import 'dotenv/config';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { GmailService } from './gmail-service';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { HumanMessage } from '@langchain/core/messages';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function initializeGmail(): Promise<GmailService | null> {
  const credentialsPath = path.join(process.cwd(), 'gmail-credentials.json');
  const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');

  if (!fs.existsSync(credentialsPath)) {
    console.log('⚠️  Gmail credentials not found at gmail-credentials.json');
    console.log('Gmail features will be disabled.\n');
    return null;
  }

  try {
    console.log('🔧 Initializing Gmail...');

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const gmailCreds = {
      client_id: credentials.installed?.client_id || credentials.web?.client_id,
      client_secret: credentials.installed?.client_secret || credentials.web?.client_secret,
      redirect_uri: credentials.installed?.redirect_uris?.[0] || credentials.web?.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
    };

    const gmailService = new GmailService(gmailCreds);

    // Try to load existing tokens
    const tokens = gmailService.loadTokens(tokenPath);

    if (tokens) {
      console.log('✅ Gmail authenticated with existing tokens\n');
      return gmailService;
    } else {
      const authUrl = gmailService.getAuthUrl();
      console.log('\n📋 Gmail OAuth Setup Required:');
      console.log('='.repeat(50));
      console.log('1. Visit this URL:\n');
      console.log(authUrl);
      console.log('\n2. Sign in and authorize the app');
      console.log('3. Copy the authorization code\n');

      const authCode = await askQuestion('Paste the authorization code here: ');

      const newTokens = await gmailService.getTokens(authCode);
      gmailService.setTokens(newTokens);
      gmailService.saveTokens(newTokens, tokenPath);

      console.log('\n✅ Gmail authenticated successfully!\n');
      return gmailService;
    }
  } catch (error) {
    console.log('⚠️  Could not initialize Gmail:', error);
    console.log('Gmail features will be disabled.\n');
    return null;
  }
}

// Helper function to make HTTP GET requests
function makeHttpRequest(url: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const req = protocol.get(url, (res) => {
        resolve({
          success: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode
        });
      });

      req.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timeout'
        });
      });
    } catch (error) {
      resolve({
        success: false,
        error: String(error)
      });
    }
  });
}

// Helper function to convert time ranges to Gmail query syntax
function buildGmailQuery(params: {
  query?: string;
  timeRange?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  label?: string;
}): string {
  const queryParts: string[] = [];

  if (params.query) {
    queryParts.push(params.query);
  }

  if (params.timeRange) {
    const now = new Date();
    let afterDate: Date;

    switch (params.timeRange.toLowerCase()) {
      case 'today':
        afterDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'yesterday':
        afterDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const beforeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        queryParts.push(`after:${formatDate(afterDate)} before:${formatDate(beforeDate)}`);
        return queryParts.join(' ');
      case 'last week':
      case 'past week':
        afterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last month':
      case 'past month':
        afterDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'last 3 days':
        afterDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        break;
      default:
        const daysMatch = params.timeRange.match(/^(\d+)\s*d(ays?)?$/i);
        if (daysMatch) {
          const days = parseInt(daysMatch[1]);
          afterDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        } else {
          afterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
    }

    if (params.timeRange.toLowerCase() !== 'yesterday') {
      queryParts.push(`after:${formatDate(afterDate)}`);
    }
  }

  if (params.from) queryParts.push(`from:${params.from}`);
  if (params.to) queryParts.push(`to:${params.to}`);
  if (params.subject) queryParts.push(`subject:${params.subject}`);
  if (params.hasAttachment) queryParts.push('has:attachment');
  if (params.isUnread !== undefined) queryParts.push(params.isUnread ? 'is:unread' : 'is:read');
  if (params.label) queryParts.push(`label:${params.label}`);

  return queryParts.join(' ') || 'in:inbox';
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

// Create Gmail tools using LangGraph's DynamicStructuredTool
function createGmailTools(gmailService: GmailService) {
  const listEmailsTool = new DynamicStructuredTool({
    name: 'list_emails',
    description: 'List emails from Gmail inbox with flexible filters including time ranges, sender, subject, and more',
    schema: z.object({
      maxResults: z.number().optional().default(10).describe('Maximum number of emails to retrieve (default: 10, max: 100)'),
      query: z.string().optional().describe('Raw Gmail search query (e.g., "is:unread", "from:sender@email.com")'),
      timeRange: z.string().optional().describe('Time range filter: "today", "yesterday", "last week", "last month", "last 3 days", or "Xd" for X days'),
      from: z.string().optional().describe('Filter by sender email address or name'),
      to: z.string().optional().describe('Filter by recipient email address'),
      subject: z.string().optional().describe('Filter by subject keywords'),
      hasAttachment: z.boolean().optional().describe('Filter for emails with attachments'),
      isUnread: z.boolean().optional().describe('Filter by read/unread status (true for unread, false for read)'),
      label: z.string().optional().describe('Filter by Gmail label (e.g., "inbox", "important", "sent")')
    }),
    func: async (params: any): Promise<string> => {
      const {
        maxResults = 10,
        query,
        timeRange,
        from,
        to,
        subject,
        hasAttachment,
        isUnread,
        label
      } = params;

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const gmailQuery = buildGmailQuery({
        query,
        timeRange,
        from,
        to,
        subject,
        hasAttachment,
        isUnread,
        label
      });

      console.log(`📧 Searching with query: ${gmailQuery}`);

      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults, 100),
        q: gmailQuery
      });

      const messages = response.data.messages || [];
      const emailDetails = [];

      for (const msg of messages.slice(0, Math.min(maxResults, 20))) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date', 'To']
        });

        const headers = details.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

        emailDetails.push({
          id: msg.id,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: getHeader('Date'),
          to: getHeader('To'),
          snippet: details.data.snippet
        });
      }

      return JSON.stringify({ emails: emailDetails }, null, 2);
    }
  });

  const readEmailTool = new DynamicStructuredTool({
    name: 'read_email',
    description: 'Read the full content of a specific email by ID',
    schema: z.object({
      emailId: z.string().describe('Gmail message ID of the email to read')
    }),
    func: async ({ emailId }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: emailId,
        format: 'full'
      });

      const headers = response.data.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

      // Extract email body
      let body = '';
      if (response.data.payload?.parts) {
        for (const part of response.data.payload.parts) {
          if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
            if (part.body?.data) {
              body += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }
      } else if (response.data.payload?.body?.data) {
        body = Buffer.from(response.data.payload.body.data, 'base64').toString('utf-8');
      }

      return JSON.stringify({
        id: emailId,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        date: getHeader('Date'),
        body: body || response.data.snippet
      }, null, 2);
    }
  });

  const archiveEmailTool = new DynamicStructuredTool({
    name: 'archive_email',
    description: 'Archive one or more emails by removing them from the inbox (they will still be accessible in All Mail)',
    schema: z.object({
      emailIds: z.array(z.string()).describe('Array of Gmail message IDs to archive')
    }),
    func: async ({ emailIds }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const results = [];
      const errors = [];

      for (const emailId of emailIds) {
        try {
          await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              removeLabelIds: ['INBOX']
            }
          });
          results.push(emailId);
          console.log(`✅ Archived email: ${emailId}`);
        } catch (error) {
          errors.push({ emailId, error: String(error) });
          console.log(`❌ Failed to archive email ${emailId}: ${error}`);
        }
      }

      return JSON.stringify({
        success: results.length > 0,
        archived: results,
        failed: errors,
        message: `Successfully archived ${results.length} email(s)${errors.length > 0 ? `, failed to archive ${errors.length}` : ''}`
      }, null, 2);
    }
  });

  const unsubscribeEmailTool = new DynamicStructuredTool({
    name: 'unsubscribe_email',
    description: 'Automatically unsubscribe from an email by parsing the List-Unsubscribe header and making the necessary HTTP request',
    schema: z.object({
      emailId: z.string().describe('Gmail message ID of the email to unsubscribe from')
    }),
    func: async ({ emailId }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      try {
        // Get the email with full headers
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: emailId,
          format: 'full'
        });

        const headers = response.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const listUnsubscribe = getHeader('List-Unsubscribe');
        const fromHeader = getHeader('From');

        if (!listUnsubscribe) {
          return JSON.stringify({
            success: false,
            error: 'No List-Unsubscribe header found in this email',
            from: fromHeader,
            message: 'This email does not have an automated unsubscribe link. You may need to manually unsubscribe.'
          }, null, 2);
        }

        console.log(`📧 Found List-Unsubscribe header: ${listUnsubscribe}`);

        // Parse List-Unsubscribe header - can contain multiple URLs in <> brackets
        const urlMatches = listUnsubscribe.match(/<([^>]+)>/g);
        if (!urlMatches) {
          return JSON.stringify({
            success: false,
            error: 'Could not parse List-Unsubscribe header',
            from: fromHeader,
            listUnsubscribe: listUnsubscribe
          }, null, 2);
        }

        // Extract URLs and filter for https URLs (prefer https over mailto)
        const urls = urlMatches.map(match => match.slice(1, -1)); // Remove < and >
        const httpUrls = urls.filter(url => url.startsWith('http://') || url.startsWith('https://'));

        if (httpUrls.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No HTTP unsubscribe URLs found (only mailto: links available)',
            from: fromHeader,
            availableUrls: urls,
            message: 'This email only provides mailto: unsubscribe links, which cannot be automated.'
          }, null, 2);
        }

        // Try each HTTP URL until one succeeds
        const results = [];
        for (const url of httpUrls) {
          console.log(`🔗 Attempting unsubscribe via: ${url}`);
          const result = await makeHttpRequest(url);
          results.push({ url, ...result });

          if (result.success) {
            console.log(`✅ Successfully unsubscribed via ${url}`);
            return JSON.stringify({
              success: true,
              from: fromHeader,
              unsubscribeUrl: url,
              statusCode: result.statusCode,
              message: `Successfully unsubscribed from ${fromHeader}`
            }, null, 2);
          }
        }

        // If we get here, all attempts failed
        return JSON.stringify({
          success: false,
          from: fromHeader,
          error: 'All unsubscribe attempts failed',
          attempts: results,
          message: 'Could not automatically unsubscribe. You may need to manually visit the unsubscribe link in the email.'
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error),
          message: 'Failed to process unsubscribe request'
        }, null, 2);
      }
    }
  });

  return [listEmailsTool, readEmailTool, archiveEmailTool, unsubscribeEmailTool];
}

async function main() {
  console.log('🤖 Personal Email Management Agent (LangGraph)');
  console.log('=====================================\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable is required');
    console.log('Please add your Anthropic API key to the .env file');
    process.exit(1);
  }

  // Initialize Gmail
  const gmailService = await initializeGmail();

  if (!gmailService) {
    console.log('❌ Gmail is not authenticated. Exiting.');
    process.exit(1);
  }

  console.log('Hi! I\'m your personal email management assistant.');
  console.log('I can help you with email tasks.\n');
  console.log('💡 Commands: "quit" (exit)\n');

  // Create LangGraph tools
  const tools = createGmailTools(gmailService);

  // Initialize Claude model
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-5-20250929',
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // System prompt to guide the agent's behavior
  const systemPrompt = `You are an advanced personal email management assistant for Emily.

🎯 **YOUR PRIORITIES (in order):**
1. **MAIN PRIORITY**: Ensure Emily responds to and takes action on TRULY important emails
   - Never let Action Required emails slip through, especially recruitment/job search
   - Make sure critical deadlines and questions are addressed
   - Present these individually with full context so Emily can make informed decisions

2. **SECOND PRIORITY**: Help Emily achieve inbox zero
   - Efficiently process non-critical emails in batches
   - Archive, unsubscribe, or organize to clear the inbox
   - Move quickly through informational content

**Remember**: It's better to spend time on one important email than to archive 100 newsletters. Quality over speed for critical emails.

🔧 **Available Gmail Operations:**
- **list_emails**: Search and filter emails with flexible options
  - Time ranges: "today", "yesterday", "last week", "last month", or custom (e.g., "7d")
  - Filters: sender (from), recipient (to), subject keywords, attachments, read/unread status, labels
  - Examples: "emails from today", "unread emails from last week", "emails with attachments from john@example.com"

- **read_email**: Get full content of a specific email by ID
  - Use after listing emails to read the complete message body

- **archive_email**: Archive one or more emails (removes from inbox, keeps in All Mail)
  - Can archive multiple emails at once by providing an array of email IDs

- **unsubscribe_email**: Automatically unsubscribe from promotional/marketing emails
  - Parses the List-Unsubscribe header and makes the HTTP request on your behalf
  - Works with emails that have standard RFC-compliant unsubscribe links
  - Use this for emails in the "Unsubscribe" category
  - Note: Not all emails have automated unsubscribe links; some may require manual action

📋 **Email Classification System:**
When asked to classify or organize emails, use these categories:

**1. Action Required**
Criteria:
- Personal emails from known contacts (not automated)
- Recruitment/job search correspondence (HIGHEST PRIORITY)
- Direct questions or calls for volunteers/action
- Calendar invitations for job interviews
- Boston-area LGBTQ, design, or product management meetup invitations
- Critical service alerts (order issues, payment failures, service outages)

Meta-summary format:
Subject: <email subject>
People: <list all participants with emails>
Synopsis: <one-sentence summary of thread purpose>
Analysis: <identify the single most important question/action required, sender's sentiment (casual/urgent/formal), deadline if any>

**2. Summarize & Inform**
Criteria:
- Newsletters, digests, articles (NYT, Substack, thought leaders)
- Content about parenting, product management, or LGBTQ topics

Meta-summary format:
Source: <publication or sender name>
Subject: <email subject>
Key Insights: <2-4 sentence synopsis of main points and key takeaway>

**3. Summarize Events**
Criteria:
- Live events, concerts, workshops
- Eventbrite, Songkick event notifications
- LGBTQ or Boston Sex Positive event invitations
- Personal calendar invitations from "Heather"
- EXCLUDE job interview invitations

Meta-summary format:
Event: <event name>
From: <invitation sender>
What: <one-sentence event description>
Where: <venue, address, location>
When: <full date and time>

**4. Summarize Purchases**
Criteria:
- Order confirmations
- Shipping notifications and delivery updates
- Digital receipts

Meta-summary format:
Vendor: <store name>
Subject: <email subject>
Update: "You purchased [Item(s)] for [Price]." OR "Your order containing [Item(s)] has shipped." OR "Your order will be delivered on [Date]."

**5. Unsubscribe**
Criteria:
- Marketing emails trying to sell something
- Promotional content from services not actively/regularly used

Meta-summary format:
Sender: <business or service name>
Recommendation: <one-sentence justification, e.g., "This is a promotional mailing list for a service you no longer use.">

**6. Immediate Archive**
Criteria:
- Automated informational notifications (not critical)
- Resolved customer support threads
- Promotional emails from services Emily uses but this specific email isn't actionable
- General corporate announcements from services she uses

Meta-summary: "This email is informational and does not require a specific action or summary. It can be safely archived."

**7. Other**
Criteria:
- Only use when all other categories have been exhausted

**WORKFLOW APPROACH:**
Work iteratively through emails in chunks or categories, ALWAYS starting with Action Required emails:

**Suggested Order:**
1. Action Required emails (handle individually, most important)
2. Summarize Events (time-sensitive, may need responses)
3. Summarize Purchases (quick review for any issues)
4. Summarize & Inform (batch archive)
5. Unsubscribe (batch cleanup)
6. Immediate Archive (batch archive)
7. Other (review case-by-case)

Examples:
- "Let's start with Action Required emails first"
- "Now let's quickly process the Summarize Purchases emails"
- "Let's review emails from the last hour, starting with anything important"

**BATCH PROCESSING (for non-important emails):**
Group similar emails and present them with options. Format:

**[Category Name]** (X emails)
<Summarized list with email IDs>

**Options:**
1. Archive all
2. Read specific email(s) (provide number/ID)
3. Skip for now
4. Unsubscribe from sender(s)

Example: "Here are 10 Summarize & Inform emails from this week. [list]. Options: 1) Archive all, 2) Read specific email(s), 3) Skip for now, 4) Unsubscribe from sender(s)"

**INDIVIDUAL HANDLING (for Action Required emails):**
Present each important email individually with:

**[Email Subject]**
<Meta-summary with full details>

**Options:**
1. Read full email
2. Archive
3. Skip for now
4. Next email

**IMPORTANT GUIDELINES:**
1. **ALWAYS start with Action Required emails** - never skip to other categories first
2. For Action Required emails: handle individually, provide full context, highlight deadlines and required actions
3. Prioritize recruitment/job search emails above all else - these are career-critical
4. Be proactive - actually perform actions, don't just explain what could be done
5. When listing emails, always mention the email IDs so users can reference them
6. Work in manageable chunks (5-10 emails at a time, or one category at a time)
7. For non-Action Required categories, prefer batch processing with summarized lists
8. Always provide the appropriate meta-summary format for each classification
9. Use consistent numbered options - don't change the order of action choices
10. If an email body is very long, summarize the key points
11. Always confirm successful operations (e.g., "✅ Archived 3 emails")
12. After completing a chunk/category, ask "What would you like to review next?" or suggest the next logical category
13. **Don't rush through important emails just to achieve inbox zero** - thoroughness matters for critical emails

**RESPONSE STYLE:**
- Be concise and helpful
- Use the tools to provide actual results, not just descriptions
- Maintain context across the conversation
- When classifying, present results grouped by category
- Present options as numbered lists for easy selection
- Guide the user through their inbox systematically`;

  // Create ReAct agent - LangGraph handles conversation history automatically!
  const agent = createReactAgent({
    llm: model,
    tools: tools,
    messageModifier: systemPrompt
  });

  // Conversation state managed by LangGraph
  const conversationMessages: any[] = [];

  while (true) {
    try {
      const userInput = await askQuestion('💬 What would you like me to help you with? (type "quit" to exit): ');

      if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye!');
        break;
      }

      if (userInput.trim() === '') {
        continue;
      }

      console.log('\n🤔 Processing...\n');

      // Add user message
      conversationMessages.push(new HumanMessage(userInput));

      // Invoke agent - LangGraph handles everything!
      const result = await agent.invoke({
        messages: conversationMessages
      });

      // LangGraph returns the full updated message history
      conversationMessages.length = 0;
      conversationMessages.push(...result.messages);

      // Extract and display the final response
      const lastMessage = result.messages[result.messages.length - 1];
      console.log('🤖 Assistant:', lastMessage.content);

      console.log('\n' + '─'.repeat(50) + '\n');

    } catch (error) {
      console.error('❌ Error:', error);
      console.log('\n' + '─'.repeat(50) + '\n');
    }
  }

  rl.close();
}

if (require.main === module) {
  main().catch(console.error);
}

import 'dotenv/config';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { GmailService } from './gmail-service';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
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

  return [listEmailsTool, readEmailTool, archiveEmailTool];
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

  // Create ReAct agent - LangGraph handles conversation history automatically!
  const agent = createReactAgent({
    llm: model,
    tools: tools,
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

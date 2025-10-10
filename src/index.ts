import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { gmailTools } from './gmail-tools';
import { EmailWorkflowManager } from './email-workflow';
import { EmailClassifier, EmailData } from './email-classifier';
import * as readline from 'readline';

/**
 * Helper function to execute a query and extract the result string
 */
async function executeQuery(params: { prompt: string | AsyncIterable<SDKUserMessage>; options?: Options }): Promise<string> {
  let finalResult = '';

  for await (const msg of query(params)) {
    if (msg.type === 'result') {
      if (msg.subtype === 'success') {
        finalResult = msg.result;
      } else {
        // Handle error cases
        throw new Error(`Query failed: ${msg.subtype}`);
      }
    }
  }

  return finalResult;
}

/**
 * Create readline interface for user input
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompt user for input
 */
function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Convert Gmail API response to EmailData format for classification
 */
function convertGmailToEmailData(gmailData: any): EmailData {
  return {
    subject: gmailData.subject || 'No Subject',
    date: gmailData.date || new Date().toISOString(),
    from: gmailData.from || 'Unknown Sender',
    to: gmailData.to || 'Unknown Recipient',
    replyTo: gmailData.replyTo,
    textAsHtml: gmailData.body || gmailData.snippet || 'No content available'
  };
}

/**
 * Attempt to fetch real emails from Gmail, with fallback to demo data
 */
async function fetchEmailsForTriage(): Promise<EmailData[]> {
  try {
    console.log('📧 Attempting to fetch real emails from Gmail...');

    // Try to fetch emails using the Gmail tools
    const listResult = await executeQuery({
      prompt: 'Use list_emails tool to get up to 20 unread emails from my Gmail inbox. If authentication is required, provide clear instructions.',
      options: {
        mcpServers: {
          'gmail-tools': createSdkMcpServer({
            name: 'gmail-tools',
            tools: gmailTools
          })
        }
      }
    });

    console.log('📊 Gmail list result:', listResult);

    // If we get email IDs, fetch the full content
    const emailIdsMatch = listResult.match(/ID: ([a-zA-Z0-9]+)/g);
    if (emailIdsMatch && emailIdsMatch.length > 0) {
      const emailIds = emailIdsMatch.map((match: string) => match.replace('ID: ', ''));
      const emails: EmailData[] = [];

      console.log(`📖 Fetching full content for ${Math.min(emailIds.length, 5)} emails...`);

      for (let i = 0; i < Math.min(emailIds.length, 5); i++) {
        try {
          const emailResult = await executeQuery({
            prompt: `Use read_email tool to get full content for email ID: ${emailIds[i]}`,
            options: {
              mcpServers: {
                'gmail-tools': createSdkMcpServer({
                  name: 'gmail-tools',
                  tools: gmailTools
                })
              }
            }
          });

          // Parse email data from the result and convert to EmailData format
          const subjectMatch = emailResult.match(/Subject: (.+)/);
          const fromMatch = emailResult.match(/From: (.+)/);
          const dateMatch = emailResult.match(/Date: (.+)/);
          const bodyMatch = emailResult.match(/Body:\n([\s\S]+)/);

          emails.push(convertGmailToEmailData({
            subject: subjectMatch?.[1] || 'No Subject',
            from: fromMatch?.[1] || 'Unknown Sender',
            date: dateMatch?.[1] || new Date().toISOString(),
            to: 'me',
            body: bodyMatch?.[1] || emailResult
          }));
        } catch (error) {
          console.log(`⚠️ Could not fetch email ${emailIds[i]}:`, error);
        }
      }

      if (emails.length > 0) {
        return emails;
      }
    }

    throw new Error('No emails retrieved from Gmail');

  } catch (error) {
    console.log('⚠️ Could not fetch real emails from Gmail:', error);
    console.log('🧠 Using demo emails instead...\n');

    return [
      convertGmailToEmailData({
        subject: 'Urgent: Account verification required',
        from: 'security@bankexample.com',
        body: 'Your account requires immediate verification. Please click the link to verify within 24 hours.',
        date: new Date().toISOString(),
        to: 'me'
      }),
      convertGmailToEmailData({
        subject: 'Coffee chat next week?',
        from: 'friend@example.com',
        body: 'Hey! Would you like to grab coffee next Tuesday? Let me know what works for you.',
        date: new Date().toISOString(),
        to: 'me'
      }),
      convertGmailToEmailData({
        subject: 'Weekly Newsletter - Tech Updates',
        from: 'newsletter@techsite.com',
        body: 'This week in tech: AI advances, new programming languages, and startup news.',
        date: new Date().toISOString(),
        to: 'me'
      })
    ];
  }
}

/**
 * Main function to run the email management agent
 */
async function main() {
  console.log('🤖 Personal Email Management Agent');
  console.log('=====================================\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable is required');
    console.log('Please add your Anthropic API key to the .env file');
    process.exit(1);
  }

  console.log('Hi! I\'m your personal email management assistant.');
  console.log('I can help you with Gmail tasks like reading, sending, organizing, and managing your emails.\n');

  while (true) {
    try {
      const userInput = await askQuestion('💬 What would you like me to help you with? (type "quit" to exit): ');

      if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye! Have a great day!');
        break;
      }

      if (userInput.trim() === '') {
        continue;
      }

      console.log('\n🤔 Processing your request...\n');

      // Check if user wants to run email triage workflow
      if (userInput.toLowerCase().includes('triage') || userInput.toLowerCase().includes('classify') || userInput.toLowerCase().includes('organize inbox')) {
        console.log('🔄 Starting intelligent email triage workflow...\n');

        // Initialize workflow manager
        const workflowManager = new EmailWorkflowManager(process.env.ANTHROPIC_API_KEY!, rl);

        // For demo purposes, we'll need to get emails first
        console.log('📧 To run email triage, I need to fetch your recent emails first.');
        console.log('This will use the Gmail tools to get your inbox data.\n');

        const confirm = await askQuestion('Proceed with email triage? (y/n): ');
        if (confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes') {
          try {
            console.log('🚀 Starting email triage workflow...\n');

            // Fetch emails (real or demo data)
            const emails = await fetchEmailsForTriage();

            // Run the actual workflow
            await workflowManager.processInboxWorkflow(emails);

          } catch (error) {
            console.error('❌ Error during email triage:', error);
            console.log('💡 Tip: Make sure you have properly configured Gmail authentication using the init_gmail and authenticate_gmail tools.');
          }
        } else {
          console.log('❌ Email triage cancelled.');
        }
        continue;
      }

      const result = await executeQuery({
        prompt: `You are an advanced personal email management assistant with intelligent classification capabilities.

The user said: "${userInput}"

You can help with:

🔧 **Gmail Operations:**
- Initializing Gmail connection (init_gmail) - Required first step for new users
- Authenticating with Gmail (authenticate_gmail) - Follow the OAuth flow
- Listing emails (list_emails) - Fetch emails with filters like "is:unread"
- Reading specific emails (read_email) - Get full email content by ID
- Sending emails (send_email) - Compose and send new emails
- Managing emails - archive, delete, mark as read/unread (manage_email)
- Listing Gmail labels (list_labels) - See all available labels

🧠 **Intelligent Email Triage:**
- Use "triage my inbox" or "organize my inbox" to start the smart classification workflow
- Automatically categorizes emails by priority and type
- Provides step-by-step guidance for important emails
- Creates detailed digests of informational content
- Identifies junk email for cleanup
- Reduces email anxiety with supportive guidance

🎯 **Email Classification Features:**
- Urgent actions (with anxiety support and step-by-step guidance)
- Personal communications (with response suggestions)
- Informational digests (preserving all key details)
- Event tracking and calendar integration
- Transaction logging
- Automated junk identification

**IMPORTANT INSTRUCTIONS:**
1. If the user is asking for any Gmail operations and hasn't authenticated yet, guide them through the setup:
   - First use init_gmail with their credentials file path
   - Then use authenticate_gmail with the authorization code
2. For email operations, always check authentication status first
3. Use specific Gmail tool calls rather than just explaining what could be done
4. Be proactive in offering the intelligent triage workflow when appropriate
5. Provide clear, actionable responses with actual tool usage

Respond with actual Gmail tool calls when the user requests email operations. Don't just explain - actually perform the requested actions.`,
        options: {
          mcpServers: {
            'gmail-tools': createSdkMcpServer({
              name: 'gmail-tools',
              tools: gmailTools
            })
          }
        }
      });

      console.log('🤖 Assistant:', result);
      console.log('\n' + '─'.repeat(50) + '\n');

    } catch (error) {
      console.error('❌ Error:', error);
      console.log('\n' + '─'.repeat(50) + '\n');
    }
  }

  rl.close();
}

// Run the example if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

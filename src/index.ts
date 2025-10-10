import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { gmailTools } from './gmail-tools';
import { EmailWorkflowManager } from './email-workflow';
import { EmailClassifier } from './email-classifier';
import * as readline from 'readline';

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
          console.log('🚀 Email triage workflow will be implemented here...');
          console.log('💡 Integration with Gmail tools for fetching emails is needed.');
          console.log('📝 This would fetch recent emails and run the classification workflow.');
        } else {
          console.log('❌ Email triage cancelled.');
        }
        continue;
      }

      const result = await query({
        prompt: `You are an advanced personal email management assistant with intelligent classification capabilities.

The user said: "${userInput}"

You can help with:

🔧 **Gmail Operations:**
- Initializing Gmail connection (init_gmail)
- Authenticating with Gmail (authenticate_gmail)
- Listing emails (list_emails)
- Reading specific emails (read_email)
- Sending emails (send_email)
- Managing emails - archive, delete, mark as read/unread (manage_email)
- Listing Gmail labels (list_labels)

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

If this is the first time using the agent, guide them through the setup process.
Be friendly, helpful, and highlight the intelligent triage capabilities.`,
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

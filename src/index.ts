import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { gmailTools } from './gmail-tools';
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

      const result = await query({
        prompt: `You are a helpful email management assistant. The user said: "${userInput}"

Please help them with their email-related tasks. You have access to Gmail tools for:
- Initializing Gmail connection (init_gmail)
- Authenticating with Gmail (authenticate_gmail)
- Listing emails (list_emails)
- Reading specific emails (read_email)
- Sending emails (send_email)
- Managing emails - archive, delete, mark as read/unread (manage_email)
- Listing Gmail labels (list_labels)

If this is the first time using the agent, guide them through the setup process.
Be friendly, helpful, and provide clear instructions.`,
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

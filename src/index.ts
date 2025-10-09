import { query, tool } from '@anthropic-ai/claude-agent-sdk';

/**
 * Example tool that adds two numbers together
 */
const addTool = tool({
  name: 'add',
  description: 'Add two numbers together',
  parameters: {
    a: { type: 'number', description: 'First number' },
    b: { type: 'number', description: 'Second number' },
  },
  execute: async ({ a, b }) => {
    return a + b;
  },
});

/**
 * Main function to run a simple agent query
 */
async function main() {
  console.log('Starting Claude Agent SDK example...\n');

  const result = await query({
    prompt: 'What is 25 + 17?',
    tools: [addTool],
    options: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  console.log('Agent response:', result);
}

// Run the example if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

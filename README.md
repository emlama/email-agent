# Email Agent

A Claude Agent SDK TypeScript project.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file from the example:
```bash
cp .env.example .env
```

3. Add your Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=your-api-key-here
```

## Usage

### Development Mode
Run the agent in development mode with auto-reload:
```bash
npm run dev
```

### Build
Compile TypeScript to JavaScript:
```bash
npm run build
```

### Production
Run the compiled JavaScript:
```bash
npm start
```

## Project Structure

```
email-agent/
├── src/
│   └── index.ts          # Main agent file
├── dist/                 # Compiled output (generated)
├── .env.example          # Environment variables template
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Resources

- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk/typescript)
- [Anthropic API Documentation](https://docs.anthropic.com/)

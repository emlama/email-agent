# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup
```bash
npm install                    # Install dependencies
cp .env.example .env          # Create environment file
# Add ANTHROPIC_API_KEY to .env
```

### Running the Agent
```bash
npm run dev                   # Development mode with tsx (auto-reload)
npm run build                 # Compile TypeScript to dist/
npm start                     # Run compiled JavaScript
```

## Architecture

This is a Claude Agent SDK TypeScript project using CommonJS modules.

### Agent SDK Pattern
- **Tools**: Created with `tool()` function from `@anthropic-ai/claude-agent-sdk`
  - Define `name`, `description`, `parameters` (with types and descriptions), and `execute` function
  - Parameters are strongly typed and validated by the SDK
- **Queries**: Use `query()` function with `prompt`, `tools` array, and `options` (including `apiKey`)
- **Environment**: API key loaded from `ANTHROPIC_API_KEY` environment variable

### TypeScript Configuration
- Target: ES2022 with CommonJS modules
- Strict mode enabled
- Source in `src/`, compiled output in `dist/`
- Main entry point: `src/index.ts`

## Reference Documentation
- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk/typescript)
- [Anthropic API Documentation](https://docs.anthropic.com/)

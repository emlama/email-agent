# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Setup
```bash
npm install                    # Install dependencies
cp .env.example .env          # Create environment file
# Add ANTHROPIC_API_KEY to .env
# Add Gmail OAuth credentials as gmail-credentials.json
```

### Running the Agent
```bash
npm run dev                   # Development mode with tsx
npm start                     # Same as dev (uses tsx)
```

## Architecture

This is a Gmail email management agent built with **LangGraph** and **Claude (Anthropic)**.

### Technology Stack
- **LangGraph**: Orchestration framework for building controllable AI agents
- **Claude Sonnet 4.5**: Anthropic's latest model for reasoning and tool use
- **Gmail API**: OAuth2 authentication and email operations
- **TypeScript**: Type-safe development with CommonJS modules

### Agent Pattern (ReAct)
The agent uses LangGraph's `createReactAgent` which implements the ReAct (Reasoning + Acting) pattern:
1. **Reason**: Claude analyzes the user's request
2. **Act**: Calls Gmail tools (list, read, archive emails)
3. **Observe**: Receives tool results
4. **Repeat**: Continues until task is complete

LangGraph automatically handles:
- Conversation history and memory
- Multi-turn tool calling
- State management
- Error handling and retries

### Gmail Tools
Tools are defined using LangGraph's `DynamicStructuredTool`:
- **list_emails**: Search emails with filters (time range, sender, subject, etc.)
- **read_email**: Read full email content by ID
- **archive_email**: Archive emails (remove from inbox)

### Project Structure
- `src/langgraph-index.ts`: Main entry point with LangGraph agent
- `src/gmail-service.ts`: Gmail OAuth2 and API wrapper
- `gmail-credentials.json`: OAuth2 credentials from Google Cloud Console
- `gmail-tokens.json`: Cached OAuth2 tokens (auto-generated)

## Reference Documentation
- [LangGraph TypeScript](https://langchain-ai.github.io/langgraphjs/)
- [LangChain Anthropic Integration](https://js.langchain.com/docs/integrations/platforms/anthropic/)
- [Gmail API Documentation](https://developers.google.com/gmail/api)

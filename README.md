# Email Agent

A Gmail management agent built with LangGraph and Claude AI.

## Features

- 📧 **Email Management**: List, read, archive, and draft replies to emails
- 🔍 **Smart Search**: Advanced filtering with Gmail query syntax
- 🤖 **Intelligent Triage**: Automatically categorize emails by importance and type
- 🚫 **Unsubscribe**: Bulk unsubscribe from newsletters with one command
- 💾 **Memory System**: Persistent context across conversations
- 🎯 **Batch Operations**: Efficiently process multiple emails at once

## Quick Start

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment:**
```bash
cp .env.example .env
# Add your Anthropic API key to .env
```

3. **Configure Gmail API:**
   - Follow detailed instructions in [SETUP.md](./SETUP.md)
   - Create OAuth credentials in Google Cloud Console
   - Save as `gmail-credentials.json`

4. **Run the agent:**
```bash
npm run dev
```

For detailed setup instructions, see [SETUP.md](./SETUP.md).
For usage examples, see [USAGE.md](./USAGE.md).

## Project Structure

```
email-agent/
├── src/
│   ├── langgraph-index.ts  # Main agent entry point
│   ├── gmail-service.ts    # Gmail API wrapper with OAuth2
│   └── triage-tool.ts      # Intelligent email categorization
├── memories/               # Persistent memory storage (auto-created)
├── dist/                   # Compiled output (generated)
├── .env.example            # Environment variables template
├── gmail-credentials.json  # Gmail OAuth credentials (not tracked)
├── gmail-tokens.json       # OAuth tokens (auto-generated, not tracked)
├── package.json
├── tsconfig.json
├── SETUP.md                # Detailed setup instructions
├── USAGE.md                # Usage guide with examples
└── README.md
```

## Available Tools

### Gmail Tools
- `list_emails` - Search and filter emails with flexible query options
- `read_email` - Read full email content by ID
- `archive_email` - Archive emails (remove from inbox)
- `unsubscribe_email` - Automatically unsubscribe from newsletters
- `draft_reply` - Create draft replies with proper threading
- `unsubscribe_and_archive_by_ids` - Bulk unsubscribe and archive specific emails
- `unsubscribe_and_archive_by_query` - Search and bulk unsubscribe/archive (with dry run)
- `triage_inbox` - Categorize emails by priority and type

### Memory Tools
- `view_memory` - View memory files or directory contents
- `create_memory` - Create new memory files for persistent context
- `str_replace_memory` - Update memory content
- `insert_memory` - Insert content at specific lines
- `delete_memory` - Delete memory files
- `rename_memory` - Rename or move memory files

## Technology Stack

- **LangGraph**: Agent orchestration framework
- **Claude Sonnet 3.5**: Anthropic's AI model for reasoning and tool use
- **Gmail API**: OAuth2 authentication and email operations
- **TypeScript**: Type-safe development with CommonJS modules

## Development

### Run in development mode (with auto-reload):
```bash
npm run dev
```

### Build for production:
```bash
npm run build
```

### Run compiled version:
```bash
npm start
```

## Security

- ✅ OAuth2 credentials never committed to version control
- ✅ Tokens stored locally and auto-refreshed
- ✅ Memory files validated to prevent path traversal
- ✅ Dry-run mode for bulk operations

See [SETUP.md](./SETUP.md) for security best practices.

## Resources

- [LangGraph Documentation](https://langchain-ai.github.io/langgraphjs/)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
- [Anthropic API Documentation](https://docs.anthropic.com/)

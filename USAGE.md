# Email Agent Usage Guide

Your personal Gmail management agent is ready to help! This guide shows you how to use all the available features.

## Starting the Agent

```bash
npm run dev
```

The agent will start and prompt you for commands. You can type natural language requests, and the agent will understand and execute them using the appropriate Gmail tools.

## Available Commands and Examples

### 🔐 Initial Setup

**First time setup:**
```
"Set up my Gmail connection"
"I need to connect to Gmail"
"Initialize Gmail"
```

The agent will guide you through the OAuth authentication process.

### 📧 Reading Emails

**List recent emails:**
```
"Show me my recent emails"
"List my last 10 emails"
"What's in my inbox?"
```

**List emails with filters:**
```
"Show me unread emails"
"List emails from john@example.com"
"Find emails with subject containing 'meeting'"
"Show me emails labeled as important"
```

**Read a specific email:**
```
"Read the email with ID 123abc"
"Show me the full content of email 123abc"
```

### ✉️ Sending Emails

**Send a simple email:**
```
"Send an email to john@example.com with subject 'Hello' and message 'How are you?'"
"Compose an email to my team about the meeting tomorrow"
```

**Send with CC/BCC:**
```
"Send an email to john@example.com, CC jane@example.com, subject 'Project Update'"
```

**Send HTML email:**
```
"Send an HTML email to john@example.com with a nicely formatted message"
```

### 🗂️ Email Management

**Archive emails:**
```
"Archive the email with ID 123abc"
"Archive all emails from newsletter@example.com"
```

**Mark as read/unread:**
```
"Mark email 123abc as read"
"Mark email 123abc as unread"
```

**Delete emails:**
```
"Delete email 123abc"
"Move email 123abc to trash"
```

**Manage labels:**
```
"Add label 'Important' to email 123abc"
"Remove label 'Spam' from email 123abc"
"Show me all available labels"
```

### 🔍 Advanced Search

**Search with Gmail query syntax:**
```
"Find emails from last week that are unread"
"Search for emails with attachments from john@example.com"
"Show me emails in the 'Work' label from yesterday"
"Find emails larger than 10MB"
```

**Complex filters:**
```
"List emails from the last 3 days that have the word 'urgent' in the subject"
"Show me all emails from my boss that are still unread"
```

## Natural Language Examples

The agent understands natural language, so you can phrase requests in various ways:

### Checking Email
- "Do I have any new messages?"
- "What emails came in today?"
- "Check my inbox for anything important"
- "Any urgent emails I need to respond to?"

### Email Organization
- "Clean up my inbox by archiving old emails"
- "Help me organize my emails by moving newsletters to a folder"
- "Mark all emails from LinkedIn as read"

### Productivity Tasks
- "Find all emails about the Johnson project"
- "Show me emails that need my response"
- "Help me find that email from last month about the budget"

### Composing Responses
- "Help me write a professional response to the last email from my client"
- "Draft a thank you email to the team"
- "Compose a follow-up email for the meeting yesterday"

## Advanced Features

### Bulk Operations
```
"Mark all emails from newsletter@example.com as read"
"Archive all emails older than 30 days in the 'Promotions' folder"
"Delete all emails in spam folder"
```

### Email Analysis
```
"Analyze my email patterns for the last week"
"Who sends me the most emails?"
"What are my most common email subjects?"
```

### Smart Filtering
```
"Show me emails that might need urgent attention"
"Find emails that look like they're waiting for my response"
"List emails from people I haven't heard from in a while"
```

## Gmail Query Syntax Reference

You can use Gmail's search operators for precise filtering:

- `from:sender@email.com` - Emails from specific sender
- `to:recipient@email.com` - Emails to specific recipient
- `subject:keyword` - Emails with keyword in subject
- `has:attachment` - Emails with attachments
- `is:unread` - Unread emails
- `is:read` - Read emails
- `is:important` - Important emails
- `is:starred` - Starred emails
- `label:labelname` - Emails with specific label
- `after:2023/12/01` - Emails after specific date
- `before:2023/12/31` - Emails before specific date
- `older_than:7d` - Emails older than 7 days
- `newer_than:3d` - Emails newer than 3 days
- `size:larger:10M` - Emails larger than 10MB

### Example combinations:
```
"Find unread emails from john@example.com with attachments"
-> uses: "from:john@example.com has:attachment is:unread"

"Show me important emails from last week"
-> uses: "is:important newer_than:7d"
```

## Tips for Best Results

1. **Be specific**: Instead of "delete emails", say "delete emails older than 30 days"
2. **Use email IDs**: When managing specific emails, use the email ID shown in listings
3. **Batch operations**: Ask for multiple actions in one request when possible
4. **Context**: Provide context like "the email from John about the meeting"

## Exiting the Agent

To stop the agent, type:
```
quit
exit
```

## Security Reminders

- Your authentication tokens are stored locally and encrypted
- The agent only accesses emails with your explicit permission
- You can revoke access anytime from your Google Account settings
- Never share your credentials or tokens with others

## Getting Help

If you encounter issues:

1. Check the [SETUP.md](./SETUP.md) for configuration problems
2. Try re-authenticating by deleting `gmail-tokens.json`
3. Verify your Gmail API quotas in Google Cloud Console
4. Check that all required scopes are granted in your OAuth consent

Have fun managing your emails with your AI assistant! 🤖📧
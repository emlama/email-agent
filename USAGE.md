# Email Agent Usage Guide

Your personal Gmail management agent is ready to help! This guide shows you how to use all the available features.

## Starting the Agent

```bash
npm run dev
```

The agent will start and prompt you for commands. You can type natural language requests, and the agent will understand and execute them using the appropriate Gmail tools.

## Available Features

### 📧 Email Management
- **List and search emails** with flexible filters
- **Read full email content** by ID
- **Archive emails** individually or in bulk
- **Draft replies** with proper email threading
- **Unsubscribe from newsletters** automatically
- **Batch operations** to process multiple emails efficiently
- **Intelligent triage** to categorize emails by priority

### 💾 Memory System
- **Persistent memory** across conversations
- **Store preferences** and contact information
- **Track job search** progress and recruiters
- **Remember email patterns** for automation

## Core Commands

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
"Show me emails from the last 3 days"
```

**Read a specific email:**
```
"Read the email with ID 123abc"
"Show me the full content of email 123abc"
```

### ✉️ Drafting Replies

**Create email drafts:**
```
"Draft a reply to email 123abc saying thank you"
"Help me write a professional response to the last email from my client"
"Create a draft reply for the meeting invitation"
```

Note: The agent creates drafts in Gmail that you can review and edit before sending. It does not send emails automatically.

### 🗂️ Email Management

**Archive emails:**
```
"Archive the email with ID 123abc"
"Archive all emails from newsletter@example.com"
```

**Unsubscribe from newsletters:**
```
"Unsubscribe from email 123abc"
"Help me unsubscribe from this newsletter"
```

**Bulk unsubscribe and archive:**
```
"Unsubscribe and archive all emails from promotions@store.com"
"Find all newsletters from the last week and unsubscribe"
```

**Batch operations with dry run:**
```
"Show me what emails would be affected by unsubscribing from sender@example.com (dry run)"
"Preview emails that match 'label:promotions older_than:30d' before archiving"
```

### 🤖 Intelligent Triage

**Categorize your inbox:**
```
"Triage my inbox"
"Categorize my recent emails"
"Organize my emails by priority"
```

The triage system categorizes emails into:
- **Action Required**: Personal emails, job search, direct questions
- **Summarize & Inform**: Newsletters, articles, content
- **Summarize Events**: Event invitations and calendar items
- **Summarize Purchases**: Order confirmations and receipts
- **Unsubscribe**: Promotional emails and junk
- **Immediate Archive**: Automated notifications
- **Other**: Uncategorized items

**View triaged emails:**
```
"Show me emails that need action"
"What's in the Action Required category?"
"List my summarized purchases"
```

### 💾 Memory System

**View memory:**
```
"What do you remember about me?"
"Show my saved preferences"
"View memory directory"
```

**Create memory files:**
```
"Remember that John Smith is my recruiter at TechCorp"
"Save my email preferences: always archive LinkedIn notifications"
"Create a memory about my job search status"
```

**Update memory:**
```
"Update my job search memory - I got an interview at Google"
"Change my email preferences to include unsubscribing from marketing emails"
```

### 🔍 Advanced Search

**Gmail query syntax:**
```
"Find emails from last week that are unread"
"Search for emails with attachments from john@example.com"
"Show me emails labeled 'Work' from yesterday"
```

**Complex filters:**
```
"List emails from the last 3 days that have the word 'urgent' in the subject"
"Find unread emails from my boss with attachments"
"Show me all emails larger than 5MB"
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
- "Help me organize my emails from newsletters"
- "Unsubscribe from all promotional emails from last month"

### Productivity Tasks
- "Find all emails about the Johnson project"
- "Show me emails that need my response"
- "Help me find that email from last month about the budget"
- "Triage my inbox and show me what's important"

### Composing Responses
- "Help me write a professional response to the last email from my client"
- "Draft a thank you email to the team"
- "Create a draft reply for the meeting invitation"

## Gmail Query Syntax Reference

You can use Gmail's search operators for precise filtering:

### Basic Operators
- `from:sender@email.com` - Emails from specific sender
- `to:recipient@email.com` - Emails to specific recipient
- `subject:keyword` - Emails with keyword in subject
- `has:attachment` - Emails with attachments
- `is:unread` - Unread emails
- `is:read` - Read emails
- `is:important` - Important emails
- `is:starred` - Starred emails
- `label:labelname` - Emails with specific label

### Time-Based Operators
- `after:2023/12/01` - Emails after specific date
- `before:2023/12/31` - Emails before specific date
- `older_than:7d` - Emails older than 7 days
- `newer_than:3d` - Emails newer than 3 days

### Size Operators
- `size:larger:10M` - Emails larger than 10MB
- `size:smaller:1M` - Emails smaller than 1MB

### Example Combinations
```
"Find unread emails from john@example.com with attachments"
→ uses: "from:john@example.com has:attachment is:unread"

"Show me important emails from last week"
→ uses: "is:important newer_than:7d"

"Archive promotional emails older than 30 days"
→ uses: "label:promotions older_than:30d"
```

## Bulk Operations Safety

The agent includes safety features for bulk operations:

### Dry Run Mode
Before processing many emails, use dry run to preview:
```
"Dry run: unsubscribe from all emails matching 'from:newsletter@example.com'"
"Preview what emails would be archived with query 'older_than:60d'"
```

### Result Limits
Bulk operations are capped at 500 emails by default for safety. You can adjust this:
```
"Unsubscribe from promotions (max 100 emails)"
"Archive old emails (limit 50)"
```

## Memory Management

### What the Agent Remembers
- **Contacts**: Important people, their roles, relationship context
- **Preferences**: Email categorization preferences, automation rules
- **Job Search**: Recruiters, companies, interview dates, follow-ups
- **Events**: Recurring events, venues, organizers
- **Email Patterns**: Senders to always archive, newsletters to unsubscribe from

### Memory Best Practices
```
"Remember that I always want to archive LinkedIn notifications"
"Save my preference: prioritize emails from @company.com domain"
"Store recruiter contact: Jane Doe at TechCorp, jane@techcorp.com"
"Update my job search status: interviewed at Google on Jan 15"
```

### View and Update Memory
```
"What do you remember about my job search?"
"Show my email preferences"
"Update my contact list with new recruiter"
"Delete old job search notes"
```

## Tips for Best Results

1. **Be specific**: Instead of "find emails", say "find unread emails from last week about the project"
2. **Use email IDs**: When managing specific emails, reference the ID shown in listings
3. **Batch operations**: Ask for multiple actions in one request when possible
4. **Use dry run**: Preview bulk operations before executing them
5. **Leverage memory**: Tell the agent your preferences once, it will remember
6. **Triage first**: Run triage to categorize emails, then act on categories

## Exiting the Agent

To stop the agent, type:
```
quit
exit
```

## Security Reminders

- Your authentication tokens are stored locally and refreshed automatically
- The agent only accesses emails with your explicit permission via OAuth2
- You can revoke access anytime from your [Google Account settings](https://myaccount.google.com/permissions)
- Never share your credentials or tokens with others
- Memory files are stored locally and never transmitted

## Getting Help

If you encounter issues:

1. Check the [SETUP.md](./SETUP.md) for configuration problems
2. Try re-authenticating by deleting `gmail-tokens.json`
3. Verify your Gmail API quotas in Google Cloud Console
4. Check that all required scopes are granted in your OAuth consent screen

## What's NOT Available

To set clear expectations, the agent currently **does not** support:
- ❌ Sending emails directly (only creates drafts)
- ❌ Deleting/trashing emails permanently
- ❌ Adding or removing labels manually
- ❌ Mark as read/unread operations
- ❌ Email analytics or statistics
- ❌ Moving emails to specific folders

These features may be added in future versions. For now, the agent focuses on reading, organizing, drafting replies, and intelligent triage.

---

Have fun managing your emails with your AI assistant! 🤖📧

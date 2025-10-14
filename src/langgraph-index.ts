import 'dotenv/config';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { GmailService } from './gmail-service';
import { createTriageTool } from './triage-tool';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { HumanMessage } from '@langchain/core/messages';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

// Helper function to convert color tags to ANSI codes
function applyColors(text: string): string {
  const colorMap: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    reset: '\x1b[0m'
  };

  let result = text;

  // Replace opening tags
  for (const [color, code] of Object.entries(colorMap)) {
    result = result.replace(new RegExp(`\\[${color}\\]`, 'gi'), code);
  }

  // Replace all closing tags with reset code
  result = result.replace(/\[\/(red|green|yellow|blue|magenta|cyan|bold|dim)\]/gi, '\x1b[0m');

  return result;
}

async function initializeGmail(): Promise<GmailService | null> {
  const credentialsPath = path.join(process.cwd(), 'gmail-credentials.json');
  const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');

  if (!fs.existsSync(credentialsPath)) {
    console.log('⚠️  Gmail credentials not found at gmail-credentials.json');
    console.log('Gmail features will be disabled.\n');
    return null;
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const gmailCreds = {
      client_id: credentials.installed?.client_id || credentials.web?.client_id,
      client_secret: credentials.installed?.client_secret || credentials.web?.client_secret,
      redirect_uri: credentials.installed?.redirect_uris?.[0] || credentials.web?.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
    };

    const gmailService = new GmailService(gmailCreds);

    // Try to load existing tokens
    const tokens = gmailService.loadTokens(tokenPath);

    if (tokens) {
      // Silent success - only show errors
      return gmailService;
    } else {
      const authUrl = gmailService.getAuthUrl();
      console.log('\n📋 Gmail OAuth Setup Required:');
      console.log('='.repeat(50));
      console.log('1. Visit this URL:\n');
      console.log(authUrl);
      console.log('\n2. Sign in and authorize the app');
      console.log('3. Copy the authorization code\n');

      const authCode = await askQuestion('Paste the authorization code here: ');

      const newTokens = await gmailService.getTokens(authCode);
      gmailService.setTokens(newTokens);
      gmailService.saveTokens(newTokens, tokenPath);

      console.log('\n✅ Gmail authenticated successfully!\n');
      return gmailService;
    }
  } catch (error) {
    console.log('⚠️  Could not initialize Gmail:', error);
    console.log('Gmail features will be disabled.\n');
    return null;
  }
}

// Helper function to make HTTP GET requests
function makeHttpRequest(url: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  return new Promise((resolve) => {
    try {
      const urlObj = new URL(url);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      const req = protocol.get(url, (res) => {
        resolve({
          success: res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400,
          statusCode: res.statusCode
        });
      });

      req.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });

      req.setTimeout(10000, () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timeout'
        });
      });
    } catch (error) {
      resolve({
        success: false,
        error: String(error)
      });
    }
  });
}

// Helper function to create a raw RFC 2822 email message
function createRawEmail(params: {
  to: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
}): string {
  const lines = [
    `To: ${params.to}`,
    `From: ${params.from}`,
    `Subject: ${params.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0'
  ];

  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
  }

  if (params.references) {
    lines.push(`References: ${params.references}`);
  }

  lines.push('');
  lines.push(params.body);

  const email = lines.join('\r\n');
  return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Helper function to convert time ranges to Gmail query syntax
function buildGmailQuery(params: {
  query?: string;
  timeRange?: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  label?: string;
}): string {
  const queryParts: string[] = [];

  if (params.query) {
    queryParts.push(params.query);
  }

  if (params.timeRange) {
    const now = new Date();
    let afterDate: Date;

    switch (params.timeRange.toLowerCase()) {
      case 'today':
        afterDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'yesterday':
        afterDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const beforeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        queryParts.push(`after:${formatDate(afterDate)} before:${formatDate(beforeDate)}`);
        return queryParts.join(' ');
      case 'last week':
      case 'past week':
        afterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'last month':
      case 'past month':
        afterDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'last 3 days':
        afterDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        break;
      default:
        const daysMatch = params.timeRange.match(/^(\d+)\s*d(ays?)?$/i);
        if (daysMatch) {
          const days = parseInt(daysMatch[1]);
          afterDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        } else {
          afterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }
    }

    if (params.timeRange.toLowerCase() !== 'yesterday') {
      queryParts.push(`after:${formatDate(afterDate)}`);
    }
  }

  if (params.from) queryParts.push(`from:${params.from}`);
  if (params.to) queryParts.push(`to:${params.to}`);
  if (params.subject) queryParts.push(`subject:${params.subject}`);
  if (params.hasAttachment) queryParts.push('has:attachment');
  if (params.isUnread !== undefined) queryParts.push(params.isUnread ? 'is:unread' : 'is:read');
  if (params.label) queryParts.push(`label:${params.label}`);

  return queryParts.join(' ') || 'in:inbox';
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

// Helper function to convert RFC 2822 email dates to East Coast timezone
function formatEmailDate(rfc2822Date: string): string {
  try {
    // Parse RFC 2822 date string to Date object
    const date = new Date(rfc2822Date);

    if (isNaN(date.getTime())) {
      return rfc2822Date; // Return original if parsing fails
    }

    // Convert to East Coast timezone (America/New_York)
    // This automatically handles EDT (UTC-4) and EST (UTC-5)
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'America/New_York',
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    };

    const formatted = new Intl.DateTimeFormat('en-US', options).format(date);

    // Add timezone indicator
    const now = new Date();
    const januaryOffset = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
    const julyOffset = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
    const isDST = Math.max(januaryOffset, julyOffset) !== date.getTimezoneOffset();
    const tzAbbr = isDST ? 'EDT' : 'EST';

    return `${formatted} ${tzAbbr}`;
  } catch (error) {
    return rfc2822Date; // Return original if conversion fails
  }
}

// Helper function to validate and sanitize memory file paths
function validateMemoryPath(filePath: string): { valid: boolean; fullPath?: string; error?: string } {
  const memoriesDir = path.join(process.cwd(), 'memories');

  // Resolve the full path and normalize it
  const fullPath = path.resolve(memoriesDir, filePath);

  // Security: Ensure the path is within the memories directory (prevent path traversal)
  if (!fullPath.startsWith(memoriesDir + path.sep) && fullPath !== memoriesDir) {
    return { valid: false, error: 'Invalid path: must be within /memories directory' };
  }

  // Security: Prevent accessing hidden files or parent directories
  const relativePath = path.relative(memoriesDir, fullPath);
  if (relativePath.startsWith('..') || relativePath.includes(path.sep + '.')) {
    return { valid: false, error: 'Invalid path: cannot access parent directories or hidden files' };
  }

  // Only allow .txt and .md files
  const ext = path.extname(fullPath).toLowerCase();
  if (ext !== '.txt' && ext !== '.md' && ext !== '') {
    return { valid: false, error: 'Invalid file type: only .txt and .md files are allowed' };
  }

  return { valid: true, fullPath };
}

// Create memory tools for the Anthropic Memory Tool beta
function createMemoryTools() {
  const memoriesDir = path.join(process.cwd(), 'memories');
  const MAX_FILE_SIZE = 100 * 1024; // 100KB limit per file

  // Ensure memories directory exists
  if (!fs.existsSync(memoriesDir)) {
    fs.mkdirSync(memoriesDir, { recursive: true });
  }

  const viewTool = new DynamicStructuredTool({
    name: 'view_memory',
    description: 'View the contents of the memory directory or a specific memory file. Use this to recall information from previous conversations.',
    schema: z.object({
      path: z.string().optional().describe('Optional path to a specific file. If not provided, lists all files in /memories directory')
    }),
    func: async ({ path: filePath }: any): Promise<string> => {
      try {
        if (!filePath) {
          // List all files in memories directory
          const files = fs.readdirSync(memoriesDir)
            .filter(f => !f.startsWith('.'))
            .map(f => {
              const stats = fs.statSync(path.join(memoriesDir, f));
              return {
                name: f,
                size: stats.size,
                modified: stats.mtime.toISOString()
              };
            });

          return JSON.stringify({
            success: true,
            directory: '/memories',
            files: files,
            message: files.length === 0 ? 'Memory directory is empty' : `Found ${files.length} file(s)`
          }, null, 2);
        }

        // View specific file
        const validation = validateMemoryPath(filePath);
        if (!validation.valid) {
          return JSON.stringify({ success: false, error: validation.error }, null, 2);
        }

        if (!fs.existsSync(validation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `File not found: ${filePath}`
          }, null, 2);
        }

        const content = fs.readFileSync(validation.fullPath!, 'utf-8');
        return JSON.stringify({
          success: true,
          path: filePath,
          content: content
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  const createTool = new DynamicStructuredTool({
    name: 'create_memory',
    description: 'Create a new memory file with content. Use this to remember important information across conversations.',
    schema: z.object({
      path: z.string().describe('Path for the new file (e.g., "contacts.txt", "preferences.md")'),
      content: z.string().describe('Content to write to the file')
    }),
    func: async ({ path: filePath, content }: any): Promise<string> => {
      try {
        const validation = validateMemoryPath(filePath);
        if (!validation.valid) {
          return JSON.stringify({ success: false, error: validation.error }, null, 2);
        }

        if (fs.existsSync(validation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `File already exists: ${filePath}. Use str_replace or insert to modify existing files.`
          }, null, 2);
        }

        if (content.length > MAX_FILE_SIZE) {
          return JSON.stringify({
            success: false,
            error: `Content too large: maximum ${MAX_FILE_SIZE} bytes`
          }, null, 2);
        }

        // Ensure parent directory exists
        const dir = path.dirname(validation.fullPath!);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(validation.fullPath!, content, 'utf-8');
        console.log(`💾 Created memory file: ${filePath}`);

        return JSON.stringify({
          success: true,
          path: filePath,
          message: `Memory file created: ${filePath}`
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  const strReplaceTool = new DynamicStructuredTool({
    name: 'str_replace_memory',
    description: 'Replace a specific string in a memory file. Use this to update existing information.',
    schema: z.object({
      path: z.string().describe('Path to the file to modify'),
      old_str: z.string().describe('String to search for'),
      new_str: z.string().describe('String to replace it with')
    }),
    func: async ({ path: filePath, old_str, new_str }: any): Promise<string> => {
      try {
        const validation = validateMemoryPath(filePath);
        if (!validation.valid) {
          return JSON.stringify({ success: false, error: validation.error }, null, 2);
        }

        if (!fs.existsSync(validation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `File not found: ${filePath}`
          }, null, 2);
        }

        const content = fs.readFileSync(validation.fullPath!, 'utf-8');

        if (!content.includes(old_str)) {
          return JSON.stringify({
            success: false,
            error: `String not found in file: "${old_str}"`
          }, null, 2);
        }

        const newContent = content.replace(old_str, new_str);

        if (newContent.length > MAX_FILE_SIZE) {
          return JSON.stringify({
            success: false,
            error: `Content too large after replacement: maximum ${MAX_FILE_SIZE} bytes`
          }, null, 2);
        }

        fs.writeFileSync(validation.fullPath!, newContent, 'utf-8');
        console.log(`✏️  Updated memory file: ${filePath}`);

        return JSON.stringify({
          success: true,
          path: filePath,
          message: `Memory file updated: ${filePath}`
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  const insertTool = new DynamicStructuredTool({
    name: 'insert_memory',
    description: 'Insert content at a specific line in a memory file.',
    schema: z.object({
      path: z.string().describe('Path to the file to modify'),
      insert_line: z.number().describe('Line number to insert at (0-indexed)'),
      content: z.string().describe('Content to insert')
    }),
    func: async ({ path: filePath, insert_line, content }: any): Promise<string> => {
      try {
        const validation = validateMemoryPath(filePath);
        if (!validation.valid) {
          return JSON.stringify({ success: false, error: validation.error }, null, 2);
        }

        if (!fs.existsSync(validation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `File not found: ${filePath}`
          }, null, 2);
        }

        const fileContent = fs.readFileSync(validation.fullPath!, 'utf-8');
        const lines = fileContent.split('\n');

        if (insert_line < 0 || insert_line > lines.length) {
          return JSON.stringify({
            success: false,
            error: `Invalid line number: ${insert_line}. File has ${lines.length} lines.`
          }, null, 2);
        }

        lines.splice(insert_line, 0, content);
        const newContent = lines.join('\n');

        if (newContent.length > MAX_FILE_SIZE) {
          return JSON.stringify({
            success: false,
            error: `Content too large after insertion: maximum ${MAX_FILE_SIZE} bytes`
          }, null, 2);
        }

        fs.writeFileSync(validation.fullPath!, newContent, 'utf-8');
        console.log(`✏️  Inserted content in memory file: ${filePath}`);

        return JSON.stringify({
          success: true,
          path: filePath,
          message: `Content inserted at line ${insert_line} in ${filePath}`
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  const deleteTool = new DynamicStructuredTool({
    name: 'delete_memory',
    description: 'Delete a memory file. Use with caution - this cannot be undone.',
    schema: z.object({
      path: z.string().describe('Path to the file to delete')
    }),
    func: async ({ path: filePath }: any): Promise<string> => {
      try {
        const validation = validateMemoryPath(filePath);
        if (!validation.valid) {
          return JSON.stringify({ success: false, error: validation.error }, null, 2);
        }

        if (!fs.existsSync(validation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `File not found: ${filePath}`
          }, null, 2);
        }

        fs.unlinkSync(validation.fullPath!);
        console.log(`🗑️  Deleted memory file: ${filePath}`);

        return JSON.stringify({
          success: true,
          path: filePath,
          message: `Memory file deleted: ${filePath}`
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  const renameTool = new DynamicStructuredTool({
    name: 'rename_memory',
    description: 'Rename or move a memory file.',
    schema: z.object({
      old_path: z.string().describe('Current path of the file'),
      new_path: z.string().describe('New path for the file')
    }),
    func: async ({ old_path, new_path }: any): Promise<string> => {
      try {
        const oldValidation = validateMemoryPath(old_path);
        if (!oldValidation.valid) {
          return JSON.stringify({ success: false, error: `Old path: ${oldValidation.error}` }, null, 2);
        }

        const newValidation = validateMemoryPath(new_path);
        if (!newValidation.valid) {
          return JSON.stringify({ success: false, error: `New path: ${newValidation.error}` }, null, 2);
        }

        if (!fs.existsSync(oldValidation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `File not found: ${old_path}`
          }, null, 2);
        }

        if (fs.existsSync(newValidation.fullPath!)) {
          return JSON.stringify({
            success: false,
            error: `Destination already exists: ${new_path}`
          }, null, 2);
        }

        // Ensure parent directory exists
        const dir = path.dirname(newValidation.fullPath!);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.renameSync(oldValidation.fullPath!, newValidation.fullPath!);
        console.log(`📝 Renamed memory file: ${old_path} → ${new_path}`);

        return JSON.stringify({
          success: true,
          old_path: old_path,
          new_path: new_path,
          message: `Memory file renamed: ${old_path} → ${new_path}`
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  return [viewTool, createTool, strReplaceTool, insertTool, deleteTool, renameTool];
}

// Create batched email loading tool for pagination
function createBatchedEmailTool() {
  const getBatchedEmailsTool = new DynamicStructuredTool({
    name: 'get_batched_emails',
    description: 'Load a batch of triaged emails by category. Use this instead of view_memory("triage/pending.json") to prevent context overflow and hallucinations. Always load fresh batches when presenting emails to the user.',
    schema: z.object({
      category: z.string().describe('Category to filter by: ACTION_REQUIRED, SUMMARIZE_EVENTS, SUMMARIZE_PURCHASES, SUMMARIZE_AND_INFORM, UNSUBSCRIBE, IMMEDIATE_ARCHIVE, OTHER'),
      offset: z.number().optional().default(0).describe('Starting index (0-based, default: 0)'),
      limit: z.number().optional().default(5).describe('Number of emails to load (default: 5, max: 20)')
    }),
    func: async ({ category, offset = 0, limit = 5 }: any): Promise<string> => {
      try {
        const pendingPath = path.join(process.cwd(), 'memories', 'triage', 'pending.json');

        if (!fs.existsSync(pendingPath)) {
          return JSON.stringify({
            success: false,
            error: 'No pending triage found. Run triage_inbox first.'
          }, null, 2);
        }

        const pendingData = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));

        // Filter emails by category
        const categoryEmails = pendingData.emails.filter((email: any) => email.category === category);

        // Apply pagination
        const batchLimit = Math.min(limit, 20); // Max 20 emails per batch
        const batchEmails = categoryEmails.slice(offset, offset + batchLimit);

        return JSON.stringify({
          success: true,
          category: category,
          batch: {
            offset: offset,
            limit: batchLimit,
            returned: batchEmails.length,
            total_in_category: categoryEmails.length
          },
          emails: batchEmails,
          has_more: offset + batchEmails.length < categoryEmails.length,
          next_offset: offset + batchEmails.length,
          last_updated: pendingData.last_updated
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error)
        }, null, 2);
      }
    }
  });

  return getBatchedEmailsTool;
}

// Create Gmail tools using LangGraph's DynamicStructuredTool
function createGmailTools(gmailService: GmailService) {
  const listEmailsTool = new DynamicStructuredTool({
    name: 'list_emails',
    description: 'List emails from Gmail inbox with flexible filters including time ranges, sender, subject, and more',
    schema: z.object({
      maxResults: z.number().optional().default(10).describe('Maximum number of emails to retrieve (default: 10, max: 100)'),
      query: z.string().optional().describe('Raw Gmail search query (e.g., "is:unread", "from:sender@email.com")'),
      timeRange: z.string().optional().describe('Time range filter: "today", "yesterday", "last week", "last month", "last 3 days", or "Xd" for X days'),
      from: z.string().optional().describe('Filter by sender email address or name'),
      to: z.string().optional().describe('Filter by recipient email address'),
      subject: z.string().optional().describe('Filter by subject keywords'),
      hasAttachment: z.boolean().optional().describe('Filter for emails with attachments'),
      isUnread: z.boolean().optional().describe('Filter by read/unread status (true for unread, false for read)'),
      label: z.string().optional().describe('Filter by Gmail label (e.g., "inbox", "important", "sent")')
    }),
    func: async (params: any): Promise<string> => {
      const {
        maxResults = 10,
        query,
        timeRange,
        from,
        to,
        subject,
        hasAttachment,
        isUnread,
        label
      } = params;

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const gmailQuery = buildGmailQuery({
        query,
        timeRange,
        from,
        to,
        subject,
        hasAttachment,
        isUnread,
        label
      });

      console.log(`📧 Searching with query: ${gmailQuery}`);

      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults, 100),
        q: gmailQuery
      });

      const messages = response.data.messages || [];
      const emailDetails = [];

      for (const msg of messages.slice(0, maxResults)) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date', 'To']
        });

        const headers = details.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

        emailDetails.push({
          id: msg.id,
          subject: getHeader('Subject'),
          from: getHeader('From'),
          date: formatEmailDate(getHeader('Date')),
          to: getHeader('To'),
          snippet: details.data.snippet
        });
      }

      return JSON.stringify({ emails: emailDetails }, null, 2);
    }
  });

  const readEmailTool = new DynamicStructuredTool({
    name: 'read_email',
    description: 'Read the full content of a specific email by ID',
    schema: z.object({
      emailId: z.string().describe('Gmail message ID of the email to read')
    }),
    func: async ({ emailId }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: emailId,
        format: 'full'
      });

      const headers = response.data.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

      // Extract email body
      let body = '';
      if (response.data.payload?.parts) {
        for (const part of response.data.payload.parts) {
          if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
            if (part.body?.data) {
              body += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
          }
        }
      } else if (response.data.payload?.body?.data) {
        body = Buffer.from(response.data.payload.body.data, 'base64').toString('utf-8');
      }

      return JSON.stringify({
        id: emailId,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        date: formatEmailDate(getHeader('Date')),
        body: body || response.data.snippet
      }, null, 2);
    }
  });

  const archiveEmailTool = new DynamicStructuredTool({
    name: 'archive_email',
    description: 'Archive one or more emails by removing them from the inbox (they will still be accessible in All Mail)',
    schema: z.object({
      emailIds: z.array(z.string()).describe('Array of Gmail message IDs to archive')
    }),
    func: async ({ emailIds }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const results = [];
      const errors = [];

      for (const emailId of emailIds) {
        try {
          await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              removeLabelIds: ['INBOX']
            }
          });
          results.push(emailId);
          console.log(`✅ Archived email: ${emailId}`);
        } catch (error) {
          errors.push({ emailId, error: String(error) });
          console.log(`❌ Failed to archive email ${emailId}: ${error}`);
        }
      }

      return JSON.stringify({
        success: results.length > 0,
        archived: results,
        failed: errors,
        message: `Successfully archived ${results.length} email(s)${errors.length > 0 ? `, failed to archive ${errors.length}` : ''}`
      }, null, 2);
    }
  });

  const unsubscribeEmailTool = new DynamicStructuredTool({
    name: 'unsubscribe_email',
    description: 'Automatically unsubscribe from an email by parsing the List-Unsubscribe header and making the necessary HTTP request',
    schema: z.object({
      emailId: z.string().describe('Gmail message ID of the email to unsubscribe from')
    }),
    func: async ({ emailId }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      try {
        // Get the email with full headers
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: emailId,
          format: 'full'
        });

        const headers = response.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const listUnsubscribe = getHeader('List-Unsubscribe');
        const fromHeader = getHeader('From');

        if (!listUnsubscribe) {
          return JSON.stringify({
            success: false,
            error: 'No List-Unsubscribe header found in this email',
            from: fromHeader,
            message: 'This email does not have an automated unsubscribe link. You may need to manually unsubscribe.'
          }, null, 2);
        }

        console.log(`📧 Found List-Unsubscribe header: ${listUnsubscribe}`);

        // Parse List-Unsubscribe header - can contain multiple URLs in <> brackets
        const urlMatches = listUnsubscribe.match(/<([^>]+)>/g);
        if (!urlMatches) {
          return JSON.stringify({
            success: false,
            error: 'Could not parse List-Unsubscribe header',
            from: fromHeader,
            listUnsubscribe: listUnsubscribe
          }, null, 2);
        }

        // Extract URLs and filter for https URLs (prefer https over mailto)
        const urls = urlMatches.map(match => match.slice(1, -1)); // Remove < and >
        const httpUrls = urls.filter(url => url.startsWith('http://') || url.startsWith('https://'));

        if (httpUrls.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No HTTP unsubscribe URLs found (only mailto: links available)',
            from: fromHeader,
            availableUrls: urls,
            message: 'This email only provides mailto: unsubscribe links, which cannot be automated.'
          }, null, 2);
        }

        // Try each HTTP URL until one succeeds
        const results = [];
        for (const url of httpUrls) {
          console.log(`🔗 Attempting unsubscribe via: ${url}`);
          const result = await makeHttpRequest(url);
          results.push({ url, ...result });

          if (result.success) {
            console.log(`✅ Successfully unsubscribed via ${url}`);
            return JSON.stringify({
              success: true,
              from: fromHeader,
              unsubscribeUrl: url,
              statusCode: result.statusCode,
              message: `Successfully unsubscribed from ${fromHeader}`
            }, null, 2);
          }
        }

        // If we get here, all attempts failed
        return JSON.stringify({
          success: false,
          from: fromHeader,
          error: 'All unsubscribe attempts failed',
          attempts: results,
          message: 'Could not automatically unsubscribe. You may need to manually visit the unsubscribe link in the email.'
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error),
          message: 'Failed to process unsubscribe request'
        }, null, 2);
      }
    }
  });

  const draftReplyTool = new DynamicStructuredTool({
    name: 'draft_reply',
    description: 'Create a draft reply to an email. The draft will be saved in Gmail and can be reviewed/edited before sending.',
    schema: z.object({
      emailId: z.string().describe('Gmail message ID of the email to reply to'),
      replyBody: z.string().describe('The content of the reply message')
    }),
    func: async ({ emailId, replyBody }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      try {
        // Get the original email with full headers
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: emailId,
          format: 'full'
        });

        const headers = response.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const from = getHeader('From');
        const to = getHeader('To');
        const subject = getHeader('Subject');
        const messageId = getHeader('Message-ID');
        const references = getHeader('References');
        const threadId = response.data.threadId;

        // Determine reply-to address (prefer Reply-To header if present)
        const replyTo = getHeader('Reply-To') || from;

        // Prepare subject with "Re: " prefix if not already present
        const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

        // Build References header for threading
        let replyReferences = messageId;
        if (references) {
          replyReferences = `${references} ${messageId}`;
        }

        // Get user's email address
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const userEmail = profile.data.emailAddress || '';

        // Create the raw email message
        const rawMessage = createRawEmail({
          to: replyTo,
          from: userEmail,
          subject: replySubject,
          body: replyBody,
          inReplyTo: messageId,
          references: replyReferences,
          threadId: threadId || undefined
        });

        // Create the draft
        const draftResponse = await gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: {
              raw: rawMessage,
              threadId: threadId || undefined
            }
          }
        });

        const draftId = draftResponse.data.id;
        console.log(`✉️  Created draft reply with ID: ${draftId}`);

        return JSON.stringify({
          success: true,
          draftId: draftId,
          to: replyTo,
          subject: replySubject,
          threadId: threadId,
          message: `Draft reply created successfully. You can review and send it from Gmail.`,
          previewBody: replyBody.slice(0, 150) + (replyBody.length > 150 ? '...' : '')
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error),
          message: 'Failed to create draft reply'
        }, null, 2);
      }
    }
  });

  // Helper function for unsubscribe and archive logic (shared between both tools)
  async function processUnsubscribeAndArchive(emailIds: string[]): Promise<{
    total: number;
    unsubscribed: string[];
    unsubscribeFailed: string[];
    archived: string[];
    archiveFailed: string[];
    emailDetails: Array<{ id: string; from: string; subject: string }>;
  }> {
    await gmailService.refreshTokenIfNeeded();
    const gmail = gmailService.getGmailApi();

    const results = {
      total: emailIds.length,
      unsubscribed: [] as string[],
      unsubscribeFailed: [] as string[],
      archived: [] as string[],
      archiveFailed: [] as string[],
      emailDetails: [] as Array<{ id: string; from: string; subject: string }>
    };

    // Step 1: Try to unsubscribe from each email (optimistic)
    for (const emailId of emailIds) {
      try {
        const response = await gmail.users.messages.get({
          userId: 'me',
          id: emailId,
          format: 'full'
        });

        const headers = response.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        const listUnsubscribe = getHeader('List-Unsubscribe');
        const fromHeader = getHeader('From');
        const subjectHeader = getHeader('Subject');

        // Store email details for dry run preview
        results.emailDetails.push({
          id: emailId,
          from: fromHeader,
          subject: subjectHeader
        });

        if (listUnsubscribe) {
          // Parse List-Unsubscribe header
          const urlMatches = listUnsubscribe.match(/<([^>]+)>/g);
          if (urlMatches) {
            const urls = urlMatches.map(match => match.slice(1, -1));
            const httpUrls = urls.filter(url => url.startsWith('http://') || url.startsWith('https://'));

            if (httpUrls.length > 0) {
              // Try first HTTP URL
              const result = await makeHttpRequest(httpUrls[0]);
              if (result.success) {
                results.unsubscribed.push(emailId);
                console.log(`✅ Unsubscribed from: ${fromHeader}`);
              } else {
                results.unsubscribeFailed.push(emailId);
                console.log(`⚠️  Could not unsubscribe from: ${fromHeader} (will still archive)`);
              }
            } else {
              results.unsubscribeFailed.push(emailId);
            }
          } else {
            results.unsubscribeFailed.push(emailId);
          }
        } else {
          results.unsubscribeFailed.push(emailId);
        }
      } catch (error) {
        results.unsubscribeFailed.push(emailId);
        console.log(`⚠️  Unsubscribe error for ${emailId}: ${error} (will still archive)`);
      }
    }

    // Step 2: Archive all emails regardless of unsubscribe success
    for (const emailId of emailIds) {
      try {
        await gmail.users.messages.modify({
          userId: 'me',
          id: emailId,
          requestBody: {
            removeLabelIds: ['INBOX']
          }
        });
        results.archived.push(emailId);
      } catch (error) {
        results.archiveFailed.push(emailId);
        console.log(`❌ Failed to archive email ${emailId}: ${error}`);
      }
    }

    return results;
  }

  const unsubscribeAndArchiveByIdsTool = new DynamicStructuredTool({
    name: 'unsubscribe_and_archive_by_ids',
    description: 'Batch operation: attempt to unsubscribe from specific emails by ID and then archive them all. Use when you have specific email IDs to process. Optimistic - continues even if unsubscribe fails.',
    schema: z.object({
      emailIds: z.array(z.string()).describe('Array of Gmail message IDs to unsubscribe and archive')
    }),
    func: async ({ emailIds }: any): Promise<string> => {
      const results = await processUnsubscribeAndArchive(emailIds);

      const summary = [
        `Processed ${results.total} email(s):`,
        `✅ Unsubscribed: ${results.unsubscribed.length}`,
        `⚠️  Unsubscribe failed/unavailable: ${results.unsubscribeFailed.length}`,
        `📥 Archived: ${results.archived.length}`,
        results.archiveFailed.length > 0 ? `❌ Archive failed: ${results.archiveFailed.length}` : null
      ].filter(Boolean).join('\n');

      console.log('\n' + summary);

      return JSON.stringify({
        success: results.archived.length > 0,
        total: results.total,
        unsubscribed: results.unsubscribed.length,
        unsubscribeFailed: results.unsubscribeFailed.length,
        archived: results.archived.length,
        archiveFailed: results.archiveFailed.length,
        summary: summary
      }, null, 2);
    }
  });

  const unsubscribeAndArchiveByQueryTool = new DynamicStructuredTool({
    name: 'unsubscribe_and_archive_by_query',
    description: 'Batch operation: search for emails using filters and then unsubscribe & archive them. Much more efficient than list_emails + unsubscribe_and_archive_by_ids. Use dryRun=true to preview matches before processing.',
    schema: z.object({
      maxResults: z.number().optional().default(100).describe('Maximum number of emails to process (default: 100, max: 500). Safety limit to prevent accidental bulk operations.'),
      dryRun: z.boolean().optional().default(false).describe('If true, only return preview of matching emails without processing them. Use this to verify the query matches the right emails.'),
      query: z.string().optional().describe('Raw Gmail search query (e.g., "is:unread", "from:sender@email.com")'),
      timeRange: z.string().optional().describe('Time range filter: "today", "yesterday", "last week", "last month", "last 3 days", or "Xd" for X days'),
      from: z.string().optional().describe('Filter by sender email address or name'),
      to: z.string().optional().describe('Filter by recipient email address'),
      subject: z.string().optional().describe('Filter by subject keywords'),
      hasAttachment: z.boolean().optional().describe('Filter for emails with attachments'),
      isUnread: z.boolean().optional().describe('Filter by read/unread status (true for unread, false for read)'),
      label: z.string().optional().describe('Filter by Gmail label (e.g., "inbox", "important", "sent")')
    }),
    func: async (params: any): Promise<string> => {
      const {
        maxResults = 100,
        dryRun = false,
        query,
        timeRange,
        from,
        to,
        subject,
        hasAttachment,
        isUnread,
        label
      } = params;

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      // Build Gmail query using existing helper function
      const gmailQuery = buildGmailQuery({
        query,
        timeRange,
        from,
        to,
        subject,
        hasAttachment,
        isUnread,
        label
      });

      console.log(`📧 Searching with query: ${gmailQuery}`);

      // Fetch matching email IDs
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults: Math.min(maxResults, 500),
        q: gmailQuery
      });

      const messages = response.data.messages || [];

      if (messages.length === 0) {
        return JSON.stringify({
          success: false,
          matched: 0,
          message: 'No emails found matching the query',
          query: gmailQuery
        }, null, 2);
      }

      const emailIds = messages.map(m => m.id!);

      // DRY RUN: Just return preview
      if (dryRun) {
        console.log(`🔍 DRY RUN: Found ${emailIds.length} matching emails`);

        // Fetch minimal details for preview (first 10 only to avoid token bloat)
        const previewCount = Math.min(emailIds.length, 10);
        const previewDetails = [];

        for (let i = 0; i < previewCount; i++) {
          const details = await gmail.users.messages.get({
            userId: 'me',
            id: emailIds[i],
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date']
          });

          const headers = details.data.payload?.headers || [];
          const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

          previewDetails.push({
            id: emailIds[i],
            from: getHeader('From'),
            subject: getHeader('Subject'),
            date: formatEmailDate(getHeader('Date'))
          });
        }

        return JSON.stringify({
          success: true,
          dryRun: true,
          matched: emailIds.length,
          query: gmailQuery,
          preview: previewDetails,
          message: `DRY RUN: Found ${emailIds.length} emails. Showing first ${previewCount}. Set dryRun=false to process them.`,
          note: emailIds.length > previewCount ? `${emailIds.length - previewCount} more emails match this query` : null
        }, null, 2);
      }

      // REAL RUN: Process all matching emails
      console.log(`⚙️  Processing ${emailIds.length} emails...`);
      const results = await processUnsubscribeAndArchive(emailIds);

      const summary = [
        `Processed ${results.total} email(s):`,
        `✅ Unsubscribed: ${results.unsubscribed.length}`,
        `⚠️  Unsubscribe failed/unavailable: ${results.unsubscribeFailed.length}`,
        `📥 Archived: ${results.archived.length}`,
        results.archiveFailed.length > 0 ? `❌ Archive failed: ${results.archiveFailed.length}` : null
      ].filter(Boolean).join('\n');

      console.log('\n' + summary);

      return JSON.stringify({
        success: results.archived.length > 0,
        query: gmailQuery,
        total: results.total,
        unsubscribed: results.unsubscribed.length,
        unsubscribeFailed: results.unsubscribeFailed.length,
        archived: results.archived.length,
        archiveFailed: results.archiveFailed.length,
        summary: summary
      }, null, 2);
    }
  });

  return [listEmailsTool, readEmailTool, archiveEmailTool, unsubscribeEmailTool, draftReplyTool, unsubscribeAndArchiveByIdsTool, unsubscribeAndArchiveByQueryTool];
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable is required');
    console.log('Please add your Anthropic API key to the .env file');
    process.exit(1);
  }

  // Initialize Gmail (silent unless there's an error)
  const gmailService = await initializeGmail();

  if (!gmailService) {
    console.log('❌ Gmail is not authenticated. Exiting.');
    process.exit(1);
  }

  // Create LangGraph tools (Gmail + Memory + Batched Email)
  const gmailTools = createGmailTools(gmailService);
  const memoryTools = createMemoryTools();
  const batchedEmailTool = createBatchedEmailTool();

  // Create triage tool (needs access to list_emails, read_email, and gmail service for pagination)
  const listEmailsTool = gmailTools.find(t => t.name === 'list_emails')!;
  const readEmailTool = gmailTools.find(t => t.name === 'read_email')!;
  const triageTool = createTriageTool(listEmailsTool, readEmailTool, gmailService);

  const tools = [...gmailTools, ...memoryTools, batchedEmailTool, triageTool];

  // Initialize Claude model with memory tool beta and prompt caching
  const model = new ChatAnthropic({
    model: 'claude-3-5-sonnet-20241022',
    apiKey: process.env.ANTHROPIC_API_KEY,
    clientOptions: {
      defaultHeaders: {
        'anthropic-beta': 'context-management-2025-06-27,prompt-caching-2024-07-31,extended-cache-ttl-2025-04-11'
      }
    }
  });

  // Load user preferences dynamically
  const preferencesPath = path.join(process.cwd(), 'memories', 'email_preferences.md');
  let userPreferences = '';
  if (fs.existsSync(preferencesPath)) {
    try {
      userPreferences = fs.readFileSync(preferencesPath, 'utf-8');
    } catch (error) {
      console.error('Failed to load email preferences:', error);
    }
  }

  // System prompt to guide the agent's behavior
  const systemPrompt = `You are a personal email management assistant.

═══════════════════════════════════════════════════════════════════
TIER 1: CORE MISSION (HIGHEST PRIORITY)
═══════════════════════════════════════════════════════════════════

🎯 YOUR PRIORITIES (IN ORDER):
1. IMPORTANT EMAILS FIRST: Ensure critical emails get attention (friends & family, job search, urgent deadlines, personal questions)
2. INBOX ZERO SECOND: Efficiently batch-process non-critical emails after important ones are handled

Remember: Better to spend time on one important email than archive 100 newsletters. Quality over speed for critical emails.

═══════════════════════════════════════════════════════════════════
TIER 2: CRITICAL TECHNICAL RULES
═══════════════════════════════════════════════════════════════════

⚠️  MANDATORY RULES (NEVER VIOLATE THESE):

1. ANTI-HALLUCINATION: Always cite email_id when presenting emails. Never present emails without source data.
   - Only use data from pending.json or Gmail API responses
   - Never invent times, dates, names, or content not in source
   - If uncertain, call read_email(email_id) to get real content

2. PAGINATION: ALWAYS use get_batched_emails() to load emails in small batches
   - Loading all pending.json causes context overflow and hallucinations
   - Batch size: 5 for ACTION_REQUIRED, 10-20 for bulk categories
   - Call get_batched_emails(category, offset, limit) before presenting emails

3. TRIAGE PRECONDITION: ALWAYS check view_memory("triage/pending.json") BEFORE calling triage_inbox
   - If pending exists: Ask user (continue vs fresh)
   - If no pending: Proceed with new triage
   - Never overwrite pending.json without asking

═══════════════════════════════════════════════════════════════════
TIER 3: USER INTERACTION
═══════════════════════════════════════════════════════════════════

🎨 CLI OUTPUT FORMATTING:
- Use ANSI color tags: [red]...[/red], [green]...[/green], [yellow]...[/yellow], [cyan]...[/cyan]
- NO markdown (**, ##, _italics_) - use colors instead
- Simple dividers: === or ---
- Numbered lists (1. 2. 3.) not bullets

📋 MULTIPLE CHOICE PROMPTS:
ALWAYS present choices as numbered options. Users reply with just "1" or "2".

Example:
What would you like to process next?
  1. Summarize Purchases (1 email)
  2. Archive (3 emails)
  3. Unsubscribe (1 email)
Enter 1-3:

🎬 STARTUP BEHAVIOR:
On first interaction, check view_memory("triage/pending.json"):
- If pending exists: Mention count, suggest processing
- If no pending: Suggest triaging inbox
- Keep welcome brief (2-3 lines), end with numbered choices

═══════════════════════════════════════════════════════════════════
TIER 4: WORKFLOWS
═══════════════════════════════════════════════════════════════════

💾 MEMORY SYSTEM:
Check memories/ at startup. Remember contacts, preferences, job search status, email patterns.
- view_memory: View directory or read file
- create_memory / str_replace_memory: Update preferences
- Check email_preferences.md for user-specific categorization rules

🔄 TRIAGE WORKFLOW:
1. Check view_memory("triage/pending.json") first
2. If pending exists: Ask user (continue or fresh)
3. If no pending: Run triage_inbox(days=1)
4. Process by priority: ACTION_REQUIRED → EVENTS → PURCHASES → INFORM → UNSUBSCRIBE → ARCHIVE

📧 EMAIL PROCESSING:
- Use get_batched_emails(category, offset, limit) to load emails in batches
- ACTION_REQUIRED: Load 5 at a time, handle individually
- Other categories: Load 10-20, batch process
- Always cite email_id when presenting emails
- Confirm actions: "✅ Archived 3 emails"

═══════════════════════════════════════════════════════════════════
TIER 5: USER-SPECIFIC PREFERENCES
═══════════════════════════════════════════════════════════════════

${userPreferences}

`;

  // Create ReAct agent - LangGraph handles conversation history automatically!
  const agent = createReactAgent({
    llm: model,
    tools: tools,
    messageModifier: systemPrompt
  });

  // Conversation state managed by LangGraph
  const conversationMessages: any[] = [];

  // Fast startup: Check for pending emails directly without LLM call
  const pendingPath = path.join(process.cwd(), 'memories', 'triage', 'pending.json');
  let hasPending = false;
  let pendingCount = 0;

  if (fs.existsSync(pendingPath)) {
    try {
      const pendingData = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
      pendingCount = pendingData.total_emails || 0;
      hasPending = pendingCount > 0;
    } catch (error) {
      // Ignore parse errors
    }
  }

  // Show instant welcome message
  console.log('\n' + applyColors('[cyan]Welcome back![/cyan]') + '\n');

  if (hasPending) {
    console.log(applyColors(`You have [yellow]${pendingCount} pending emails[/yellow] from a previous triage.\n`));
    console.log('What would you like to do?');
    console.log('  1. Process pending emails (recommended)');
    console.log('  2. Triage new emails from today');
    console.log('  3. Something else');
  } else {
    console.log('No pending triaged emails found.\n');
    console.log('What would you like to do?');
    console.log('  1. Triage inbox from today (recommended)');
    console.log('  2. Triage inbox from a different timeframe');
    console.log('  3. Check specific emails manually');
  }

  console.log('\n' + '─'.repeat(50) + '\n');

  while (true) {
    try {
      const userInput = await askQuestion('> ');

      if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye!');
        break;
      }

      if (userInput.trim() === '') {
        continue;
      }

      console.log('\n🤔 Processing...\n');

      // Add user message
      conversationMessages.push(new HumanMessage(userInput));

      // Invoke agent - LangGraph handles everything!
      const result = await agent.invoke({
        messages: conversationMessages
      });

      // LangGraph returns the full updated message history
      // Trim history intelligently to prevent context overflow while keeping tool_use/tool_result pairs intact
      conversationMessages.length = 0;

      // Find a safe cutoff point that doesn't separate tool_use from tool_result
      // Strategy: Keep the most recent complete conversation turns
      const MAX_TURNS_TO_KEEP = 2; // Keep last 2 complete turns (user input + agent response with tools)

      let trimmedMessages: any[];
      if (result.messages.length <= 10) {
        // If history is small enough, keep everything
        trimmedMessages = result.messages;
      } else {
        // Work backwards to find complete turns
        // A turn is: HumanMessage -> AIMessage (with possible tool_use) -> ToolMessages -> AIMessage
        const messages = result.messages;
        let turnsKept = 0;
        let cutoffIndex = messages.length;

        // Scan backwards
        for (let i = messages.length - 1; i >= 0 && turnsKept < MAX_TURNS_TO_KEEP; i--) {
          const msg = messages[i];

          // Look for HumanMessage as turn boundary
          if (msg._getType() === 'human') {
            turnsKept++;
            if (turnsKept >= MAX_TURNS_TO_KEEP) {
              cutoffIndex = i;
              break;
            }
          }
        }

        // Ensure we keep at least the last message
        if (cutoffIndex >= messages.length - 1) {
          cutoffIndex = Math.max(0, messages.length - 10);
        }

        trimmedMessages = messages.slice(cutoffIndex);
      }

      conversationMessages.push(...trimmedMessages);

      // Log if we're managing history (for debugging)
      if (result.messages.length > trimmedMessages.length) {
        console.log(`\n[Note: Conversation history trimmed to last ${trimmedMessages.length} messages (${MAX_TURNS_TO_KEEP} turns) to manage context]\n`);
      }

      // Extract and display the final response with colors applied
      const lastMessage = result.messages[result.messages.length - 1];
      console.log(applyColors(lastMessage.content));

      console.log('\n' + '─'.repeat(50) + '\n');

    } catch (error) {
      console.error('❌ Error:', error);
      console.log('\n' + '─'.repeat(50) + '\n');
    }
  }

  rl.close();
}

if (require.main === module) {
  main().catch(console.error);
}

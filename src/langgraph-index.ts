import 'dotenv/config';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatAnthropic } from '@langchain/anthropic';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { GmailService } from './gmail-service';
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

async function initializeGmail(): Promise<GmailService | null> {
  const credentialsPath = path.join(process.cwd(), 'gmail-credentials.json');
  const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');

  if (!fs.existsSync(credentialsPath)) {
    console.log('⚠️  Gmail credentials not found at gmail-credentials.json');
    console.log('Gmail features will be disabled.\n');
    return null;
  }

  try {
    console.log('🔧 Initializing Gmail...');

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
      console.log('✅ Gmail authenticated with existing tokens\n');
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

      for (const msg of messages.slice(0, Math.min(maxResults, 20))) {
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
          date: getHeader('Date'),
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
        date: getHeader('Date'),
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

  const unsubscribeAndArchiveTool = new DynamicStructuredTool({
    name: 'unsubscribe_and_archive',
    description: 'Batch operation: attempt to unsubscribe from multiple emails and then archive them all. Perfect for sweeping away junk newsletters. Optimistic - continues even if unsubscribe fails.',
    schema: z.object({
      emailIds: z.array(z.string()).describe('Array of Gmail message IDs to unsubscribe and archive')
    }),
    func: async ({ emailIds }: any): Promise<string> => {
      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const results = {
        total: emailIds.length,
        unsubscribed: [] as string[],
        unsubscribeFailed: [] as string[],
        archived: [] as string[],
        archiveFailed: [] as string[]
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
        ...results,
        summary: summary
      }, null, 2);
    }
  });

  return [listEmailsTool, readEmailTool, archiveEmailTool, unsubscribeEmailTool, draftReplyTool, unsubscribeAndArchiveTool];
}

async function main() {
  console.log('🤖 Personal Email Management Agent (LangGraph)');
  console.log('=====================================\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable is required');
    console.log('Please add your Anthropic API key to the .env file');
    process.exit(1);
  }

  // Initialize Gmail
  const gmailService = await initializeGmail();

  if (!gmailService) {
    console.log('❌ Gmail is not authenticated. Exiting.');
    process.exit(1);
  }

  console.log('Hi! I\'m your personal email management assistant.');
  console.log('I can help you with email tasks.\n');
  console.log('💡 Commands: "quit" (exit)\n');

  // Create LangGraph tools (Gmail + Memory)
  const gmailTools = createGmailTools(gmailService);
  const memoryTools = createMemoryTools();
  const tools = [...gmailTools, ...memoryTools];

  // Initialize Claude model with memory tool beta
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-5-20250929',
    apiKey: process.env.ANTHROPIC_API_KEY,
    clientOptions: {
      defaultHeaders: {
        'anthropic-beta': 'context-management-2025-06-27'
      }
    }
  });

  // System prompt to guide the agent's behavior
  const systemPrompt = `You are an advanced personal email management assistant for Emily.

🎯 **YOUR PRIORITIES (in order):**
1. **MAIN PRIORITY**: Ensure Emily responds to and takes action on TRULY important emails
   - Never let Action Required emails slip through, especially recruitment/job search
   - Make sure critical deadlines and questions are addressed
   - Present these individually with full context so Emily can make informed decisions

2. **SECOND PRIORITY**: Help Emily achieve inbox zero
   - Efficiently process non-critical emails in batches
   - Archive, unsubscribe, or organize to clear the inbox
   - Move quickly through informational content

**Remember**: It's better to spend time on one important email than to archive 100 newsletters. Quality over speed for critical emails.

💾 **MEMORY SYSTEM:**
You have access to a persistent memory system that allows you to remember information across conversations:

**Memory Operations:**
- **view_memory**: View memory directory contents or read a specific memory file
- **create_memory**: Create a new memory file (e.g., "contacts.txt", "preferences.md")
- **str_replace_memory**: Update existing information by replacing strings
- **insert_memory**: Insert content at a specific line
- **delete_memory**: Delete a memory file
- **rename_memory**: Rename or move a memory file

**What to Remember:**
- **Contacts**: Important people Emily emails with, their roles, context about relationships
- **Preferences**: How Emily prefers to categorize certain types of emails, communication style preferences
- **Job Search**: Recruiters contacted, companies applied to, interview dates, follow-up needed
- **Events**: Recurring events Emily attends, venues, organizers
- **Email Patterns**: Senders Emily always archives, newsletters to unsubscribe from
- **Response Templates**: Common reply patterns or phrases Emily uses

**Memory Best Practices:**
1. **Check memory first**: At the start of each session, view memory directory to recall context
2. **Update as you learn**: When Emily makes decisions or shares preferences, save them to memory
3. **Organize by topic**: Use descriptive filenames like "job_search.md", "frequent_contacts.txt", "email_preferences.md"
4. **Keep it current**: Update memory when situations change (e.g., job status, new contacts)
5. **Focus on actionable info**: Remember things that help you categorize and respond to emails better

**Example Memory Usage:**
- When Emily says "always archive emails from this sender", save it to "email_preferences.md"
- When drafting replies, check "response_style.txt" to match Emily's tone
- Before suggesting which emails to prioritize, check "job_search.md" for current priorities

🔧 **Available Gmail Operations:**
- **list_emails**: Search and filter emails with flexible options
  - Time ranges: "today", "yesterday", "last week", "last month", or custom (e.g., "7d")
  - Filters: sender (from), recipient (to), subject keywords, attachments, read/unread status, labels
  - Examples: "emails from today", "unread emails from last week", "emails with attachments from john@example.com"

- **read_email**: Get full content of a specific email by ID
  - Use after listing emails to read the complete message body

- **archive_email**: Archive one or more emails (removes from inbox, keeps in All Mail)
  - Can archive multiple emails at once by providing an array of email IDs

- **unsubscribe_email**: Automatically unsubscribe from promotional/marketing emails
  - Parses the List-Unsubscribe header and makes the HTTP request on your behalf
  - Works with emails that have standard RFC-compliant unsubscribe links
  - Use this for emails in the "Unsubscribe" category
  - Note: Not all emails have automated unsubscribe links; some may require manual action

- **draft_reply**: Create a draft reply to an email
  - Automatically handles threading (In-Reply-To, References headers) to keep conversations organized
  - Prefixes subject with "Re: " if not already present
  - Saves as draft in Gmail for review before sending
  - Use this for Action Required emails that need thoughtful responses
  - Emily can review, edit, and send the draft from Gmail

- **unsubscribe_and_archive**: ⚡ BATCH OPERATION - Sweep away junk newsletters efficiently
  - Attempts to unsubscribe from multiple emails, then archives them all
  - Optimistic: continues even if unsubscribe fails for some emails
  - Perfect for processing "Unsubscribe" category in bulk
  - Saves tokens by combining two operations into one
  - Use this instead of calling unsubscribe_email and archive_email separately for multiple emails

📋 **Email Classification System:**
When asked to classify or organize emails, use these categories:

**1. Action Required**
Criteria:
- Personal emails from known contacts (not automated)
- Recruitment/job search correspondence (HIGHEST PRIORITY)
- Direct questions or calls for volunteers/action
- Calendar invitations for job interviews
- Boston-area LGBTQ, design, or product management meetup invitations
- Critical service alerts (order issues, payment failures, service outages)

Meta-summary format:
Subject: <email subject>
People: <list all participants with emails>
Synopsis: <one-sentence summary of thread purpose>
Analysis: <identify the single most important question/action required, sender's sentiment (casual/urgent/formal), deadline if any>

**2. Summarize & Inform**
Criteria:
- Newsletters, digests, articles (NYT, Substack, thought leaders)
- Content about parenting, product management, or LGBTQ topics

Meta-summary format:
Source: <publication or sender name>
Subject: <email subject>
Key Insights: <2-4 sentence synopsis of main points and key takeaway>

**3. Summarize Events**
Criteria:
- Live events, concerts, workshops
- Eventbrite, Songkick event notifications
- LGBTQ or Boston Sex Positive event invitations
- Personal calendar invitations from "Heather"
- EXCLUDE job interview invitations

Meta-summary format:
Event: <event name>
From: <invitation sender>
What: <one-sentence event description>
Where: <venue, address, location>
When: <full date and time>

**4. Summarize Purchases**
Criteria:
- Order confirmations
- Shipping notifications and delivery updates
- Digital receipts

Meta-summary format:
Vendor: <store name>
Subject: <email subject>
Update: "You purchased [Item(s)] for [Price]." OR "Your order containing [Item(s)] has shipped." OR "Your order will be delivered on [Date]."

**5. Unsubscribe**
Criteria:
- Marketing emails trying to sell something
- Promotional content from services not actively/regularly used

Meta-summary format:
Sender: <business or service name>
Recommendation: <one-sentence justification, e.g., "This is a promotional mailing list for a service you no longer use.">

**6. Immediate Archive**
Criteria:
- Automated informational notifications (not critical)
- Resolved customer support threads
- Promotional emails from services Emily uses but this specific email isn't actionable
- General corporate announcements from services she uses

Meta-summary: "This email is informational and does not require a specific action or summary. It can be safely archived."

**7. Other**
Criteria:
- Only use when all other categories have been exhausted

**WORKFLOW APPROACH:**
Work iteratively through emails in chunks or categories, ALWAYS starting with Action Required emails:

**Suggested Order:**
1. Action Required emails (handle individually, most important)
2. Summarize Events (time-sensitive, may need responses)
3. Summarize Purchases (quick review for any issues)
4. Summarize & Inform (batch archive)
5. Unsubscribe (batch cleanup)
6. Immediate Archive (batch archive)
7. Other (review case-by-case)

Examples:
- "Let's start with Action Required emails first"
- "Now let's quickly process the Summarize Purchases emails"
- "Let's review emails from the last hour, starting with anything important"

**BATCH PROCESSING (for non-important emails):**
Group similar emails and present them with options. Format:

**[Category Name]** (X emails)
<Summarized list with email IDs>

**Options:**
1. Archive all
2. Read specific email(s) (provide number/ID)
3. Skip for now
4. Unsubscribe and archive all (use unsubscribe_and_archive tool for efficiency)

Example: "Here are 10 Summarize & Inform emails from this week. [list]. Options: 1) Archive all, 2) Read specific email(s), 3) Skip for now, 4) Unsubscribe from sender(s)"

**INDIVIDUAL HANDLING (for Action Required emails):**
Present each important email individually with:

**[Email Subject]**
<Meta-summary with full details>

**Options:**
1. Read full email
2. Draft reply (if response needed)
3. Archive
4. Skip for now
5. Next email

When drafting replies:
- Offer to create a draft for Action Required emails that need responses
- Suggest thoughtful reply content based on the email context
- Always save as draft so Emily can review before sending

**IMPORTANT GUIDELINES:**
1. **ALWAYS start with Action Required emails** - never skip to other categories first
2. For Action Required emails: handle individually, provide full context, highlight deadlines and required actions
3. Prioritize recruitment/job search emails above all else - these are career-critical
4. Be proactive - actually perform actions, don't just explain what could be done
5. When listing emails, always mention the email IDs so users can reference them
6. Work in manageable chunks (5-10 emails at a time, or one category at a time)
7. For non-Action Required categories, prefer batch processing with summarized lists
8. Always provide the appropriate meta-summary format for each classification
9. Use consistent numbered options - don't change the order of action choices
10. If an email body is very long, summarize the key points
11. Always confirm successful operations (e.g., "✅ Archived 3 emails")
12. After completing a chunk/category, ask "What would you like to review next?" or suggest the next logical category
13. **Don't rush through important emails just to achieve inbox zero** - thoroughness matters for critical emails

**RESPONSE STYLE:**
- Be concise and helpful
- Use the tools to provide actual results, not just descriptions
- Maintain context across the conversation
- When classifying, present results grouped by category
- Present options as numbered lists for easy selection
- Guide the user through their inbox systematically`;

  // Create ReAct agent - LangGraph handles conversation history automatically!
  const agent = createReactAgent({
    llm: model,
    tools: tools,
    messageModifier: systemPrompt
  });

  // Conversation state managed by LangGraph
  const conversationMessages: any[] = [];

  while (true) {
    try {
      const userInput = await askQuestion('💬 What would you like me to help you with? (type "quit" to exit): ');

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
      conversationMessages.length = 0;
      conversationMessages.push(...result.messages);

      // Extract and display the final response
      const lastMessage = result.messages[result.messages.length - 1];
      console.log('🤖 Assistant:', lastMessage.content);

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

import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { GmailService, GmailCredentials } from './gmail-service';
import fs from 'fs';
import path from 'path';

// Global Gmail service instance
let gmailService: GmailService | null = null;

/**
 * Initialize Gmail service with credentials
 */
export const initGmailTool = tool(
  'init_gmail',
  'Initialize Gmail service with OAuth credentials',
  {
    credentialsPath: z.string().describe('Path to Gmail credentials JSON file (from Google Cloud Console)')
  },
  async ({ credentialsPath }) => {
    try {
      if (!fs.existsSync(credentialsPath)) {
        return {
          content: [{ type: 'text', text: 'Error: Credentials file not found. Please provide a valid path to your Gmail credentials JSON file.' }]
        };
      }

      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      const gmailCreds: GmailCredentials = {
        client_id: credentials.installed?.client_id || credentials.web?.client_id,
        client_secret: credentials.installed?.client_secret || credentials.web?.client_secret,
        redirect_uri: credentials.installed?.redirect_uris?.[0] || credentials.web?.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
      };

      gmailService = new GmailService(gmailCreds);

      // Try to load existing tokens
      const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');
      const tokens = gmailService.loadTokens(tokenPath);

      if (tokens) {
        return {
          content: [{ type: 'text', text: 'Gmail service initialized with existing tokens. You are now authenticated and ready to use Gmail tools!' }]
        };
      } else {
        const authUrl = gmailService.getAuthUrl();
        return {
          content: [{
            type: 'text',
            text: `Gmail service initialized. Please authenticate by visiting this URL:\n\n${authUrl}\n\nAfter authorizing, copy the authorization code and use the authenticate_gmail tool with that code.`
          }]
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to initialize Gmail service: ${error}` }]
      };
    }
  }
);

/**
 * Authenticate Gmail with authorization code
 */
export const authenticateGmailTool = tool(
  'authenticate_gmail',
  'Authenticate Gmail service with authorization code from OAuth flow',
  {
    authCode: z.string().describe('Authorization code from Gmail OAuth flow')
  },
  async ({ authCode }) => {
    try {
      if (!gmailService) {
        return {
          content: [{ type: 'text', text: 'Error: Gmail service not initialized. Please run init_gmail first.' }]
        };
      }

      const tokens = await gmailService.getTokens(authCode);
      gmailService.setTokens(tokens);

      // Save tokens for future use
      const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');
      gmailService.saveTokens(tokens, tokenPath);

      return {
        content: [{ type: 'text', text: 'Gmail authenticated successfully! Tokens saved for future use. You can now use all Gmail tools.' }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Authentication failed: ${error}` }]
      };
    }
  }
);

/**
 * List emails from Gmail
 */
export const listEmailsTool = tool(
  'list_emails',
  'List emails from Gmail inbox with optional filters',
  {
    maxResults: z.number().optional().default(10).describe('Maximum number of emails to retrieve (default: 10, max: 100)'),
    query: z.string().optional().describe('Gmail search query (e.g., "is:unread", "from:sender@email.com", "subject:important")'),
    labelIds: z.string().optional().describe('Comma-separated list of label IDs to filter by (e.g., "INBOX,UNREAD")')
  },
  async ({ maxResults = 10, query, labelIds }) => {
    try {
      if (!gmailService?.isAuthenticated()) {
        return {
          content: [{ type: 'text', text: 'Error: Gmail not authenticated. Please authenticate first using init_gmail and authenticate_gmail tools.' }]
        };
      }

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const params: any = {
        userId: 'me',
        maxResults: Math.min(maxResults, 100)
      };

      if (query) params.q = query;
      if (labelIds) params.labelIds = labelIds.split(',');

      const response = await gmail.users.messages.list(params);
      const messages = response.data.messages || [];

      if (messages.length === 0) {
        return {
          content: [{ type: 'text', text: 'No emails found matching the criteria.' }]
        };
      }

      // Get details for each message
      const emailDetails = await Promise.all(
        messages.map(async (message: any) => {
          const details = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'Date', 'To']
          });

          const headers = details.data.payload.headers;
          const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

          return {
            id: message.id,
            threadId: message.threadId,
            subject: getHeader('Subject'),
            from: getHeader('From'),
            to: getHeader('To'),
            date: getHeader('Date'),
            snippet: details.data.snippet,
            labelIds: details.data.labelIds
          };
        })
      );

      const emailList = emailDetails.map((email, index) =>
        `${index + 1}. ID: ${email.id}\n   Subject: ${email.subject}\n   From: ${email.from}\n   Date: ${email.date}\n   Snippet: ${email.snippet}\n`
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${emailDetails.length} emails:\n\n${emailList}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to list emails: ${error}` }]
      };
    }
  }
);

/**
 * Read a specific email
 */
export const readEmailTool = tool(
  'read_email',
  'Read the full content of a specific email by ID',
  {
    emailId: z.string().describe('Gmail message ID of the email to read'),
    format: z.string().optional().default('full').describe('Email format: "full" for complete email, "raw" for raw content, "minimal" for basic info (default: "full")')
  },
  async ({ emailId, format = 'full' }) => {
    try {
      if (!gmailService?.isAuthenticated()) {
        return {
          content: [{ type: 'text', text: 'Error: Gmail not authenticated. Please authenticate first.' }]
        };
      }

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const response = await gmail.users.messages.get({
        userId: 'me',
        id: emailId,
        format
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

      let body = '';
      if (format === 'full' && message.payload) {
        body = extractEmailBody(message.payload);
      }

      const emailText = `
Email Details:
ID: ${message.id}
Subject: ${getHeader('Subject')}
From: ${getHeader('From')}
To: ${getHeader('To')}
Date: ${getHeader('Date')}
Labels: ${message.labelIds?.join(', ') || 'None'}

${body ? `Body:\n${body}` : `Snippet: ${message.snippet}`}
      `;

      return {
        content: [{ type: 'text', text: emailText.trim() }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to read email: ${error}` }]
      };
    }
  }
);

/**
 * Send an email
 */
export const sendEmailTool = tool(
  'send_email',
  'Send an email via Gmail',
  {
    to: z.string().describe('Recipient email address(es), comma-separated for multiple recipients'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body content (plain text or HTML)'),
    cc: z.string().optional().describe('CC email address(es), comma-separated'),
    bcc: z.string().optional().describe('BCC email address(es), comma-separated'),
    isHtml: z.boolean().optional().default(false).describe('Whether the body content is HTML (default: false)')
  },
  async ({ to, subject, body, cc, bcc, isHtml = false }) => {
    try {
      if (!gmailService?.isAuthenticated()) {
        return {
          content: [{ type: 'text', text: 'Error: Gmail not authenticated. Please authenticate first.' }]
        };
      }

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      // Construct email
      let email = `To: ${to}\r\n`;
      if (cc) email += `Cc: ${cc}\r\n`;
      if (bcc) email += `Bcc: ${bcc}\r\n`;
      email += `Subject: ${subject}\r\n`;
      email += `Content-Type: ${isHtml ? 'text/html' : 'text/plain'}; charset=utf-8\r\n\r\n`;
      email += body;

      // Encode email in base64url
      const encodedEmail = Buffer.from(email).toString('base64url');

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail
        }
      });

      return {
        content: [{
          type: 'text',
          text: `Email sent successfully!\nMessage ID: ${response.data.id}\nTo: ${to}\nSubject: ${subject}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to send email: ${error}` }]
      };
    }
  }
);

/**
 * Manage email labels (archive, delete, mark as read/unread)
 */
export const manageEmailTool = tool(
  'manage_email',
  'Manage email labels and actions (archive, delete, mark as read/unread, add/remove labels)',
  {
    emailId: z.string().describe('Gmail message ID of the email to manage'),
    action: z.string().describe('Action to perform: "archive", "delete", "mark_read", "mark_unread", "add_labels", "remove_labels"'),
    labels: z.string().optional().describe('Comma-separated list of label IDs (required for add_labels/remove_labels actions)')
  },
  async ({ emailId, action, labels }) => {
    try {
      if (!gmailService?.isAuthenticated()) {
        return {
          content: [{ type: 'text', text: 'Error: Gmail not authenticated. Please authenticate first.' }]
        };
      }

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      let response;

      switch (action) {
        case 'archive':
          response = await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              removeLabelIds: ['INBOX']
            }
          });
          break;

        case 'delete':
          response = await gmail.users.messages.trash({
            userId: 'me',
            id: emailId
          });
          break;

        case 'mark_read':
          response = await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              removeLabelIds: ['UNREAD']
            }
          });
          break;

        case 'mark_unread':
          response = await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              addLabelIds: ['UNREAD']
            }
          });
          break;

        case 'add_labels':
          if (!labels) {
            return {
              content: [{ type: 'text', text: 'Error: Labels parameter required for add_labels action' }]
            };
          }
          response = await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              addLabelIds: labels.split(',')
            }
          });
          break;

        case 'remove_labels':
          if (!labels) {
            return {
              content: [{ type: 'text', text: 'Error: Labels parameter required for remove_labels action' }]
            };
          }
          response = await gmail.users.messages.modify({
            userId: 'me',
            id: emailId,
            requestBody: {
              removeLabelIds: labels.split(',')
            }
          });
          break;

        default:
          return {
            content: [{ type: 'text', text: `Error: Unknown action: ${action}` }]
          };
      }

      return {
        content: [{
          type: 'text',
          text: `Email ${action} completed successfully for email ID: ${emailId}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to manage email: ${error}` }]
      };
    }
  }
);

/**
 * List Gmail labels
 */
export const listLabelsTool = tool(
  'list_labels',
  'List all Gmail labels available in the account',
  {},
  async () => {
    try {
      if (!gmailService?.isAuthenticated()) {
        return {
          content: [{ type: 'text', text: 'Error: Gmail not authenticated. Please authenticate first.' }]
        };
      }

      await gmailService.refreshTokenIfNeeded();
      const gmail = gmailService.getGmailApi();

      const response = await gmail.users.labels.list({
        userId: 'me'
      });

      const labels = response.data.labels || [];

      const labelList = labels.map((label: any) =>
        `- ${label.name} (ID: ${label.id}) - ${label.messagesTotal || 0} total, ${label.messagesUnread || 0} unread`
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Available Gmail labels:\n\n${labelList}`
        }]
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to list labels: ${error}` }]
      };
    }
  }
);

/**
 * Helper function to extract email body from Gmail API payload
 */
function extractEmailBody(payload: any): string {
  let body = '';

  if (payload.parts) {
    // Multi-part email
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
        if (part.body?.data) {
          body += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      } else if (part.parts) {
        // Nested parts
        body += extractEmailBody(part);
      }
    }
  } else if (payload.body?.data) {
    // Single-part email
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  return body;
}

// Export all tools
export const gmailTools = [
  initGmailTool,
  authenticateGmailTool,
  listEmailsTool,
  readEmailTool,
  sendEmailTool,
  manageEmailTool,
  listLabelsTool
];
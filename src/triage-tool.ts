import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { ChatAnthropic } from '@langchain/anthropic';

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

// Email classification structure
interface EmailClassification {
  email_id: string;
  category: string;
  confidence: number;
  from: string;
  subject: string;
  date: string;
  meta_summary: any;
  reason_for_low_confidence?: string;
}

interface PendingEmailsData {
  last_updated: string;
  total_emails: number;
  by_category: Record<string, number>;
  emails: EmailClassification[];
}

// Zod schemas for structured output
const ActionRequiredSchema = z.object({
  subject: z.string().describe('The email subject'),
  people: z.string().describe('List all participants with emails'),
  synopsis: z.string().describe('One-sentence summary of thread purpose'),
  analysis: z.string().describe('Single most important question/action required, sender sentiment (casual/urgent/formal), deadline if any')
});

const SummarizeInformSchema = z.object({
  source: z.string().describe('Publication or sender name'),
  subject: z.string().describe('Email subject'),
  key_insights: z.string().describe('2-4 sentence synopsis of main points and key takeaway')
});

const SummarizeEventsSchema = z.object({
  event: z.string().describe('Event name'),
  from: z.string().describe('Invitation sender'),
  what: z.string().describe('One-sentence event description'),
  where: z.string().describe('Venue, address, location'),
  when: z.string().describe('Full date and time')
});

const SummarizePurchasesSchema = z.object({
  vendor: z.string().describe('Store name'),
  subject: z.string().describe('Email subject'),
  update: z.string().describe('Purchase details: You purchased [Item(s)] for [Price]. OR Your order shipped. OR Delivery on [Date].')
});

const UnsubscribeSchema = z.object({
  sender: z.string().describe('Business or service name'),
  recommendation: z.string().describe('One-sentence justification for unsubscribing')
});

const OtherSchema = z.object({
  subject: z.string().describe('Email subject'),
  people: z.string().describe('Sender'),
  synopsis: z.string().describe('Brief summary'),
  reason: z.string().describe('Why it doesn\'t fit other categories')
});

const EmailClassificationSchema = z.object({
  category: z.enum([
    'ACTION_REQUIRED',
    'SUMMARIZE_AND_INFORM',
    'SUMMARIZE_EVENTS',
    'SUMMARIZE_PURCHASES',
    'UNSUBSCRIBE',
    'IMMEDIATE_ARCHIVE',
    'OTHER'
  ]).describe('The category this email belongs to'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0.0 to 1.0'),
  meta_summary: z.union([
    ActionRequiredSchema,
    SummarizeInformSchema,
    SummarizeEventsSchema,
    SummarizePurchasesSchema,
    UnsubscribeSchema,
    z.string(), // For IMMEDIATE_ARCHIVE
    OtherSchema
  ]).describe('Category-specific structured summary')
});

/**
 * Load email preferences for classification guidance
 */
function loadEmailPreferences(): string {
  const preferencesPath = path.join(process.cwd(), 'memories', 'email_preferences.md');
  try {
    if (fs.existsSync(preferencesPath)) {
      return fs.readFileSync(preferencesPath, 'utf-8');
    }
  } catch (error) {
    console.error('Failed to load email preferences:', error);
  }
  return 'No user preferences loaded. Use default classification rules.';
}

/**
 * Create the triage_inbox tool for batch email classification
 */
export function createTriageTool(listEmailsTool: DynamicStructuredTool, readEmailTool: DynamicStructuredTool, gmailService?: any) {
  const triageTool = new DynamicStructuredTool({
    name: 'triage_inbox',
    description: `⚠️  PRECONDITION: Before calling this tool, ALWAYS check view_memory("triage/pending.json") first! ⚠️

If pending emails exist (total_emails > 0):
  1. Show count to user
  2. Ask: "Continue pending OR start fresh?"
  3. Only call triage_inbox if user chose "start fresh"

What this tool does:
Triage and classify emails in batch using AI. Fetches recent emails from Gmail, classifies them by category with confidence scores, and saves results to memories/triage/pending.json (will overwrite existing file if present). Use this to organize inbox efficiently after checking for existing pending emails.`,
    schema: z.object({
      batch_size: z.number().optional().default(200).describe('Maximum number of emails to process (default: 200, max: 300 to avoid context limits)'),
      days: z.number().optional().default(1).describe('Process emails from last N days (default: 1)'),
      older_than: z.string().optional().describe('Process emails older than specific date (YYYY/MM/DD format)')
    }),
    func: async ({ batch_size = 200, days = 1, older_than }: any): Promise<string> => {
      try {
        // Enforce maximum batch size to prevent context overflow
        const MAX_BATCH_SIZE = 300;
        if (batch_size > MAX_BATCH_SIZE) {
          console.log(`⚠️  Batch size ${batch_size} exceeds maximum ${MAX_BATCH_SIZE}, limiting to ${MAX_BATCH_SIZE}`);
          batch_size = MAX_BATCH_SIZE;
        }

        console.log(`🔄 Starting triage for emails from last ${days} day(s)...`);

        // Step 1: Fetch ALL emails with metadata + snippet (with proper Gmail API pagination)
        const allEmails: any[] = [];

        if (gmailService) {
          // Use Gmail API directly for proper pagination
          await gmailService.refreshTokenIfNeeded();
          const gmail = gmailService.getGmailApi();

          // Build query
          const now = new Date();
          const afterDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
          const formatDate = (date: Date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}/${month}/${day}`;
          };

          const query = older_than
            ? `before:${older_than} in:inbox`
            : `after:${formatDate(afterDate)} in:inbox`;

          console.log(`📧 Searching with query: ${query}`);

          // Paginate through all results
          let pageToken: string | undefined = undefined;
          let fetchRound = 1;

          do {
            const response = await gmail.users.messages.list({
              userId: 'me',
              maxResults: Math.min(100, batch_size - allEmails.length),
              q: query,
              pageToken: pageToken
            });

            const messages = response.data.messages || [];

            if (messages.length === 0) {
              break;
            }

            // Fetch details for each message
            for (const msg of messages) {
              const details = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id!,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date', 'To']
              });

              const headers = details.data.payload?.headers || [];
              const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

              allEmails.push({
                id: msg.id,
                subject: getHeader('Subject'),
                from: getHeader('From'),
                date: formatEmailDate(getHeader('Date')),
                to: getHeader('To'),
                snippet: details.data.snippet
              });
            }

            console.log(`📧 Fetched ${messages.length} emails (page ${fetchRound}, total: ${allEmails.length})`);

            // Get next page token
            pageToken = response.data.nextPageToken;
            fetchRound++;

            // Stop if we've reached the batch size limit
            if (allEmails.length >= batch_size) {
              break;
            }

          } while (pageToken);

        } else {
          // Fallback to using list_emails tool (limited to 100 emails)
          console.log('⚠️  Using fallback method (limited to 100 emails)');
          const timeRange = older_than ? undefined : `${days}d`;
          const listParams = {
            maxResults: Math.min(batch_size, 100),
            timeRange: timeRange,
            query: older_than ? `before:${older_than}` : undefined
          };

          const emailsResult = await listEmailsTool.func(listParams);
          const emailsData = JSON.parse(emailsResult);
          allEmails.push(...(emailsData.emails || []));
        }

        if (allEmails.length === 0) {
          return JSON.stringify({
            success: true,
            message: 'No emails found in the specified time range',
            total: 0
          }, null, 2);
        }

        console.log(`📧 Total emails found: ${allEmails.length}`);

        // Warn if approaching context limits
        if (allEmails.length > 250) {
          console.log(`⚠️  Processing ${allEmails.length} emails may be slow. Consider smaller batches (batch_size=200) for better performance.`);
        }

        console.log(`🤖 Classifying with AI (using snippets first)...`);

        // Step 2: First pass - classify based on snippets
        const classifications = await classifyEmailBatch(allEmails, true);

        // Step 3: Identify low-confidence classifications
        const lowConfidence = classifications.filter(c => c.confidence < 0.7);
        console.log(`🔍 Found ${lowConfidence.length} low-confidence classifications, fetching full bodies...`);

        // Step 4: Second pass - re-classify with full body for low-confidence emails
        if (lowConfidence.length > 0) {
          const reclassified = [];
          for (const item of lowConfidence) {
            try {
              // Fetch full email body
              const fullEmailResult = await readEmailTool.func({ emailId: item.email_id });
              const fullEmail = JSON.parse(fullEmailResult);

              // Re-classify with full content
              const reclassification = await classifyEmailBatch([{
                id: fullEmail.id,
                from: fullEmail.from,
                subject: fullEmail.subject,
                date: fullEmail.date,
                body: fullEmail.body // Now has full body instead of snippet
              }], false);

              if (reclassification.length > 0) {
                reclassified.push(reclassification[0]);
              }
            } catch (error) {
              console.log(`⚠️  Could not reclassify ${item.email_id}: ${error}`);
              // Keep original classification if reclassification fails
              reclassified.push(item);
            }
          }

          // Merge reclassified emails back into classifications
          for (const updated of reclassified) {
            const index = classifications.findIndex(c => c.email_id === updated.email_id);
            if (index !== -1) {
              classifications[index] = updated;
            }
          }

          console.log(`✅ Reclassified ${reclassified.length} emails with full content`);
        }

        // Step 5: Save classifications to pending.json
        await saveClassificationsToMemory(classifications);

        // Step 6: Generate summary statistics
        const summary = generateSummary(classifications);

        // Return ONLY summary stats, not the full email data (to avoid context overflow)
        return JSON.stringify({
          success: true,
          total_emails: classifications.length,
          by_category: summary.by_category,
          message: `Successfully triaged ${classifications.length} email(s). Results saved to memories/triage/pending.json`,
          summary: summary.message
        }, null, 2);

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: String(error),
          message: 'Failed to complete triage operation'
        }, null, 2);
      }
    }
  });

  return triageTool;
}

/**
 * Classify a single email using LLM with structured output
 * @param email Email object with id, from, subject, snippet, and optionally body
 * @param preferences User email preferences loaded from email_preferences.md
 * @param useSnippetOnly If true, only use snippet for classification (for initial pass)
 * @returns Email classification with structured meta_summary
 */
async function classifyEmailWithLLM(email: any, preferences: string, useSnippetOnly: boolean = false): Promise<EmailClassification> {
  try {
    // Initialize Claude Haiku model (fast and cheap for classification)
    const model = new ChatAnthropic({
      modelName: 'claude-haiku-4-20250514',
      temperature: 0,
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    // Use structured output with our Zod schema
    const structuredLLM = model.withStructuredOutput(EmailClassificationSchema, {
      name: 'email_classification'
    });

    // Prepare email content for classification
    const content = useSnippetOnly
      ? email.snippet || ''
      : email.body || email.snippet || '';

    const contentType = useSnippetOnly ? 'SNIPPET ONLY' : 'FULL EMAIL';

    // Create classification prompt
    const prompt = `You are an email classification assistant. Classify the following email into one of the defined categories and provide a structured meta-summary.

${preferences}

EMAIL TO CLASSIFY:
From: ${email.from}
Subject: ${email.subject || '(no subject)'}
Date: ${email.date}
Content Type: ${contentType}
Content:
${content}

${useSnippetOnly ? '\n⚠️ WARNING: You only have the snippet. If the content seems truncated or unclear, lower your confidence score (0.3-0.5 range) and note that full body is needed for accurate classification.\n' : ''}

Instructions:
1. Choose the most appropriate category based on the email content and user preferences
2. Provide a confidence score (0.0-1.0) based on how certain you are
3. Create a structured meta_summary that matches the category's required format
4. For ACTION_REQUIRED: Focus on job search emails (HIGHEST PRIORITY), personal contacts, direct questions
5. For IMMEDIATE_ARCHIVE: Use a simple string, not an object
6. Consider the user's location, interests, and priorities when categorizing

Return your classification in the structured format.`;

    // Get structured classification from LLM
    const result = await structuredLLM.invoke(prompt);

    // Return formatted classification
    return {
      email_id: email.id,
      category: result.category,
      confidence: result.confidence,
      from: email.from,
      subject: email.subject,
      date: email.date,
      meta_summary: result.meta_summary,
      ...(useSnippetOnly && result.confidence < 0.5 ? {
        reason_for_low_confidence: 'Snippet is truncated or unclear, need full body for accurate classification'
      } : {})
    };

  } catch (error) {
    console.error(`❌ Error classifying email ${email.id}:`, error);

    // Fallback to OTHER category if LLM fails
    return {
      email_id: email.id,
      category: 'OTHER',
      confidence: 0.3,
      from: email.from,
      subject: email.subject,
      date: email.date,
      meta_summary: {
        subject: email.subject || '(no subject)',
        people: email.from,
        synopsis: email.snippet || email.body?.substring(0, 100) || 'No content available',
        reason: `Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      reason_for_low_confidence: 'LLM classification failed, manual review recommended'
    };
  }
}

/**
 * Classify a batch of emails using LLM with structured output
 * @param emails Array of email objects with id, from, subject, snippet, and optionally body
 * @param useSnippetOnly If true, only use snippet for classification (for initial pass)
 * @returns Array of email classifications
 */
async function classifyEmailBatch(
  emails: any[],
  useSnippetOnly: boolean
): Promise<EmailClassification[]> {
  const preferences = loadEmailPreferences();
  const classifications: EmailClassification[] = [];

  console.log(`🤖 Classifying ${emails.length} emails using LLM ${useSnippetOnly ? '(snippet only)' : '(full content)'}...`);

  // Process emails sequentially to avoid rate limits
  // TODO: Consider batching multiple emails in a single prompt for efficiency
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    console.log(`  [${i + 1}/${emails.length}] Classifying: ${email.subject?.substring(0, 50) || '(no subject)'}...`);

    const classification = await classifyEmailWithLLM(email, preferences, useSnippetOnly);
    classifications.push(classification);
  }

  // Log category distribution
  const categoryCount: Record<string, number> = {};
  classifications.forEach(c => {
    categoryCount[c.category] = (categoryCount[c.category] || 0) + 1;
  });

  console.log('📊 Classification results:');
  Object.entries(categoryCount).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count} emails`);
  });

  return classifications;
}

/**
 * Save classifications to memories/triage/pending.json
 */
async function saveClassificationsToMemory(classifications: EmailClassification[]): Promise<void> {
  const memoriesDir = path.join(process.cwd(), 'memories', 'triage');
  const pendingPath = path.join(memoriesDir, 'pending.json');

  // Ensure directory exists
  if (!fs.existsSync(memoriesDir)) {
    fs.mkdirSync(memoriesDir, { recursive: true });
  }

  // Calculate category counts
  const by_category: Record<string, number> = {};
  for (const classification of classifications) {
    by_category[classification.category] = (by_category[classification.category] || 0) + 1;
  }

  const data: PendingEmailsData = {
    last_updated: new Date().toISOString(),
    total_emails: classifications.length,
    by_category: by_category,
    emails: classifications
  };

  // Check if file exists and merge with existing data
  if (fs.existsSync(pendingPath)) {
    try {
      const existingData: PendingEmailsData = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));

      // Merge new classifications with existing ones (avoid duplicates)
      const existingIds = new Set(existingData.emails.map(e => e.email_id));
      const newEmails = classifications.filter(c => !existingIds.has(c.email_id));

      if (newEmails.length > 0) {
        existingData.emails.push(...newEmails);
        existingData.total_emails = existingData.emails.length;

        // Recalculate category counts
        existingData.by_category = {};
        for (const email of existingData.emails) {
          existingData.by_category[email.category] = (existingData.by_category[email.category] || 0) + 1;
        }
        existingData.last_updated = new Date().toISOString();

        fs.writeFileSync(pendingPath, JSON.stringify(existingData, null, 2), 'utf-8');
        console.log(`💾 Updated pending.json with ${newEmails.length} new email(s)`);
      } else {
        console.log(`ℹ️  All emails already in pending.json`);
      }
    } catch (error) {
      // If existing file is corrupt, overwrite it
      console.log(`⚠️  Existing pending.json is corrupt, creating new file`);
      fs.writeFileSync(pendingPath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`💾 Created new pending.json with ${classifications.length} email(s)`);
    }
  } else {
    // Create new file
    fs.writeFileSync(pendingPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`💾 Created pending.json with ${classifications.length} email(s)`);
  }
}

/**
 * Generate summary statistics from classifications
 */
function generateSummary(classifications: EmailClassification[]): { by_category: Record<string, number>; message: string } {
  const by_category: Record<string, number> = {};

  for (const classification of classifications) {
    by_category[classification.category] = (by_category[classification.category] || 0) + 1;
  }

  const lines = [
    `Triaged ${classifications.length} emails:`,
    ''
  ];

  // Sort categories by priority
  const priorityOrder = [
    'ACTION_REQUIRED',
    'SUMMARIZE_EVENTS',
    'SUMMARIZE_PURCHASES',
    'SUMMARIZE_AND_INFORM',
    'UNSUBSCRIBE',
    'IMMEDIATE_ARCHIVE',
    'OTHER'
  ];

  for (const category of priorityOrder) {
    const count = by_category[category] || 0;
    if (count > 0) {
      let icon = '';
      switch (category) {
        case 'ACTION_REQUIRED':
          icon = '🔴';
          break;
        case 'SUMMARIZE_EVENTS':
          icon = '📅';
          break;
        case 'SUMMARIZE_PURCHASES':
          icon = '🛒';
          break;
        case 'SUMMARIZE_AND_INFORM':
          icon = '📰';
          break;
        case 'UNSUBSCRIBE':
          icon = '🗑️';
          break;
        case 'IMMEDIATE_ARCHIVE':
          icon = '📥';
          break;
        default:
          icon = '❓';
      }
      lines.push(`  ${icon} ${count} ${category.replace(/_/g, ' ')}`);
    }
  }

  return {
    by_category: by_category,
    message: lines.join('\n')
  };
}

import { query } from '@anthropic-ai/claude-agent-sdk';
import { EMAIL_CLASSIFIER_PROMPT, EmailClassificationResult } from './email-classifier-prompt';

export interface EmailData {
  subject: string;
  date: string;
  from: string;
  to: string;
  replyTo?: string;
  textAsHtml: string;
}

export class EmailClassifier {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async classifyEmail(emailData: EmailData): Promise<EmailClassificationResult> {
    const classificationPrompt = `${EMAIL_CLASSIFIER_PROMPT}

### Email to Classify and Analyze

**Subject:** ${emailData.subject}
**Date:** ${emailData.date}
**From:** ${emailData.from}
**To:** ${emailData.to}
**Reply To:** ${emailData.replyTo || 'N/A'}

**Email Body:**
${emailData.textAsHtml}

---

Please analyze this email and return the classification result as a clean JSON object with no additional formatting or explanation.`;

    try {
      const result = await query({
        prompt: classificationPrompt,
        options: {
          apiKey: this.apiKey,
          model: 'claude-3-5-sonnet-20241022'
        }
      });

      // Parse the JSON response
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }

      const classification: EmailClassificationResult = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!classification.classification || !classification.meta_summary) {
        throw new Error('Invalid classification result: missing required fields');
      }

      return classification;
    } catch (error) {
      console.error('Error classifying email:', error);
      throw new Error(`Email classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async classifyEmailBatch(emails: EmailData[]): Promise<EmailClassificationResult[]> {
    const results: EmailClassificationResult[] = [];

    for (const email of emails) {
      try {
        const classification = await this.classifyEmail(email);
        results.push(classification);
      } catch (error) {
        console.error(`Failed to classify email: ${email.subject}`, error);
        // Add fallback classification for failed emails
        results.push({
          classification: 'NEEDS_REVIEW',
          priority: 3,
          meta_summary: `**❓ CLASSIFICATION FAILED**\n**Subject:** ${email.subject}\n**From:** ${email.from}\n**Error:** Failed to process this email automatically.`,
          suggested_actions: ['Review manually'],
          next_steps: ['Open email and categorize manually']
        });
      }
    }

    return results;
  }

  /**
   * Sort classified emails by priority for workflow-based processing
   */
  sortByPriority(classifications: EmailClassificationResult[]): EmailClassificationResult[] {
    return classifications.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Group emails by classification for batch processing
   */
  groupByClassification(classifications: EmailClassificationResult[]): Record<string, EmailClassificationResult[]> {
    return classifications.reduce((groups, classification) => {
      const category = classification.classification;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(classification);
      return groups;
    }, {} as Record<string, EmailClassificationResult[]>);
  }
}
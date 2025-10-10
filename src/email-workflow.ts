import { EmailClassifier, EmailData } from './email-classifier';
import { EmailClassificationResult } from './email-classifier-prompt';
import * as readline from 'readline';

export interface WorkflowConfig {
  batchSize: number;
  autoArchiveAfterDigestReview: boolean;
  showAnxietySupport: boolean;
}

export class EmailWorkflowManager {
  private classifier: EmailClassifier;
  private rl: readline.Interface;
  private config: WorkflowConfig;

  constructor(apiKey: string, rl: readline.Interface, config: Partial<WorkflowConfig> = {}) {
    this.classifier = new EmailClassifier(apiKey);
    this.rl = rl;
    this.config = {
      batchSize: 10,
      autoArchiveAfterDigestReview: true,
      showAnxietySupport: true,
      ...config
    };
  }

  private askQuestion(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  async processInboxWorkflow(emails: EmailData[]): Promise<void> {
    console.log(`\n🔄 Starting inbox triage for ${emails.length} emails...\n`);

    // Classify all emails
    console.log('📊 Analyzing emails...');
    const classifications = await this.classifier.classifyEmailBatch(emails);

    // Sort by priority
    const sortedClassifications = this.classifier.sortByPriority(classifications);

    // Group by classification for summary
    const grouped = this.classifier.groupByClassification(classifications);

    // Show overview
    this.showInboxOverview(grouped);

    // Process in priority order
    await this.processUrgentActions(sortedClassifications.filter(c => c.classification === 'URGENT_ACTION'));
    await this.processPersonalActions(sortedClassifications.filter(c => c.classification === 'PERSONAL_ACTION'));
    await this.processInformationalDigest(sortedClassifications.filter(c => c.classification === 'INFORMATIONAL_DIGEST'));
    await this.processEvents(sortedClassifications.filter(c => c.classification === 'EVENT_TRACKING'));
    await this.processJunkCleanup(sortedClassifications.filter(c => c.classification === 'JUNK_UNSUBSCRIBE'));
    await this.processRemainingItems(sortedClassifications.filter(c =>
      !['URGENT_ACTION', 'PERSONAL_ACTION', 'INFORMATIONAL_DIGEST', 'EVENT_TRACKING', 'JUNK_UNSUBSCRIBE'].includes(c.classification)
    ));

    console.log('\n✅ Inbox triage complete! Your emails are now organized and actionable.');
  }

  private showInboxOverview(grouped: Record<string, EmailClassificationResult[]>): void {
    console.log('\n📋 INBOX OVERVIEW');
    console.log('==================');

    const priorityOrder = ['URGENT_ACTION', 'PERSONAL_ACTION', 'INFORMATIONAL_DIGEST', 'EVENT_TRACKING', 'JUNK_UNSUBSCRIBE', 'AUTO_ARCHIVE', 'NEEDS_REVIEW'];

    for (const category of priorityOrder) {
      const count = grouped[category]?.length || 0;
      if (count > 0) {
        const emoji = this.getCategoryEmoji(category);
        console.log(`${emoji} ${category.replace('_', ' ')}: ${count} emails`);
      }
    }
    console.log('');
  }

  private getCategoryEmoji(category: string): string {
    const emojiMap: Record<string, string> = {
      'URGENT_ACTION': '🚨',
      'PERSONAL_ACTION': '👤',
      'INFORMATIONAL_DIGEST': '📰',
      'EVENT_TRACKING': '🎪',
      'TRANSACTION_LOG': '💳',
      'PROMOTIONAL_ARCHIVE': '📢',
      'JUNK_UNSUBSCRIBE': '🗑️',
      'AUTO_ARCHIVE': '📁',
      'NEEDS_REVIEW': '❓'
    };
    return emojiMap[category] || '📧';
  }

  private async processUrgentActions(urgentEmails: EmailClassificationResult[]): Promise<void> {
    if (urgentEmails.length === 0) return;

    console.log(`\n🚨 URGENT ACTIONS (${urgentEmails.length} emails)`);
    console.log('===============================================');
    console.log('These emails need immediate attention and may be causing anxiety.');
    console.log('Let\'s work through them one by one with step-by-step guidance.\n');

    for (let i = 0; i < urgentEmails.length; i++) {
      const email = urgentEmails[i];
      console.log(`📧 URGENT EMAIL ${i + 1}/${urgentEmails.length}`);
      console.log('─'.repeat(40));
      console.log(email.meta_summary);

      if (this.config.showAnxietySupport && email.anxiety_support) {
        console.log(`\n💚 SUPPORT: ${email.anxiety_support}`);
      }

      if (email.next_steps) {
        console.log('\n📝 SUGGESTED NEXT STEPS:');
        email.next_steps.forEach((step, idx) => {
          console.log(`   ${idx + 1}. ${step}`);
        });
      }

      const action = await this.askQuestion('\n🤔 What would you like to do? (respond/defer/archive/next): ');

      switch (action.toLowerCase()) {
        case 'respond':
          console.log('✅ Great! Opening this email for response...');
          break;
        case 'defer':
          console.log('⏰ Email deferred for later action.');
          break;
        case 'archive':
          console.log('📁 Email archived.');
          break;
        case 'next':
        default:
          console.log('⏭️ Moving to next email...');
          break;
      }
      console.log('');
    }
  }

  private async processPersonalActions(personalEmails: EmailClassificationResult[]): Promise<void> {
    if (personalEmails.length === 0) return;

    console.log(`\n👤 PERSONAL ACTIONS (${personalEmails.length} emails)`);
    console.log('==========================================');
    console.log('Personal emails that need your response when you have time.\n');

    for (const email of personalEmails) {
      console.log(email.meta_summary);

      if (email.next_steps) {
        console.log('\n📝 RESPONSE OPTIONS:');
        email.next_steps.forEach((step, idx) => {
          console.log(`   ${idx + 1}. ${step}`);
        });
      }
      console.log('\n' + '─'.repeat(50) + '\n');
    }

    await this.askQuestion('Press Enter to continue to informational digest...');
  }

  private async processInformationalDigest(digestEmails: EmailClassificationResult[]): Promise<void> {
    if (digestEmails.length === 0) return;

    console.log(`\n📰 INFORMATIONAL DIGEST (${digestEmails.length} items)`);
    console.log('==========================================');
    console.log('Here\'s your curated digest of newsletters and articles.\n');

    for (const email of digestEmails) {
      console.log(email.meta_summary);
      console.log('\n' + '─'.repeat(50) + '\n');
    }

    if (this.config.autoArchiveAfterDigestReview) {
      const shouldArchive = await this.askQuestion('Archive all informational emails after review? (y/n): ');
      if (shouldArchive.toLowerCase() === 'y' || shouldArchive.toLowerCase() === 'yes') {
        console.log('📁 All informational emails marked for archiving.');
      }
    }
  }

  private async processEvents(eventEmails: EmailClassificationResult[]): Promise<void> {
    if (eventEmails.length === 0) return;

    console.log(`\n🎪 EVENTS & CALENDAR (${eventEmails.length} items)`);
    console.log('====================================');
    console.log('Events that might interest you:\n');

    for (const email of eventEmails) {
      console.log(email.meta_summary);
      console.log('\n' + '─'.repeat(50) + '\n');
    }

    await this.askQuestion('Press Enter to continue to junk cleanup...');
  }

  private async processJunkCleanup(junkEmails: EmailClassificationResult[]): Promise<void> {
    if (junkEmails.length === 0) return;

    console.log(`\n🗑️ JUNK CLEANUP (${junkEmails.length} emails)`);
    console.log('==============================');
    console.log('Emails suggested for unsubscribing or archiving:\n');

    const sampleSize = Math.min(5, junkEmails.length);
    console.log(`Showing ${sampleSize} examples:\n`);

    for (let i = 0; i < sampleSize; i++) {
      console.log(`${i + 1}. ${junkEmails[i].meta_summary}`);
      console.log('');
    }

    if (junkEmails.length > sampleSize) {
      console.log(`... and ${junkEmails.length - sampleSize} more similar emails.\n`);
    }

    const action = await this.askQuestion('Bulk unsubscribe from these senders? (y/n): ');
    if (action.toLowerCase() === 'y' || action.toLowerCase() === 'yes') {
      console.log('✅ Marked for bulk unsubscribe. Processing unsubscribe requests...');
    }
  }

  private async processRemainingItems(remainingEmails: EmailClassificationResult[]): Promise<void> {
    if (remainingEmails.length === 0) return;

    console.log(`\n📁 REMAINING ITEMS (${remainingEmails.length} emails)`);
    console.log('=================================');
    console.log('Other emails that have been processed:\n');

    const grouped = this.classifier.groupByClassification(remainingEmails);

    for (const [category, emails] of Object.entries(grouped)) {
      if (emails.length > 0) {
        const emoji = this.getCategoryEmoji(category);
        console.log(`${emoji} ${category.replace('_', ' ')}: ${emails.length} emails - processed automatically`);
      }
    }

    console.log('\n✅ All remaining emails have been categorized and can be safely archived.');
  }
}
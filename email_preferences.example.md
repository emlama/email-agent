# Email Preferences & Categorization Rules

This file contains user-specific preferences for email categorization and processing.
These preferences are loaded dynamically by the email agent.

**Instructions:** Copy this file to `memories/email_preferences.md` and customize it with your information.

═══════════════════════════════════════════════════════════════════
USER CONTEXT
═══════════════════════════════════════════════════════════════════

**Name:** [Your Name]
**Location:** [Your City/Area]
**Current Priorities:**

- [Priority 1 - e.g., Job search, project deadlines]
- [Priority 2 - e.g., Specific interests or responsibilities]
- [Priority 3 - e.g., Community activities]
- [Priority 4 - e.g., Personal projects]

═══════════════════════════════════════════════════════════════════
EMAIL CATEGORIZATION RULES
═══════════════════════════════════════════════════════════════════

## 1. ACTION REQUIRED

Emails that need personal attention or response:

- Personal emails from known contacts (not automated)
- **[Your highest priority - e.g., Recruitment/job search correspondence]**
- Direct questions or calls for volunteers/action
- Calendar invitations requiring response
- [Your location]-area [your interests] meetup invitations
- Critical service alerts (order issues, payment failures, service outages)
- NOTE: Password changes and security notifications are typically PREVENTIVE NOTICES and DO NOT require action

Meta-summary format:

```
Subject: <email subject>
People: <list all participants with emails>
Synopsis: <one-sentence summary of thread purpose>
Analysis: <single most important question/action, sender sentiment, deadline if any>
```

## 2. SUMMARIZE & INFORM

Newsletters and informational content to digest:

- Newsletters, digests, articles (e.g., NYT, Substack, thought leaders)
- Content about [your interests - e.g., tech, parenting, professional topics]
- [Any specific senders you want summaries for]

Meta-summary format:

```
Source: <publication or sender name>
Subject: <email subject>
Key Insights: <2-4 sentence synopsis of main points>
```

## 3. SUMMARIZE EVENTS

Time-sensitive event invitations:

- Live events, concerts, workshops
- Eventbrite, Songkick event notifications
- [Your area] [your interests] event invitations
- Personal calendar invitations from [important contacts]
- **EXCLUDE job interview invitations** (those go to ACTION_REQUIRED)

Meta-summary format:

```
Event: <event name>
From: <invitation sender>
What: <one-sentence event description>
Where: <venue, address, location>
When: <full date and time>
```

## 4. SUMMARIZE PURCHASES

Order confirmations and shipping updates:

- Order confirmations
- Shipping notifications and delivery updates
- Digital receipts

Meta-summary format:

```
Vendor: <store name>
Subject: <email subject>
Update: "You purchased [Item(s)] for [Price]." OR "Your order shipped." OR "Delivery on [Date]."
```

## 5. UNSUBSCRIBE

Marketing emails to unsubscribe from:

- Marketing emails trying to sell something
- Promotional content from services not actively/regularly used

Meta-summary format:

```
Sender: <business or service name>
Recommendation: <one-sentence justification>
```

## 6. IMMEDIATE ARCHIVE

Safe to archive without review:

- Automated informational notifications (not critical)
- Resolved customer support threads
- Promotional emails from services you use but not actionable
- General corporate announcements

## 7. OTHER

Only use when all other categories are exhausted

═══════════════════════════════════════════════════════════════════
IMPORTANT CONTACTS
═══════════════════════════════════════════════════════════════════

List specific people whose emails should be prioritized or categorized specially:

- **[Contact Name]** (email@example.com): [Special handling - e.g., Personal calendar invitations → SUMMARIZE_EVENTS]
- **[Manager Name]** (manager@company.com): [Special handling - e.g., Always → ACTION_REQUIRED]

═══════════════════════════════════════════════════════════════════
CATEGORIZATION OVERRIDES
═══════════════════════════════════════════════════════════════════

### Senders to Always Keep (Never Unsubscribe)

List newsletters or services you want to keep even if they look promotional:

- **[Service/Newsletter Name]**: [Reason - e.g., Important alerts → SUMMARIZE_AND_INFORM]

### Senders to Always Archive

List senders whose emails should be automatically archived:

- [Sender]: [Reason]

### Senders to Always Unsubscribe

List senders you definitely want to unsubscribe from:

- [Sender]: [Reason]

═══════════════════════════════════════════════════════════════════
RESPONSE STYLE PREFERENCES
═══════════════════════════════════════════════════════════════════

When drafting replies:

- Match your tone based on sender relationship
- For [relationship type]: [tone preference - e.g., Professional and enthusiastic]
- For [relationship type]: [tone preference - e.g., Friendly and warm]
- Always save as draft for review before sending

═══════════════════════════════════════════════════════════════════
PROCESSING PRIORITIES
═══════════════════════════════════════════════════════════════════

**Order of Processing (by importance):**

1. ACTION_REQUIRED (handle individually - most important)
2. SUMMARIZE_EVENTS (time-sensitive - may need responses)
3. SUMMARIZE_PURCHASES (quick review for issues)
4. SUMMARIZE_AND_INFORM (batch archive after digest)
5. UNSUBSCRIBE (batch cleanup)
6. IMMEDIATE_ARCHIVE (batch archive)
7. OTHER (case-by-case review)

**Guidelines:**

- ALWAYS start with ACTION_REQUIRED emails
- Prioritize [your highest priority] emails above all else
- Don't rush through important emails just to achieve inbox zero
- Quality over speed for critical emails

═══════════════════════════════════════════════════════════════════
AI CLASSIFICATION SCHEMAS (for triage-tool.ts)
═══════════════════════════════════════════════════════════════════

This section defines the structured output format for AI email classification.
The triage tool uses these schemas to ensure consistent, parseable output.

**⚠️ DO NOT MODIFY THIS SECTION unless you understand the triage-tool.ts code structure**

## Category List

The following categories are available for email classification:

- ACTION_REQUIRED
- SUMMARIZE_AND_INFORM
- SUMMARIZE_EVENTS
- SUMMARIZE_PURCHASES
- UNSUBSCRIBE
- IMMEDIATE_ARCHIVE
- OTHER

## Classification Output Schema

Each email classification must return:

```typescript
{
  category: string,           // One of the categories above
  confidence: number,          // 0.0 to 1.0
  meta_summary: object        // Category-specific structured data (see below)
}
```

## Meta-Summary Schemas by Category

### ACTION_REQUIRED

```json
{
  "subject": "string - the email subject",
  "people": "string - list all participants with emails",
  "synopsis": "string - one-sentence summary of thread purpose",
  "analysis": "string - single most important question/action required, sender's sentiment (casual/urgent/formal), deadline if any"
}
```

### SUMMARIZE_AND_INFORM

```json
{
  "source": "string - publication or sender name",
  "subject": "string - email subject",
  "key_insights": "string - 2-4 sentence synopsis of main points and key takeaway"
}
```

### SUMMARIZE_EVENTS

```json
{
  "event": "string - event name",
  "from": "string - invitation sender",
  "what": "string - one-sentence event description",
  "where": "string - venue, address, location",
  "when": "string - full date and time"
}
```

### SUMMARIZE_PURCHASES

```json
{
  "vendor": "string - store name",
  "subject": "string - email subject",
  "update": "string - You purchased [Item(s)] for [Price]. OR Your order containing [Item(s)] has shipped. OR Your order will be delivered on [Date]."
}
```

### UNSUBSCRIBE

```json
{
  "sender": "string - business or service name",
  "recommendation": "string - one-sentence justification (e.g., This is a promotional mailing list for a service you no longer use.)"
}
```

### IMMEDIATE_ARCHIVE

```json
"string - This email is informational and does not require a specific action or summary. It can be safely archived."
```

### OTHER

```json
{
  "subject": "string - email subject",
  "people": "string - sender",
  "synopsis": "string - brief summary",
  "reason": "string - why it doesn't fit other categories"
}
```

## Classification Guidelines for AI

When classifying emails, consider:

1. **ACTION_REQUIRED Priority Keywords:**

   - [Your priority keywords - e.g., job search: interview, recruiter, hiring, position]
   - Personal emails from known contacts (check IMPORTANT CONTACTS section)
   - Direct questions requiring responses
   - Calendar invitations for [important meetings]
   - [Your area]-area [your interests] meetups
   - Critical service alerts (payment failed, order issue, security alert)

2. **SUMMARIZE_AND_INFORM Indicators:**

   - Newsletter domains: substack.com, nytimes.com, medium.com
   - Digest/roundup in subject
   - Content about [your interests]
   - Check categorization overrides for exceptions

3. **SUMMARIZE_EVENTS Indicators:**

   - Event platforms: eventbrite.com, songkick.com, dice.fm
   - Calendar invitations (except job interviews)
   - RSVP requests, venue mentions
   - Date/time/location details
   - Check IMPORTANT CONTACTS for personal event invites

4. **SUMMARIZE_PURCHASES Indicators:**

   - Order confirmation, shipping notification, delivery update
   - Receipt, invoice, purchase confirmation
   - Tracking number mentions

5. **UNSUBSCRIBE Indicators:**

   - Marketing/promotional content
   - Sale, discount, offer, promotion keywords
   - Services not actively used
   - High frequency promotional senders

6. **IMMEDIATE_ARCHIVE Indicators:**

   - Automated notifications (not critical)
   - noreply@ or no-reply@ senders
   - Resolved support threads
   - Corporate announcements from services user uses

7. **Confidence Scoring:**
   - 0.9-1.0: Very clear indicators, multiple confirming signals
   - 0.7-0.89: Strong indicators, one or two confirming signals
   - 0.5-0.69: Moderate indicators, some ambiguity
   - 0.3-0.49: Weak indicators, significant ambiguity (use snippet only)
   - Below 0.3: Unclear, needs full body review

---

Last updated: [Date when you customize this file]

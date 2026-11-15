/**
 * Centralized Email Scenario Templates
 * Focused on converting Buyers and Sellers into paid customers.
 * Includes both commercial proposals and call-outcome-specific drafts.
 *
 * The copy makes no statistics, prices, credit terms, offers or meeting times of its own.
 * Every specific value comes from the placeholders the sender fills in ({companyName},
 * {followupDate}, {followupTime}, {assigneeName}, {senderName}, {contactName}).
 */

export interface EmailScenarioTemplate {
  id: string;
  name: string;
  description: string;
  targetCategory: 'BUYER' | 'SELLER' | 'ALL';
  scenarioGroup?: 'commercial_pitch' | 'call_outcome' | 'custom';
  callOutcomeValue?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  suggestedVaultTags: string[];
  defaultFollowupDays?: number;
}

export const EMAIL_SCENARIO_TEMPLATES: EmailScenarioTemplate[] = [
  // ---------------------------------------------------------------------------
  // BUYER CONVERSION SCENARIOS (Commercial Proposals)
  // ---------------------------------------------------------------------------
  {
    id: 'buyer_conversion_followup',
    name: 'Post-Call Follow-up & Commercial Proposal',
    description: 'Recap sales call, confirm scheduled follow-up meeting, and share the procurement overview.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Follow-up: Procurement Optimization & Commercial Plan for {companyName}',
    bodyTemplate: `Dear {contactName},

Thank you for discussing {companyName}'s procurement goals with our Category Leadership team today.

As agreed, we have scheduled our follow-up discussion:
- Meeting Date & Time: {followupDate} at {followupTime}
- Key Agenda: Commercial Plan Review
- Category Specialist: {assigneeName}

To help your team evaluate our commercial model, please find attached our Enterprise Procurement overview and plan breakdown.

Please let us know if you would like us to invite any additional stakeholders from your finance or commercial teams to the calendar invite.

Warm regards,
{senderName}
Enterprise Category Solutions | Procucev`,
  },
  {
    id: 'buyer_demo_trial',
    name: 'Platform Demo Invitation',
    description: 'Invite buyer to a platform walkthrough.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Invitation: Enterprise Sourcing Walkthrough - {companyName}',
    bodyTemplate: `Dear {contactName},

We would like to invite {companyName}'s procurement leadership to a platform demonstration.

Demo Details:
- Scheduled Date: {followupDate}
- Scheduled Time: {followupTime}
- Session Agenda: Automated Vendor Discovery, Real-time Bid Matrix & Spend Analytics
- Session Host: {assigneeName}

Attached is our Platform Capabilities Walkthrough guide for your preliminary review.

Best regards,
{senderName}
Enterprise Category Solutions | Procucev`,
  },
  {
    id: 'buyer_subscription_offer',
    name: 'Enterprise Sourcing Plan Overview',
    description: 'Share buyer subscription plan options for the buyer to review.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['rate_cards', 'compliance'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Enterprise Sourcing Plan Overview - {companyName}',
    bodyTemplate: `Dear {contactName},

Following our recent discussion of {companyName}'s sourcing requirements, we would like to share our Enterprise Sourcing plan options.

Attached is our Enterprise Sourcing Plans & Entitlements brochure, which sets out each plan and what it includes.

Could we schedule a brief call on {followupDate} to review the plan options that best suit your fiscal cycle?

Sincerely,
{senderName}
Enterprise Growth | Procucev`,
  },

  // ---------------------------------------------------------------------------
  // BUYER CALL OUTCOME SCENARIOS
  // ---------------------------------------------------------------------------
  {
    id: 'buyer_call_outcome_connected',
    name: 'Call Outcome: Connected - Commercial Follow-up & Plan Review',
    description: 'Recap phone discussion with buyer, confirm agreed follow-up meeting, and attach the overview and plan details.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Connected',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Follow-up: Discussion Recap & Commercial Proposal for {companyName}',
    bodyTemplate: `Dear {contactName},

Thank you for speaking with me today regarding {companyName}'s procurement operations. It was a pleasure discussing how we can streamline your supply chain and reduce sourcing costs.

Key Takeaways & Next Steps:
- Call Outcome: Connected & Discussion Completed
- Scheduled Follow-up: {followupDate} at {followupTime}
- Discussion Agenda: Commercial Proposal Review & Tier Selection
- Assigned Category Lead: {assigneeName}

As discussed, please find attached our Enterprise Procurement overview and Sourcing Plan options.

We look forward to reconvening on {followupDate}. Please feel free to reply directly to this email if you would like to include additional team members in our next session.

Warm regards,
{senderName}
Category Management & Enterprise Sourcing | Procucev`,
  },
  {
    id: 'buyer_call_outcome_left_voicemail',
    name: 'Call Outcome: Left Voicemail - Sourcing Optimization & Pilot Access',
    description: 'Follow up on voicemail left for buyer, describe sourcing support, and offer a short discovery call.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Left Voicemail',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Voicemail Follow-up: Enterprise Sourcing & Savings for {companyName}',
    bodyTemplate: `Dear {contactName},

I just left a brief voicemail for your team regarding {companyName}'s current industrial sourcing and procurement requirements.

We support procurement teams with verified supplier discovery and an automated bid comparison matrix.

I would welcome a short call to walk you through our Sourcing Pilot Requisition program. I have attached our Enterprise Capabilities Overview for your quick reference.

Could you please let me know if {followupDate} at {followupTime} works for a quick discovery call, or feel free to propose a time that best suits your schedule.

Best regards,
{senderName}
Category Solutions | Procucev`,
  },
  {
    id: 'buyer_call_outcome_busy',
    name: 'Call Outcome: Line Busy - Quick Reconnect on Procurement Plans',
    description: 'Reach out when line was busy, acknowledge busy schedule, and offer a quick asynchronous reconnect.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Busy',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Tried reaching you | Quick note on Sourcing Optimization for {companyName}',
    bodyTemplate: `Dear {contactName},

I attempted to reach you by phone earlier today, but the line was busy. I completely understand that you have a demanding schedule.

I am reaching out regarding {companyName}'s upcoming procurement cycles. Our category desk provides pre-vetted supplier matching and bid comparison.

Attached is our one-page Enterprise Sourcing Overview. When would be a convenient time to reconnect for a brief conversation? Alternatively, I will attempt to reach you again on {followupDate}.

Looking forward to connecting with your team.

Sincerely,
{senderName}
Enterprise Category Management | Procucev`,
  },
  {
    id: 'buyer_call_outcome_no_answer',
    name: 'Call Outcome: No Answer - Enterprise Sourcing Value & Pilot Intro',
    description: 'Polite email when buyer did not answer, listing the main sourcing benefits and scheduling options.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'No Answer',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Sorry I missed you | Sourcing Opportunities for {companyName}',
    bodyTemplate: `Dear {contactName},

I tried connecting with you by phone today to introduce Procucev's enterprise procurement platform, but was unable to reach you.

We help commercial procurement leaders at {companyName}:
1. Reach a verified supplier network across industrial categories
2. Compare competing bids in one place
3. Keep each requisition's RFQ, quotes and approvals together

I have attached our Enterprise Sourcing Overview and Plan Brochure for your review.

Would you be open to a brief call on {followupDate} at {followupTime}? Please reply with a preferred time slot if another time works better.

Warm regards,
{senderName}
Enterprise Sourcing Desk | Procucev`,
  },
  {
    id: 'buyer_call_outcome_wrong_number',
    name: 'Call Outcome: Update Contact - Commercial Procurement Lead for {companyName}',
    description: 'Polite request to confirm correct phone contact for procurement decision makers at buyer organization.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Wrong Number',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Contact Verification: Enterprise Procurement Desk for {companyName}',
    bodyTemplate: `Dear {contactName},

I recently attempted to connect with your commercial procurement desk regarding {companyName}'s supplier requirements, but it appears the phone number on file may be outdated or routed incorrectly.

Could you kindly confirm the best direct contact number and preferred time to reach your procurement or vendor-management team?

In the interim, I have attached our Enterprise Procurement Capabilities deck so your team has our commercial sourcing details on hand.

Thank you for your assistance.

Warm regards,
{senderName}
Category Solutions | Procucev`,
  },

  // ---------------------------------------------------------------------------
  // SELLER CONVERSION SCENARIOS (Commercial Proposals)
  // ---------------------------------------------------------------------------
  {
    id: 'seller_conversion_followup',
    name: 'Post-Call Follow-up & Paid Roster Invitation',
    description: 'Recap supplier onboarding call, schedule next discussion, and describe the verified supplier program.',
    targetCategory: 'SELLER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Follow-up: Verified Supplier Partnership & Growth Program - {companyName}',
    bodyTemplate: `Dear {contactName},

Thank you for speaking with our Category Management team today regarding expanding {companyName}'s enterprise footprint.

As discussed, we have logged our follow-up schedule:
- Scheduled Date: {followupDate} at {followupTime}
- Focus: Verified Vendor Tier Enrollment & Immediate Enterprise Inquiries
- Assigned Specialist: {assigneeName}

We have attached our Supplier Growth Handbook, which explains how verified suppliers receive buyer RFQs in their categories.

We look forward to onboarding {companyName} into our premier vendor roster.

Best regards,
{senderName}
Supplier Partnerships | Procucev`,
  },
  {
    id: 'seller_premium_access',
    name: 'Supplier Membership Plan Invitation',
    description: 'Invite a supplier to review premium membership plans.',
    targetCategory: 'SELLER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Invitation: Supplier Membership Plans for {companyName}',
    bodyTemplate: `Dear {contactName},

Our category desk currently manages enterprise procurement requisitions in your primary supply categories.

To help {companyName} review access to these requisitions, we invite you to look at our premium supplier membership plans:

- Plan details and entitlements are set out in the attached Premium Supplier Membership Plans sheet
- Our category desk can walk you through which plan fits your current capacity

We would be glad to activate premium status for {companyName} if the plan suits your business. Please let us know a convenient time on {followupDate}.

Warm regards,
{senderName}
Enterprise Supplier Network | Procucev`,
  },
  {
    id: 'seller_featured_placement',
    name: 'Featured Supplier Sponsorship',
    description: 'Offer featured supplier sponsorship in a category.',
    targetCategory: 'SELLER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['rate_cards', 'marketing_overview'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Category Exclusive: Featured Supplier Sponsorship in your Category - {companyName}',
    bodyTemplate: `Dear {contactName},

We are opening featured supplier sponsorships for your primary manufacturing and supply categories for the upcoming quarter.

Attached is the Category Featured Partner Benefits presentation, which sets out the available options and pricing.

Let us know if you would like us to reserve a sponsorship position for {companyName}.

Sincerely,
{senderName}
Supplier Partnerships | Procucev`,
  },

  // ---------------------------------------------------------------------------
  // SELLER CALL OUTCOME SCENARIOS
  // ---------------------------------------------------------------------------
  {
    id: 'seller_call_outcome_connected',
    name: 'Call Outcome: Connected - Verified Supplier Onboarding & Priority RFQs',
    description: 'Recap phone conversation with vendor, confirm scheduled review meeting, and send verified tier enrollment materials.',
    targetCategory: 'SELLER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Connected',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Follow-up: Discussion Recap & Verified Vendor Program for {companyName}',
    bodyTemplate: `Dear {contactName},

Thank you for speaking with our Category Management team today. We are excited about the prospect of onboarding {companyName} into our premier supplier network.

Summary & Next Steps:
- Call Outcome: Connected & Discussion Completed
- Scheduled Follow-up: {followupDate} at {followupTime}
- Discussion Focus: Verified Supplier Enrollment & Direct Buyer RFQs
- Category Manager: {assigneeName}

Attached is our Supplier Growth Playbook along with our Verified Supplier Tier details. As a verified supplier, {companyName} would receive buyer RFQs in its supply categories.

We look forward to speaking with you again on {followupDate}.

Best regards,
{senderName}
Supplier Network Operations | Procucev`,
  },
  {
    id: 'seller_call_outcome_left_voicemail',
    name: 'Call Outcome: Left Voicemail - High-Value Buyer RFQ Inquiries',
    description: 'Follow up on voicemail left for vendor, highlighting incoming corporate RFQ demand in their category.',
    targetCategory: 'SELLER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Left Voicemail',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Voicemail Follow-up: Incoming Enterprise RFQ Demand for {companyName}',
    bodyTemplate: `Dear {contactName},

I just left a brief voicemail for your sales office regarding incoming enterprise purchase inquiries matching {companyName}'s manufacturing and distribution capabilities.

Our buyer network is currently seeking verified suppliers in your category for upcoming corporate requisitions.

I have attached our Supplier Growth Guide for your review. We would love to connect for a short call to verify your production capacities and route these RFQs directly to your sales desk.

Are you available for a brief call on {followupDate} at {followupTime}? Please let me know if a different time suits you best.

Sincerely,
{senderName}
Supplier Partnerships | Procucev`,
  },
  {
    id: 'seller_call_outcome_busy',
    name: 'Call Outcome: Line Busy - High-Volume Requisition Matching',
    description: 'Follow up when vendor line was busy, offering a direct calendar connection to discuss RFQ pipelines.',
    targetCategory: 'SELLER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Busy',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Tried reaching your team | Enterprise RFQ Inquiries for {companyName}',
    bodyTemplate: `Dear {contactName},

I tried calling your sales desk earlier today, but the line was engaged.

I am reaching out from Procucev because enterprise buyers on our platform are requesting quotes for categories supplied by {companyName}. We want to ensure your team is positioned to bid on these contracts.

Attached is our Supplier Growth Overview. When would be a good time to connect for a brief phone alignment? I will also try calling back on {followupDate}.

Looking forward to collaborating.

Warm regards,
{senderName}
Category Lead | Procucev`,
  },
  {
    id: 'seller_call_outcome_no_answer',
    name: 'Call Outcome: No Answer - New RFQ Opportunities for {companyName}',
    description: 'Reach out when vendor did not answer, describing the RFQ opportunities and scheduling a briefing.',
    targetCategory: 'SELLER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'No Answer',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Missed you earlier | New Enterprise Buyer RFQs for {companyName}',
    bodyTemplate: `Dear {contactName},

I called your office earlier today regarding {companyName}'s supplier profile on Procucev, but was unable to reach you.

We are onboarding trusted manufacturing and supply partners to respond to requisitions from corporate buyers.

Key Points for {companyName}:
1. Verified RFQs for your supply categories, sent to your dashboard
2. Clear quote, award and approval status for each requisition
3. Category-based routing so you see the requests that match your capabilities

Please review the attached Supplier Growth Playbook. Could we schedule a short briefing on {followupDate} at {followupTime}?

Best regards,
{senderName}
Enterprise Supplier Desk | Procucev`,
  },
  {
    id: 'seller_call_outcome_wrong_number',
    name: 'Call Outcome: Update Contact - Vendor Roster & RFQ Dispatch for {companyName}',
    description: 'Request updated sales/executive contact details to ensure vendor receives active RFQs without delay.',
    targetCategory: 'SELLER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Wrong Number',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Contact Verification: Supplier Sales Office for {companyName}',
    bodyTemplate: `Dear {contactName},

I attempted to contact {companyName}'s sales and commercial desk by phone today regarding new procurement opportunities, but the number on record appears to be incorrect or unreachable.

To ensure your commercial team does not miss out on live enterprise RFQ dispatches, could you please reply with the direct phone number and contact details of your authorized sales representative?

Attached is our Supplier Network Overview for your reference.

Thank you for your prompt response.

Sincerely,
{senderName}
Vendor Network Operations | Procucev`,
  },

  // ---------------------------------------------------------------------------
  // GENERAL CUSTOM (For bespoke sales communications)
  // ---------------------------------------------------------------------------
  {
    id: 'custom',
    name: 'Custom Sales Pitch / Bespoke Proposal',
    description: 'Blank template for custom commercial proposals with Document Vault and local attachments.',
    targetCategory: 'ALL',
    scenarioGroup: 'custom',
    suggestedVaultTags: [],
    subjectTemplate: '',
    bodyTemplate: '',
  },
];

/**
 * Replace placeholders like {contactName}, {companyName}, {followupDate} with provided values.
 */
export function interpolateScenarioTemplate(
  template: string,
  variables: Record<string, string | number | undefined | null>
): string {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_match, token) => {
    const val = variables[token];
    if (val === undefined || val === null || val === '') {
      return '';
    }
    return String(val);
  });
}

/**
 * Filter scenarios by entity type.
 */
export function getScenariosForEntityType(
  entityType?: 'BUYER' | 'SELLER' | 'ALL' | string
): EmailScenarioTemplate[] {
  if (!entityType || entityType === 'ALL') {
    return EMAIL_SCENARIO_TEMPLATES;
  }
  const normalized = entityType.toUpperCase();
  if (normalized === 'BUYER' || normalized === 'BUYER_DOSSIER') {
    return EMAIL_SCENARIO_TEMPLATES.filter(
      (s) => s.targetCategory === 'BUYER' || s.targetCategory === 'ALL'
    );
  }
  if (normalized === 'SELLER' || normalized === 'SUPPLIER_DOSSIER' || normalized === 'VENDOR') {
    return EMAIL_SCENARIO_TEMPLATES.filter(
      (s) => s.targetCategory === 'SELLER' || s.targetCategory === 'ALL'
    );
  }
  return EMAIL_SCENARIO_TEMPLATES;
}

/**
 * Retrieves the specific scenario template matching a call outcome.
 */
export function getScenarioForCallOutcome(
  entityType: 'BUYER' | 'SELLER' | string,
  callOutcome: string
): EmailScenarioTemplate | undefined {
  if (!callOutcome) return undefined;
  const normalizedEntity = entityType.toUpperCase().includes('BUYER') ? 'BUYER' : 'SELLER';
  return EMAIL_SCENARIO_TEMPLATES.find(
    (s) =>
      s.targetCategory === normalizedEntity &&
      s.scenarioGroup === 'call_outcome' &&
      s.callOutcomeValue?.toLowerCase() === callOutcome.toLowerCase()
  );
}

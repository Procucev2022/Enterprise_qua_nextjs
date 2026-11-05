/**
 * Centralized Email Scenario Templates
 * Focused strictly on converting Buyers and Sellers into PAID customers.
 * Includes both strategic commercial conversion proposals and call-outcome-specific drafts.
 * Each scenario highlights commercial value, ROI, exclusive enterprise plans,
 * and follow-up schedules with auto-suggested Document Vault collateral.
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
    description: 'Recap sales call, confirm scheduled follow-up meeting, and pitch enterprise procurement ROI.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Follow-up: Procurement Optimization & Commercial Plan for {companyName}',
    bodyTemplate: `Dear {contactName},

Thank you for discussing {companyName}'s procurement goals with our Category Leadership team today.

As agreed, we have scheduled our follow-up discussion:
- Meeting Date & Time: {followupDate} at {followupTime}
- Key Agenda: Commercial Plan Review & Sourcing Fee Structure
- Category Specialist: {assigneeName}

To help your team evaluate our commercial model, please find attached our Enterprise Procurement ROI Overview and Plan Breakdown. Our clients typically achieve 8-14% direct cost savings across industrial categories while reducing cycle times by 60%.

Please let us know if you would like us to invite any additional stakeholders from your finance or commercial teams to the calendar invite.

Warm regards,
{senderName}
Enterprise Category Solutions | Procucev`,
  },
  {
    id: 'buyer_demo_trial',
    name: 'Platform Demo & Sourcing Pilot Offer',
    description: 'Invite buyer to a walkthrough and offer a pilot sourcing cycle with zero upfront listing fees.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Invitation: Enterprise Sourcing Walkthrough & Pilot Requisition - {companyName}',
    bodyTemplate: `Dear {contactName},

We would love to invite {companyName}'s procurement leadership to an exclusive 30-minute platform demonstration.

Demo Details:
- Scheduled Date: {followupDate}
- Scheduled Time: 2:30 PM IST
- Session Agenda: Automated Vendor Discovery, Real-time Bid Matrix & Spend Analytics
- Session Host: {assigneeName}

As part of this session, we are pleased to offer {companyName} a complimentary Pilot Sourcing Cycle for your upcoming requisition, allowing you to experience our verified supplier network and price discovery at zero risk.

Attached is our Platform Capabilities Walkthrough guide for your preliminary review.

Best regards,
{senderName}
Enterprise Category Solutions | Procucev`,
  },
  {
    id: 'buyer_subscription_offer',
    name: 'Enterprise Sourcing Plan & Credit Package',
    description: 'Present premium buyer subscription tiers, dedicated category manager SLA, and credit line benefits.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['rate_cards', 'compliance'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Exclusive Enterprise Sourcing Plan & Credit Facilities - {companyName}',
    bodyTemplate: `Dear {contactName},

Following our recent evaluation of {companyName}'s monthly sourcing volume, we have tailored an Enterprise Sourcing Membership package designed to maximize your bottom-line savings:

Key Membership Entitlements:
- Unlimited RFQ Dispatches with autonomous supplier matching
- Dedicated Category Manager & Expedited SLA turnaround
- Verified Supplier Network Access with pre-negotiated wholesale pricing
- Flexible 30/60-Day Rolling Procurement Credit Line

Attached is our detailed Enterprise Sourcing Plans & Entitlements brochure. We are currently offering a 15% incentive on annual agreements executed this quarter.

Could we schedule a brief 10-minute call this {followupDate} to finalize terms that best suit your fiscal cycle?

Sincerely,
{senderName}
Director of Enterprise Growth | Procucev`,
  },
  {
    id: 'buyer_credit_activation',
    name: 'Credit Line & Working Capital Terms',
    description: 'Pitch interest-free rolling procurement credit to unlock immediate purchasing liquidity.',
    targetCategory: 'BUYER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['compliance'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Unlock Working Capital: Pre-Approved Procurement Credit for {companyName}',
    bodyTemplate: `Dear {contactName},

We are pleased to share that {companyName} is eligible for our Pre-Approved Rolling Procurement Credit Facility of up to ₹25,00,000 to streamline your purchase order liquidity.

Key Highlights of the Facility:
- Flexible 30 to 60-day settlement windows
- 0% interest on settlements completed within standard cycle
- Zero upfront collateral requirement for verified corporate entities

Review the attached Procurement Credit Terms & Guidelines for complete details. Activating this facility requires simple digital verification and can be completed in under 24 hours.

Let us know when you would like our finance specialist to walk your team through the activation checklist.

Warm regards,
{senderName}
Procurement Finance Desk | Procucev`,
  },

  // ---------------------------------------------------------------------------
  // BUYER CALL OUTCOME SCENARIOS
  // ---------------------------------------------------------------------------
  {
    id: 'buyer_call_outcome_connected',
    name: 'Call Outcome: Connected - Commercial Follow-up & Plan Review',
    description: 'Recap phone discussion with buyer, confirm agreed follow-up meeting, and attach ROI brochure and plan details.',
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

As discussed, please find attached our Enterprise Procurement ROI Overview and Sourcing Plan options. With our autonomous vendor matching and pre-negotiated wholesale rates, enterprise buyers achieve an average 8-14% bottom-line savings while cutting procurement turnaround times by over 50%.

We look forward to reconvening on {followupDate}. Please feel free to reply directly to this email if you would like to include additional team members in our next session.

Warm regards,
{senderName}
Category Management & Enterprise Sourcing | Procucev`,
  },
  {
    id: 'buyer_call_outcome_left_voicemail',
    name: 'Call Outcome: Left Voicemail - Sourcing Optimization & Pilot Access',
    description: 'Follow up on voicemail left for buyer, pitch enterprise sourcing savings, and offer a zero-risk pilot.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'Left Voicemail',
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 1,
    subjectTemplate: 'Voicemail Follow-up: Enterprise Sourcing & Savings for {companyName}',
    bodyTemplate: `Dear {contactName},

I just left a brief voicemail for your team regarding {companyName}'s current industrial sourcing and procurement requirements.

We partner with leading enterprises across your sector to reduce supply costs by 8-14% through our verified supplier network and automated bid-matrix engine.

I would welcome 10 minutes to walk you through our zero-risk Sourcing Pilot Requisition program. I have attached our Enterprise Capabilities Overview for your quick reference.

Could you please let me know if {followupDate} at {followupTime} works for a quick 10-minute discovery call, or feel free to propose a time that best suits your schedule.

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

I am reaching out regarding {companyName}'s upcoming procurement cycles. Our category desk provides pre-vetted supplier matching, direct factory pricing, and flexible 30-60 day rolling procurement credit.

Attached is our one-page Enterprise Sourcing Overview. When would be a convenient time to reconnect for a brief 5-minute conversation? Alternatively, I will attempt to reach you again on {followupDate}.

Looking forward to connecting with your team.

Sincerely,
{senderName}
Enterprise Category Management | Procucev`,
  },
  {
    id: 'buyer_call_outcome_no_answer',
    name: 'Call Outcome: No Answer - Enterprise Sourcing Value & Pilot Intro',
    description: 'Polite email when buyer did not answer, providing 3 key value highlights and scheduling options.',
    targetCategory: 'BUYER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'No Answer',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Sorry I missed you | Sourcing Opportunities for {companyName}',
    bodyTemplate: `Dear {contactName},

I tried connecting with you by phone today to introduce Procucev's enterprise procurement platform, but was unable to reach you.

We help commercial procurement leaders at {companyName}:
1. Access 10,000+ audited manufacturers with guaranteed quality compliance
2. Secure 8-14% average savings through consolidated competitive bidding
3. Leverage pre-approved rolling procurement credit facilities (up to ₹25 Lakhs)

I have attached our Enterprise Sourcing Overview and Plan Brochure for your review.

Would you be open to a brief 10-minute call on {followupDate} at {followupTime}? Please reply with a preferred time slot if another time works better.

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
    description: 'Recap supplier onboarding call, schedule next discussion, and pitch verified supplier tier benefits.',
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

We have attached our Supplier Monetization & Growth Handbook detailing how our verified suppliers secure guaranteed buyer quote shortlists and access ₹50Cr+ in monthly requisition volumes.

We look forward to onboarding {companyName} into our premier vendor roster.

Best regards,
{senderName}
Supplier Partnerships Lead | Procucev`,
  },
  {
    id: 'seller_premium_access',
    name: 'Exclusive High-Value RFQ Access Plan',
    description: 'Pitch premium seller membership unlocking high-budget enterprise RFQs and direct buyer introductions.',
    targetCategory: 'SELLER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Exclusive Invitation: High-Value Enterprise RFQ Pipeline for {companyName}',
    bodyTemplate: `Dear {contactName},

Our category desk currently manages active enterprise procurement pipelines exceeding ₹10 Crore in your primary supply categories.

To grant {companyName} immediate unsealed access to quote on these requisitions, we invite you to subscribe to our Premium Supplier Growth Plan:

Plan Advantages:
- Priority RFQ Routing: Receive high-value commercial tenders 48 hours prior to general release
- Verified Supplier Gold Badge: 3.5x higher quote acceptance rate among corporate buyers
- Direct Buyer Procurement Introductions with Category Manager backing
- Unlimited Quotation Submissions with zero per-lead deduction

Please review the attached Premium Supplier Membership Plans sheet. We would be delighted to activate your premium status ahead of our upcoming weekly RFQ releases.

Warm regards,
{senderName}
Enterprise Supplier Network | Procucev`,
  },
  {
    id: 'seller_featured_placement',
    name: 'Featured Vendor & Guaranteed Lead Allocation',
    description: 'Offer featured catalog placement and guaranteed monthly buyer lead quota in specific divisions.',
    targetCategory: 'SELLER',
    scenarioGroup: 'commercial_pitch',
    suggestedVaultTags: ['rate_cards', 'marketing_overview'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Category Exclusive: Featured Supplier Sponsorship in your Category - {companyName}',
    bodyTemplate: `Dear {contactName},

We are opening exclusive Featured Supplier sponsorships for your primary manufacturing and supply categories for the upcoming quarter.

Featured Partner Benefits:
- Top-of-page search and catalog ranking across 500+ active enterprise buyer accounts
- Guaranteed quota of verified buyer RFQ dispatches every month
- Custom Digital Showroom showcasing {companyName}'s manufacturing capabilities and QA certifications

Review the attached Category Featured Partner Benefits presentation for performance metrics and pricing options.

Slots per major category are strictly capped to ensure maximum lead conversion for our partners. Let us know if you would like to reserve {companyName}'s position.

Sincerely,
{senderName}
Head of Vendor Monetization | Procucev`,
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

Attached is our Supplier Monetization & Growth Playbook along with our Verified Supplier Tier details. As a verified supplier, {companyName} gains direct visibility across 500+ corporate buyers with pre-cleared budgets and priority RFQ dispatch.

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

I have attached our Supplier Growth Guide for your review. We would love to connect for 10 minutes to verify your production capacities and route these RFQs directly to your sales desk.

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

I am reaching out from Procucev because enterprise buyers in our platform are actively requesting quotes for categories supplied by {companyName}. We want to ensure your team is positioned to bid on these contracts.

Attached is our Supplier Growth Overview. When would be a good time to connect for a 5-minute phone alignment? I will also try calling back on {followupDate}.

Looking forward to collaborating.

Warm regards,
{senderName}
Category Lead | Procucev`,
  },
  {
    id: 'seller_call_outcome_no_answer',
    name: 'Call Outcome: No Answer - New RFQ Opportunities for {companyName}',
    description: 'Reach out when vendor did not answer, presenting immediate vendor benefits and scheduling a briefing.',
    targetCategory: 'SELLER',
    scenarioGroup: 'call_outcome',
    callOutcomeValue: 'No Answer',
    suggestedVaultTags: ['marketing_overview', 'rate_cards'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Missed you earlier | New Enterprise Buyer RFQs for {companyName}',
    bodyTemplate: `Dear {contactName},

I called your office earlier today regarding {companyName}'s supplier profile on Procucev, but was unable to reach you.

We are currently onboarding trusted manufacturing and supply partners to fulfill high-budget purchase orders from verified corporate buyers.

Key Benefits for {companyName}:
1. Zero cost per lead — receive verified RFQs directly to your dashboard
2. Guaranteed payment protection via verified buyer credit facilities
3. Category exclusivity and preferential bid showcase

Please review the attached Supplier Growth Playbook. Could we schedule a 10-minute briefing on {followupDate} at {followupTime}?

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

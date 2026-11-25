/**
 * Centralized Standardized Communication & Email Templates
 * Single Shared Source of Truth for:
 * 1. Internal Tasks (Action Center Communication modal)
 * 2. Buyer Directory (Record Communication & Activity modal)
 * 3. Seller Directory (Record Communication modal)
 *
 * ONLY these 8 standardized options exist in the platform.
 */

import {
  STANDARDIZED_COMMUNICATION_CATEGORIES,
  STANDARDIZED_COMMUNICATION_SCENARIO_IDS,
  type StandardizedCommunicationCategory,
} from './constants';

export { STANDARDIZED_COMMUNICATION_CATEGORIES, STANDARDIZED_COMMUNICATION_SCENARIO_IDS };
export type { StandardizedCommunicationCategory };

export interface EmailScenarioTemplate {
  id: string;
  name: string;
  description: string;
  targetCategory: 'BUYER' | 'SELLER' | 'ALL';
  scenarioGroup?: 'standardized' | 'commercial_pitch' | 'call_outcome' | 'custom';
  callOutcomeValue?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  suggestedVaultTags: string[];
  defaultFollowupDays?: number;
  autoCompletesTask?: boolean;
}

export const EMAIL_SCENARIO_TEMPLATES: EmailScenarioTemplate[] = [
  // 1. Credit / Quote (Buyer / Seller)
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.CREDIT_QUOTE,
    name: 'Credit / Quote (Buyer / Seller)',
    description: 'Update on credits and quote balance for Buyer or Seller accounts.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    suggestedVaultTags: [],
    defaultFollowupDays: 2,
    subjectTemplate: 'Update on Your {accountType} Credits / Quote Balance – {companyName}',
    bodyTemplate: `Hi {contactName},

Your {accountType} account for {companyName} has been updated on Procucev QUA AI.

Action: {creditAction} ({creditAmount} Credits)

Updated Available Balance: {availableCredits} Credits

You can log in to your dashboard to continue raising RFQs / submitting quotes. Please reach out if you need any assistance.

Regards,
{senderName} | Category Management, Procucev`,
  },

  // 2. Follow-up / New (Supports Call, SMS, WhatsApp, Email)
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.FOLLOWUP_NEW,
    name: 'Follow-up / New',
    description: 'Follow up on sourcing requirements and active RFQs across Call, SMS, WhatsApp, and Email.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    suggestedVaultTags: [],
    defaultFollowupDays: 2,
    subjectTemplate: 'Following Up: Sourcing & Procurement Opportunities for {companyName}',
    bodyTemplate: `Hi {contactName},

Reaching out from Procucev regarding your account for {companyName}. We wanted to follow up on your current sourcing requirements / active RFQs and check if you need any help getting started or reviewing quotes.

Let us know a convenient time for a quick call, or reply directly to this email.

Regards,
{senderName} | Category Management, Procucev`,
  },

  // 3. Demo Schedule
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.DEMO_SCHEDULE,
    name: 'Demo Schedule',
    description: 'Confirm schedule and meeting link for Procucev platform demonstration.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    suggestedVaultTags: [],
    defaultFollowupDays: 1,
    subjectTemplate: 'Procucev QUA AI Platform Demo Scheduled – {companyName}',
    bodyTemplate: `Hi {contactName},

Your walkthrough of the Procucev QUA AI platform for {companyName} is scheduled as follows:

Date & Time: {demoDate} at {demoTime} IST

Meeting Link: {meetingLink}

We will cover automated RFQ workflows, vendor quote comparison, and dashboard setup. Let us know if you need to reschedule.

Regards,
{senderName} | Category Management, Procucev`,
  },

  // 4. Send Proposal (Auto-completes Task)
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.SEND_PROPOSAL,
    name: 'Send Proposal',
    description: 'Share commercial proposal and pricing. Automatically completes linked task.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    autoCompletesTask: true,
    suggestedVaultTags: ['rate_cards', 'marketing_overview'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Commercial Proposal for {companyName} – Procucev Enterprise',
    bodyTemplate: `Hi {contactName},

Please find attached our commercial proposal tailored for {companyName}, outlining subscription tiers, credit allocations, and sourcing support on Procucev QUA AI.

Please review the details and let us know if you have any questions or would like to proceed with activation.

Regards,
{senderName} | Category Management, Procucev`,
  },

  // 5. Send Corporate Email (Auto-completes Task)
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.SEND_CORPORATE_EMAIL,
    name: 'Send Corporate Email',
    description: 'Official enterprise partnership outreach. Automatically completes linked task.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    autoCompletesTask: true,
    suggestedVaultTags: ['marketing_overview'],
    defaultFollowupDays: 3,
    subjectTemplate: 'Procucev Enterprise Partnership – {companyName}',
    bodyTemplate: `Dear {contactName},

On behalf of Procucev Enterprise Solutions, we are pleased to connect with {companyName}. Our AI-driven B2B procurement platform streamlines multi-vendor RFQs, bid evaluation, and supplier onboarding.

We would welcome the opportunity to align with your procurement team on upcoming requirements.

Warm regards,
{senderName} | Category Management, Procucev`,
  },

  // 6. Onboarding Process
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.ONBOARDING_PROCESS,
    name: 'Onboarding Process',
    description: 'Guide supplier or buyer through statutory document verification and category confirmation.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    suggestedVaultTags: ['compliance'],
    defaultFollowupDays: 2,
    subjectTemplate: 'Welcome to Procucev – Complete Your Onboarding for {companyName}',
    bodyTemplate: `Hi {contactName},

Welcome to Procucev! To complete onboarding for {companyName}, please finish these quick steps:

Verify your registered mobile number and corporate email.

Upload your company GSTIN / statutory documents in the portal.

Confirm your primary product categories.

Complete onboarding here: {onboardingLink}

Regards,
{senderName} | Category Management, Procucev`,
  },

  // 7. Registration Task
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.REGISTRATION_TASK,
    name: 'Registration Task',
    description: 'Account creation notice and verification link.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    suggestedVaultTags: [],
    defaultFollowupDays: 2,
    subjectTemplate: 'Action Required: Verify & Activate Your Procucev Account – {companyName}',
    bodyTemplate: `Hi {contactName},

Your account for {companyName} has been created on Procucev QUA AI. To activate full access and receive real-time RFQ/quote updates, please verify your contact details and set your password:

Activate Account: {activationLink}

Regards,
{senderName} | Category Management, Procucev`,
  },

  // 8. Internal Operations (Others)
  {
    id: STANDARDIZED_COMMUNICATION_SCENARIO_IDS.INTERNAL_OPERATIONS,
    name: 'Internal Operations (Others)',
    description: 'Operational update regarding an account or reference.',
    targetCategory: 'ALL',
    scenarioGroup: 'standardized',
    suggestedVaultTags: [],
    defaultFollowupDays: 2,
    subjectTemplate: '[Internal Operations] Update Regarding {companyName} – {referenceId}',
    bodyTemplate: `Hi {contactName},

This is an operational update regarding {companyName} ({referenceId}):

{customMessage}

Please reply if any further action is required from our side.

Regards,
{senderName} | Procucev Operations`,
  },
];

/**
 * Replace placeholders like {contactName}, {companyName}, {accountType}, etc. with provided values.
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
 * Filter scenarios by entity type. All 8 standardized scenarios apply to ALL entities.
 */
export function getScenariosForEntityType(
  _entityType?: 'BUYER' | 'SELLER' | 'ALL' | string
): EmailScenarioTemplate[] {
  return EMAIL_SCENARIO_TEMPLATES;
}

export const STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES = EMAIL_SCENARIO_TEMPLATES;

const VALID_CALL_OUTCOMES = ['connected', 'left voicemail', 'busy', 'no answer', 'wrong number'];

/**
 * Retrieves scenario matching call outcome (defaults to Follow-up / New).
 */
export function getScenarioForCallOutcome(
  _entityType: 'BUYER' | 'SELLER' | string,
  callOutcome?: string
): EmailScenarioTemplate | undefined {
  if (!callOutcome) return undefined;
  if (!VALID_CALL_OUTCOMES.includes(callOutcome.trim().toLowerCase())) return undefined;
  return EMAIL_SCENARIO_TEMPLATES.find((s) => s.id === STANDARDIZED_COMMUNICATION_SCENARIO_IDS.FOLLOWUP_NEW);
}

import {
  EMAIL_SCENARIO_TEMPLATES,
  STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES,
  getScenariosForEntityType,
  getScenarioForCallOutcome,
  interpolateScenarioTemplate,
} from '@/lib/emailScenarioTemplates';

describe('Standardized Communication Scenario Templates', () => {
  describe('Definitions and Constraints', () => {
    test('contains exactly the 8 standardized communication templates', () => {
      expect(STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES).toHaveLength(8);
      expect(EMAIL_SCENARIO_TEMPLATES).toHaveLength(8);

      const ids = STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES.map((t) => t.id);
      expect(ids).toEqual([
        'credit_quote',
        'followup_new',
        'demo_schedule',
        'send_proposal',
        'send_corporate_email',
        'onboarding_process',
        'registration_task',
        'internal_operations',
      ]);
    });

    test('marks Send Proposal and Send Corporate Email as task auto-completing', () => {
      const proposal = STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES.find((t) => t.id === 'send_proposal');
      const corporateEmail = STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES.find((t) => t.id === 'send_corporate_email');
      const followup = STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES.find((t) => t.id === 'followup_new');

      expect(Boolean(proposal?.autoCompletesTask)).toBe(true);
      expect(Boolean(corporateEmail?.autoCompletesTask)).toBe(true);
      expect(Boolean(followup?.autoCompletesTask)).toBe(false);
    });

    test('all 8 templates target ALL entity categories uniformly', () => {
      STANDARDIZED_COMMUNICATION_SCENARIO_TEMPLATES.forEach((template) => {
        expect(template.targetCategory).toBe('ALL');
        expect(template.name).toBeTruthy();
        expect(template.subjectTemplate).toBeTruthy();
        expect(template.bodyTemplate).toBeTruthy();
      });
    });
  });

  describe('getScenariosForEntityType', () => {
    test('returns all 8 standardized templates for BUYER, SELLER, and INTERNAL_TASK', () => {
      const buyerList = getScenariosForEntityType('BUYER');
      const sellerList = getScenariosForEntityType('SELLER');
      const taskList = getScenariosForEntityType('INTERNAL_TASK');
      const defaultList = getScenariosForEntityType();

      expect(buyerList).toHaveLength(8);
      expect(sellerList).toHaveLength(8);
      expect(taskList).toHaveLength(8);
      expect(defaultList).toHaveLength(8);
      expect(buyerList.map((s) => s.id)).toEqual(sellerList.map((s) => s.id));
    });
  });

  describe('getScenarioForCallOutcome', () => {
    test('retrieves followup_new scenario for valid call outcomes', () => {
      const outcome = getScenarioForCallOutcome('BUYER', 'Connected');
      expect(outcome).toBeDefined();
      expect(outcome?.id).toBe('followup_new');

      const sellerOutcome = getScenarioForCallOutcome('SELLER', 'Left Voicemail');
      expect(sellerOutcome).toBeDefined();
      expect(sellerOutcome?.id).toBe('followup_new');
    });

    test('returns undefined for empty outcome or invalid outcome', () => {
      expect(getScenarioForCallOutcome('BUYER', '')).toBeUndefined();
      expect(getScenarioForCallOutcome('BUYER', 'UnknownBadOutcome')).toBeUndefined();
    });
  });

  describe('interpolateScenarioTemplate', () => {
    test('returns empty string when template is falsy', () => {
      expect(interpolateScenarioTemplate('', { contactName: 'Acme' })).toBe('');
    });

    test('interpolates single and multiple placeholder tokens', () => {
      const template = 'Update on Your {accountType} Credits / Quote Balance – {companyName}';
      const vars = {
        accountType: 'Buyer',
        companyName: 'Veera Solutions',
      };
      const result = interpolateScenarioTemplate(template, vars);
      expect(result).toBe('Update on Your Buyer Credits / Quote Balance – Veera Solutions');
    });

    test('replaces missing, null, or undefined tokens with empty string', () => {
      const template = 'Action: {creditAction} ({creditAmount} Credits) for {contactName}';
      const vars = {
        creditAction: 'Credit Balance Update',
        creditAmount: 50,
      };
      const result = interpolateScenarioTemplate(template, vars);
      expect(result).toBe('Action: Credit Balance Update (50 Credits) for ');
    });

    test('replaces numeric tokens correctly', () => {
      const template = 'Balance: {availableCredits} Credits';
      const vars = {
        availableCredits: 100,
      };
      const result = interpolateScenarioTemplate(template, vars);
      expect(result).toBe('Balance: 100 Credits');
    });
  });
});

import {
  EMAIL_SCENARIO_TEMPLATES,
  getScenariosForEntityType,
  getScenarioForCallOutcome,
  interpolateScenarioTemplate,
} from '@/lib/emailScenarioTemplates';

describe('Email Scenario Templates', () => {
  describe('EMAIL_SCENARIO_TEMPLATES definitions', () => {
    test('copy contains no invented statistics, prices, credit terms, offers or fixed times', () => {
      for (const template of EMAIL_SCENARIO_TEMPLATES) {
        const copy = `${template.name}\n${template.description}\n${template.subjectTemplate}\n${template.bodyTemplate}`;
        expect(copy).not.toMatch(/\d+(\.\d+)?\s?%/);
        expect(copy).not.toMatch(/₹|Crore|Lakh|\bIST\b|\d+(\.\d+)?x\b/);
        expect(copy).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
        expect(copy).not.toMatch(/zero|complimentary|guaranteed|free of charge/i);
      }
    });

    test('meeting time and date come from placeholders, not fixed text', () => {
      const demo = EMAIL_SCENARIO_TEMPLATES.find((s) => s.id === 'buyer_demo_trial');
      expect(demo?.bodyTemplate).toContain('{followupTime}');
      expect(demo?.bodyTemplate).toContain('{followupDate}');
    });

    test('contains buyer conversion scenarios', () => {
      const buyerScenarios = EMAIL_SCENARIO_TEMPLATES.filter((s) => s.targetCategory === 'BUYER');
      expect(buyerScenarios.length).toBeGreaterThanOrEqual(8);

      const ids = buyerScenarios.map((s) => s.id);
      expect(ids).toContain('buyer_conversion_followup');
      expect(ids).toContain('buyer_demo_trial');
      expect(ids).toContain('buyer_subscription_offer');
      expect(ids).toContain('buyer_call_outcome_connected');
      expect(ids).toContain('buyer_call_outcome_left_voicemail');
      expect(ids).toContain('buyer_call_outcome_busy');
      expect(ids).toContain('buyer_call_outcome_no_answer');
      expect(ids).toContain('buyer_call_outcome_wrong_number');
    });

    test('contains seller conversion scenarios', () => {
      const sellerScenarios = EMAIL_SCENARIO_TEMPLATES.filter((s) => s.targetCategory === 'SELLER');
      expect(sellerScenarios.length).toBeGreaterThanOrEqual(8);

      const ids = sellerScenarios.map((s) => s.id);
      expect(ids).toContain('seller_conversion_followup');
      expect(ids).toContain('seller_premium_access');
      expect(ids).toContain('seller_featured_placement');
      expect(ids).toContain('seller_call_outcome_connected');
      expect(ids).toContain('seller_call_outcome_left_voicemail');
      expect(ids).toContain('seller_call_outcome_busy');
      expect(ids).toContain('seller_call_outcome_no_answer');
      expect(ids).toContain('seller_call_outcome_wrong_number');
    });

    test('contains custom scenario targeting ALL', () => {
      const customScenario = EMAIL_SCENARIO_TEMPLATES.find((s) => s.id === 'custom');
      expect(customScenario).toBeDefined();
      expect(customScenario?.targetCategory).toBe('ALL');
    });
  });

  describe('getScenariosForEntityType', () => {
    test('returns all scenarios when no entity type is given or "ALL"', () => {
      expect(getScenariosForEntityType()).toHaveLength(EMAIL_SCENARIO_TEMPLATES.length);
      expect(getScenariosForEntityType('ALL')).toHaveLength(EMAIL_SCENARIO_TEMPLATES.length);
    });

    test('returns buyer and ALL scenarios for BUYER and BUYER_DOSSIER', () => {
      const buyerList = getScenariosForEntityType('BUYER');
      expect(buyerList.length).toBeGreaterThan(0);
      buyerList.forEach((s) => {
        expect(['BUYER', 'ALL']).toContain(s.targetCategory);
      });

      const buyerDossierList = getScenariosForEntityType('BUYER_DOSSIER');
      expect(buyerDossierList).toHaveLength(buyerList.length);
    });

    test('returns seller and ALL scenarios for SELLER, SUPPLIER_DOSSIER, and VENDOR', () => {
      const sellerList = getScenariosForEntityType('SELLER');
      expect(sellerList.length).toBeGreaterThan(0);
      sellerList.forEach((s) => {
        expect(['SELLER', 'ALL']).toContain(s.targetCategory);
      });

      expect(getScenariosForEntityType('SUPPLIER_DOSSIER')).toHaveLength(sellerList.length);
      expect(getScenariosForEntityType('VENDOR')).toHaveLength(sellerList.length);
    });

    test('falls back to all scenarios for unrecognized entity types', () => {
      const fallbackList = getScenariosForEntityType('UNKNOWN_ENTITY');
      expect(fallbackList).toHaveLength(EMAIL_SCENARIO_TEMPLATES.length);
    });
  });

  describe('getScenarioForCallOutcome', () => {
    test('retrieves correct scenario for BUYER call outcomes', () => {
      const outcomes = ['Connected', 'Left Voicemail', 'Busy', 'No Answer', 'Wrong Number'];
      outcomes.forEach((outcome) => {
        const scenario = getScenarioForCallOutcome('BUYER', outcome);
        expect(scenario).toBeDefined();
        expect(scenario?.targetCategory).toBe('BUYER');
        expect(scenario?.scenarioGroup).toBe('call_outcome');
        expect(scenario?.callOutcomeValue?.toLowerCase()).toBe(outcome.toLowerCase());
      });
    });

    test('retrieves correct scenario for SELLER call outcomes', () => {
      const outcomes = ['Connected', 'Left Voicemail', 'Busy', 'No Answer', 'Wrong Number'];
      outcomes.forEach((outcome) => {
        const scenario = getScenarioForCallOutcome('SELLER', outcome);
        expect(scenario).toBeDefined();
        expect(scenario?.targetCategory).toBe('SELLER');
        expect(scenario?.scenarioGroup).toBe('call_outcome');
        expect(scenario?.callOutcomeValue?.toLowerCase()).toBe(outcome.toLowerCase());
      });
    });

    test('returns undefined for empty outcome or invalid outcome', () => {
      expect(getScenarioForCallOutcome('BUYER', '')).toBeUndefined();
      expect(getScenarioForCallOutcome('BUYER', 'NonExistentOutcome')).toBeUndefined();
      expect(getScenarioForCallOutcome('SELLER', 'Invalid')).toBeUndefined();
    });
  });

  describe('interpolateScenarioTemplate', () => {
    test('returns empty string when template is falsy', () => {
      expect(interpolateScenarioTemplate('', { name: 'Acme' })).toBe('');
    });

    test('interpolates single and multiple placeholder tokens', () => {
      const template = 'Hello {contactName}, your meeting is on {followupDate} at {followupTime}.';
      const vars = {
        contactName: 'Rohit Sharma',
        followupDate: '2026-11-05',
        followupTime: '11:30 AM',
      };
      const result = interpolateScenarioTemplate(template, vars);
      expect(result).toBe('Hello Rohit Sharma, your meeting is on 2026-11-05 at 11:30 AM.');
    });

    test('replaces missing, null, or undefined tokens with empty string', () => {
      const template = 'Contact: {contactName} | Company: {companyName} | Notes: {notes}';
      const vars = {
        contactName: 'John',
        companyName: null,
      };
      const result = interpolateScenarioTemplate(template, vars);
      expect(result).toBe('Contact: John | Company:  | Notes: ');
    });

    test('replaces numeric tokens correctly', () => {
      const template = 'Discount: {discount}% on order {orderId}';
      const vars = {
        discount: 15,
        orderId: 1042,
      };
      const result = interpolateScenarioTemplate(template, vars);
      expect(result).toBe('Discount: 15% on order 1042');
    });
  });
});


import { UI_STRINGS } from '../../lib/uiStrings';

describe('UI Strings Constants Tests', () => {
  test('exports application title and engine information', () => {
    expect(UI_STRINGS.appName).toBe('Procucev Enterprise');
    expect(UI_STRINGS.engineVersion).toBe('QUA AI 2.0');
    expect(UI_STRINGS.tagline).toBeDefined();
  });

  test('exports screen metadata definitions', () => {
    expect(UI_STRINGS.screens.commandCenter.screenTag).toBe('Screen 1.1');
    expect(UI_STRINGS.screens.ingestionWizard.screenTag).toBe('Screen 1.2');
    expect(UI_STRINGS.screens.quoteMatrix.screenTag).toBe('Screen 1.3');
    expect(UI_STRINGS.screens.vendorEvaluation.screenTag).toBe('Screen 2.3');
    expect(UI_STRINGS.screens.categoryDashboard.screenTag).toBe('Screen 3.1');
  });

  test('exports reusable action labels and badge constants', () => {
    expect(UI_STRINGS.actions.approveAndGeneratePO).toContain('APPROVE');
    expect(UI_STRINGS.actions.backToDashboard).toContain('Back');
    expect(UI_STRINGS.badges.aiChasingActive).toContain('Active');
    expect(UI_STRINGS.badges.fullyCompliant).toContain('Compliant');
  });
});

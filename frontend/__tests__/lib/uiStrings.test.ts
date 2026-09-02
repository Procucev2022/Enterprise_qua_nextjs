import { UI_STRINGS, formatString } from '../../lib/uiStrings';

describe('UI Strings Constants & i18n Format Tests', () => {
  test('exports application title and engine information', () => {
    expect(UI_STRINGS.appName).toBe('Procucev Enterprise');
    expect(UI_STRINGS.engineVersion).toBe('QUA AI 2.0');
    expect(UI_STRINGS.tagline).toBeDefined();
  });

  test('exports screen metadata definitions', () => {
    expect(UI_STRINGS.screens.commandCenter.screenTag).toBe('Screen 1.1');
    expect(UI_STRINGS.screens.ingestionWizard.screenTag).toBe('Screen 1.2');
    // RFQ Summary took Screen 1.3, shifting the quote matrix to 1.4.
    expect(UI_STRINGS.screens.rfqSummary.screenTag).toBe('Screen 1.3');
    expect(UI_STRINGS.screens.quoteMatrix.screenTag).toBe('Screen 1.4');
    expect(UI_STRINGS.screens.vendorEvaluation.screenTag).toBe('Screen 2.3');
    expect(UI_STRINGS.screens.categoryDashboard.screenTag).toBe('Screen 3.1');
    expect(UI_STRINGS.screens.infraControl.screenTag).toBe('Screen 4.1');
    expect(UI_STRINGS.screens.auditLogs.screenTag).toBe('Screen 4.2');
  });

  test('exports reusable action labels and badge constants', () => {
    expect(UI_STRINGS.actions.approveAndGeneratePO).toContain('APPROVE');
    expect(UI_STRINGS.actions.backToDashboard).toContain('Back');
    expect(UI_STRINGS.badges.aiChasingActive).toContain('Active');
    expect(UI_STRINGS.badges.fullyCompliant).toContain('Compliant');
    expect(UI_STRINGS.badges.aesEncrypted).toContain('AES-256-GCM');
    expect(UI_STRINGS.badges.aesGcmProtected).toContain('AES-256');
    expect(UI_STRINGS.badges.cryptoVerified).toContain('Cryptographically');
  });


  test('formats strings with runtime placeholder substitution', () => {
    const formatted = formatString(UI_STRINGS.templates.rfqDispatched, {
      rfqNumber: 'RFQ-8902',
      vendorCount: 5,
    });
    expect(formatted).toBe('RFQ #RFQ-8902 successfully dispatched to 5 qualified vendors.');

    const poText = formatString(UI_STRINGS.templates.poGenerated, {
      poNumber: 'PO-2026-0042',
    });
    expect(poText).toBe('Purchase Order #PO-2026-0042 created and committed to ERP.');

    const ratingText = formatString(UI_STRINGS.templates.ratingUpdated, {
      vendorName: 'Apex Tools',
      newScore: 94,
    });
    expect(ratingText).toBe('Vendor rating for Apex Tools revised to 94/100.');
  });

  test('handles edge cases in formatString gracefully', () => {
    expect(formatString('')).toBe('');
    expect(formatString('Static Text without params')).toBe('Static Text without params');
    expect(formatString('Hello {missingParam}', {})).toBe('Hello {missingParam}');
  });
});

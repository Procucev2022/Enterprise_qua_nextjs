import { SOURCING_MODES, INITIAL_SYSTEM_CONFIG, INITIAL_AZURE_HEALTH } from '@/lib/constants';

describe('lib/constants', () => {
  it('should export valid SOURCING_MODES', () => {
    expect(Array.isArray(SOURCING_MODES)).toBe(true);
    expect(SOURCING_MODES.length).toBe(3);
    
    const mode1 = SOURCING_MODES.find(m => m.id === 'mode_1');
    expect(mode1).toBeDefined();
    expect(mode1?.code).toBe('Version 1');
    expect(mode1?.name).toContain('Client Roster');

    const mode2 = SOURCING_MODES.find(m => m.id === 'mode_2');
    expect(mode2).toBeDefined();
    expect(mode2?.code).toBe('Version 2');

    const mode3 = SOURCING_MODES.find(m => m.id === 'mode_3');
    expect(mode3).toBeDefined();
    expect(mode3?.code).toBe('Version 3');
  });

  it('should export valid INITIAL_SYSTEM_CONFIG', () => {
    expect(INITIAL_SYSTEM_CONFIG).toBeDefined();
    expect(INITIAL_SYSTEM_CONFIG.ollamaModel).toBe('Llama 3 (8B Instruct)');
    expect(INITIAL_SYSTEM_CONFIG.ollamaActive).toBe(true);
    expect(INITIAL_SYSTEM_CONFIG.ocrExtractionThreshold).toBe(85);
    expect(INITIAL_SYSTEM_CONFIG.escalationIntervalHours).toBe(24);
    expect(INITIAL_SYSTEM_CONFIG.azureDbBackupFrequency).toBe('Daily');
    expect(INITIAL_SYSTEM_CONFIG.rbacEnforced).toBe(true);
  });

  it('should export valid INITIAL_AZURE_HEALTH services', () => {
    expect(Array.isArray(INITIAL_AZURE_HEALTH)).toBe(true);
    expect(INITIAL_AZURE_HEALTH.length).toBeGreaterThanOrEqual(5);
    
    const services = INITIAL_AZURE_HEALTH.map(s => s.service);
    expect(services.some(s => s.includes('PostgreSQL'))).toBe(true);
    expect(services.some(s => s.includes('OpenAI'))).toBe(true);
    expect(services.some(s => s.includes('Cosmos DB'))).toBe(true);
    expect(services.some(s => s.includes('Communication Services'))).toBe(true);
    expect(services.some(s => s.includes('Key Vault'))).toBe(true);
  });
});

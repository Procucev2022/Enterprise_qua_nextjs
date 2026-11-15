const configController = require('../src/controllers/configController');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');
const { SYSTEM_CONFIG_MESSAGES } = require('../src/config/constants');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('configController branches', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('getSystemConfig answers with the stored config and the Azure health probe', () => {
    const systemConfig = { aiModel: 'model-under-test', aiTemperature: 0.2 };
    const azureHealth = { status: 'connected' };
    jest.spyOn(storeService, 'getSystemConfig').mockReturnValue(systemConfig);
    jest.spyOn(storeService, 'getAzureHealth').mockReturnValue(azureHealth);
    const res = mockRes();
    const next = jest.fn();

    configController.getSystemConfig({}, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: { systemConfig, azureHealth } });
    expect(next).not.toHaveBeenCalled();
  });

  test('getSystemConfig forwards a store failure to next without answering', () => {
    const failure = new Error('config store unavailable');
    jest.spyOn(storeService, 'getSystemConfig').mockImplementation(() => {
      throw failure;
    });
    const res = mockRes();
    const next = jest.fn();

    configController.getSystemConfig({}, res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.json).not.toHaveBeenCalled();
  });

  test('updateSystemConfig refuses the write with 501 and reports the submitted keys', () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    const res = mockRes();
    const next = jest.fn();

    configController.updateSystemConfig({ body: { ocrExtractionThreshold: 90 } }, res, next);

    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: SYSTEM_CONFIG_MESSAGES.READ_ONLY });
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), { submittedKeys: ['ocrExtractionThreshold'] }, 'CONFIG_CONTROLLER');
    expect(next).not.toHaveBeenCalled();
  });

  test('updateSystemConfig records no submitted keys when the body is missing or not an object', () => {
    const warnSpy = jest.spyOn(logger, 'warn');

    for (const req of [{}, { body: null }, { body: 'raw text' }]) {
      const res = mockRes();
      configController.updateSystemConfig(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(501);
    }

    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy.mock.calls.map(([, details]) => details)).toEqual([
      { submittedKeys: [] },
      { submittedKeys: [] },
      { submittedKeys: [] },
    ]);
    expect(warnSpy.mock.calls.map(([, , category]) => category)).toEqual([
      'CONFIG_CONTROLLER',
      'CONFIG_CONTROLLER',
      'CONFIG_CONTROLLER',
    ]);
  });

  test('updateSystemConfig forwards an unexpected response failure to next', () => {
    const failure = new Error('response already closed');
    const res = mockRes();
    res.status.mockImplementation(() => {
      throw failure;
    });
    const next = jest.fn();

    configController.updateSystemConfig({ body: { activeMode: 'mode_3' } }, res, next);

    expect(next).toHaveBeenCalledWith(failure);
  });
});

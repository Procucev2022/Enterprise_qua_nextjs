const scorecardController = require('../src/controllers/scorecardController');
const scorecardQueries = require('../src/db/scorecardQueries');
const { logger } = require('../src/services/loggerService');
const { PERSISTENCE_MESSAGES } = require('../src/config/constants');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('scorecardController branches', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('applies the default period and filters when the query is empty', async () => {
    const queryDataSpy = jest.spyOn(scorecardQueries, 'getScorecardData').mockResolvedValue({ period: 'this_month' });
    const res = mockRes();

    await scorecardController.getScorecard({ query: {} }, res);

    expect(queryDataSpy).toHaveBeenCalledWith({
      period: 'this_month',
      startDate: undefined,
      endDate: undefined,
      project: 'all',
      pillar: 'all',
      executiveId: undefined,
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { period: 'this_month' } });
  });

  test('passes explicit query filters through to the query layer', async () => {
    const queryDataSpy = jest.spyOn(scorecardQueries, 'getScorecardData').mockResolvedValue({ executiveId: 'exec-9' });
    const res = mockRes();

    await scorecardController.getScorecard({
      query: {
        period: 'custom',
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        project: 'project-a',
        pillar: 'operations',
        executiveId: 'exec-9',
      },
    }, res);

    expect(queryDataSpy).toHaveBeenCalledWith({
      period: 'custom',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      project: 'project-a',
      pillar: 'operations',
      executiveId: 'exec-9',
    });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { executiveId: 'exec-9' } });
  });

  test('answers 503 with a retryable message when task storage is unavailable', async () => {
    const storageError = Object.assign(new Error('storage down'), { code: 'PERSISTENCE_UNAVAILABLE' });
    jest.spyOn(scorecardQueries, 'getScorecardData').mockRejectedValue(storageError);
    const res = mockRes();

    await scorecardController.getScorecard({ query: { period: 'this_month' } }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
      retryable: true,
    });
  });

  test('answers 400 with the validation message for an invalid custom range', async () => {
    const validationError = Object.assign(new Error('startDate must be a valid date.'), { code: 'VALIDATION_FAILED' });
    jest.spyOn(scorecardQueries, 'getScorecardData').mockRejectedValue(validationError);
    const res = mockRes();

    await scorecardController.getScorecard({ query: { period: 'custom', startDate: 'not-a-date' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'startDate must be a valid date.' });
  });

  test('answers 500 with the generic message and logs any other failure', async () => {
    jest.spyOn(scorecardQueries, 'getScorecardData').mockRejectedValue(new Error('unexpected failure'));
    const errorSpy = jest.spyOn(logger, 'error');
    const res = mockRes();

    await scorecardController.getScorecard({ query: {} }, res);

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to retrieve scorecard performance data',
      expect.any(Error),
      'SCORECARD_CONTROLLER'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Failed to retrieve scorecard performance analytics.',
    });
  });
});

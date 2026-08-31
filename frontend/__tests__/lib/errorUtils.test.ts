import { formatDescriptiveErrorMessage } from '../../lib/errorUtils';

describe('errorUtils Unit Tests', () => {
  test('formats validation errors with fieldErrors and actionable text', () => {
    const errObj = {
      message: 'Invalid GSTIN provided',
      fieldErrors: { gstin: 'Must match 15-character GSTIN pattern' },
    };
    const formatted = formatDescriptiveErrorMessage(errObj, 'Buyer Registration');

    expect(formatted.category).toBe('VALIDATION');
    expect(formatted.title).toBe('Form Validation Incomplete');
    expect(formatted.actionType).toBe('FIX_INPUT');
    expect(formatted.isRecoverable).toBe(true);
    expect(formatted.fieldErrors?.gstin).toBeDefined();
  });

  test('formats validation errors based on HTTP status 400', () => {
    const errObj = { status: 400 };
    const formatted = formatDescriptiveErrorMessage(errObj);

    expect(formatted.category).toBe('VALIDATION');
    expect(formatted.message).toMatch(/required fields contain invalid data/i);
  });

  test('formats network errors when message contains network/fetch keywords', () => {
    const err = new Error('Failed to fetch API resource');
    const formatted = formatDescriptiveErrorMessage(err);

    expect(formatted.category).toBe('NETWORK');
    expect(formatted.title).toBe('Network Connectivity Disrupted');
    expect(formatted.actionType).toBe('RETRY');
    expect(formatted.isRecoverable).toBe(true);
  });

  test('formats network errors when navigator is offline or status is 504', () => {
    const err = { status: 504 };
    const formatted = formatDescriptiveErrorMessage(err);

    expect(formatted.category).toBe('NETWORK');
  });

  test('formats database sync errors when PostgreSQL connection fails or status is 503', () => {
    const err = { message: 'PostgreSQL pool timeout on query execution' };
    const formatted = formatDescriptiveErrorMessage(err);

    expect(formatted.category).toBe('DATABASE_SYNC');
    expect(formatted.title).toBe('Database Synchronization Delayed');
    expect(formatted.actionType).toBe('RETRY');
  });

  test('formats authentication errors when unauthorized (401 / 403 / session expired)', () => {
    const err = { status: 401, message: 'JWT expired' };
    const formatted = formatDescriptiveErrorMessage(err);

    expect(formatted.category).toBe('AUTHENTICATION');
    expect(formatted.title).toBe('Authentication Required or Expired');
    expect(formatted.actionType).toBe('LOGIN');
  });

  test('formats business logic errors when workflow constraints are violated', () => {
    const err = { message: 'Budget exceeded for this RFQ line item' };
    const formatted = formatDescriptiveErrorMessage(err);

    expect(formatted.category).toBe('BUSINESS_LOGIC');
    expect(formatted.title).toBe('Workflow Policy Constraint');
    expect(formatted.actionType).toBe('SWITCH_MODE');
  });

  test('formats unexpected system errors with context and support action', () => {
    const err = { message: 'Unknown kernel crash' };
    const formatted = formatDescriptiveErrorMessage(err, 'RFQ Dispatch');

    expect(formatted.category).toBe('SYSTEM');
    expect(formatted.title).toBe('RFQ Dispatch Error');
    expect(formatted.actionType).toBe('CONTACT_SUPPORT');
    expect(formatted.isRecoverable).toBe(false);
  });

  test('handles empty or string error inputs gracefully', () => {
    const formattedStr = formatDescriptiveErrorMessage('NetworkError when attempting to fetch resource.');
    expect(formattedStr.category).toBe('NETWORK');

    const formattedEmpty = formatDescriptiveErrorMessage(null);
    expect(formattedEmpty.category).toBe('SYSTEM');
    expect(formattedEmpty.message).toMatch(/unexpected operational anomaly/i);
  });
});

const mailerService = require('../src/services/mailerService');

describe('mailerService', () => {
  test('sendOtpEmail no-ops during test environment (NODE_ENV=test)', async () => {
    const res = await mailerService.sendOtpEmail('someone@example.com', '1234', 600);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('test environment');
  });

  test('sendOtpEmail no-ops when SMTP is not configured', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendOtpEmail('someone@example.com', '1234', 600);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('SMTP not configured');

    process.env.NODE_ENV = 'test';
  });

  test('sendOtpEmail sends via the configured transporter, caching it across calls, with correct minute pluralization', async () => {
    let freshMailerService;
    let capturedMail;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn((mail) => {
            capturedMail = mail;
            return Promise.resolve({ messageId: 'mock-message-id' });
          }),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendOtpEmail('someone@example.com', '9999', 10);
    expect(res.sent).toBe(true);
    expect(res.messageId).toBe('mock-message-id');
    expect(capturedMail.to).toBe('someone@example.com');
    expect(capturedMail.html).toContain('9999');
    expect(capturedMail.html).toContain('1 minute.');

    // Second call reuses the cached transporter (getTransporter's early-return branch)
    await freshMailerService.sendOtpEmail('someone@example.com', '1111', 120);
    expect(capturedMail.html).toContain('2 minutes.');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('sendOtpEmail propagates a real send failure to the caller', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn().mockRejectedValue(new Error('SMTP connection refused')),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    await expect(freshMailerService.sendOtpEmail('someone@example.com', '1234', 600)).rejects.toThrow(
      'SMTP connection refused'
    );

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });
});

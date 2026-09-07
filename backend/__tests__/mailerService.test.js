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

  test('isConfigured reflects whether both SMTP_USER and SMTP_PASSWORD are set', () => {
    const originalUser = process.env.SMTP_USER;
    const originalPass = process.env.SMTP_PASSWORD;

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    expect(mailerService.isConfigured()).toBe(false);

    process.env.SMTP_USER = 'test@example.com';
    delete process.env.SMTP_PASSWORD;
    expect(mailerService.isConfigured()).toBe(false);

    process.env.SMTP_USER = 'test@example.com';
    process.env.SMTP_PASSWORD = 'app-password';
    expect(mailerService.isConfigured()).toBe(true);

    if (originalUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = originalUser;
    if (originalPass === undefined) delete process.env.SMTP_PASSWORD;
    else process.env.SMTP_PASSWORD = originalPass;
  });

  test('sendRequisitionNotificationEmail no-ops during test environment (NODE_ENV=test)', async () => {
    const res = await mailerService.sendRequisitionNotificationEmail({
      to: 'target@example.com',
      rfqNumber: 'RFQ-2026-TEST',
      title: 'Industrial Motor',
    });
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('test environment');
  });

  test('sendRequisitionNotificationEmail no-ops when SMTP is not configured', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail(
      'target@example.com',
      { rfqNumber: 'RFQ-2026-TEST' },
      'buyer@example.com'
    );
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('SMTP not configured');

    process.env.NODE_ENV = 'test';
  });

  test('sendRequisitionNotificationEmail sends email with line items, specs, and attachments', async () => {
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
            return Promise.resolve({ messageId: 'req-msg-123' });
          }),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail(
      'navinchaudhary.dev@gmail.com',
      {
        rfqNumber: 'RFQ-2026-101',
        title: 'Stainless Steel Flanges',
        category: 'Piping',
        targetDeliveryDate: '2026-10-15',
        budget: 150000,
        description: 'Urgent line replacement items',
        extractedEntities: [
          { itemName: 'SS 316 Flange 4-inch', quantity: 20, unit: 'pcs', technicalSpecs: 'Class 150 ANSI' },
          { itemName: 'Gasket Ring', quantity: 40 },
        ],
      },
      'buyer@procucev.com'
    );

    expect(res.sent).toBe(true);
    expect(res.messageId).toBe('req-msg-123');
    expect(capturedMail.to).toBe('navinchaudhary.dev@gmail.com');
    expect(capturedMail.replyTo).toBe('buyer@procucev.com');
    expect(capturedMail.subject).toContain('RFQ-2026-101');
    expect(capturedMail.html).toContain('SS 316 Flange 4-inch');
    expect(capturedMail.html).toContain('Class 150 ANSI');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('sendRequisitionNotificationEmail handles empty items and fallback values safely', async () => {
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
            return Promise.resolve({ messageId: 'req-msg-456' });
          }),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail(
      '',
      null,
      ''
    );

    expect(res.sent).toBe(true);
    expect(capturedMail.to).toBe('navinchaudhary.dev@gmail.com');
    expect(capturedMail.html).toContain('No specific line items itemized');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('sendRequisitionNotificationEmail handles send failure and returns error', async () => {
    let freshMailerService;
    jest.isolateModules(() => {
      process.env.NODE_ENV = 'development';
      process.env.SMTP_USER = 'test@example.com';
      process.env.SMTP_PASSWORD = 'app-password';
      jest.doMock('nodemailer', () => ({
        createTransport: jest.fn(() => ({
          sendMail: jest.fn().mockRejectedValue(new Error('Gateway timeout')),
        })),
      }));
      freshMailerService = require('../src/services/mailerService');
    });

    const res = await freshMailerService.sendRequisitionNotificationEmail('test@example.com', { rfqNumber: 'RFQ-ERR' }, 'buyer@test.com');
    expect(res.sent).toBe(false);
    expect(res.error).toBe('Gateway timeout');

    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  test('buildRequisitionEmail exercises items array and alternate property names', () => {
    const email1 = mailerService.buildRequisitionEmail('target@test.com', {
      sourceEmail: 'fallback-buyer@test.com',
      items: [
        { name: 'Pipe Fitting', uom: 'meters', specs: 'Grade A' },
        { itemName: 'Pressure Gauge', quantity: 5, unit: 'pcs', description: '0-10 bar' },
      ],
    });
    expect(email1.replyTo).toBe('fallback-buyer@test.com');
    expect(email1.html).toContain('Pipe Fitting');
    expect(email1.html).toContain('Pressure Gauge');
    expect(email1.html).toContain('Grade A');
    expect(email1.html).toContain('0-10 bar');
  });
});

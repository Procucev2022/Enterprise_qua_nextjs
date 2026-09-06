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

    // With no expiry argument at all the window defaults to 10 minutes.
    await freshMailerService.sendOtpEmail('someone@example.com', '2222');
    expect(capturedMail.html).toContain('10 minutes.');

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

  describe('buildRfqInviteEmail', () => {
    const RFQ = {
      rfqNumber: 'RFQ-2026-00500',
      title: 'Centrifugal Pumps',
      category: 'Pumps & Accessories',
      buyerAccountName: 'Acme Buyer Co',
      targetDeliveryDate: '2026-12-01',
      deliveryLocation: 'Navi Mumbai Plant',
      extractedEntities: [{ itemName: 'Pump 500 GPM', quantity: 2, unit: 'Units' }],
    };

    test('renders only real fields and names the RFQ in the subject', () => {
      const msg = mailerService.buildRfqInviteEmail('v@x.com', { rfq: RFQ, recipientName: 'Priya' });
      expect(msg.to).toBe('v@x.com');
      expect(msg.subject).toBe('New RFQ RFQ-2026-00500 in Pumps & Accessories');
      expect(msg.html).toContain('Dear <strong>Priya</strong>');
      expect(msg.html).toContain('Acme Buyer Co');
      expect(msg.html).toContain('Centrifugal Pumps');
      expect(msg.html).toContain('Pump 500 GPM');
      expect(msg.html).toContain('Navi Mumbai Plant');
    });

    test('omits rows and the greeting name when the data is not there — never invents them', () => {
      const bare = {
        rfqNumber: 'RFQ-2026-00777',
        title: 'Untitled enquiry',
        // A line item with nothing filled in still renders without inventing values.
        extractedEntities: [{}],
      };
      const msg = mailerService.buildRfqInviteEmail('v@x.com', { rfq: bare, recipientName: '' });
      expect(msg.html).toContain('1. Line item');
      expect(msg.subject).toBe('New RFQ RFQ-2026-00777');
      expect(msg.html).toContain('Hello,');
      expect(msg.html).not.toContain('Category');
      expect(msg.html).not.toContain('Target delivery');
      // No fabricated fallback address / date / category anywhere.
      expect(msg.html).not.toContain('partner@enterprise.com');
      expect(msg.html).not.toContain('2026-09-15');
    });
  });

  describe('buildQuoteReceivedEmail', () => {
    const RFQ = { rfqNumber: 'RFQ-2026-00500', title: 'Centrifugal Pumps' };

    test('summarises the quote with only the fields the vendor supplied', () => {
      const msg = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: RFQ,
        quote: { vendorName: 'Pumps R Us', unitPrice: 5200, totalPrice: 10400, leadTimeDays: 15, paymentTerms: 'Net 30' },
        recipientName: 'Acme Buyer Co',
      });
      expect(msg.subject).toBe('New quote on RFQ-2026-00500 from Pumps R Us');
      expect(msg.html).toContain('Pumps R Us');
      expect(msg.html).toContain('5200');
      expect(msg.html).toContain('Net 30');
      expect(msg.html).not.toContain('Warranty');
    });

    test('falls back to neutral wording and omits every unset figure', () => {
      const msg = mailerService.buildQuoteReceivedEmail('buyer@x.com', {
        rfq: RFQ,
        quote: {},
        recipientName: '',
      });
      expect(msg.subject).toBe('New quote on RFQ-2026-00500');
      expect(msg.html).toContain('A vendor has');
      expect(msg.html).toContain('Hello,');
      expect(msg.html).not.toContain('Unit price');
      expect(msg.html).not.toContain('Lead time');
    });
  });

  describe('sendRfqInviteEmail / sendQuoteReceivedEmail', () => {
    const ctxRfq = { rfq: { rfqNumber: 'RFQ-1', title: 'T' }, recipientName: 'R' };
    const ctxQuote = { rfq: { rfqNumber: 'RFQ-1', title: 'T' }, quote: { unitPrice: 1 }, recipientName: 'R' };

    test('both no-op under the test environment', async () => {
      expect(await mailerService.sendRfqInviteEmail('v@x.com', ctxRfq)).toEqual({
        sent: false,
        reason: 'test environment',
      });
      expect(await mailerService.sendQuoteReceivedEmail('b@x.com', ctxQuote)).toEqual({
        sent: false,
        reason: 'test environment',
      });
    });

    test('no-op when SMTP is unconfigured, and send + propagate failure when configured', async () => {
      let fresh;
      let captured = [];
      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        delete process.env.SMTP_USER;
        delete process.env.SMTP_PASSWORD;
        fresh = require('../src/services/mailerService');
      });
      expect(await fresh.sendRfqInviteEmail('v@x.com', ctxRfq)).toMatchObject({ sent: false, reason: 'SMTP not configured' });

      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'pw';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({
            sendMail: jest.fn((m) => {
              captured.push(m);
              return Promise.resolve({ messageId: 'id-1' });
            }),
          })),
        }));
        fresh = require('../src/services/mailerService');
      });
      expect(await fresh.sendQuoteReceivedEmail('b@x.com', ctxQuote)).toEqual({ sent: true, messageId: 'id-1' });
      expect(captured[0].to).toBe('b@x.com');

      jest.isolateModules(() => {
        process.env.NODE_ENV = 'development';
        process.env.SMTP_USER = 'test@example.com';
        process.env.SMTP_PASSWORD = 'pw';
        jest.doMock('nodemailer', () => ({
          createTransport: jest.fn(() => ({ sendMail: jest.fn().mockRejectedValue(new Error('smtp down')) })),
        }));
        fresh = require('../src/services/mailerService');
      });
      await expect(fresh.sendRfqInviteEmail('v@x.com', ctxRfq)).rejects.toThrow('smtp down');

      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASSWORD;
      process.env.NODE_ENV = 'test';
    });
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
});

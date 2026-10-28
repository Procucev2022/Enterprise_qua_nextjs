const mailTransport = require('../src/services/mailTransport');

function decode(raw) {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => undefined },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

const FILE = { filename: 'report.xlsx', content: 'UEsDBAo=\n', contentType: 'application/vnd.ms-excel' };

describe('mailTransport attachments', () => {
  const originalFetch = global.fetch;
  const provider = (key) => mailTransport.HTTP_PROVIDERS.find((entry) => entry.key === key);

  afterEach(() => {
    ['RESEND_API_KEY', 'SENDGRID_API_KEY', 'BREVO_API_KEY', 'MAILCHANNELS_API_KEY'].forEach((key) => delete process.env[key]);
    global.fetch = originalFetch;
  });

  test('toAttachmentList keeps named, non-empty files and defaults their type', () => {
    expect(mailTransport.toAttachmentList(undefined)).toEqual([]);
    expect(
      mailTransport.toAttachmentList([FILE, null, { filename: 'empty.txt' }, { filename: 'a.bin', content: 'AAA=' }])
    ).toEqual([
      { filename: 'report.xlsx', content: 'UEsDBAo=', contentType: 'application/vnd.ms-excel', encoding: 'base64' },
      { filename: 'a.bin', content: 'AAA=', contentType: 'application/octet-stream', encoding: 'base64' },
    ]);
  });

  test('a message without attachments is built exactly as before', () => {
    const raw = decode(mailTransport.buildRawMimeMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'S', text: 'Body' }));
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(raw).not.toContain('multipart/mixed');
  });

  test('plain-text and html messages wrap their body in multipart/mixed with one part per file', () => {
    const plain = decode(
      mailTransport.buildRawMimeMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'S', text: 'Body', attachments: [FILE] })
    );
    expect(plain).toContain('Content-Type: multipart/mixed;');
    expect(plain).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(plain).toContain('Content-Disposition: attachment; filename="report.xlsx"');
    expect(plain).toContain('UEsDBAo=');

    const long = { filename: 'big".bin', content: 'A'.repeat(100) };
    const html = decode(
      mailTransport.buildRawMimeMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'S', html: '<p>Hi</p>', attachments: [long] })
    );
    expect(html).toContain('multipart/alternative');
    expect(html).toContain('filename="big.bin"');
    expect(html).toContain(`${'A'.repeat(76)}\r\n${'A'.repeat(24)}`);
  });

  test('each HTTP provider sends attachments in its own field', async () => {
    const message = { to: 'c@d.com', subject: 'S', text: 'Body', attachments: [FILE] };
    process.env.RESEND_API_KEY = 'rk';
    process.env.SENDGRID_API_KEY = 'sg';
    process.env.BREVO_API_KEY = 'bk';
    process.env.MAILCHANNELS_API_KEY = 'mc';
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(200, { id: 'x', messageId: 'y' }));

    await provider('resend').send(message, 'a@b.com');
    await provider('sendgrid').send(message, 'a@b.com');
    await provider('brevo').send(message, 'a@b.com');
    await provider('mailchannels').send(message, 'a@b.com');
    const bodies = global.fetch.mock.calls.map((call) => JSON.parse(call[1].body));

    expect(bodies[0].attachments).toEqual([{ filename: 'report.xlsx', content: 'UEsDBAo=' }]);
    expect(bodies[1].attachments).toEqual([
      { content: 'UEsDBAo=', filename: 'report.xlsx', type: 'application/vnd.ms-excel', disposition: 'attachment' },
    ]);
    expect(bodies[2].attachment).toEqual([{ content: 'UEsDBAo=', name: 'report.xlsx' }]);
    expect(bodies[3].attachments).toEqual([{ content: 'UEsDBAo=', filename: 'report.xlsx', type: 'application/vnd.ms-excel' }]);

    global.fetch.mockClear();
    await provider('sendgrid').send({ to: 'c@d.com', subject: 'S', text: 'Body' }, 'a@b.com');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).attachments).toBeUndefined();
  });
});

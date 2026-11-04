import { google } from 'googleapis';

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground',
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

const gmail = google.gmail({
  version: 'v1',
  auth: oauth2Client,
});

const encodeBase64 = (value) =>
  (Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g) || []).join('\r\n');

const base64Url = (value) => Buffer.from(value, 'utf8').toString('base64url');

const safeHeader = (value, name) => {
  const normalized = String(value ?? '');
  if (/[\r\n]/.test(normalized)) {
    throw new Error(`Invalid newline in email ${name}`);
  }
  return normalized;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  const requiredConfig = [
    ['GMAIL_USER', process.env.GMAIL_USER],
    ['GMAIL_CLIENT_ID', process.env.GMAIL_CLIENT_ID],
    ['GMAIL_CLIENT_SECRET', process.env.GMAIL_CLIENT_SECRET],
    ['GMAIL_REFRESH_TOKEN', process.env.GMAIL_REFRESH_TOKEN],
  ];
  const missingConfig = requiredConfig
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingConfig.length) {
    throw new Error(`Missing Gmail OAuth configuration: ${missingConfig.join(', ')}`);
  }

  try {
    const boundary = `wordwell_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const from = safeHeader(process.env.EMAIL_FROM || process.env.GMAIL_USER, 'From');
    const recipient = safeHeader(to, 'To');
    const emailSubject = safeHeader(subject, 'Subject');
    const plainText = text || '';
    const htmlText = html || text || '';

    const message = [
      `From: "WordWell" <${from}>`,
      `To: ${recipient}`,
      `Subject: =?UTF-8?B?${Buffer.from(emailSubject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64(plainText),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodeBase64(htmlText),
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: base64Url(message) },
      timeout: 20_000,
    });

    return response.data;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw new Error('Failed to send email');
  }
};

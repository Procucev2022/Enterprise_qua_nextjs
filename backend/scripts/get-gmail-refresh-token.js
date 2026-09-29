require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const http = require('http');
const path = require('path');
const { google } = require('googleapis');

// Request send, modify, and readonly scopes for full autonomous ingestion and dispatch
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.readonly',
];

async function main() {
  let client_id = process.env.GMAIL_CLIENT_ID;
  let client_secret = process.env.GMAIL_CLIENT_SECRET;

  const credPath = process.argv[2];
  if (credPath && fs.existsSync(credPath)) {
    const parsed = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const installed = parsed.installed || parsed.web;
    if (installed) {
      client_id = installed.client_id;
      client_secret = installed.client_secret;
    }
  }

  if (!client_id || !client_secret) {
    console.error('Usage: node get-gmail-refresh-token.js [/path/to/client_secret_*.json]');
    console.error('Or ensure GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are defined in backend/.env');
    process.exit(1);
  }

  // Google's "installed app" (loopback) OAuth flow accepts any port on
  // http://localhost at request time even though the registered
  // redirect_uris just says "http://localhost" with no port (RFC 8252) — so
  // this picks a fixed local port rather than parsing one out of the JSON.
  const port = 53682;
  const redirectUri = `http://localhost:${port}`;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token even on repeat runs
    scope: SCOPES,
  });

  console.log('\n================================================================');
  console.log('       GMAIL API OAUTH2 AUTHORIZATION FOR ENTERPRISE QUA        ');
  console.log('================================================================');
  console.log('1. Open this URL in your browser and sign in with navin.procucev@gmail.com:\n');
  console.log(authUrl);
  console.log('\n2. Approve access. You will be redirected to localhost (port 53682)...\n');

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/')) return;
    const code = new URL(req.url, redirectUri).searchParams.get('code');
    if (!code) {
      res.end('No code found in redirect. Check the terminal.');
      return;
    }
    res.end('Success! Enterprise QUA has received the authorized Gmail tokens. You can close this tab.');
    server.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      console.log('\n=== SAVE THESE INTO backend/.env ===\n');
      console.log(`GMAIL_CLIENT_ID=${client_id}`);
      console.log(`GMAIL_CLIENT_SECRET=${client_secret}`);
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('GMAIL_SENDER_EMAIL=navin.procucev@gmail.com');
      console.log('\n=====================================\n');

      if (!tokens.refresh_token) {
        console.warn(
          'WARNING: no refresh_token returned. This happens if you already granted access before ' +
          'without revoking it. Fix: go to https://myaccount.google.com/permissions, remove access ' +
          'for this app, then re-run this script.'
        );
      } else {
        // Auto-update backend/.env and root .env
        [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')].forEach((envPath) => {
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (envContent.includes('GMAIL_REFRESH_TOKEN=')) {
              envContent = envContent.replace(/GMAIL_REFRESH_TOKEN=.*(\r?\n)/, `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}$1`);
            } else {
              envContent += `\nGMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`;
            }
            if (envContent.includes('GMAIL_SENDER_EMAIL=')) {
              envContent = envContent.replace(/GMAIL_SENDER_EMAIL=.*(\r?\n)/, `GMAIL_SENDER_EMAIL=navin.procucev@gmail.com$1`);
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
            console.log(`✔ ${path.basename(path.dirname(envPath))}/.env has been automatically updated with the new refresh token!`);
          }
        });
      }
    } catch (err) {
      console.error('Token exchange failed:', err.message);
    }
    process.exit(0);
  });
  server.listen(port, () => {});
}

main();

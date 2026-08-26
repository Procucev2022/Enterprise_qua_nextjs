const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

async function testCapture() {
  const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  console.log('Launching browser with chrome at:', chromePath);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1.5,
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  console.log('Page loaded:', await page.title());

  const testPath = path.join(screenshotsDir, '00_auth_login.png');
  await page.screenshot({ path: testPath, fullPage: true });
  console.log('Screenshot saved:', testPath);

  await browser.close();
}

testCapture().catch(console.error);

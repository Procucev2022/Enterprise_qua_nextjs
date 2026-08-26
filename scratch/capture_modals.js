const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureModals() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: {
      width: 1536,
      height: 960,
      deviceScaleFactor: 1.5,
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  async function take(filename, description) {
    await sleep(800);
    const filePath = path.join(screenshotsDir, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`[Captured Modal] ${filename} -> ${description}`);
  }

  // 1. Login as Buyer
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await sleep(600);

  await page.evaluate(() => {
    const reqBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Request Login OTP'));
    if (reqBtn) reqBtn.click();
  });
  await sleep(600);

  await page.evaluate(() => {
    const strongs = Array.from(document.querySelectorAll('strong'));
    const codeEl = strongs.find(s => /^\d{4}$/.test(s.textContent.trim()));
    const otpCode = codeEl ? codeEl.textContent.trim() : '4321';
    
    const input = document.querySelector('input[type="text"]') || document.querySelector('input[placeholder*="OTP"]') || document.querySelector('input[placeholder*="digit"]') || document.querySelectorAll('input')[0];
    if (input) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      nativeInputValueSetter.call(input, otpCode);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(300);

  await page.evaluate(() => {
    const verifyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Verify & Sign In') || b.textContent.includes('Verify'));
    if (verifyBtn) verifyBtn.click();
  });
  await sleep(1200);

  // 1. Follow-Up Deep Dive Modal
  await page.evaluate(() => {
    // Click on the first RFQ item in pipeline
    const rfqRow = document.querySelector('.cursor-pointer');
    if (rfqRow) rfqRow.click();
  });
  await sleep(1000);
  await take('05_buyer_followup_deepdive.png', 'Modal: RFQ Follow-Up Deep-Dive Matrix (Calls, WhatsApp, SMS, 24h Reminders)');

  // 2. Open Multi-Channel Chaser from within Deep Dive or from Kanban
  await page.evaluate(() => {
    const triggerBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Outreach') || b.textContent.includes('Chaser') || b.textContent.includes('Contact') || b.title?.includes('Chaser'));
    if (triggerBtn) triggerBtn.click();
  });
  await sleep(1000);
  await take('04_buyer_multichannel_chaser.png', 'Modal: Multi-Channel Outreach Dispatch & Voice Call Simulation');

  // Close modals
  await page.evaluate(() => {
    const closeBtns = Array.from(document.querySelectorAll('.modal-overlay button, .modal-content button'));
    closeBtns.forEach(b => b.click());
  });
  await sleep(600);

  // 3. Purchase Order Generation Modal from Quote Matrix
  await page.evaluate(() => {
    const matrixBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Matrix'));
    if (matrixBtn) matrixBtn.click();
  });
  await sleep(1000);

  await page.evaluate(() => {
    const poBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('APPROVE & GENERATE PO') || b.textContent.includes('APPROVE'));
    if (poBtn) poBtn.click();
  });
  await sleep(1000);
  await take('08_buyer_po_generation_modal.png', 'Modal: Formal Enterprise Purchase Order Dispatch with SHA-256 Stamp');

  console.log('Modals capture complete!');
  await browser.close();
}

captureModals().catch(console.error);

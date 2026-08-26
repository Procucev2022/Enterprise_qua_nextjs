const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const screenshotsDir = path.join(__dirname, '..', 'docs', 'screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureAll() {
  console.log('Starting full application screenshot capture...');

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
    console.log(`[Captured] ${filename} -> ${description}`);
  }

  // 1. Auth Page - Sign In Tab
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await sleep(600);
  await take('01_auth_signin.png', 'Authentication - Sign In Portal');

  // 2. Auth Page - Create Account Tab
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const registerBtn = buttons.find(b => b.textContent.includes('Create Account'));
    if (registerBtn) registerBtn.click();
  });
  await sleep(500);
  await take('02_auth_register.png', 'Authentication - Buyer Dual-OTP Registration');

  // 3. Login as Buyer
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const loginTab = buttons.find(b => b.textContent.includes('Sign In'));
    if (loginTab) loginTab.click();
  });
  await sleep(400);

  // Request OTP
  await page.evaluate(() => {
    const reqBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Request Login OTP'));
    if (reqBtn) reqBtn.click();
  });
  await sleep(600);

  // Extract OTP text displayed on screen, set value, and trigger React synthetic change + submit
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

  // ----------------------------------------------------
  // ROLE 1: BUYER SCREENS & MODALS
  // ----------------------------------------------------
  console.log('Capturing Buyer Screens...');

  // Screen 1.1: Buyer Command Center
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.1'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('03_buyer_command_center.png', 'Screen 1.1: Buyer Command Center & RFQ Management');

  // Modal 1: Multi-Channel Chaser
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.title?.includes('Auto-Chaser') || b.textContent.includes('Auto-Chaser') || b.textContent.includes('Launch Chaser') || b.textContent.includes('Launch Multi-Channel'));
    if (btn) btn.click();
  });
  await sleep(800);
  await take('04_buyer_multichannel_chaser.png', 'Modal: Multi-Channel Outreach Dispatch & Voice Call Simulation');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('.modal-content button') || document.querySelector('.modal-overlay button');
    if (closeBtn) closeBtn.click();
  });
  await sleep(500);

  // Modal 2: Follow-up Deep-Dive Matrix
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Deep Dive') || b.textContent.includes('Deep-Dive') || b.title?.includes('Deep-Dive') || b.textContent.includes('Analytics & Channels'));
    if (btn) btn.click();
  });
  await sleep(800);
  await take('05_buyer_followup_deepdive.png', 'Modal: RFQ Follow-Up Deep-Dive Matrix (Calls, WhatsApp, SMS, 24h Reminders)');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('.modal-content button') || document.querySelector('.modal-overlay button');
    if (closeBtn) closeBtn.click();
  });
  await sleep(500);

  // Screen 1.2: AI Ingestion & Mode Wizard
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.2'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('06_buyer_ingestion_wizard.png', 'Screen 1.2: AI Ingestion & Sourcing Mode Wizard (Modes 1, 2, 3)');

  // Screen 1.3 View: Comparative Quote Evaluation Matrix
  await page.evaluate(() => {
    const cmdBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.1'));
    if (cmdBtn) cmdBtn.click();
  });
  await sleep(800);
  await page.evaluate(() => {
    const matrixBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Matrix') || b.textContent.includes('Evaluate Quotes'));
    if (matrixBtn) matrixBtn.click();
  });
  await sleep(1200);
  await take('07_buyer_quote_matrix.png', 'Interactive View: Comparative Quote Evaluation Matrix');

  // Modal 3: Purchase Order Generation Modal
  await page.evaluate(() => {
    const poBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Generate & Approve PO') || b.textContent.includes('Generate PO') || b.textContent.includes('Award Contract') || b.textContent.includes('Select Vendor'));
    if (poBtn) poBtn.click();
  });
  await sleep(800);
  await take('08_buyer_po_generation_modal.png', 'Modal: Formal Enterprise Purchase Order Dispatch with SHA-256 Stamp');

  // Close PO modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('.modal-content button') || document.querySelector('.modal-overlay button');
    if (closeBtn) closeBtn.click();
  });
  await sleep(500);

  // Screen 1.3: Mode 3 Vendor Evaluation Summary
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.3'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('09_buyer_vendor_evaluation_mode3.png', 'Screen 1.3: Mode 3 Vendor Evaluation Summary (6 Pillars M1-M6 Radar)');

  // Screen 1.4: Vendor Directory & Evaluations
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.4'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('10_buyer_vendor_directory.png', 'Screen 1.4: Vendor Directory & Evaluation Records');

  // Screen 1.5: Sourcing Subscriptions
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.5'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('11_buyer_subscription_center.png', 'Screen 1.5: Sourcing Subscription Plans & Quotas');

  // Screen 1.6: Buyer Profile & Scope
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 1.6'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('12_buyer_profile_scope.png', 'Screen 1.6: Buyer Profile & Procurement Scope');

  // ----------------------------------------------------
  // ROLE 2: CATEGORY MANAGER SCREENS
  // ----------------------------------------------------
  console.log('Capturing Category Manager Screens...');
  await page.evaluate(() => {
    const catBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('2. Category Manager'));
    if (catBtn) catBtn.click();
  });
  await sleep(1000);

  // Screen 2.1: Operational Monitoring Kanban
  await take('13_cat_manager_kanban.png', 'Screen 2.1: Operational Monitoring Kanban');

  // Screen 2.2: Spend & Performance Analytics
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 2.2'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('14_cat_manager_spend_analytics.png', 'Screen 2.2: Spend & Performance Analytics Dashboard');

  // Screen 2.3: Buyer Console
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 2.3'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('15_cat_manager_buyer_console.png', 'Screen 2.3: Buyer Console & RFQ Overview');

  // Screen 2.4: Mode 3 Vendor Survey Evaluation
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 2.4'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('16_cat_manager_vendor_evaluation.png', 'Screen 2.4: Mode 3 Vendor Survey Evaluation Audit');

  // Screen 2.5: Vendor Console
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 2.5'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('17_cat_manager_vendor_console.png', 'Screen 2.5: Vendor Performance & Analytics Console');

  // Screen 2.6: Categories Summary & Trends
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 2.6'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('18_cat_manager_categories_summary.png', 'Screen 2.6: Categories Summary & Spend Trends');

  // ----------------------------------------------------
  // ROLE 3: VENDOR SCREENS
  // ----------------------------------------------------
  console.log('Capturing Vendor Screens...');
  await page.evaluate(() => {
    const vendorBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('3. Vendor'));
    if (vendorBtn) vendorBtn.click();
  });
  await sleep(1000);

  // Screen 3.1: Vendor Workspace & Opportunity Feed
  await take('19_vendor_opportunity_feed.png', 'Screen 3.1: Vendor Workspace & Opportunity Feed');

  // Screen 3.2: Submitted Bids & Quotation Form
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 3.2'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('20_vendor_quotation_form.png', 'Screen 3.2: Quotation Submission & Bid Entry');

  // Screen 3.3: Mode 3 Qualification Survey
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 3.3'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('21_vendor_qualification_survey.png', 'Screen 3.3: Mode 3 Qualification Survey (6 Pillars M1-M6)');

  // Screen 3.4: Item Catalogue
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 3.4'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('22_vendor_item_catalogue.png', 'Screen 3.4: Item Catalogue Repository');

  // Screen 3.5: Vendor Subscription Plans
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 3.5'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('23_vendor_subscription_plans.png', 'Screen 3.5: Vendor Subscription Plans');

  // Screen 3.6: Vendor Profile & Scope
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 3.6'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('24_vendor_profile_scope.png', 'Screen 3.6: Vendor Profile & Scope');

  // ----------------------------------------------------
  // ROLE 4: ADMIN & AUDITOR SCREENS
  // ----------------------------------------------------
  console.log('Capturing Admin Screens...');
  await page.evaluate(() => {
    const adminBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('4. Admin'));
    if (adminBtn) adminBtn.click();
  });
  await sleep(1000);

  // Screen 4.1: Azure Infrastructure & AI Settings
  await take('25_admin_infra_control.png', 'Screen 4.1: Azure Infrastructure & AI Settings');

  // Screen 4.2: Immutable Compliance Audit Log
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Screen 4.2'));
    if (btn) btn.click();
  });
  await sleep(1000);
  await take('26_admin_audit_log.png', 'Screen 4.2: Immutable Compliance Audit Log (SHA-256 Stamp)');

  // ----------------------------------------------------
  // GLOBAL DRAWERS & WIDGETS
  // ----------------------------------------------------
  console.log('Capturing Global Widgets...');
  // Global AI Bot Feed Drawer
  await page.evaluate(() => {
    const feedBtn = document.querySelector('button[title*="Live AI Bot Feed"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('AI Bot Feed') || b.textContent.includes('Live AI Stream') || b.querySelector('.live-dot'));
    if (feedBtn) feedBtn.click();
  });
  await sleep(800);
  await take('27_global_ai_bot_feed.png', 'Header: Autonomous AI Bot Activity Feed Drawer');

  // Close AI Feed Drawer
  await page.evaluate(() => {
    const closeBtn = document.querySelector('[class*="drawer"] button') || document.querySelector('aside button');
    if (closeBtn) closeBtn.click();
  });
  await sleep(500);

  // Global Support Chat Widget
  await page.evaluate(() => {
    const chatBtn = document.querySelector('button[title*="Support"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Need Support?') || b.textContent.includes('Support'));
    if (chatBtn) chatBtn.click();
  });
  await sleep(800);
  await take('28_global_support_chat.png', 'Global: Embedded AI Support Chat Widget');

  console.log('All 28 Platform Screenshots Captured Successfully!');
  await browser.close();
}

captureAll().catch(console.error);

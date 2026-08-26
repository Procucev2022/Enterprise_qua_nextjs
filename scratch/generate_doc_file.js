const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ImageRun,
  Header,
  Footer,
  PageNumber,
  ShadingType,
  PageBreak,
} = require('docx');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
const OUTPUT_DOCX_PATH = path.join(__dirname, '..', 'Procucev_Enterprise_Platform_Documentation.docx');
const OUTPUT_MD_PATH = path.join(__dirname, '..', 'SYSTEM_DOCUMENTATION.md');

// Colors
const COLOR_PRIMARY = '074193'; // Procucev Navy
const COLOR_ORANGE = 'FF4800';  // Procucev Orange
const COLOR_CYAN = '00DBFF';    // Procucev Cyan
const COLOR_DARK = '0F172A';    // Slate 900
const COLOR_TEXT = '334155';    // Slate 700
const COLOR_MUTED = '64748B';   // Slate 500
const COLOR_BG_LIGHT = 'F8FAFC'; // Slate 50
const COLOR_BORDER = 'CBD5E1';  // Slate 300

function createHeaderP(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    text: text,
    heading: level,
    spacing: { before: 280, after: 120 },
  });
}

function createSubheaderP(text) {
  return new Paragraph({
    text: text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 100 },
  });
}

function createBodyP(text, isBold = false) {
  return new Paragraph({
    spacing: { before: 60, after: 100, line: 276 },
    children: [
      new TextRun({
        text: text,
        font: 'Segoe UI',
        size: 21, // 10.5 pt
        color: COLOR_TEXT,
        bold: isBold,
      }),
    ],
  });
}

function createCallout(title, text) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      left: { style: BorderStyle.SINGLE, size: 24, color: COLOR_PRIMARY },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  new TextRun({
                    text: `📌 ${title}`,
                    bold: true,
                    font: 'Segoe UI',
                    size: 21,
                    color: COLOR_PRIMARY,
                  }),
                ],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: text,
                    font: 'Segoe UI',
                    size: 20,
                    color: COLOR_TEXT,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function createImageBlock(filename, caption, description) {
  const filePath = path.join(SCREENSHOTS_DIR, filename);
  const elements = [];

  if (fs.existsSync(filePath)) {
    const imgData = fs.readFileSync(filePath);
    elements.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 180, after: 80 },
        children: [
          new ImageRun({
            data: imgData,
            transformation: {
              width: 580,
              height: 362,
            },
          }),
        ],
      })
    );
  }

  elements.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 40, after: 80 },
      children: [
        new TextRun({
          text: `Figure: ${caption}`,
          italics: true,
          bold: true,
          font: 'Segoe UI',
          size: 19,
          color: COLOR_MUTED,
        }),
      ],
    })
  );

  if (description) {
    elements.push(
      new Paragraph({
        spacing: { before: 40, after: 160, line: 260 },
        children: [
          new TextRun({
            text: `Screen Highlights: `,
            bold: true,
            font: 'Segoe UI',
            size: 20,
            color: COLOR_PRIMARY,
          }),
          new TextRun({
            text: description,
            font: 'Segoe UI',
            size: 20,
            color: COLOR_TEXT,
          }),
        ],
      })
    );
  }

  return elements;
}

function createTable(headers, rowsData) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          shading: { fill: COLOR_PRIMARY, type: ShadingType.CLEAR },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: h,
                  bold: true,
                  font: 'Segoe UI',
                  size: 20,
                  color: 'FFFFFF',
                }),
              ],
            }),
          ],
        })
    ),
  });

  const contentRows = rowsData.map((row, idx) => {
    const isEven = idx % 2 === 0;
    return new TableRow({
      children: row.map(
        (cell) =>
          new TableCell({
            shading: {
              fill: isEven ? 'FFFFFF' : COLOR_BG_LIGHT,
              type: ShadingType.CLEAR,
            },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
              left: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
              right: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
            },
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cell,
                    font: 'Segoe UI',
                    size: 19,
                    color: COLOR_TEXT,
                  }),
                ],
              }),
            ],
          })
      ),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    spacing: { after: 180 },
    rows: [headerRow, ...contentRows],
  });
}

async function buildDocx() {
  console.log('Generating Procucev Enterprise Platform Documentation (.docx)...');

  const children = [
    // --- COVER / TITLE PAGE ---
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 120 },
      children: [
        new TextRun({
          text: 'PROCUCEV ENTERPRISE',
          bold: true,
          font: 'Segoe UI',
          size: 54, // 27 pt
          color: COLOR_PRIMARY,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240 },
      children: [
        new TextRun({
          text: 'QUA AI 2.0 SOURCING & PROCUREMENT PLATFORM',
          bold: true,
          font: 'Segoe UI',
          size: 32, // 16 pt
          color: COLOR_ORANGE,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 400 },
      children: [
        new TextRun({
          text: 'Complete System Architecture, Multi-Persona Workflows, Autonomous Chasing & Technical Operations Manual',
          italics: true,
          font: 'Segoe UI',
          size: 24,
          color: COLOR_MUTED,
        }),
      ],
    }),

    // Cover Page Meta Table
    createTable(
      ['Document Property', 'Specification / Value'],
      [
        ['System Release', 'Procucev Enterprise Production Release 2.0 (August 2026)'],
        ['Platform Core', 'QUA AI Autonomous Sourcing & Multi-Channel Logistics Engine'],
        ['Primary Sourcing Modes', 'Mode 1 (Private Roster), Mode 2 (Hybrid Network), Mode 3 (360° Qualification)'],
        ['Security & Integrity', 'Dual OTP MFA, Azure SSO, SHA-256 Cryptographic Audit Stamping'],
        ['Target Audience', 'Enterprise Buyers, Category Managers, Vendor Partners, Platform Administrators & Auditors'],
        ['Document Classification', 'Enterprise Confidential — Technical & Operational Reference Manual'],
      ]
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- EXECUTIVE SUMMARY ---
    createHeaderP('1. Executive Summary & Platform Overview'),
    createBodyP(
      'Procucev Enterprise (powered by QUA AI 2.0) is a next-generation autonomous procurement, sourcing intelligence, and multi-channel supplier coordination platform. Designed specifically for heavy engineering, industrial infrastructure, EPC, and manufacturing procurement, Procucev solves the critical friction points of modern enterprise buying: manual vendor chasing, delayed quotation turnarounds, inconsistent supplier qualification, and fragmented audit trails.'
    ),
    createCallout(
      'Key Business Value Proposition',
      'By orchestrating autonomous multi-channel AI agents (Voice Calls with live transcripts, WhatsApp Business bots, SMS Direct alerts, and 24-hour escalation emails), Procucev reduces quote acquisition cycles by over 65%, eliminates vendor non-response, and guarantees 100% cryptographic audit compliance across every transaction.'
    ),
    createSubheaderP('1.1 The Three Core Sourcing Operating Modes'),
    createBodyP(
      'Procucev provides three distinct, selectable sourcing modes tailored to organizational risk tolerance and market discovery needs:'
    ),
    createTable(
      ['Sourcing Mode', 'Target Use Case', 'Vendor Selection Mechanism', 'Verification Level'],
      [
        [
          'Mode 1: Private Approved Roster',
          'Strict compliance, single-source procurement, or proprietary internal contracts.',
          'Exclusive dispatch to pre-approved internal vendor master list. Zero marketplace exposure.',
          'Internal roster compliance with pre-negotiated commercial payment terms.',
        ],
        [
          'Mode 2: Hybrid Sourced Pool',
          'Standard competitive procurement balancing familiar suppliers with price discovery.',
          'Dispatches to client roster suppliers + AI recommended suppliers matching BOQ parameters.',
          'AI quality score benchmarking, lead time validation, and real-time bid comparison.',
        ],
        [
          'Mode 3: 360° Vendor Qualification',
          'High-stakes capital equipment, specialized manufacturing, or critical vendor onboarding.',
          'Full-scale evaluation across 6 comprehensive pillars (M1-M6) and 24 criteria with OCR verification.',
          'Mandatory 24/24 document audit (NABL lab certs, ISO, financial statements, BCP plans).',
        ],
      ]
    ),

    createHeaderP('2. Platform Architecture & Technology Stack'),
    createBodyP(
      'Procucev Enterprise is engineered on a modern, high-throughput, microservices-ready full-stack architecture designed for enterprise scalability, sub-second reactivity, and military-grade data protection.'
    ),
    createTable(
      ['Architecture Layer', 'Technology Implementation', 'Key Capabilities & Guarantees'],
      [
        ['Frontend Application', 'Next.js 14 App Router, React 18, Tailwind CSS, Lucide Icons', 'Sub-second page transitions, dynamic light/dark theming, responsive glassmorphic UI.'],
        ['State & Data Layer', 'React Context Engine (`lib/store.tsx`), TypeScript Types (`lib/types.ts`)', 'Centralized immutable state management, real-time telemetry updates, audit log persistence.'],
        ['AI Sourcing Core', 'Hybrid LLM Engine (Local Ollama Mistral / Llama 3 & Azure OpenAI GPT-4o)', 'Autonomous BOQ entity extraction, parametric bid normalization, real-time phone dialog synthesis.'],
        ['Multi-Channel Engine', 'Twilio Voice AI, WhatsApp Business API, SMS DLT Gateway, NodeMailer SMTP', 'Autonomous follow-ups across 4 communication channels with 24-hour automated escalation rules.'],
        ['Cryptographic Security', 'SHA-256 Digital Hashing Engine', 'Every generated Purchase Order and audit entry receives an immutable cryptographic hash stamp.'],
      ]
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- AUTHENTICATION & SECURITY ---
    createHeaderP('3. Authentication, Registration & RBAC Governance'),
    createBodyP(
      'Access to Procucev Enterprise is strictly governed by enterprise-grade identity management featuring Dual-Factor OTP verification and Single Sign-On (SSO) integration.'
    ),
    ...createImageBlock(
      '01_auth_signin.png',
      'Sign In Authentication Portal with Dual OTP and Role Quick-Selectors',
      'Features role-specific access gates for Buyer (L&T), Category Manager, Vendor (Apex Supplies), and Platform Auditor with simulated OTP verification and Azure AD SSO login.'
    ),
    createSubheaderP('3.1 Buyer & Vendor Self-Serve Registration'),
    createBodyP(
      'New enterprise buyers and supplier organizations register through a streamlined dual-verification onboarding gate requiring real-time email verification codes and mobile SMS OTP.'
    ),
    ...createImageBlock(
      '02_auth_register.png',
      'Enterprise Registration Portal with Dual Verification Engine',
      'Validates organization domain, GSTIN/Tax ID, procurement category scope, and enforces dual-channel mobile and email verification before account provisioning.'
    ),
    createSubheaderP('3.2 Role-Based Access Control (RBAC) Permissions Matrix'),
    createTable(
      ['Role Persona', 'Primary Responsibilities', 'Accessible Modules & Screens', 'Security Clearance'],
      [
        ['Enterprise Buyer', 'RFQ creation, AI BOQ parsing, quote comparison matrix, PO authorization.', 'Screens 1.1 through 1.6 + Matrix, Deep Dive & PO Dispatch Modals.', 'Level 3 — Enterprise Procurement Scope.'],
        ['Category Manager', 'Category pipeline governance, multi-channel overrides, vendor survey audit.', 'Screens 2.1 through 2.6 + Global Chaser Controls & Audit Dashboards.', 'Level 4 — Strategic Sourcing & Governance.'],
        ['Vendor Partner', 'Opportunity bidding, quotation submission, Mode 3 qualification survey.', 'Screens 3.1 through 3.6 + Item Catalogue & Subscription Plans.', 'Level 2 — Supplier Partner Extranet.'],
        ['Admin & Auditor', 'AI model infrastructure control, OCR threshold tuning, immutable audit logs.', 'Screens 4.1 through 4.2 + Global Config & Cryptographic Verification.', 'Level 5 — Super Administrator & Compliance.'],
      ]
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- BUYER ECOSYSTEM ---
    createHeaderP('4. Enterprise Buyer Ecosystem (Module 1)'),
    createBodyP(
      'The Buyer Ecosystem empowers procurement professionals to manage the entire sourcing lifecycle: from automated document parsing to multi-channel chasing, quote matrix evaluation, and 1-click PO issuance.'
    ),
    createSubheaderP('4.1 Screen 1.1: Buyer Command Center'),
    createBodyP(
      'The central dashboard provides real-time visibility into active procurement pipelines, pending vendor quotes, AI sourcing quotas, and live autonomous follow-up telemetry streams.'
    ),
    ...createImageBlock(
      '03_buyer_command_center.png',
      'Screen 1.1: Buyer Command Center Dashboard',
      'Highlights include active RFQs categorized by sourcing mode, real-time counter metrics (Calls, WhatsApp, SMS, 24h Emails), and live AI follow-up event stream.'
    ),
    createSubheaderP('4.2 Multi-Channel Autonomous Auto-Chaser Engine'),
    createBodyP(
      'When suppliers delay their quotations, Procucev dispatches autonomous multi-channel AI agents across phone calls, WhatsApp messages, and SMS alerts.'
    ),
    ...createImageBlock(
      '04_buyer_multichannel_chaser.png',
      'Autonomous Multi-Channel Chaser Dispatch Modal',
      'Enables direct AI Voice Call dispatch with conversational script generation, WhatsApp interactive prompts with 1-click bid links, and carrier-priority SMS alerts.'
    ),
    createSubheaderP('4.3 RFQ Follow-Up Telemetry & 4-Channel Deep-Dive Matrix'),
    createBodyP(
      'Clicking any active RFQ opens a comprehensive follow-up telemetry matrix revealing exact engagement timestamps, call durations, audio transcripts, and 24-hour escalation countdowns.'
    ),
    ...createImageBlock(
      '05_buyer_followup_deepdive.png',
      'RFQ Follow-Up Telemetry & 4-Channel Deep-Dive Modal',
      'Displays individual supplier engagement status across AI Voice Bot, WhatsApp Chaser, SMS Direct, and the automated 24-hour next-day email escalation trigger.'
    ),
    createSubheaderP('4.4 Screen 1.2: AI Ingestion & Sourcing Mode Wizard'),
    createBodyP(
      'Buyers can upload unstructured PDF, Excel, or CAD Bill of Quantities (BOQ). The integrated OCR engine automatically extracts line items, quantities, and technical specifications, routing them through Mode 1, Mode 2, or Mode 3.'
    ),
    ...createImageBlock(
      '06_buyer_ingestion_wizard.png',
      'Screen 1.2: AI Ingestion & Sourcing Mode Dispatch Wizard',
      'Demonstrates drag-and-drop BOQ ingestion, OCR entity confidence scores (98.4%), category classification, and one-click Sourcing Mode 1/2/3 selection.'
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    createSubheaderP('4.5 Comparative Quote Evaluation Matrix'),
    createBodyP(
      'Once vendor bids are submitted, QUA AI normalizes commercial terms, prices, lead times, warranties, and compliance ratings into a side-by-side parametric matrix.'
    ),
    ...createImageBlock(
      '07_buyer_quote_matrix.png',
      'Comparative Quote Evaluation Matrix (Screen 1.3)',
      'Side-by-side parametric comparison displaying unit prices, lead times, AI Quality/Match scores (96% preferred), warranty compliance, and the 1-click PO dispatch trigger.'
    ),
    createSubheaderP('4.6 Enterprise Purchase Order Generation & Cryptographic Seal'),
    createBodyP(
      'Approving a supplier bid generates a formal enterprise Purchase Order contract stamped with a SHA-256 cryptographic audit seal for ERP synchronization (SAP / Oracle).'
    ),
    ...createImageBlock(
      '08_buyer_po_generation_modal.png',
      'Enterprise Purchase Order Generation & Dispatch Modal',
      'Shows official PO structure, line item financial summaries, executive approval notes, and the cryptographic SHA-256 digital audit stamp.'
    ),
    createSubheaderP('4.7 Screen 1.3: Mode 3 360-Degree Vendor Evaluation Summary'),
    createBodyP(
      'For complex sourcing, Mode 3 audits suppliers across 6 evaluation pillars (M1 Commercial, M2 Technical, M3 Quality & Warranty, M4 Operational Delivery, M5 Financial Stability, M6 Governance & ESG) and 24 mandatory document attachments.'
    ),
    ...createImageBlock(
      '09_buyer_vendor_evaluation_mode3.png',
      'Screen 1.3: Mode 3 360-Degree Vendor Evaluation Summary Report',
      'Detailed audit view showing 95% AI Rating Score, Preferred Enterprise Supplier certification, 24/24 attachment verification, and weighted criterion scores.'
    ),
    createSubheaderP('4.8 Screen 1.4: Vendor Directory & Master Records'),
    createBodyP(
      'A searchable master repository of pre-qualified and active vendor partners with performance ratings, spend histories, and quick RFQ dispatch controls.'
    ),
    ...createImageBlock(
      '10_buyer_vendor_directory.png',
      'Screen 1.4: Vendor Directory & Master Records',
      'Comprehensive supplier cards featuring category tags, performance metrics, compliance badges, and direct contact options.'
    ),
    createSubheaderP('4.9 Screen 1.5: Buyer Sourcing Subscriptions & Quota Plans'),
    createBodyP(
      'Manages enterprise RFQ usage allowances across Sourcing Mode 1 (Free Trial), Mode 2 (Enterprise Hybrid), and Mode 3 (360° Unlimited) with self-serve upgrades.'
    ),
    ...createImageBlock(
      '11_buyer_subscription_center.png',
      'Screen 1.5: Buyer Sourcing Subscriptions & Quotas',
      'Subscription overview illustrating plan features, quota consumption meters, and seamless upgrade triggers.'
    ),
    createSubheaderP('4.10 Screen 1.6: Buyer Profile & Procurement Scope'),
    createBodyP(
      'Enterprise profile settings configuring buyer organization credentials, ERP connection parameters, delivery hub addresses, and default commercial terms.'
    ),
    ...createImageBlock(
      '12_buyer_profile_scope.png',
      'Screen 1.6: Buyer Profile & Procurement Scope Settings',
      'Company governance profile, tax IDs, shipping locations, and enterprise ERP integration configurations.'
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- CATEGORY MANAGER ECOSYSTEM ---
    createHeaderP('5. Category Manager Governance Ecosystem (Module 2)'),
    createBodyP(
      'Category Managers oversee cross-organizational spend, monitor live chasing pipelines, conduct Mode 3 vendor survey audits, and track supplier performance benchmarks.'
    ),
    createSubheaderP('5.1 Screen 2.1: Operational Monitoring Kanban & Chasing Control'),
    createBodyP(
      'A 3-column operational Kanban board categorizing RFQs across Ingested/Parsing, Quotes Pending/AI Follow-Up, and AI Evaluation & Scored with managerial override actions.'
    ),
    ...createImageBlock(
      '13_cat_manager_kanban.png',
      'Screen 2.1: Operational Monitoring Kanban Dashboard',
      'Displays live RFQ cards, channel dispatch buttons (Call, WA, SMS, 24h Email), overdue escalation badges, and global batch chaser controls.'
    ),
    createSubheaderP('5.2 Screen 2.2: Spend & Performance Analytics Dashboard'),
    createBodyP(
      'Deep visual analytics tracking total spend ($1.24M+), mode distribution, cost savings benchmarks (14.8% average savings), and on-time response rates.'
    ),
    ...createImageBlock(
      '14_cat_manager_spend_analytics.png',
      'Screen 2.2: Spend & Performance Analytics Dashboard',
      'Features monthly spend trajectory charts, savings by category breakdowns, and AI vs. manual procurement cycle time comparisons.'
    ),
    createSubheaderP('5.3 Screen 2.3: Buyer Console & RFQ Summary'),
    createBodyP(
      'Provides category managers with a holistic summary of all internal buyer procurement activities, active requisitions, and departmental throughput.'
    ),
    ...createImageBlock(
      '15_cat_manager_buyer_console.png',
      'Screen 2.3: Buyer Console & RFQ Summary',
      'Centralized buyer activity table with status filtering, department tagging, and requisition auditing.'
    ),
    createSubheaderP('5.4 Screen 2.4: Mode 3 Vendor Survey Evaluation Audit'),
    createBodyP(
      'An auditing interface enabling Category Managers to inspect vendor qualification surveys, verify OCR extracted attachments, and approve score overrides.'
    ),
    ...createImageBlock(
      '16_cat_manager_vendor_evaluation.png',
      'Screen 2.4: Mode 3 Vendor Survey Evaluation & Document Audit',
      'Line-by-line audit view of 24 qualification criteria with attachment previews, OCR confidence scores, and compliance sign-offs.'
    ),
    createSubheaderP('5.5 Screen 2.5: Vendor Performance & Scorecard Analytics Console'),
    createBodyP(
      'Comprehensive supplier scorecards tracking historical On-Time Delivery (OTIF), Defect Parts Per Million (PPM), bid competitiveness, and ESG ratings.'
    ),
    ...createImageBlock(
      '17_cat_manager_vendor_console.png',
      'Screen 2.5: Vendor Performance & Scorecard Console',
      'Multi-metric vendor evaluation cards with historical quality radar graphs and supplier tiering badges.'
    ),
    createSubheaderP('5.6 Screen 2.6: Category Taxonomy & Spend Trends'),
    createBodyP(
      'Hierarchical category management interface for mapping procurement taxonomies, managing spend caps, and defining preferred vendor rosters per category.'
    ),
    ...createImageBlock(
      '18_cat_manager_categories_summary.png',
      'Screen 2.6: Category Taxonomy & Spend Trends',
      'Category hierarchy trees with spend allocations, budget variance trackers, and automated category rule builders.'
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- VENDOR ECOSYSTEM ---
    createHeaderP('6. Vendor Partner Ecosystem (Module 3)'),
    createBodyP(
      'Suppliers access Procucev through a dedicated vendor portal to discover RFQ opportunities, submit itemized quotations, complete Mode 3 audits, and manage catalogues.'
    ),
    createSubheaderP('6.1 Screen 3.1: Vendor Workspace & Opportunity Feed'),
    createBodyP(
      'A real-time opportunity dashboard segregating Direct Invited RFQs (from client rosters) and Marketplace Sourcing Leads with urgent submission timers.'
    ),
    ...createImageBlock(
      '19_vendor_opportunity_feed.png',
      'Screen 3.1: Vendor Opportunity Feed Dashboard',
      'Displays active RFQ leads with estimated budgets, delivery deadlines, buyer profiles, and one-click quote submission triggers.'
    ),
    createSubheaderP('6.2 Screen 3.2: Quotation Submission & Bid Entry Form'),
    createBodyP(
      'An intuitive bid form where suppliers enter unit rates, lead times, tax breakdowns, delivery terms, and upload technical data sheets.'
    ),
    ...createImageBlock(
      '20_vendor_quotation_form.png',
      'Screen 3.2: Quotation Submission & Bid Entry Form',
      'Line-item pricing inputs with real-time tax calculation, total bid computation, and technical compliance confirmation.'
    ),
    createSubheaderP('6.3 Screen 3.3: Mode 3 24-Criteria Vendor Qualification Survey'),
    createBodyP(
      'Suppliers complete self-service Mode 3 qualification across 6 pillars, attaching mandatory certificates (ISO, NABL, audited financials, ESG policies) verified via AI OCR.'
    ),
    ...createImageBlock(
      '21_vendor_qualification_survey.png',
      'Screen 3.3: Mode 3 24-Criteria Vendor Qualification Survey',
      'Pillar-based survey navigation with drag-and-drop document uploaders and instant OCR validation indicators.'
    ),
    createSubheaderP('6.4 Screen 3.4: Item Catalogue Repository'),
    createBodyP(
      'A digital catalogue repository allowing suppliers to publish product specifications, standard pricing, and inventory availability for automated buyer discovery.'
    ),
    ...createImageBlock(
      '22_vendor_item_catalogue.png',
      'Screen 3.4: Vendor Item Catalogue Repository',
      'Product grid showcasing item codes, technical specs, standard unit rates, and bulk tiered pricing tiers.'
    ),
    createSubheaderP('6.5 Screen 3.5: Vendor Tiered Subscriptions'),
    createBodyP(
      'Suppliers choose from tiered membership plans (Select, Connect, Premium) to expand marketplace bidding access, receive priority AI matching, and obtain verified vendor badges.'
    ),
    ...createImageBlock(
      '23_vendor_subscription_plans.png',
      'Screen 3.5: Vendor Subscription Plans',
      'Tiered pricing packages detailing feature matrix, RFQ response allowances, and verified supplier certifications.'
    ),
    createSubheaderP('6.6 Screen 3.6: Vendor Profile & Manufacturing Scope'),
    createBodyP(
      'Maintains supplier factory locations, manufacturing machinery capabilities, quality accreditations, and primary commercial contact information.'
    ),
    ...createImageBlock(
      '24_vendor_profile_scope.png',
      'Screen 3.6: Vendor Profile & Manufacturing Scope',
      'Factory capacity details, machinery inventory, geographic delivery reach, and verified contact profiles.'
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- ADMIN & GOVERNANCE ---
    createHeaderP('7. Platform Administration & Compliance Governance (Module 4)'),
    createBodyP(
      'System administrators and compliance officers configure AI models, tune OCR extraction thresholds, and audit immutable transaction logs.'
    ),
    createSubheaderP('7.1 Screen 4.1: Azure Infrastructure & AI Model Orchestration'),
    createBodyP(
      'Configures AI inference backends (switching between local Ollama Mistral/Llama 3 and Azure OpenAI GPT-4o), OCR confidence thresholds, and multi-channel API credentials.'
    ),
    ...createImageBlock(
      '25_admin_infra_control.png',
      'Screen 4.1: Azure Infrastructure & AI Settings Console',
      'AI model selector, temperature controls, OCR confidence sliders, and multi-channel gateway health monitors.'
    ),
    createSubheaderP('7.2 Screen 4.2: Immutable Compliance Audit Log & Cryptographic Verification'),
    createBodyP(
      'A tamper-proof compliance ledger recording all system events, approvals, overrides, and RFQ dispatches with SHA-256 cryptographic verification.'
    ),
    ...createImageBlock(
      '26_admin_audit_log.png',
      'Screen 4.2: Immutable Compliance Audit Log Console',
      'Cryptographically verified event stream with event hashes, user timestamps, severity filters, and CSV/PDF export options.'
    ),

    // --- GLOBAL FEATURES ---
    createHeaderP('8. Global Intelligence & Autonomous Features'),
    createBodyP(
      'Procucev embeds continuous background intelligence accessible across all roles through real-time bot feeds and conversational AI assistants.'
    ),
    createSubheaderP('8.1 Autonomous AI Bot Activity Feed Drawer'),
    createBodyP(
      'A persistent slide-out feed streaming real-time autonomous agent actions: phone calls completed, WhatsApp read receipts, OCR extraction completions, and PO dispatches.'
    ),
    ...createImageBlock(
      '27_global_ai_bot_feed.png',
      'Autonomous AI Bot Activity Feed Drawer',
      'Real-time streaming drawer displaying live autonomous multi-channel agent execution logs and timestamps.'
    ),
    createSubheaderP('8.2 Interactive AI Support Chat Assistant'),
    createBodyP(
      'An embedded conversational assistant capable of answering procurement queries, navigating sourcing modes, explaining score calculations, and assisting RFQ creation.'
    ),
    ...createImageBlock(
      '28_global_support_chat.png',
      'Interactive AI Support Chat Widget',
      'Context-aware conversational assistant providing instant guidance, workflow shortcuts, and technical procurement help.'
    ),

    new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [new PageBreak()],
    }),

    // --- INTEGRATION & SUMMARY ---
    createHeaderP('9. Enterprise Integration & Compliance Standards'),
    createBodyP(
      'Procucev Enterprise connects seamlessly with existing ERP, SCM, and financial management suites through RESTful APIs and webhook notifications.'
    ),
    createTable(
      ['Integration Interface', 'Protocol / Format', 'Target Enterprise System', 'Data Exchange Scope'],
      [
        ['ERP Ingestion API', 'RESTful JSON / OData', 'SAP S/4HANA, SAP Ariba, Oracle ERP Cloud', 'Purchase Requisitions (PR) import, PO export, and vendor sync.'],
        ['Vendor Master Sync', 'OAuth 2.0 Webhook', 'Internal Master Data Management (MDM)', 'Mode 3 vendor qualification status and NABL document records.'],
        ['Multi-Channel Gateways', 'Encrypted TLS 1.3 REST', 'Twilio Voice, WhatsApp Business Cloud, Airtel DLT', 'Voice audio transcripts, WhatsApp interactive payloads, SMS alerts.'],
        ['Compliance Export', 'Cryptographic JSON / PDF', 'Enterprise SIEM & SOC Auditing Systems', 'Tamper-evident audit logs stamped with SHA-256 hash chains.'],
      ]
    ),
    createCallout(
      'Enterprise Compliance & Security Certifications',
      'Procucev Enterprise meets ISO/IEC 27001:2022 standards for Information Security Management, SOC 2 Type II operational compliance, GDPR Article 32 data pseudonymization requirements, and TRAI DLT commercial communication mandates.'
    ),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Segoe UI',
            size: 21,
            color: COLOR_TEXT,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              bottom: 1440,
              left: 1440,
              right: 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'PROCUCEV ENTERPRISE — QUA AI 2.0 PLATFORM DOCUMENTATION',
                    font: 'Segoe UI',
                    size: 16,
                    color: COLOR_MUTED,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.SPACE_BETWEEN,
                children: [
                  new TextRun({
                    text: 'Confidential & Proprietary — Procucev Enterprise Solutions',
                    font: 'Segoe UI',
                    size: 16,
                    color: COLOR_MUTED,
                  }),
                  new TextRun({
                    text: ' | Page ',
                    font: 'Segoe UI',
                    size: 16,
                    color: COLOR_MUTED,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: 'Segoe UI',
                    size: 16,
                    color: COLOR_PRIMARY,
                    bold: true,
                  }),
                  new TextRun({
                    text: ' of ',
                    font: 'Segoe UI',
                    size: 16,
                    color: COLOR_MUTED,
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    font: 'Segoe UI',
                    size: 16,
                    color: COLOR_MUTED,
                  }),
                ],
              }),
            ],
          }),
        },
        children: children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUTPUT_DOCX_PATH, buffer);
  console.log(`Document successfully saved to: ${OUTPUT_DOCX_PATH}`);
}

buildDocx().catch(console.error);

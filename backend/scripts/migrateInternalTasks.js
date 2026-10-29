const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const pool = require('../src/db/pool');

async function migrateInternalTasks() {
  console.log('[migrateInternalTasks] Ensuring internal task tables exist in database...');

  const ddl1 = `
  CREATE TABLE IF NOT EXISTS internal_task_types (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(64) UNIQUE NOT NULL,
    default_module VARCHAR(64) NOT NULL DEFAULT 'GENERAL',
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `;

  const ddl1_d1 = `
  CREATE TABLE IF NOT EXISTS internal_task_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    default_module TEXT NOT NULL DEFAULT 'GENERAL',
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `;

  const ddl2 = `
  CREATE TABLE IF NOT EXISTS internal_tasks (
    id VARCHAR(64) PRIMARY KEY,
    task_number VARCHAR(64) UNIQUE NOT NULL,
    title VARCHAR(512) NOT NULL,
    description TEXT,
    task_type_id VARCHAR(64),
    priority VARCHAR(32) NOT NULL DEFAULT 'Medium',
    status VARCHAR(32) NOT NULL DEFAULT 'Pending',
    assigned_to_user_id VARCHAR(64),
    assigned_to_name VARCHAR(255),
    assigned_team VARCHAR(100),
    created_by_user_id VARCHAR(64),
    created_by_name VARCHAR(255),
    due_date DATE,
    completed_at TIMESTAMPTZ,
    related_entity_type VARCHAR(64) NOT NULL DEFAULT 'GENERAL',
    related_entity_id VARCHAR(64),
    related_entity_label VARCHAR(512),
    notes TEXT,
    attachments JSONB,
    raw JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `;

  const ddl2_d1 = `
  CREATE TABLE IF NOT EXISTS internal_tasks (
    id TEXT PRIMARY KEY,
    task_number TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    task_type_id TEXT,
    priority TEXT NOT NULL DEFAULT 'Medium',
    status TEXT NOT NULL DEFAULT 'Pending',
    assigned_to_user_id TEXT,
    assigned_to_name TEXT,
    assigned_team TEXT,
    created_by_user_id TEXT,
    created_by_name TEXT,
    due_date TEXT,
    completed_at TEXT,
    related_entity_type TEXT NOT NULL DEFAULT 'GENERAL',
    related_entity_id TEXT,
    related_entity_label TEXT,
    notes TEXT,
    attachments TEXT,
    raw TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `;

  const ddl3 = `
  CREATE TABLE IF NOT EXISTS internal_task_activities (
    id VARCHAR(64) PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64),
    actor_name VARCHAR(255),
    from_value TEXT,
    to_value TEXT,
    comment TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `;

  const ddl3_d1 = `
  CREATE TABLE IF NOT EXISTS internal_task_activities (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    from_value TEXT,
    to_value TEXT,
    comment TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `;

  const indexes = [
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_status ON internal_tasks (status);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_status ON internal_tasks (status);' },
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_priority ON internal_tasks (priority);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_priority ON internal_tasks (priority);' },
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_related ON internal_tasks (related_entity_type, related_entity_id);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_related ON internal_tasks (related_entity_type, related_entity_id);' },
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_due_date ON internal_tasks (due_date);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_due_date ON internal_tasks (due_date);' },
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_assigned_to ON internal_tasks (assigned_to_user_id);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_assigned_to ON internal_tasks (assigned_to_user_id);' },
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_task_type ON internal_tasks (task_type_id);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_task_type ON internal_tasks (task_type_id);' },
    { pg: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_created_at ON internal_tasks (created_at DESC);', d1: 'CREATE INDEX IF NOT EXISTS idx_internal_tasks_created_at ON internal_tasks (created_at DESC);' },
  ];

  await pool.query(ddl1, [], { d1: true, d1Text: ddl1_d1 });
  await pool.query(ddl2, [], { d1: true, d1Text: ddl2_d1 });
  await pool.query(ddl3, [], { d1: true, d1Text: ddl3_d1 });

  for (const idx of indexes) {
    await pool.query(idx.pg, [], { d1: true, d1Text: idx.d1 });
  }

  // Seed default dynamic task types if none exist
  const countRes = await pool.query('SELECT count(*) as total FROM internal_task_types', [], {
    d1: true,
    d1Text: 'SELECT count(*) as total FROM internal_task_types',
  });
  const total = countRes.rows && countRes.rows[0] ? Number(countRes.rows[0].total) : 0;

  if (total === 0) {
    console.log('[migrateInternalTasks] Seeding dynamic task types...');
    const seedTypes = [
      ['itt_vendor_followup', 'Vendor Follow-up', 'vendor_followup', 'VENDOR', 'Follow-up with sellers on active tenders, pricing, or compliance'],
      ['itt_quotation_review', 'Quotation Review', 'quotation_review', 'RFQ', 'Review and approve technical quotes and commercial bids'],
      ['itt_buyer_onboarding', 'Buyer Onboarding', 'buyer_onboarding', 'BUYER', 'Assist buyer organizations with onboarding and profile verification'],
      ['itt_credit_approval', 'Credit Approval', 'credit_approval', 'CREDIT', 'Review and grant credits for RFQ generation or download allowance'],
      ['itt_category_audit', 'Category Audit', 'category_audit', 'CATEGORY', 'Audit procurement category taxonomy and vendor category mappings'],
      ['itt_payment_verification', 'Payment Verification', 'payment_verification', 'PAYMENT', 'Reconcile offline payments, gateway webhooks, and refunds'],
      ['itt_account_governance', 'Account Governance', 'account_governance', 'USER', 'Manage user accounts, credential resets, and permissions'],
      ['itt_general_ops', 'General Operations', 'general_ops', 'GENERAL', 'Internal operational escalations and triage tasks'],
    ];

    for (const [id, name, code, mod, desc] of seedTypes) {
      await pool.query(
        'INSERT INTO internal_task_types (id, name, code, default_module, description) VALUES ($1, $2, $3, $4, $5)',
        [id, name, code, mod, desc],
        {
          d1: true,
          d1Text: 'INSERT INTO internal_task_types (id, name, code, default_module, description) VALUES ($1, $2, $3, $4, $5)',
        }
      );
    }
  }

  const typesRes = await pool.query('SELECT id, name, default_module FROM internal_task_types', [], {
    d1: true,
    d1Text: 'SELECT id, name, default_module FROM internal_task_types',
  });
  console.log('[migrateInternalTasks] Complete. Active task types:', typesRes.rows);
}

if (require.main === module) {
  migrateInternalTasks()
    .then(() => {
      console.log('[migrateInternalTasks] Successfully completed migration.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrateInternalTasks] Error:', err);
      process.exit(1);
    });
}

module.exports = { migrateInternalTasks };

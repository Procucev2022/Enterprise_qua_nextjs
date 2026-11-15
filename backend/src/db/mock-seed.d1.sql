-- Local-only demo fixtures for UI and integration development.
-- Apply with `npm run db:seed:mock:local`; the command hard-codes --local and
-- must never be changed to target a remote D1 database.
INSERT OR IGNORE INTO buyer_accounts
  (id, corporate_email, status, is_active, raw)
VALUES
  ('mock-buyer-local-001', 'buyer.demo@example.com', 'ACTIVE', 1,
   '{"id":"mock-buyer-local-001","name":"Demo Buyer Ltd","companyName":"Demo Buyer Ltd","corporateEmail":"buyer.demo@example.com","status":"ACTIVE","isActive":true,"mockData":true}');

INSERT OR IGNORE INTO vendors
  (id, email, major_category, status, source, raw)
VALUES
  ('mock-vendor-local-001', 'vendor.demo@example.com', 'Office Supplies', 'ACTIVE', 'LOCAL_DEMO',
   '{"id":"mock-vendor-local-001","name":"Demo Office Supplies","companyName":"Demo Office Supplies","email":"vendor.demo@example.com","majorCategory":"Office Supplies","status":"ACTIVE","mockData":true}');

INSERT OR IGNORE INTO rfqs
  (id, rfq_number, category, status, sourcing_mode, budget, raw)
VALUES
  ('mock-rfq-local-001', 'DEMO-LOCAL-001', 'Office Supplies', 'OPEN', 'COMPETITIVE', 25000,
   '{"id":"mock-rfq-local-001","rfqNumber":"DEMO-LOCAL-001","title":"Local demo: office stationery","category":"Office Supplies","status":"OPEN","sourcingMode":"COMPETITIVE","budget":25000,"buyerId":"mock-buyer-local-001","mockData":true}');

INSERT OR IGNORE INTO enterprise_inquiries
  (id, company_name, email, mobile, buyer_account_id, notes, status)
VALUES
  ('mock-enterprise-inquiry-local-001', 'Demo Fleet Services', 'enterprise.demo@example.test',
   '+919999000002', 'mock-buyer-local-001', 'Local-only demo inquiry for workflow verification.', 'NEW');

INSERT OR IGNORE INTO management_approvals
  (id, request_number, module, project, applicant_name, applicant_email, value_impact,
   maker_name, maker_role, status, details, created_at, updated_at)
VALUES
  ('mock-approval-local-001', 'DEMO-APP-001', 'Credit Notes', 'Demo Office Supplies RFQ',
   'Demo Buyer Ltd', 'buyer.demo@example.com', '10 RFQ credits', 'Local Demo Operator',
   'Category Executive', 'Pending', 'Local-only seeded approval request.',
   datetime('now', '-2 hours'), datetime('now', '-2 hours')),
  ('mock-approval-local-002', 'DEMO-APP-002', 'Discounts', 'Demo annual sourcing plan',
   'Demo Buyer Ltd', 'buyer.demo@example.com', '5% plan discount', 'Local Demo Operator',
   'Enterprise Director', 'Approved', 'Local-only seeded approved request.',
   datetime('now', '-1 day'), datetime('now', '-20 hours'));

INSERT OR IGNORE INTO role (uuid, role_name, is_active)
VALUES ('mock-role-client-initiator', 'ClientInitiator', 1);

INSERT OR IGNORE INTO "user"
  (uuid, username, email, password, full_name, phone, role_uuid, is_active,
   is_approved, verification_status, source_type, is_web_app, is_whats_app)
VALUES
  ('mock-registration-local-001', 'registration.demo@example.com', 'registration.demo@example.com',
   '', 'Local Demo Registration', '+919999000001', 'mock-role-client-initiator', 0,
   0, 'PENDING_EMAIL_VERIFICATION', 'W', 1, 0);

-- =============================================================================
-- CATEGORY MANAGER CREDENTIAL DUMP FOR CLOUDFLARE D1 (DEV -> TEST)
-- =============================================================================
-- Safe, idempotent SQL script to populate Category Manager credentials from
-- dev into the test environment D1 database.
--
-- Safety Guarantees:
--   1. Zero database records deleted (uses INSERT OR IGNORE / ON CONFLICT DO NOTHING).
--   2. Ensures master data (role, org_types, master_status) is present.
--   3. Links Category Manager accounts to the Internal Organization with STAFF_ACTIVE status.
--
-- Can be executed via:
--   npx wrangler d1 execute enterprise-qua-d1 --remote --file=scripts/dump_category_manager_credential.d1.sql
--   or pasted directly into Cloudflare D1 Console -> enterprise-qua-d1 -> Console/Studio.
-- =============================================================================

-- Step 1: Ensure Role, Org Type, and Master Status exist
INSERT OR IGNORE INTO role (uuid, role_name, is_active)
VALUES ('role-category-manager', 'CategoryManager', 1);

INSERT OR IGNORE INTO org_types (uuid, type_name, is_active)
VALUES ('orgtype-internal', 'INTERNAL', 1);

INSERT OR IGNORE INTO master_status (uuid, status, is_active)
VALUES ('status-staff-active', 'STAFF_ACTIVE', 1);

-- Step 2: Ensure Procucev Internal Organization exists
INSERT OR IGNORE INTO organization (
    uuid,
    organization_name,
    email,
    organization_phonenumber,
    contact_person,
    org_type_uuid,
    client_status_uuid,
    self_client,
    source_type,
    company_id,
    gmt_name,
    bfs_name,
    is_india,
    upgrade_days,
    rfq_credits,
    rfq_used_count,
    quote_submitted,
    is_active,
    created_by,
    created_ts,
    last_modified_by,
    last_modified_ts
)
VALUES (
    'org-internal-procucev',
    'Procucev Internal',
    'support@procucev.com',
    '9157154504',
    'Category Operations',
    'orgtype-internal',
    'status-staff-active',
    0,
    'WEB',
    'PROC-INT-001',
    'GMT Basic',
    'BFS PRO',
    1,
    0,
    0,
    0,
    0,
    1,
    'cm-credential-migration',
    CURRENT_TIMESTAMP,
    'cm-credential-migration',
    CURRENT_TIMESTAMP
);

-- Step 3: Insert / Replicate Category Manager accounts (Idempotent via INSERT OR IGNORE)

-- 1. Navin Chaudhary (Lead Category Manager)
INSERT OR IGNORE INTO "user" (
    uuid,
    username,
    email,
    password,
    full_name,
    first_name,
    phone,
    organization_name,
    org_uuid,
    role_uuid,
    client_status_uuid,
    unique_id,
    is_active,
    self_client,
    is_approved,
    reset_password,
    is_web_app,
    is_whats_app,
    is_bot,
    source_type,
    verification_status,
    is_password_changed,
    created_by,
    created_ts,
    last_modified_by,
    last_modified_ts
)
VALUES (
    'usr-cm-navin-001',
    'navinchaudhary.dev@gmail.com',
    'navinchaudhary.dev@gmail.com',
    'Password@123',
    'Navin Chaudhary',
    'Navin',
    '9157154504',
    'Procucev Internal',
    'org-internal-procucev',
    'role-category-manager',
    'status-staff-active',
    'CM-NAVIN-001',
    1,
    0,
    1,
    0,
    1,
    0,
    0,
    'STAFF',
    'VERIFIED',
    0,
    'cm-credential-migration',
    CURRENT_TIMESTAMP,
    'cm-credential-migration',
    CURRENT_TIMESTAMP
);

-- 2. Mukul Rai (Category Manager)
INSERT OR IGNORE INTO "user" (
    uuid,
    username,
    email,
    password,
    full_name,
    first_name,
    phone,
    organization_name,
    org_uuid,
    role_uuid,
    client_status_uuid,
    unique_id,
    is_active,
    self_client,
    is_approved,
    reset_password,
    is_web_app,
    is_whats_app,
    is_bot,
    source_type,
    verification_status,
    is_password_changed,
    created_by,
    created_ts,
    last_modified_by,
    last_modified_ts
)
VALUES (
    'usr-cm-mukul-002',
    'mukul.rai@procucev.com',
    'mukul.rai@procucev.com',
    'Password@123',
    'Mukul Rai',
    'Mukul',
    '9157154504',
    'Procucev Internal',
    'org-internal-procucev',
    'role-category-manager',
    'status-staff-active',
    'CM-MUKUL-002',
    1,
    0,
    1,
    0,
    1,
    0,
    0,
    'STAFF',
    'VERIFIED',
    0,
    'cm-credential-migration',
    CURRENT_TIMESTAMP,
    'cm-credential-migration',
    CURRENT_TIMESTAMP
);

-- 3. Govardhan Kilari (Category Manager)
INSERT OR IGNORE INTO "user" (
    uuid,
    username,
    email,
    password,
    full_name,
    first_name,
    phone,
    organization_name,
    org_uuid,
    role_uuid,
    client_status_uuid,
    unique_id,
    is_active,
    self_client,
    is_approved,
    reset_password,
    is_web_app,
    is_whats_app,
    is_bot,
    source_type,
    verification_status,
    is_password_changed,
    created_by,
    created_ts,
    last_modified_by,
    last_modified_ts
)
VALUES (
    'usr-cm-govardhan-003',
    'govardhan.kilari@procucev.com',
    'govardhan.kilari@procucev.com',
    'Password@123',
    'Govardhan Kilari',
    'Govardhan',
    '9876543210',
    'Procucev Internal',
    'org-internal-procucev',
    'role-category-manager',
    'status-staff-active',
    'CM-GOVARDHAN-003',
    1,
    0,
    1,
    0,
    1,
    0,
    0,
    'STAFF',
    'VERIFIED',
    0,
    'cm-credential-migration',
    CURRENT_TIMESTAMP,
    'cm-credential-migration',
    CURRENT_TIMESTAMP
);

-- 4. Category Operations Lead
INSERT OR IGNORE INTO "user" (
    uuid,
    username,
    email,
    password,
    full_name,
    first_name,
    phone,
    organization_name,
    org_uuid,
    role_uuid,
    client_status_uuid,
    unique_id,
    is_active,
    self_client,
    is_approved,
    reset_password,
    is_web_app,
    is_whats_app,
    is_bot,
    source_type,
    verification_status,
    is_password_changed,
    created_by,
    created_ts,
    last_modified_by,
    last_modified_ts
)
VALUES (
    'usr-cm-lead-004',
    'cm.lead@procucev.com',
    'cm.lead@procucev.com',
    'Password@123',
    'CM Operations Lead',
    'Lead',
    '9157154504',
    'Procucev Internal',
    'org-internal-procucev',
    'role-category-manager',
    'status-staff-active',
    'CM-LEAD-004',
    1,
    0,
    1,
    0,
    1,
    0,
    0,
    'STAFF',
    'VERIFIED',
    0,
    'cm-credential-migration',
    CURRENT_TIMESTAMP,
    'cm-credential-migration',
    CURRENT_TIMESTAMP
);

-- 5. Standard Test Category Manager
INSERT OR IGNORE INTO "user" (
    uuid,
    username,
    email,
    password,
    full_name,
    first_name,
    phone,
    organization_name,
    org_uuid,
    role_uuid,
    client_status_uuid,
    unique_id,
    is_active,
    self_client,
    is_approved,
    reset_password,
    is_web_app,
    is_whats_app,
    is_bot,
    source_type,
    verification_status,
    is_password_changed,
    created_by,
    created_ts,
    last_modified_by,
    last_modified_ts
)
VALUES (
    'usr-catman-001',
    'catmanager@procucev.com',
    'catmanager@procucev.com',
    'Pass@123',
    'Test Category Manager',
    'Category',
    '9157154504',
    'Procucev Internal',
    'org-internal-procucev',
    'role-category-manager',
    'status-staff-active',
    'CM-CATMAN-001',
    1,
    0,
    1,
    0,
    1,
    0,
    0,
    'STAFF',
    'VERIFIED',
    0,
    'cm-credential-migration',
    CURRENT_TIMESTAMP,
    'cm-credential-migration',
    CURRENT_TIMESTAMP
);

const identityQueries = require('../src/db/identityQueries');
const { IDENTITY_MASTER_DATA } = require('../src/config/constants');

const ROLE_UUID = 'role-uuid';
const ORG_TYPE_UUID = 'org-type-uuid';
const STATUS_UUID = 'status-uuid';
const D1_UNDEFINED_ERROR = "D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'";

// A stand-in for the Workers D1 binding. Each prepared statement records its bound values in the order
// the placeholders appear in the SQL. The fake rejects undefined the way D1 does, answers the three
// master-data lookups, and returns no rows for every other read.
function fakeD1Binding(batches) {
  const lookupRows = (sql) => {
    if (/from\s+"?role"?\b/i.test(sql)) return [{ uuid: ROLE_UUID }];
    if (/from\s+"?org_types"?\b/i.test(sql)) return [{ uuid: ORG_TYPE_UUID }];
    if (/from\s+"?master_status"?\b/i.test(sql)) return [{ uuid: STATUS_UUID }];
    return [];
  };
  return {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async all() {
          return { results: lookupRows(this.sql), success: true, meta: {} };
        },
      };
    },
    async batch(statements) {
      if (statements.some((statement) => statement.args.includes(undefined))) {
        throw new Error(D1_UNDEFINED_ERROR);
      }
      batches.push(statements);
      return statements.map(() => ({
        results: [{ uuid: 'created-uuid', org_uuid: 'org-uuid' }],
        success: true,
        meta: { changes: 1 },
      }));
    },
  };
}

describe('account creation on D1 binds every placeholder to its own value', () => {
  let batches;

  beforeEach(() => {
    batches = [];
    globalThis.__CF_ENV__ = { DB: fakeD1Binding(batches) };
  });

  afterEach(() => {
    delete globalThis.__CF_ENV__;
  });

  test('buyer registration writes the organization and the user without undefined values', async () => {
    const result = await identityQueries.insertBuyerAccount({
      email: 'Buyer@Example.com',
      password: 'Secret#1',
      phone: '9876543210',
      fullName: 'Asha Rao',
      organizationName: 'Acme Components',
      street: '12 Industrial Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India',
      gstin: '27aaaaa0000a1z5',
      pan: '',
    });

    expect(result.created).toBe(true);
    const [organizationInsert, userInsert] = batches[0];
    // The first 14 placeholders of the organization insert follow its column list in order. zip_code and
    // pincode both take the PIN code, and country, gstin, pan and org_type_uuid each take their own value.
    expect(organizationInsert.args.slice(0, 14)).toEqual([
      expect.any(String),
      'Acme Components',
      'Asha Rao',
      'buyer@example.com',
      '+919876543210',
      '12 Industrial Road',
      'Pune',
      'Maharashtra',
      '411001',
      '411001',
      'India',
      '27AAAAA0000A1Z5',
      '',
      ORG_TYPE_UUID,
    ]);
    // The buyer user insert lists organization_name, so its placeholders run $1 to $8, then the org_uuid
    // subselect (which uses $8 and $12), then $9, $10 and $11, then the existence checks.
    expect(userInsert.args).toEqual([
      expect.any(String),
      'buyer@example.com',
      'buyer@example.com',
      'Secret#1',
      'Asha Rao',
      'Asha Rao',
      '+919876543210',
      'Acme Components',
      'Acme Components',
      ORG_TYPE_UUID,
      ROLE_UUID,
      0,
      IDENTITY_MASTER_DATA.VERIFICATION_VERIFIED,
      'Acme Components',
      ORG_TYPE_UUID,
      'buyer@example.com',
    ]);
  });

  test('vendor registration binds the organization type and the role to their own placeholders', async () => {
    const result = await identityQueries.insertVendorAccount({
      email: 'supplier@example.com',
      password: 'Secret#1',
      phone: '9876543210',
      fullName: 'Ravi Supplier',
      organizationName: 'Supplier Works',
      resetExisting: false,
      resetPasswordRequired: false,
    });

    expect(result.created).toBe(true);
    const [organizationInsert, userInsert] = batches[0];
    expect(organizationInsert.args.slice(0, 6)).toEqual([
      expect.any(String),
      'Supplier Works',
      'Ravi Supplier',
      'supplier@example.com',
      '+919876543210',
      ORG_TYPE_UUID,
    ]);
    // The vendor user insert has no organization_name column, so its placeholders run $1 to $7, then the
    // org_uuid subselect (which uses $8 and $12), then $9, $10 and $11, then the existence checks.
    expect(userInsert.args).toEqual([
      expect.any(String),
      'supplier@example.com',
      'supplier@example.com',
      'Secret#1',
      'Ravi Supplier',
      'Ravi Supplier',
      '+919876543210',
      'Supplier Works',
      ORG_TYPE_UUID,
      ROLE_UUID,
      0,
      IDENTITY_MASTER_DATA.VERIFICATION_VERIFIED,
      'Supplier Works',
      ORG_TYPE_UUID,
      'supplier@example.com',
    ]);
  });
});

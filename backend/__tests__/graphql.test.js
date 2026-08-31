const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const { queryCache } = require('../src/db/queryCache');
const { handleGraphQL } = require('../src/controllers/graphqlController');

describe('GraphQL API & Controller Integration Tests', () => {
  beforeEach(() => {
    queryCache.clear();
  });

  test('POST /graphql executes rfqs, vendors, and buyerAccounts queries', async () => {
    const query = `
      query {
        rfqs(limit: 5) {
          id
          rfqNumber
          title
          category
          sourcingMode
          budget
        }
        vendors(limit: 5) {
          id
          name
          email
          majorCategory
          rating
        }
        buyerAccounts(limit: 3) {
          id
          organizationName
          corporateEmail
        }
        activeBuyerAccount {
          id
          organizationName
        }
      }
    `;

    const res = await request(app)
      .post('/graphql')
      .send({ query })
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.rfqs)).toBe(true);
    expect(Array.isArray(res.body.data.vendors)).toBe(true);
    expect(Array.isArray(res.body.data.buyerAccounts)).toBe(true);
    expect(res.body.data.activeBuyerAccount).toBeDefined();
  });

  test('POST /graphql supports filtered queries for RFQ and Vendor by id/rfqNumber/email', async () => {
    const rfqList = storeService.getRFQs();
    const vendorList = storeService.getVendors();
    const testRFQ = rfqList[0];
    const testVendor = vendorList[0];

    const query = `
      query GetSingleEntities($rfqId: String, $rfqNum: String, $vId: String, $vEmail: String) {
        rfqById: rfq(id: $rfqId) {
          id
          title
        }
        rfqByNum: rfq(rfqNumber: $rfqNum) {
          id
          rfqNumber
        }
        vendorById: vendor(id: $vId) {
          id
          name
        }
        vendorByEmail: vendor(email: $vEmail) {
          id
          email
        }
      }
    `;

    const variables = {
      rfqId: testRFQ.id,
      rfqNum: testRFQ.rfqNumber,
      vId: testVendor.id,
      vEmail: testVendor.email,
    };

    const res = await request(app)
      .post('/graphql')
      .send({ query, variables })
      .expect(200);

    expect(res.body.data.rfqById.id).toBe(testRFQ.id);
    expect(res.body.data.rfqByNum.rfqNumber).toBe(testRFQ.rfqNumber);
    expect(res.body.data.vendorById.id).toBe(testVendor.id);
    expect(res.body.data.vendorByEmail.email.toLowerCase()).toBe(testVendor.email.toLowerCase());
  });

  test('POST /graphql queries evaluations, auditLogs, catalogue, aiFeed, config, dbHealth, and optimizationMetrics', async () => {
    const query = `
      query {
        evaluations {
          id
          vendorName
          overallScore
        }
        auditLogs(limit: 5, search: "RFQ") {
          id
          action
          userEmail
        }
        catalogue(category: "Electrical") {
          id
          name
          category
          unitPrice
        }
        aiFeed(limit: 5) {
          id
          agent
          action
        }
        systemConfig {
          maintenanceMode
          aiModel
        }
        dbHealth {
          isConfigured
          provider
        }
        optimizationMetrics {
          cache {
            activeEntries
            cacheHitRatio
          }
          auditing {
            totalQueriesExecuted
          }
        }
      }
    `;

    const res = await request(app)
      .post('/graphql')
      .send({ query })
      .expect(200);

    expect(res.body.data.evaluations).toBeDefined();
    expect(res.body.data.auditLogs).toBeDefined();
    expect(res.body.data.catalogue).toBeDefined();
    expect(res.body.data.aiFeed).toBeDefined();
    expect(res.body.data.systemConfig).toBeDefined();
    expect(res.body.data.dbHealth).toBeDefined();
    expect(res.body.data.optimizationMetrics).toBeDefined();
  });

  test('POST /graphql executes mutations: createRFQ, updateRFQ, createVendor, updateVendor, deleteVendor, createBuyerAccount, clearQueryCache, purgeLogs', async () => {
    // 1. Create RFQ
    const createRFQMutation = `
      mutation {
        createRFQ(input: {
          title: "GraphQL Sourcing RFQ Test"
          category: "Specialized Alloys"
          budget: 250000
          sourcingMode: "mode_3"
        }) {
          id
          rfqNumber
          title
          status
        }
      }
    `;
    const resCreateRFQ = await request(app).post('/graphql').send({ query: createRFQMutation }).expect(200);
    const createdRFQ = resCreateRFQ.body.data.createRFQ;
    expect(createdRFQ.title).toBe('GraphQL Sourcing RFQ Test');

    // 2. Update RFQ
    const updateRFQMutation = `
      mutation {
        updateRFQ(id: "${createdRFQ.id}", input: {
          status: "awarded"
          budget: 280000
        }) {
          id
          status
          budget
        }
      }
    `;
    const resUpdateRFQ = await request(app).post('/graphql').send({ query: updateRFQMutation }).expect(200);
    expect(resUpdateRFQ.body.data.updateRFQ.status).toBe('awarded');

    // 3. Create Vendor
    const createVendorMutation = `
      mutation {
        createVendor(input: {
          name: "Apex Precision Castings"
          email: "sales@apexprecision.com"
          majorCategory: "Industrial Valves"
          rating: 4.8
          score: 91.5
        }) {
          id
          name
          email
        }
      }
    `;
    const resCreateVendor = await request(app).post('/graphql').send({ query: createVendorMutation }).expect(200);
    const createdVendor = resCreateVendor.body.data.createVendor;
    expect(createdVendor.name).toBe('Apex Precision Castings');

    // 4. Update Vendor
    const updateVendorMutation = `
      mutation {
        updateVendor(id: "${createdVendor.id}", input: {
          rating: 4.9
          score: 94.0
        }) {
          id
          rating
          score
        }
      }
    `;
    const resUpdateVendor = await request(app).post('/graphql').send({ query: updateVendorMutation }).expect(200);
    expect(resUpdateVendor.body.data.updateVendor.rating).toBe(4.9);

    // 5. Delete Vendor
    const deleteVendorMutation = `
      mutation {
        deleteVendor(id: "${createdVendor.id}")
      }
    `;
    const resDeleteVendor = await request(app).post('/graphql').send({ query: deleteVendorMutation }).expect(200);
    expect(resDeleteVendor.body.data.deleteVendor).toBe(true);

    // 6. Create Buyer Account
    const createBuyerMutation = `
      mutation {
        createBuyerAccount(input: {
          organizationName: "JSW Energy Limited"
          corporateEmail: "procurement@jswenergy.in"
          contactPerson: "Rajesh Kumar"
          sourcingMode: "mode_2"
        }) {
          id
          organizationName
          corporateEmail
        }
      }
    `;
    const resCreateBuyer = await request(app).post('/graphql').send({ query: createBuyerMutation }).expect(200);
    expect(resCreateBuyer.body.data.createBuyerAccount.organizationName).toBe('JSW Energy Limited');

    // 7. Clear Query Cache
    const clearCacheMutation = `
      mutation {
        clearQueryCache
      }
    `;
    const resClearCache = await request(app).post('/graphql').send({ query: clearCacheMutation }).expect(200);
    expect(resClearCache.body.data.clearQueryCache).toBe(true);

    // 8. Purge Logs
    const purgeLogsMutation = `
      mutation {
        purgeLogs(maxAgeDays: 14) {
          success
        }
      }
    `;
    const resPurgeLogs = await request(app).post('/graphql').send({ query: purgeLogsMutation }).expect(200);
    expect(resPurgeLogs.body.data.purgeLogs.success).toBe(true);
  });

  test('GET /graphql supports query execution and handles string variables and invalid JSON variables fallback', async () => {
    const query = 'query { systemConfig { maintenanceMode } }';
    const res = await request(app)
      .get(`/graphql?query=${encodeURIComponent(query)}&variables=${encodeURIComponent('{}')}`)
      .expect(200);

    expect(res.body.data.systemConfig).toBeDefined();

    // Invalid JSON string in variables
    const resInvalidJson = await request(app)
      .get(`/graphql?query=${encodeURIComponent(query)}&variables=INVALID_JSON`)
      .expect(200);
    expect(resInvalidJson.body.data.systemConfig).toBeDefined();
  });

  test('POST /graphql returns 400 when query string is missing', async () => {
    const res = await request(app).post('/graphql').send({}).expect(400);
    expect(res.body.errors[0].message).toMatch(/Must provide query string/i);
  });

  test('POST /graphql returns GraphQL execution errors on invalid syntax', async () => {
    const res = await request(app)
      .post('/graphql')
      .send({ query: 'query { nonExistentField }' })
      .expect(200);

    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  test('filters queries with parameters: category, sourcingMode, status, search, limit, offset', async () => {
    const query = `
      query {
        rfqsFiltered: rfqs(category: "Raw", sourcingMode: "mode_1", status: "In Evaluation", limit: 2, offset: 0) {
          id
        }
        vendorsFiltered: vendors(majorCategory: "Engineering", search: "Steel", limit: 2, offset: 0) {
          id
        }
        catalogueFiltered: catalogue(search: "Valve") {
          id
        }
        evaluationsFiltered: evaluations(vendorName: "Steel") {
          id
        }
        emptyRfq: rfq {
          id
        }
        emptyVendor: vendor {
          id
        }
      }
    `;
    const res = await request(app).post('/graphql').send({ query }).expect(200);
    expect(res.body.data.rfqsFiltered).toBeDefined();
    expect(res.body.data.vendorsFiltered).toBeDefined();
    expect(res.body.data.catalogueFiltered).toBeDefined();
    expect(res.body.data.evaluationsFiltered).toBeDefined();
    expect(res.body.data.emptyRfq).toBeNull();
    expect(res.body.data.emptyVendor).toBeNull();
  });

  test('POST /graphql queries and mutations for AES cryptography', async () => {
    const statusQuery = `
      query {
        cryptoStatus {
          status
          algorithm
          keyLengthBits
          roundtripVerified
          tamperDetectionVerified
        }
      }
    `;
    const statusRes = await request(app).post('/graphql').send({ query: statusQuery }).expect(200);
    expect(statusRes.body.data.cryptoStatus.status).toBe('HEALTHY');
    expect(statusRes.body.data.cryptoStatus.algorithm).toBe('aes-256-gcm');

    const encMutation = `
      mutation Encrypt($input: EncryptDataInput!) {
        encryptData(input: $input) {
          ciphertext
          iv
          authTag
          salt
          algorithm
          encoded
        }
      }
    `;

    const encRes = await request(app)
      .post('/graphql')
      .send({
        query: encMutation,
        variables: { input: { plaintext: 'Confidential ERP Quote' } },
      })
      .expect(200);

    expect(encRes.body.data.encryptData.ciphertext).toBeDefined();
    expect(encRes.body.data.encryptData.encoded).toMatch(/^enc:v1:aes-256-gcm:/);

    const decQuery = `
      query Decrypt($input: DecryptDataInput!) {
        decryptData(input: $input) {
          plaintext
        }
      }
    `;
    const decRes = await request(app)
      .post('/graphql')
      .send({
        query: decQuery,
        variables: { input: { token: encRes.body.data.encryptData.encoded } },
      })
      .expect(200);

    expect(decRes.body.data.decryptData.plaintext).toBe('Confidential ERP Quote');

    // Decrypt with structured input
    const decStructRes = await request(app)
      .post('/graphql')
      .send({
        query: decQuery,
        variables: {
          input: {
            ciphertext: encRes.body.data.encryptData.ciphertext,
            iv: encRes.body.data.encryptData.iv,
            authTag: encRes.body.data.encryptData.authTag,
            salt: encRes.body.data.encryptData.salt,
          },
        },
      })
      .expect(200);

    expect(decStructRes.body.data.decryptData.plaintext).toBe('Confidential ERP Quote');

  });

  test('handleGraphQL controller catches unhandled errors via next', async () => {
    const req = {
      method: 'POST',
      get body() {
        throw new Error('Malformed Request Stream');
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await handleGraphQL(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});


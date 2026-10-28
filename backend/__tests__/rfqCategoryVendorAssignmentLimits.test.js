const storeService = require('../src/services/storeService');
const { VENDOR_ASSIGNMENT_LIMITS } = require('../src/config/constants');

describe('RFQ Category Vendor Assignment Limits (5 Client & 5 Procucev per Category)', () => {
  const origEnv = process.env;

  beforeEach(() => {
    storeService.reset();
    process.env = { ...origEnv };
    delete process.env.MAX_CLIENT_VENDORS_PER_CATEGORY;
    delete process.env.MAX_PROCUCEV_VENDORS_PER_CATEGORY;
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      delete globalThis.__CF_ENV__.MAX_CLIENT_VENDORS_PER_CATEGORY;
      delete globalThis.__CF_ENV__.MAX_PROCUCEV_VENDORS_PER_CATEGORY;
    }
  });

  afterEach(() => {
    process.env = origEnv;
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      delete globalThis.__CF_ENV__.MAX_CLIENT_VENDORS_PER_CATEGORY;
      delete globalThis.__CF_ENV__.MAX_PROCUCEV_VENDORS_PER_CATEGORY;
    }
    jest.restoreAllMocks();
  });

  test('default limits are 5 Client and 5 Procucev vendors per category', () => {
    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY).toBe(5);
    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY).toBe(5);
  });

  test('limits are dynamically configurable via process.env', () => {
    process.env.MAX_CLIENT_VENDORS_PER_CATEGORY = '3';
    process.env.MAX_PROCUCEV_VENDORS_PER_CATEGORY = '2';

    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY).toBe(3);
    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY).toBe(2);
  });

  test('limits are dynamically configurable via Cloudflare Worker globalThis.__CF_ENV__', () => {
    globalThis.__CF_ENV__ = {
      MAX_CLIENT_VENDORS_PER_CATEGORY: '7',
      MAX_PROCUCEV_VENDORS_PER_CATEGORY: '8',
    };

    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY).toBe(7);
    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY).toBe(8);
  });

  describe('Mode 1 (Private Roster): assigns up to 5 Client vendors per category and 0 Procucev vendors', () => {
    test('caps at 5 client vendors per category across multiple categories', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Testing Corp',
        corporateEmail: 'buyer@test.com',
        subscriptionPlan: 'version_1',
      });

      // Add 8 client vendors for 'Packing Material'
      const packingVendors = [];
      for (let i = 1; i <= 8; i++) {
        packingVendors.push(
          storeService.addVendor({
            name: `Packing Vendor ${i}`,
            email: `pack${i}@vendor.com`,
            majorCategory: 'Packing Material',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 3.0 + i * 0.1,
          })
        );
      }

      // Add 7 client vendors for 'Civil Works'
      const civilVendors = [];
      for (let i = 1; i <= 7; i++) {
        civilVendors.push(
          storeService.addVendor({
            name: `Civil Vendor ${i}`,
            email: `civ${i}@vendor.com`,
            majorCategory: 'Civil Works',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 3.0 + i * 0.1,
          })
        );
      }

      const allAssigned = [...packingVendors, ...civilVendors];

      const rfq = storeService.createRFQ(
        {
          title: 'Multi-category packaging and civil RFQ',
          sourcingMode: 'mode_1',
          extractedEntities: [
            { itemName: 'Corrugated Box', majorCategory: 'Packing Material', quantity: 100 },
            { itemName: 'Cement bags', majorCategory: 'Civil Works', quantity: 50 },
          ],
          assignedVendors: allAssigned,
        },
        buyer
      );

      const packingIds = new Set(packingVendors.map((v) => v.id));
      const civilIds = new Set(civilVendors.map((v) => v.id));

      const assigned = rfq.assignedVendors || [];
      const assignedPacking = assigned.filter((v) => packingIds.has(v.id));
      const assignedCivil = assigned.filter((v) => civilIds.has(v.id));

      // Exactly 5 per category (not 8 and not 7)
      expect(assignedPacking).toHaveLength(5);
      expect(assignedCivil).toHaveLength(5);
      expect(assigned).toHaveLength(10);

      // Verify highest rated were picked
      const expectedPackingIds = packingVendors
        .slice()
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 5)
        .map((v) => v.id);
      const expectedCivilIds = civilVendors
        .slice()
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 5)
        .map((v) => v.id);

      expect(assignedPacking.map((v) => v.id)).toEqual(expectedPackingIds);
      expect(assignedCivil.map((v) => v.id)).toEqual(expectedCivilIds);
    });
  });

  describe('Mode 2 (Hybrid): assigns up to 5 Client & 5 Procucev vendors per category', () => {
    test('assigns 5 Client and 5 Procucev vendors per category', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Hybrid Buyer Corp',
        corporateEmail: 'hybrid@test.com',
        subscriptionPlan: 'version_2',
      });

      // 7 Client vendors for 'Raw Material'
      const clientVendorsList = [];
      for (let i = 1; i <= 7; i++) {
        clientVendorsList.push(
          storeService.addVendor({
            name: `Client Raw ${i}`,
            email: `clientraw${i}@test.com`,
            majorCategory: 'Raw Material',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 4.0 + i * 0.1,
          })
        );
      }

      // 8 Procucev network vendors for 'Raw Material'
      const procVendorsList = [];
      for (let i = 1; i <= 8; i++) {
        procVendorsList.push(
          storeService.addVendor({
            name: `Procucev Raw ${i}`,
            email: `procraw${i}@test.com`,
            majorCategory: 'Raw Material',
            source: 'procucev_network',
            rating: 4.0 + i * 0.1,
          })
        );
      }

      const rfq = storeService.createRFQ(
        {
          title: 'Hybrid Raw Material Sourcing',
          category: 'Raw Material',
          sourcingMode: 'mode_2',
        },
        buyer
      );

      const clientIds = new Set(clientVendorsList.map((v) => v.id));
      const procIds = new Set(procVendorsList.map((v) => v.id));

      const assigned = rfq.assignedVendors || [];
      const clientVendors = assigned.filter((v) => clientIds.has(v.id));
      const procVendors = assigned.filter((v) => procIds.has(v.id));

      expect(clientVendors).toHaveLength(5);
      expect(procVendors).toHaveLength(5);
      expect(assigned).toHaveLength(10);
    });

    test('respects custom environment variable limit per category', () => {
      process.env.MAX_CLIENT_VENDORS_PER_CATEGORY = '2';
      process.env.MAX_PROCUCEV_VENDORS_PER_CATEGORY = '3';

      const buyer = storeService.addBuyerAccount({
        organizationName: 'Custom Limit Buyer',
        corporateEmail: 'custom@test.com',
        subscriptionPlan: 'version_2',
      });

      const clientVendorsList = [];
      const procVendorsList = [];
      for (let i = 1; i <= 6; i++) {
        clientVendorsList.push(
          storeService.addVendor({
            name: `Client ${i}`,
            email: `cl${i}@test.com`,
            majorCategory: 'Electricals',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 4.0 + i * 0.1,
          })
        );
        procVendorsList.push(
          storeService.addVendor({
            name: `Procucev ${i}`,
            email: `pr${i}@test.com`,
            majorCategory: 'Electricals',
            source: 'procucev_network',
            rating: 4.0 + i * 0.1,
          })
        );
      }

      const rfq = storeService.createRFQ(
        {
          title: 'Custom limit RFQ',
          category: 'Electricals',
          sourcingMode: 'mode_2',
        },
        buyer
      );

      const clientIds = new Set(clientVendorsList.map((v) => v.id));
      const procIds = new Set(procVendorsList.map((v) => v.id));

      const assigned = rfq.assignedVendors || [];
      const clientVendors = assigned.filter((v) => clientIds.has(v.id));
      const procVendors = assigned.filter((v) => procIds.has(v.id));

      expect(clientVendors).toHaveLength(2);
      expect(procVendors).toHaveLength(3);
      expect(assigned).toHaveLength(5);
    });
  });

  describe('Mode 0 (Free Starter Plan / V0): assigns strictly Procucev vendors up to limit per category', () => {
    test('assigns up to 5 Procucev vendors per category and 0 client vendors', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'V0 Buyer Corp',
        corporateEmail: 'v0@test.com',
        subscriptionPlan: 'free_trial',
      });

      // Add 8 Procucev vendors for 'Solar Equipment'
      const solarVendors = [];
      for (let i = 1; i <= 8; i++) {
        solarVendors.push(
          storeService.addVendor({
            name: `Solar Supplier ${i}`,
            email: `solar${i}@test.com`,
            majorCategory: 'Solar Equipment',
            source: 'procucev_network',
            rating: 3.5 + i * 0.1,
          })
        );
      }

      // Add a client vendor for 'Solar Equipment' (must be excluded from V0)
      const clientSolar = storeService.addVendor({
        name: 'Private Solar Vendor',
        email: 'pvtsolar@test.com',
        majorCategory: 'Solar Equipment',
        buyerId: buyer.id,
        source: 'buyer_uploaded',
      });

      const rfq = storeService.createRFQ(
        {
          title: 'V0 Solar Equipment RFQ',
          category: 'Solar Equipment',
          sourcingMode: 'mode_0',
        },
        buyer
      );

      const solarIds = new Set(solarVendors.map((v) => v.id));
      const assigned = rfq.assignedVendors || [];
      expect(assigned).toHaveLength(5);
      expect(assigned.every((v) => solarIds.has(v.id))).toBe(true);
      expect(assigned.some((v) => v.id === clientSolar.id)).toBe(false);
      expect(rfq.procucevVendorCount).toBe(5);
    });
  });

  describe('Mode 3 (Autonomous / V3): does not auto-populate assignedVendors but calculates network capacity', () => {
    test('calculates mode3ProcucevCount without polluting assignedVendors', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'V3 Buyer Corp',
        corporateEmail: 'v3@test.com',
        subscriptionPlan: 'version_3',
      });

      // Add 8 Procucev vendors for 'Logistics'
      for (let i = 1; i <= 8; i++) {
        storeService.addVendor({
          name: `Logistics Vendor ${i}`,
          email: `logistics${i}@test.com`,
          majorCategory: 'Logistics',
          source: 'procucev_network',
          rating: 4.0 + i * 0.1,
        });
      }

      const rfq = storeService.createRFQ(
        {
          title: 'V3 Autonomous Logistics RFQ',
          category: 'Logistics',
          sourcingMode: 'mode_3',
        },
        buyer
      );

      // In Mode 3, Procucev vendors are NOT added to assignedVendors at RFQ creation time
      // (Category Manager manual invitation relies on uninvited status)
      expect(rfq.assignedVendors).toEqual([]);
      expect(rfq.procucevVendorCount).toBe(5); // Capped at MAX_PROCUCEV_PER_CATEGORY (5)
    });
  });

  describe('Automatic vendor assignment based on RFQ category and delivery location', () => {
    test('prioritizes vendors matching delivery location (city and pincode) over distant vendors', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Location Test Corp',
        corporateEmail: 'location@test.com',
        subscriptionPlan: 'version_2',
      });

      // Vendor in Mumbai with matching pincode
      const vMumbaiPin = storeService.addVendor({
        name: 'Mumbai Exact Pin Vendor',
        email: 'mum-pin@test.com',
        majorCategory: 'Civil Works',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        rating: 4.0,
      });

      // Vendor in Mumbai without exact pincode
      const vMumbaiCity = storeService.addVendor({
        name: 'Mumbai City Vendor',
        email: 'mum-city@test.com',
        majorCategory: 'Civil Works',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400099',
        rating: 4.1,
      });

      // Vendor in Maharashtra (state match)
      const vState = storeService.addVendor({
        name: 'Maharashtra State Vendor',
        email: 'mah-state@test.com',
        majorCategory: 'Civil Works',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        rating: 4.5,
      });

      // Distant vendor in Delhi
      const vDelhi = storeService.addVendor({
        name: 'Delhi Distant Vendor',
        email: 'delhi@test.com',
        majorCategory: 'Civil Works',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
        rating: 4.9, // Higher rating but distant
      });

      const rfq = storeService.createRFQ(
        {
          title: 'Civil Works RFQ for Mumbai Site',
          category: 'Civil Works',
          deliveryLocation: 'Mumbai Plant Site',
          deliveryPincode: '400001',
          sourcingMode: 'mode_0',
        },
        buyer
      );

      const assigned = rfq.assignedVendors || [];
      expect(assigned.length).toBeGreaterThanOrEqual(2);
      // The exact pincode match in Mumbai should rank first
      expect(assigned[0].id).toBe(vMumbaiPin.id);
      // Mumbai city match should rank above distant Delhi vendor despite lower rating
      const assignedIds = assigned.map((v) => v.id);
      expect(assignedIds.indexOf(vMumbaiCity.id)).toBeLessThan(assignedIds.indexOf(vDelhi.id));
    });

    test('automatically assigns eligible vendors through taxonomy major and minor hierarchy', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Taxonomy Test Corp',
        corporateEmail: 'tax@test.com',
        subscriptionPlan: 'version_2',
      });

      // Vendor specialized in minor category 'Bricks' (part of Civil Works)
      const vBricks = storeService.addVendor({
        name: 'Bricks Supplier',
        email: 'bricks@test.com',
        minorCategories: ['Bricks'],
        rating: 4.5,
      });

      // Vendor with alias 'Civil'
      const vCivilAlias = storeService.addVendor({
        name: 'Civil Alias Vendor',
        email: 'civil-alias@test.com',
        majorCategory: 'Civil',
        rating: 4.6,
      });

      const rfq = storeService.createRFQ(
        {
          title: 'Masonry Work RFQ',
          category: 'Civil Works',
          sourcingMode: 'mode_0',
        },
        buyer
      );

      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).toContain(vBricks.id);
      expect(assignedIds).toContain(vCivilAlias.id);
    });

    test('Mode 1 auto-assigns eligible private roster vendors when assignedVendors is empty', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Private Auto Assign Corp',
        corporateEmail: 'private-auto@test.com',
        subscriptionPlan: 'version_1',
      });

      // Private roster vendor belonging to this buyer
      const privateVendor = storeService.addVendor({
        name: 'My Private Vendor',
        email: 'myprivate@test.com',
        majorCategory: 'Packing Material',
        buyerId: buyer.id,
        source: 'buyer_uploaded',
        rating: 4.8,
      });

      // Network vendor that must NOT be assigned in Mode 1
      const networkVendor = storeService.addVendor({
        name: 'Network Packaging Supplier',
        email: 'netpack@test.com',
        majorCategory: 'Packing Material',
        source: 'procucev_network',
        rating: 5.0,
      });

      // RFQ created without passing assignedVendors
      const rfq = storeService.createRFQ(
        {
          title: 'Packaging boxes requisition',
          category: 'Packing Material',
          sourcingMode: 'mode_1',
        },
        buyer
      );

      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).toContain(privateVendor.id);
      expect(assignedIds).not.toContain(networkVendor.id);
      expect(rfq.followUpData.totalInvited).toBe(1);
    });
  });

  describe('vendorCoversCategory & scoreVendorLocation branch coverage', () => {
    test('scoreVendorLocation evaluates PIN proximity, city, state, tokens, and fallbacks', () => {
      expect(storeService.scoreVendorLocation(null, null)).toBe(40);
      expect(storeService.scoreVendorLocation({}, null)).toBe(40);

      const vPin = { pincode: '400001', city: 'Mumbai', state: 'Maharashtra', location: 'Navi Mumbai Plant' };
      // Exact PIN match (100)
      expect(storeService.scoreVendorLocation(vPin, { pincode: '400001' })).toBe(100);
      // String 6-digit PIN destination (100)
      expect(storeService.scoreVendorLocation(vPin, '400001')).toBe(100);
      // Same district PIN (90)
      expect(storeService.scoreVendorLocation(vPin, { pincode: '400050' })).toBe(90);
      // Same region PIN (70)
      expect(storeService.scoreVendorLocation(vPin, { pincode: '411001' })).toBe(70);
      // Different postal zone (destText check)
      expect(storeService.scoreVendorLocation(vPin, { pincode: '560001' })).toBe(40);

      // City match (85)
      expect(storeService.scoreVendorLocation(vPin, { location: 'Delivery at Mumbai Site' })).toBe(85);
      // String text destination (85)
      expect(storeService.scoreVendorLocation(vPin, 'Site at Mumbai Central')).toBe(85);
      // State match (65)
      const vStateOnly = { state: 'Maharashtra' };
      expect(storeService.scoreVendorLocation(vStateOnly, { location: 'Pune, Maharashtra' })).toBe(65);
      // Regional token match (60)
      const vToken = { location: 'Greater Noida Warehouse' };
      expect(storeService.scoreVendorLocation(vToken, { location: 'Noida Project' })).toBe(60);
      // No match fallback (40)
      expect(storeService.scoreVendorLocation(vToken, { location: 'Chennai Depot' })).toBe(40);
    });

    test('vendorCoversCategory handles edge cases, empty values, aliases, and taxonomy directions', () => {
      expect(storeService.vendorCoversCategory(null, 'Civil Works')).toBe(false);
      expect(storeService.vendorCoversCategory({}, null)).toBe(false);
      expect(storeService.vendorCoversCategory({}, '')).toBe(false);
      expect(storeService.vendorCoversCategory({}, 'Civil Works')).toBe(false);

      const vendor = {
        majorCategory: 'Civil Works',
        minorCategories: ['Bricks', 'Painting'],
        vendorSelectedCategories: ['Interior Finishes'],
        clientMappedCategories: ['Plumbing'],
      };

      // Exact matches
      expect(storeService.vendorCoversCategory(vendor, 'Civil Works')).toBe(true);
      expect(storeService.vendorCoversCategory(vendor, 'Bricks')).toBe(true);
      expect(storeService.vendorCoversCategory(vendor, 'Painting')).toBe(true);
      expect(storeService.vendorCoversCategory(vendor, 'Interior Finishes')).toBe(true);
      expect(storeService.vendorCoversCategory(vendor, 'Plumbing')).toBe(true);

      // Major covers minor (taxonomy)
      const vendorMajorOnly = { majorCategory: 'Civil Works' };
      expect(storeService.vendorCoversCategory(vendorMajorOnly, 'Excavation')).toBe(true);

      // Minor mapped to major (taxonomy)
      const vendorMinorOnly = { minorCategories: ['Excavation'] };
      expect(storeService.vendorCoversCategory(vendorMinorOnly, 'Civil Works')).toBe(true);

      // Canonical alias matching
      const vendorAlias = { majorCategory: 'Civil' };
      expect(storeService.vendorCoversCategory(vendorAlias, 'Civil Works')).toBe(true);

      // Token matching
      const vendorToken = { majorCategory: 'Centrifugal Water Pumps' };
      expect(storeService.vendorCoversCategory(vendorToken, 'Water Pumps')).toBe(true);

      // Unrelated category
      expect(storeService.vendorCoversCategory(vendor, 'Medical Devices')).toBe(false);
    });
  });
});

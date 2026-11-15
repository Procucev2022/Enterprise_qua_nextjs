const storeService = require('../src/services/storeService');
const { VENDOR_ASSIGNMENT_LIMITS } = require('../src/config/constants');

describe('RFQ Category Vendor Assignment Limits (25 per Unique Minor Category with Major Fallback)', () => {
  const origEnv = process.env;

  beforeEach(() => {
    storeService.reset();
    process.env = { ...origEnv };
    delete process.env.MAX_CLIENT_VENDORS_PER_CATEGORY;
    delete process.env.MAX_PROCUCEV_VENDORS_PER_CATEGORY;
    delete process.env.TARGET_VENDORS_PER_MINOR_CATEGORY;
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      delete globalThis.__CF_ENV__.MAX_CLIENT_VENDORS_PER_CATEGORY;
      delete globalThis.__CF_ENV__.MAX_PROCUCEV_VENDORS_PER_CATEGORY;
      delete globalThis.__CF_ENV__.TARGET_VENDORS_PER_MINOR_CATEGORY;
    }
  });

  afterEach(() => {
    process.env = origEnv;
    if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__) {
      delete globalThis.__CF_ENV__.MAX_CLIENT_VENDORS_PER_CATEGORY;
      delete globalThis.__CF_ENV__.MAX_PROCUCEV_VENDORS_PER_CATEGORY;
      delete globalThis.__CF_ENV__.TARGET_VENDORS_PER_MINOR_CATEGORY;
    }
    jest.restoreAllMocks();
  });

  test('default limits are 25 Client and 25 Procucev vendors per category', () => {
    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY).toBe(25);
    expect(VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY).toBe(25);
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

  describe('25 Vendors per Unique Minor Category with Major Fallback', () => {
    test('invites all 21 minor vendors and tops the RFQ up to 25 from the parent major category', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Fallback Test Corp',
        corporateEmail: 'buyer-fallback@test.com',
        subscriptionPlan: 'free_trial',
      });

      // Add 21 vendors having minor category 'Corrugated Boxes'
      const minorVendors = [];
      for (let i = 1; i <= 21; i++) {
        minorVendors.push(
          storeService.addVendor({
            name: `Minor Packaging Vendor ${i}`,
            email: `minorpack${i}@vendor.com`,
            majorCategory: 'Packing Material',
            minorCategories: ['Corrugated Boxes'],
            source: 'procucev_network',
            rating: 3.0 + (i % 10) * 0.1,
          })
        );
      }

      // Add 10 vendors having only major category 'Packing Material' (no minor category)
      const majorOnlyVendors = [];
      for (let i = 1; i <= 10; i++) {
        majorOnlyVendors.push(
          storeService.addVendor({
            name: `Major Fallback Vendor ${i}`,
            email: `majorpack${i}@vendor.com`,
            majorCategory: 'Packing Material',
            minorCategories: [],
            source: 'procucev_network',
            rating: 4.0 + (i % 10) * 0.1,
          })
        );
      }

      const rfq = storeService.createRFQ(
        {
          title: 'RFQ for Packaging Corrugated Boxes',
          sourcingMode: 'mode_0',
          extractedEntities: [
            {
              itemName: 'Heavy Duty Corrugated Box',
              minorCategory: 'Corrugated Boxes',
              majorCategory: 'Packing Material',
              quantity: 500,
            },
          ],
        },
        buyer
      );

      const assigned = rfq.assignedVendors || [];
      expect(assigned).toHaveLength(25);

      const minorIds = new Set(minorVendors.map((v) => v.id));
      const majorIds = new Set(majorOnlyVendors.map((v) => v.id));

      const assignedMinor = assigned.filter((v) => minorIds.has(v.id));
      const assignedMajorFallback = assigned.filter((v) => majorIds.has(v.id));

      // All 21 minor-category vendors
      expect(assignedMinor).toHaveLength(21);
      // The remaining 4 come from the major category
      expect(assignedMajorFallback).toHaveLength(4);
    });

    test('preserves delivery location proximity sorting within minor category matches', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Location Proximity Corp',
        corporateEmail: 'buyer-loc@test.com',
        subscriptionPlan: 'free_trial',
      });

      // Add 20 minor category vendors in distant cities
      for (let i = 1; i <= 20; i++) {
        storeService.addVendor({
          name: `Distant Minor Vendor ${i}`,
          email: `distminor${i}@vendor.com`,
          majorCategory: 'Packing Material',
          minorCategories: ['Corrugated Boxes'],
          city: 'Chennai',
          state: 'Tamil Nadu',
          pincode: '600001',
          rating: 4.5,
        });
      }

      // Add 1 minor category vendor with exact matching pincode (Mumbai 400001)
      const nearbyMinorVendor = storeService.addVendor({
        name: 'Nearby Minor Vendor Mumbai',
        email: 'nearminor@vendor.com',
        majorCategory: 'Packing Material',
        minorCategories: ['Corrugated Boxes'],
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        rating: 3.0, // lower rating but exact pincode
      });

      // Total minor vendors = 21

      // Add 10 major fallback vendors (some in Mumbai, some elsewhere)
      const nearbyMajorFallback = storeService.addVendor({
        name: 'Nearby Major Fallback Vendor Mumbai',
        email: 'nearmajor@vendor.com',
        majorCategory: 'Packing Material',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        rating: 3.5,
      });

      for (let i = 2; i <= 8; i++) {
        storeService.addVendor({
          name: `Distant Major Vendor ${i}`,
          email: `distmajor${i}@vendor.com`,
          majorCategory: 'Packing Material',
          city: 'Kolkata',
          state: 'West Bengal',
          pincode: '700001',
          rating: 4.8,
        });
      }

      const rfq = storeService.createRFQ(
        {
          title: 'Location-Prioritized Packaging RFQ',
          sourcingMode: 'mode_0',
          deliveryLocation: 'Mumbai, Maharashtra',
          deliveryPincode: '400001',
          extractedEntities: [
            {
              itemName: 'Custom Corrugated Box',
              minorCategory: 'Corrugated Boxes',
              majorCategory: 'Packing Material',
              quantity: 200,
            },
          ],
        },
        buyer
      );

      const assigned = rfq.assignedVendors || [];
      expect(assigned).toHaveLength(25);

      // Nearby minor vendor (exact pincode) must be at the very top of minor matches
      expect(assigned[0].id).toBe(nearbyMinorVendor.id);

      // The top-up fills the 4 slots left after the 21 minor vendors, best located first
      expect(assigned.some((v) => v.id === nearbyMajorFallback.id)).toBe(true);
    });

    test('invites up to 25 vendors strictly per unique minor category across multiple line items', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Multi Category Corp',
        corporateEmail: 'buyer-multi@test.com',
        subscriptionPlan: 'version_2',
      });

      // 30 vendors for minor 'PVC Pipes' under major 'Plumbing'
      for (let i = 1; i <= 30; i++) {
        storeService.addVendor({
          name: `PVC Vendor ${i}`,
          email: `pvc${i}@vendor.com`,
          majorCategory: 'Plumbing',
          minorCategories: ['PVC Pipes'],
          rating: 3.5 + (i % 10) * 0.1,
        });
      }

      // 21 vendors for minor 'Valves' under major 'Plumbing'
      for (let i = 1; i <= 21; i++) {
        storeService.addVendor({
          name: `Valve Vendor ${i}`,
          email: `valve${i}@vendor.com`,
          majorCategory: 'Plumbing',
          minorCategories: ['Valves'],
          rating: 3.5 + (i % 10) * 0.1,
        });
      }

      // 10 vendors for major 'Plumbing' without minor category
      for (let i = 1; i <= 10; i++) {
        storeService.addVendor({
          name: `Plumbing General Vendor ${i}`,
          email: `plumbgen${i}@vendor.com`,
          majorCategory: 'Plumbing',
          minorCategories: [],
          rating: 4.0 + (i % 10) * 0.1,
        });
      }

      const rfq = storeService.createRFQ(
        {
          title: 'Plumbing Multi Minor Category RFQ',
          sourcingMode: 'mode_2',
          extractedEntities: [
            { itemName: 'PVC Pipe 2 inch', minorCategory: 'PVC Pipes', majorCategory: 'Plumbing' },
            { itemName: 'Gate Valve', minorCategory: 'Valves', majorCategory: 'Plumbing' },
            { itemName: 'PVC Pipe 4 inch', minorCategory: 'PVC Pipes', majorCategory: 'Plumbing' }, // duplicate minor category
          ],
        },
        buyer
      );

      // There are 2 unique minor categories: 'PVC Pipes' and 'Valves'
      // PVC Pipes gets 25 minor vendors (out of 30 available)
      // Valves gets strictly 21 minor vendors (0 fallback from major Plumbing)
      // Total assigned vendors = 25 + 21 = 46
      expect(rfq.assignedVendors).toHaveLength(46);
    });
  });

  describe('Mode 1 (Private Roster): assigns up to 25 Client vendors per category and 0 Procucev vendors', () => {
    test('caps at 25 client vendors per category across multiple categories', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Testing Corp',
        corporateEmail: 'buyer@test.com',
        subscriptionPlan: 'version_1',
      });

      // Add 28 client vendors for 'Packing Material'
      const packingVendors = [];
      for (let i = 1; i <= 28; i++) {
        packingVendors.push(
          storeService.addVendor({
            name: `Packing Vendor ${i}`,
            email: `pack${i}@vendor.com`,
            majorCategory: 'Packing Material',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 3.0 + (i % 10) * 0.1,
          })
        );
      }

      // Add 27 client vendors for 'Civil Works'
      const civilVendors = [];
      for (let i = 1; i <= 27; i++) {
        civilVendors.push(
          storeService.addVendor({
            name: `Civil Vendor ${i}`,
            email: `civ${i}@vendor.com`,
            majorCategory: 'Civil Works',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 3.0 + (i % 10) * 0.1,
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

      // Exactly 25 per category (not 28 and not 27)
      expect(assignedPacking).toHaveLength(25);
      expect(assignedCivil).toHaveLength(25);
      expect(assigned).toHaveLength(50);
    });
  });

  describe('Mode 2 (Hybrid): assigns up to 25 Client & 25 Procucev vendors per category', () => {
    test('assigns 25 Client and 25 Procucev vendors per category', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Hybrid Buyer Corp',
        corporateEmail: 'hybrid@test.com',
        subscriptionPlan: 'version_2',
      });

      // 27 Client vendors for 'Raw Material'
      const clientVendorsList = [];
      for (let i = 1; i <= 27; i++) {
        clientVendorsList.push(
          storeService.addVendor({
            name: `Client Raw ${i}`,
            email: `clientraw${i}@test.com`,
            majorCategory: 'Raw Material',
            buyerId: buyer.id,
            source: 'buyer_uploaded',
            rating: 4.0 + (i % 10) * 0.1,
          })
        );
      }

      // 28 Procucev network vendors for 'Raw Material'
      const procVendorsList = [];
      for (let i = 1; i <= 28; i++) {
        procVendorsList.push(
          storeService.addVendor({
            name: `Procucev Raw ${i}`,
            email: `procraw${i}@test.com`,
            majorCategory: 'Raw Material',
            source: 'procucev_network',
            rating: 4.0 + (i % 10) * 0.1,
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

      expect(clientVendors).toHaveLength(25);
      expect(procVendors).toHaveLength(25);
      expect(assigned).toHaveLength(50);
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
    test('assigns up to 25 Procucev vendors per category and 0 client vendors', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'V0 Buyer Corp',
        corporateEmail: 'v0@test.com',
        subscriptionPlan: 'free_trial',
      });

      // Add 28 Procucev vendors for 'Solar Equipment'
      const solarVendors = [];
      for (let i = 1; i <= 28; i++) {
        solarVendors.push(
          storeService.addVendor({
            name: `Solar Supplier ${i}`,
            email: `solar${i}@test.com`,
            majorCategory: 'Solar Equipment',
            source: 'procucev_network',
            rating: 3.5 + (i % 10) * 0.1,
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
      expect(assigned).toHaveLength(25);
      expect(assigned.every((v) => solarIds.has(v.id))).toBe(true);
      expect(assigned.some((v) => v.id === clientSolar.id)).toBe(false);
      expect(rfq.procucevVendorCount).toBe(25);
    });
  });

  describe('Mode 3 (Autonomous / V3): does not auto-populate assignedVendors but calculates network capacity', () => {
    test('calculates mode3ProcucevCount without polluting assignedVendors', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'V3 Buyer Corp',
        corporateEmail: 'v3@test.com',
        subscriptionPlan: 'version_3',
      });

      // Add 28 Procucev vendors for 'Logistics'
      for (let i = 1; i <= 28; i++) {
        storeService.addVendor({
          name: `Logistics Vendor ${i}`,
          email: `logistics${i}@test.com`,
          majorCategory: 'Logistics',
          source: 'procucev_network',
          rating: 4.0 + (i % 10) * 0.1,
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

      expect(rfq.assignedVendors).toEqual([]);
      expect(rfq.procucevVendorCount).toBe(25); // Capped at MAX_PROCUCEV_PER_CATEGORY (25)
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
        pincode: '400050',
        rating: 4.2,
      });

      // Vendor in Pune (different city, same state)
      const vPune = storeService.addVendor({
        name: 'Pune Vendor',
        email: 'pune@test.com',
        majorCategory: 'Civil Works',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        rating: 4.9, // Higher rating but further away
      });

      // Vendor in Delhi (different state)
      const vDelhi = storeService.addVendor({
        name: 'Delhi Vendor',
        email: 'delhi@test.com',
        majorCategory: 'Civil Works',
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
        rating: 5.0, // Highest rating but out of state
      });

      const rfq = storeService.createRFQ(
        {
          title: 'Civil Construction at Mumbai Site',
          category: 'Civil Works',
          deliveryLocation: 'Mumbai, Maharashtra',
          deliveryPincode: '400001',
          sourcingMode: 'mode_2',
        },
        buyer
      );

      const assigned = rfq.assignedVendors || [];
      const assignedIds = assigned.map((v) => v.id);

      // Verify ordering: Exact Pin (100) > Same District (90) > Same State (70/65) > Distant (40)
      expect(assignedIds.indexOf(vMumbaiPin.id)).toBe(0);
      expect(assignedIds.indexOf(vMumbaiCity.id)).toBe(1);
      expect(assignedIds.indexOf(vPune.id)).toBe(2);
      expect(assignedIds.indexOf(vDelhi.id)).toBe(3);
    });

    test('Mode 1 without pre-selected vendors auto-assigns matching private vendors by location', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Auto Mode 1 Corp',
        corporateEmail: 'automode1@test.com',
        subscriptionPlan: 'version_1',
      });

      // Private vendor belonging to this buyer matching the category
      const privateVendor = storeService.addVendor({
        name: 'Private Packaging Supplier',
        email: 'pvtpack@test.com',
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

    test('vendorCoversMinorCategory handles matching and non-matching vendors', () => {
      expect(storeService.vendorCoversMinorCategory(null, 'Corrugated Boxes')).toBe(false);
      expect(storeService.vendorCoversMinorCategory({}, null)).toBe(false);
      expect(storeService.vendorCoversMinorCategory({}, '')).toBe(false);

      const vendorWithMinor = {
        majorCategory: 'Packing Material',
        minorCategories: ['Corrugated Boxes'],
      };
      expect(storeService.vendorCoversMinorCategory(vendorWithMinor, 'Corrugated Boxes')).toBe(true);
      expect(storeService.vendorCoversMinorCategory(vendorWithMinor, 'Corrugated Box')).toBe(true);

      const vendorWithoutMinor = {
        majorCategory: 'Packing Material',
        minorCategories: ['Stretch Film'],
      };
      expect(storeService.vendorCoversMinorCategory(vendorWithoutMinor, 'Corrugated Boxes')).toBe(false);

      const vendorMajorDirect = {
        majorCategory: 'Corrugated Boxes',
      };
      expect(storeService.vendorCoversMinorCategory(vendorMajorDirect, 'Corrugated Boxes')).toBe(true);
    });
  });

  describe('Painting Minor Category Matching & Location Proximity Flow', () => {
    test('sends RFQ under Painting category only to relevant vendors near specified delivery location', () => {
      // 1. Add vendors: Painting in Mumbai, Painting in Delhi, Civil Works in Mumbai, Unrelated in Mumbai
      const vPaintingMumbai = storeService.addVendor({
        name: 'Mumbai Painting Masters',
        email: 'mumbai-painting@vendor.com',
        majorCategory: 'Civil Works',
        minorCategories: ['Painting'],
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        source: 'procucev_network',
        rating: 4.8,
      });

      const vPaintingDelhi = storeService.addVendor({
        name: 'Delhi Painting Experts',
        email: 'delhi-painting@vendor.com',
        majorCategory: 'Civil Works',
        minorCategories: ['Painting'],
        city: 'Delhi',
        state: 'Delhi',
        pincode: '110001',
        source: 'procucev_network',
        rating: 4.9,
      });

      const vCivilMumbai = storeService.addVendor({
        name: 'Mumbai General Civil',
        email: 'mumbai-civil@vendor.com',
        majorCategory: 'Civil Works',
        minorCategories: [],
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        source: 'procucev_network',
        rating: 4.5,
      });

      const vElectricalMumbai = storeService.addVendor({
        name: 'Mumbai Electricals',
        email: 'mumbai-elec@vendor.com',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategories: ['Cables'],
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        source: 'procucev_network',
        rating: 5.0,
      });

      // Buyer raises RFQ under Painting category for delivery in Mumbai (400001)
      const rfq = storeService.createRFQ({
        title: 'Commercial Office Painting Project',
        category: 'Painting',
        deliveryCity: 'Mumbai',
        deliveryState: 'Maharashtra',
        deliveryPincode: '400001',
        deliveryLocation: 'Nariman Point, Mumbai',
        sourcingMode: 'mode_0',
      });

      expect(rfq.needsCategoryManagerAssignment).toBeFalsy();
      expect(rfq.categoryNotAvailable).toBeFalsy();
      expect(rfq.assignedVendors.length).toBeGreaterThan(0);

      // Verify Painting vendors are included, and closer vendor is ranked first
      const assignedIds = rfq.assignedVendors.map((v) => v.id);
      expect(assignedIds).toContain(vPaintingMumbai.id);
      expect(assignedIds).toContain(vPaintingDelhi.id);

      // Verify unrelated electrical vendor is completely excluded
      expect(assignedIds).not.toContain(vElectricalMumbai.id);

      // Location proximity check: Mumbai painting vendor (exact pincode match 100 pts)
      // must precede Delhi painting vendor (no location match 40 pts)
      const mIdx = assignedIds.indexOf(vPaintingMumbai.id);
      const dIdx = assignedIds.indexOf(vPaintingDelhi.id);
      expect(mIdx).toBeLessThan(dIdx);
    });

    test('flags RFQ for Category Manager review when category is not available in category list', async () => {
      const v1 = storeService.addVendor({
        name: 'Generic Vendor 1',
        email: 'gen1@vendor.com',
        majorCategory: 'Civil Works',
        source: 'procucev_network',
      });

      // Buyer raises RFQ under unknown/unlisted category
      const rfq = storeService.createRFQ({
        title: 'Exotic Submarine Painting Refurbishment',
        category: 'Exotic Unlisted Coating Subcategory 99',
        deliveryPincode: '400001',
        sourcingMode: 'mode_0',
      });

      // 1. Must NOT be sent to vendors from unrelated categories
      expect(rfq.assignedVendors).toEqual([]);
      expect(rfq.procucevVendorCount).toBe(0);
      expect(rfq.followUpData.totalInvited).toBe(0);

      // 2. Must be flagged for Category Manager to review
      expect(rfq.needsCategoryManagerAssignment).toBe(true);
      expect(rfq.categoryNotAvailable).toBe(true);

      // 3. Category Manager notification and audit log created
      const cmNotif = storeService.notifications.find(
        (n) => n.recipientType === 'category_manager' && n.meta?.rfqNumber === rfq.rfqNumber
      );
      expect(cmNotif).toBeDefined();
      expect(cmNotif.title).toContain('Category Review Needed');

      const audit = storeService.auditLogs.find(
        (a) => a.rfqNumber === rfq.rfqNumber && a.action.includes('not available in our category list')
      );
      expect(audit).toBeDefined();

      // 4. Vendor notifications must NOT be dispatched for unlisted category
      const vendorNotifs = storeService.notifyVendorsOfNewRFQ(rfq);
      expect(vendorNotifs).toEqual([]);

      // 5. Category Manager identifies and adds relevant vendors to the RFQ
      const inviteResult = await storeService.inviteVendorsToRFQ(rfq.id, [v1.id], 'cm@procucev.com');
      expect(inviteResult.invitedCount).toBe(1);

      const refreshed = storeService.getRFQById(rfq.id);
      expect(refreshed.needsCategoryManagerAssignment).toBe(false);
      expect(refreshed.categoryNotAvailable).toBe(false);
      expect(refreshed.assignedVendors.length).toBe(1);
      expect(refreshed.assignedVendors[0].id).toBe(v1.id);
    });

    test('isCategoryAvailable correctly identifies available and unavailable categories', () => {
      expect(storeService.isCategoryAvailable(null)).toBe(false);
      expect(storeService.isCategoryAvailable('')).toBe(false);
      expect(storeService.isCategoryAvailable(123)).toBe(false);

      // Minor category
      expect(storeService.isCategoryAvailable('Painting')).toBe(true);
      expect(storeService.isCategoryAvailable('painting')).toBe(true);
      expect(storeService.isCategoryAvailable('Plumbing')).toBe(true);
      expect(storeService.isCategoryAvailable('Corrugated Boxes')).toBe(true);

      // Major category
      expect(storeService.isCategoryAvailable('Civil Works')).toBe(true);
      expect(storeService.isCategoryAvailable('civil works')).toBe(true);
      expect(storeService.isCategoryAvailable('Packing Material')).toBe(true);

      // Canonical alias
      expect(storeService.isCategoryAvailable('Civil')).toBe(true);

      // Unavailable category
      expect(storeService.isCategoryAvailable('Unknown Fantasy Category')).toBe(false);
    });
  });
});

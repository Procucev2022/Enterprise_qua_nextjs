// ==============================================================================
// REGISTRATION QUERIES
// ==============================================================================
// Queries and state management for Registered Clients in Action Center.
// Provides persistent storage via the "user" & "organization" identity tables
// with in-memory fallback to support offline, test, and standalone execution.
// ==============================================================================

const pool = require('./pool');
const { logger } = require('../services/loggerService');

const INITIAL_CLIENTS = [
  {
    id: 'reg-client-101',
    userName: 'verababu',
    companyName: 'Verababu eneterprises',
    phoneNumber: '+919381877013',
    userEmail: 'veerababuv2002@gmail.com',
    regDate: '2026-06-30T10:30:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-102',
    userName: 'GOVARDHAN PVT LTD',
    companyName: 'GOVARDHAN PVT LTD',
    phoneNumber: '+917780755357',
    userEmail: 'govardhjan.kilari@procucev.com',
    regDate: '2026-06-30T09:15:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-103',
    userName: 'Kishore Plywood',
    companyName: 'Kishore Plywood',
    phoneNumber: '+917780755357',
    userEmail: 'kishore.yerramsetti@procucev.com',
    regDate: '2026-06-30T08:45:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-104',
    userName: 'Kishore New Enterprize',
    companyName: 'Kishore New Enterprize',
    phoneNumber: '+919966766905',
    userEmail: 'kishore.yerramsetti@procucev.com',
    regDate: '2026-06-30T07:20:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-105',
    userName: 'Kishore Furnitures',
    companyName: 'Kishore Furnitures',
    phoneNumber: '+919983890689',
    userEmail: 'kishore.yerramsetti@procucev.com',
    regDate: '2026-06-30T06:10:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-106',
    userName: 'Kishore Yerramsetti',
    companyName: 'Kishore New Enterprize',
    phoneNumber: '+917780755359',
    userEmail: 'kishore.yerramsetti@procucev.com',
    regDate: '2026-05-21T11:00:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-107',
    userName: 'Raghavendra',
    companyName: 'Raghavendra Solutions Pvt Ltd',
    phoneNumber: '+917981186190',
    userEmail: 'raghureddy2488975@gmail.com',
    regDate: '2026-05-20T14:30:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-108',
    userName: 'Vanshika',
    companyName: 'Pvt Ltd',
    phoneNumber: '+919084381486',
    userEmail: 'vanshikabhardwaj29@gmail.com',
    regDate: '2026-05-18T16:15:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-109',
    userName: 'Venkata Kishore',
    companyName: 'Procucev',
    phoneNumber: '+917780755351',
    userEmail: 'kishore.yerramsetti@procucev.com',
    regDate: '2026-05-11T12:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-110',
    userName: 'Chandan',
    companyName: 'Procucev',
    phoneNumber: '+918984483769',
    userEmail: 'chandan.behera@procucev.com',
    regDate: '2026-04-15T10:45:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-111',
    userName: 'suneel',
    companyName: 'test Construction Co Pvt Ltd',
    phoneNumber: '+919505224821',
    userEmail: 'harshitha.vantipally@procucev.com',
    regDate: '2026-03-13T09:20:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-112',
    userName: 'Pavan',
    companyName: 'Procucev Enterprise Solutions',
    phoneNumber: '+917996170801',
    userEmail: 'mn.rao@procucev.com',
    regDate: '2026-02-25T15:10:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-113',
    userName: 'Navin Kumar',
    companyName: 'Kumar Infrastructure & Buildcon',
    phoneNumber: '+919845012345',
    userEmail: 'navin.kumar@kumarinfra.in',
    regDate: '2026-02-18T10:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Email',
    isApproved: true,
  },
  {
    id: 'reg-client-114',
    userName: 'Meenakshi Sundaram',
    companyName: 'Sundaram Tech Components',
    phoneNumber: '+919444098765',
    userEmail: 'meenakshi@sundaramtech.com',
    regDate: '2026-02-12T11:45:00.000Z',
    status: 'New',
    sourceType: 'Email',
    isApproved: false,
  },
  {
    id: 'reg-client-115',
    userName: 'Rameshwar Lal',
    companyName: 'Lal Agro Equipment Pvt Ltd',
    phoneNumber: '+919829011223',
    userEmail: 'rlal@lalagro.co.in',
    regDate: '2026-02-05T14:20:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-116',
    userName: 'Anita Deshmukh',
    companyName: 'Deshmukh Heavy Engineering',
    phoneNumber: '+919820033445',
    userEmail: 'anita@deshmukheng.com',
    regDate: '2026-01-29T16:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-117',
    userName: 'Deepak Patel',
    companyName: 'Gujarat Precision Bearings',
    phoneNumber: '+919879044556',
    userEmail: 'deepak.patel@gujaratprecision.in',
    regDate: '2026-01-22T08:30:00.000Z',
    status: 'New',
    sourceType: 'WhatsApp',
    isApproved: false,
  },
  {
    id: 'reg-client-118',
    userName: 'Vikramaditya Roy',
    companyName: 'Bengal Steels & Alloys Ltd',
    phoneNumber: '+919830055667',
    userEmail: 'vikram.roy@bengalsteels.com',
    regDate: '2026-01-15T13:40:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-119',
    userName: 'Sunita Sharma',
    companyName: 'Apex Electrical Solutions',
    phoneNumber: '+919811066778',
    userEmail: 'sunita.sharma@apexelectrical.com',
    regDate: '2026-01-10T10:15:00.000Z',
    status: 'Accepted',
    sourceType: 'Email',
    isApproved: true,
  },
  {
    id: 'reg-client-120',
    userName: 'Karthik Raja',
    companyName: 'Coimbatore Foundry & Motors',
    phoneNumber: '+919443077889',
    userEmail: 'karthik@coimbatorefoundry.com',
    regDate: '2026-01-04T12:00:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-121',
    userName: 'Harish Chandra',
    companyName: 'Northern Power Controls',
    phoneNumber: '+919810088990',
    userEmail: 'harish@northernpower.in',
    regDate: '2025-12-28T14:50:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-122',
    userName: 'Pooja Bhatt',
    companyName: 'Himalayan Polymer Tech',
    phoneNumber: '+919819099001',
    userEmail: 'pooja.bhatt@himalayanpoly.com',
    regDate: '2025-12-20T09:10:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-123',
    userName: 'Santosh Hegde',
    companyName: 'Canara Pumps & Valves',
    phoneNumber: '+919844011234',
    userEmail: 'santosh@canarapumps.com',
    regDate: '2025-12-15T15:30:00.000Z',
    status: 'New',
    sourceType: 'Email',
    isApproved: false,
  },
  {
    id: 'reg-client-124',
    userName: 'Mohit Agarwal',
    companyName: 'Agarwal Metal Fabricators',
    phoneNumber: '+919829022345',
    userEmail: 'mohit@agarwalmetals.in',
    regDate: '2025-12-08T11:25:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-125',
    userName: 'Bhavna Joshi',
    companyName: 'Sterling Fasteners India',
    phoneNumber: '+919825033456',
    userEmail: 'bhavna@sterlingfasteners.com',
    regDate: '2025-12-01T10:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-126',
    userName: 'Anand Kulkarni',
    companyName: 'Pune Hydraulic Systems',
    phoneNumber: '+919822044567',
    userEmail: 'anand@punehydraulics.in',
    regDate: '2025-11-24T16:40:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-127',
    userName: 'Shalini Verma',
    companyName: 'Zenith Scientific Instruments',
    phoneNumber: '+919818055678',
    userEmail: 'shalini@zenithinstruments.com',
    regDate: '2025-11-18T13:15:00.000Z',
    status: 'New',
    sourceType: 'Email',
    isApproved: false,
  },
  {
    id: 'reg-client-128',
    userName: 'Rajesh Goud',
    companyName: 'Telangana Minerals & Ores',
    phoneNumber: '+919849066789',
    userEmail: 'rajesh@telanganaminerals.com',
    regDate: '2025-11-10T12:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-129',
    userName: 'Priyanka Das',
    companyName: 'Eastern Refractories Ltd',
    phoneNumber: '+919831077890',
    userEmail: 'p.das@easternrefractories.in',
    regDate: '2025-11-03T14:20:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-130',
    userName: 'Manish Tiwari',
    companyName: 'Central India Automations',
    phoneNumber: '+919827088901',
    userEmail: 'manish@centralindiaauto.com',
    regDate: '2025-10-27T09:30:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-131',
    userName: 'Lalit Somani',
    companyName: 'Somani Cable Corporation',
    phoneNumber: '+919829099012',
    userEmail: 'lalit@somanicables.com',
    regDate: '2025-10-20T10:45:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-132',
    userName: 'Kavita Menon',
    companyName: 'Malabar Logistics & Freight',
    phoneNumber: '+919847012346',
    userEmail: 'kavita@malabarfreight.in',
    regDate: '2025-10-14T11:50:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-133',
    userName: 'Girish Prabhu',
    companyName: 'Prabhu Industrial Seals',
    phoneNumber: '+919845023457',
    userEmail: 'girish@prabhuseals.com',
    regDate: '2025-10-07T15:10:00.000Z',
    status: 'Accepted',
    sourceType: 'Email',
    isApproved: true,
  },
  {
    id: 'reg-client-134',
    userName: 'Tanya Sengupta',
    companyName: 'Kolkata Heavy Machine Tools',
    phoneNumber: '+919830034568',
    userEmail: 'tanya@kolkatamachinetools.in',
    regDate: '2025-09-30T14:00:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-135',
    userName: 'Farhan Akhtar',
    companyName: 'Deccan Boiler Systems',
    phoneNumber: '+919849045679',
    userEmail: 'farhan@deccanboilers.com',
    regDate: '2025-09-22T08:40:00.000Z',
    status: 'New',
    sourceType: 'WhatsApp',
    isApproved: false,
  },
  {
    id: 'reg-client-136',
    userName: 'Smita Kadam',
    companyName: 'Kadam Industrial Coatings',
    phoneNumber: '+919821056780',
    userEmail: 'smita@kadamcoatings.com',
    regDate: '2025-09-15T12:15:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-137',
    userName: 'Ashwin Nair',
    companyName: 'Cochin Maritime Equipment',
    phoneNumber: '+919846067891',
    userEmail: 'ashwin@cochinmaritime.in',
    regDate: '2025-09-08T10:30:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-138',
    userName: 'Dinesh Singhania',
    companyName: 'Singhania Gears & Pinions',
    phoneNumber: '+919810078902',
    userEmail: 'dinesh@singhaniagears.com',
    regDate: '2025-09-01T16:20:00.000Z',
    status: 'Accepted',
    sourceType: 'Email',
    isApproved: true,
  },
  {
    id: 'reg-client-139',
    userName: 'Rekha Pillai',
    companyName: 'Pillai Agro Chemicals Ltd',
    phoneNumber: '+919847089013',
    userEmail: 'rekha@pillaiagro.com',
    regDate: '2025-08-25T11:00:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-140',
    userName: 'Umesh Yadav',
    companyName: 'Yadav Construction Earthmovers',
    phoneNumber: '+919829090124',
    userEmail: 'umesh@yadavconstruction.in',
    regDate: '2025-08-18T13:45:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
  {
    id: 'reg-client-141',
    userName: 'Geeta Subramaniam',
    companyName: 'Subramaniam Transformer Works',
    phoneNumber: '+919444001235',
    userEmail: 'geeta@subramaniamtransformers.com',
    regDate: '2025-08-10T14:10:00.000Z',
    status: 'Accepted',
    sourceType: 'Web App',
    isApproved: true,
  },
  {
    id: 'reg-client-142',
    userName: 'Rohit Bansal',
    companyName: 'Bansal Wire Industries',
    phoneNumber: '+919811012346',
    userEmail: 'rohit@bansalwires.in',
    regDate: '2025-08-04T09:25:00.000Z',
    status: 'Accepted',
    sourceType: 'Email',
    isApproved: true,
  },
  {
    id: 'reg-client-143',
    userName: 'Nandini Sen',
    companyName: 'Sen Engineering Instruments',
    phoneNumber: '+919831023457',
    userEmail: 'nandini@seninstruments.com',
    regDate: '2025-07-28T15:00:00.000Z',
    status: 'New',
    sourceType: 'Web App',
    isApproved: false,
  },
  {
    id: 'reg-client-144',
    userName: 'Kalyan Chakravarthy',
    companyName: 'Chakravarthy Forge & Precision',
    phoneNumber: '+919849034568',
    userEmail: 'kalyan@chakravarthyforge.com',
    regDate: '2025-07-20T10:15:00.000Z',
    status: 'Accepted',
    sourceType: 'WhatsApp',
    isApproved: true,
  },
];

let memoryClients = JSON.parse(JSON.stringify(INITIAL_CLIENTS));

function resetMemoryClients() {
  memoryClients = JSON.parse(JSON.stringify(INITIAL_CLIENTS));
}

function normalizeSourceType(source) {
  const s = String(source || '').toLowerCase().trim();
  if (s.includes('whatsapp') || s.includes('whats_app')) return 'WhatsApp';
  if (s.includes('email')) return 'Email';
  return 'Web App';
}

function normalizeStatus(isApproved, verificationStatus) {
  const vs = String(verificationStatus || '').toLowerCase();
  if (vs === 'rejected') return 'Rejected';
  if (isApproved === true || vs === 'verified' || vs === 'accepted' || vs === 'active') return 'Accepted';
  return 'New';
}

/**
 * Get registered clients list with search, filter, and pagination
 */
async function getRegisteredClients({
  search = '',
  sourceType = 'all',
  status = 'all',
  limit = 100,
  offset = 0,
} = {}) {
  let clients = memoryClients;

  if (pool.hasStorage()) {
    try {
      const sql = `
        SELECT u.uuid as id,
               COALESCE(u.full_name, u.first_name, u.username) as "userName",
               COALESCE(o.organization_name, 'Enterprise Client') as "companyName",
               COALESCE(u.phone, '') as "phoneNumber",
               COALESCE(u.email, u.username) as "userEmail",
               u.created_ts as "regDate",
               u.is_approved as "isApproved",
               u.verification_status as "verificationStatus",
               u.source_type as "sourceTypeRaw",
               u.is_whats_app as "isWhatsApp",
               u.is_web_app as "isWebApp"
          FROM "user" u
          LEFT JOIN organization o ON o.uuid = u.org_uuid
         ORDER BY u.created_ts DESC
         LIMIT 500
      `;
      const res = await pool.query(sql, [], { d1: true, useCache: false });
      if (res && res.rows && res.rows.length > 0) {
        const dbClients = res.rows.map((r) => {
          const source = r.isWhatsApp ? 'WhatsApp' : normalizeSourceType(r.sourceTypeRaw);
          const computedStatus = normalizeStatus(r.isApproved, r.verificationStatus);
          return {
            id: r.id,
            userName: r.userName || 'Enterprise User',
            companyName: r.companyName || 'Enterprise Client',
            phoneNumber: r.phoneNumber || '',
            userEmail: r.userEmail || '',
            regDate: (() => { if (!r.regDate) return new Date().toISOString(); const d = new Date(r.regDate); return !isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString(); })(),
            status: computedStatus,
            sourceType: source,
            isApproved: Boolean(r.isApproved),
          };
        });

        // Merge DB clients with memory clients to ensure complete roster
        const existingIds = new Set(dbClients.map((c) => c.id));
        const nonDuplicateMemory = memoryClients.filter((c) => !existingIds.has(c.id));
        clients = [...dbClients, ...nonDuplicateMemory];
      }
    } catch (err) {
      logger.warn('Failed to query registered clients from database, falling back to memory store', { error: err.message }, 'REGISTRATION_QUERIES');
    }
  }

  // Filter in memory
  let filtered = clients;

  if (sourceType && sourceType.toLowerCase() !== 'all') {
    const targetSource = sourceType.toLowerCase();
    filtered = filtered.filter((c) => c.sourceType.toLowerCase() === targetSource);
  }

  if (status && status.toLowerCase() !== 'all') {
    const targetStatus = status.toLowerCase();
    filtered = filtered.filter((c) => c.status.toLowerCase() === targetStatus);
  }

  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(
      (c) =>
        (c.userName && c.userName.toLowerCase().includes(q)) ||
        (c.companyName && c.companyName.toLowerCase().includes(q)) ||
        (c.phoneNumber && c.phoneNumber.toLowerCase().includes(q)) ||
        (c.userEmail && c.userEmail.toLowerCase().includes(q))
    );
  }

  const total = filtered.length;
  const numLimit = Math.max(1, parseInt(String(limit), 10) || 100);
  const numOffset = Math.max(0, parseInt(String(offset), 10) || 0);
  const paginated = filtered.slice(numOffset, numOffset + numLimit);

  return {
    total,
    clients: paginated,
    limit: numLimit,
    offset: numOffset,
  };
}

/**
 * Accept or reject a client registration
 */
async function updateClientRegistrationStatus(id, action, remarks = '') {
  const normAction = String(action || '').toLowerCase().trim();
  const isAccept = normAction === 'accept';
  const newStatus = isAccept ? 'Accepted' : 'Rejected';
  const isApproved = isAccept;
  const verificationStatus = isAccept ? 'VERIFIED' : 'REJECTED';

  // 1. Update memory store
  let client = memoryClients.find((c) => c.id === id);
  if (client) {
    client.status = newStatus;
    client.isApproved = isApproved;
    client.verificationStatus = verificationStatus;
    if (remarks) client.remarks = remarks;
  }

  // 2. Update persistent database if available
  if (pool.hasStorage()) {
    try {
      await pool.query(
        `UPDATE "user"
            SET is_approved = $1,
                verification_status = $2,
                last_modified_ts = now()
          WHERE uuid = $3`,
        [isApproved, verificationStatus, id],
        { d1: true }
      );

      // Also update buyer_accounts status if this user is a buyer
      const buyerStatus = isAccept ? 'ACTIVE_VERIFIED' : 'REJECTED';
      await pool.query(
        `UPDATE buyer_accounts
            SET status = $1,
                updated_at = now()
          WHERE id = $2`,
        [buyerStatus, id],
        { d1: true }
      );
    } catch (err) {
      logger.warn('Failed to update persistent registration status in database', { error: err.message, id, action }, 'REGISTRATION_QUERIES');
    }
  }

  // Also check storeService buyer accounts
  try {
    const storeService = require('../services/storeService');
    const matchingBuyer = (storeService.buyerAccounts || []).find((b) => b.id === id || b.corporateEmail === (client && client.userEmail));
    if (matchingBuyer) {
      matchingBuyer.status = isAccept ? 'ACTIVE_VERIFIED' : 'REJECTED';
      matchingBuyer.profileVerified = isAccept;
      matchingBuyer.verificationStatus = isAccept ? 'VERIFIED' : 'REJECTED';
    }
  } catch {
    // ignore
  }

  return client || {
    id,
    status: newStatus,
    isApproved,
    verificationStatus,
    remarks,
  };
}

module.exports = {
  INITIAL_CLIENTS,
  resetMemoryClients,
  getRegisteredClients,
  updateClientRegistrationStatus,
};

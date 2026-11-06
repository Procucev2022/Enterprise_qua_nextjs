// ==============================================================================
// REGISTRATION QUERIES
// ==============================================================================
// Queries and state management for Registered Clients in Action Center.
// Provides persistent storage via the "user" & "organization" identity tables
// with in-memory fallback to support offline, test, and standalone execution.
// ==============================================================================

const pool = require('./pool');
const { logger } = require('../services/loggerService');
const crypto = require('crypto');
const { getD1Binding, getD1HttpClient, batchD1 } = require('./d1Bridge');
const { IDENTITY_ROLE_MAP } = require('../config/constants');

const BUYER_ROLE_NAMES = Object.freeze(
  Object.keys(IDENTITY_ROLE_MAP).filter((roleName) => IDENTITY_ROLE_MAP[roleName] === 'buyer')
);

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

function createPersistenceError(error, operation, id = undefined, action = undefined) {
  logger.error('Client registration persistence failed', {
    error,
    operation,
    ...(id ? { registrationId: id } : {}),
    ...(action ? { action } : {}),
  }, 'REGISTRATION_QUERIES');
  const unavailable = new Error('Registration storage is temporarily unavailable. No action was completed. Please retry shortly.');
  unavailable.code = 'PERSISTENCE_UNAVAILABLE';
  unavailable.status = 503;
  unavailable.statusCode = 503;
  unavailable.cause = error;
  return unavailable;
}

function registrationConflict() {
  const conflict = new Error('This registration has already been processed. Refresh the list before taking another action.');
  conflict.code = 'REGISTRATION_ALREADY_PROCESSED';
  conflict.status = 409;
  conflict.statusCode = 409;
  return conflict;
}

function normalizeClientRow(row) {
  const source = row.isWhatsApp ? 'WhatsApp' : normalizeSourceType(row.sourceTypeRaw);
  const computedStatus = normalizeStatus(row.isApproved, row.verificationStatus);
  const registeredAt = row.regDate ? new Date(row.regDate) : new Date();
  return {
    id: row.id,
    userName: row.userName || 'Enterprise User',
    companyName: row.companyName || 'Enterprise Client',
    phoneNumber: row.phoneNumber || '',
    userEmail: row.userEmail || '',
    regDate: Number.isNaN(registeredAt.getTime()) ? new Date().toISOString() : registeredAt.toISOString(),
    status: computedStatus,
    sourceType: source,
    isApproved: Boolean(row.isApproved),
  };
}

function buildBuyerRolePredicate(startIndex) {
  const placeholders = BUYER_ROLE_NAMES.map((_, index) => `$${startIndex + index}`).join(', ');
  return `LOWER(REPLACE(COALESCE(r.role_name, ''), ' ', '')) IN (${placeholders})`;
}

function buildRegistrationSelect(whereClause) {
  return `SELECT u.uuid AS id,
      COALESCE(u.full_name, u.first_name, u.username) AS "userName",
      COALESCE(o.organization_name, 'Enterprise Client') AS "companyName",
      COALESCE(u.phone, '') AS "phoneNumber",
      COALESCE(u.email, u.username) AS "userEmail",
      u.created_ts AS "regDate",
      u.is_approved AS "isApproved",
      u.verification_status AS "verificationStatus",
      u.source_type AS "sourceTypeRaw",
      u.is_whats_app AS "isWhatsApp",
      u.is_web_app AS "isWebApp",
      COUNT(*) OVER() AS total
    FROM "user" u
    INNER JOIN role r ON r.uuid = u.role_uuid
    LEFT JOIN organization o ON o.uuid = u.org_uuid
    ${whereClause}`;
}

async function queryRegistrationRows(sql, params) {
  return pool.query(sql, params, { d1: true, useCache: false });
}

async function findRegistrationInDatabase(id) {
  const rolePredicate = buildBuyerRolePredicate(2);
  const sql = buildRegistrationSelect(`WHERE u.uuid = $1 AND ${rolePredicate}`);
  const result = await queryRegistrationRows(sql, [id, ...BUYER_ROLE_NAMES]);
  return result.rows[0] ? normalizeClientRow(result.rows[0]) : null;
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
  if (pool.hasStorage()) {
    try {
      const filters = [buildBuyerRolePredicate(1)];
      const params = [...BUYER_ROLE_NAMES];
      const addFilter = (value, predicate) => {
        params.push(value);
        filters.push(predicate(params.length));
      };

      if (sourceType && sourceType.toLowerCase() !== 'all') {
        addFilter(sourceType.toLowerCase(), (index) => `(CASE
          WHEN u.is_whats_app = true OR LOWER(COALESCE(u.source_type, '')) LIKE '%whatsapp%' THEN 'whatsapp'
          WHEN LOWER(COALESCE(u.source_type, '')) LIKE '%email%' THEN 'email'
          ELSE 'web app' END) = $${index}`);
      }
      if (status && status.toLowerCase() !== 'all') {
        addFilter(status.toLowerCase(), (index) => `(CASE
          WHEN LOWER(COALESCE(u.verification_status, '')) = 'rejected' THEN 'rejected'
          WHEN u.is_approved = true OR LOWER(COALESCE(u.verification_status, '')) IN ('verified', 'accepted', 'active') THEN 'accepted'
          ELSE 'new' END) = $${index}`);
      }
      if (search && search.trim()) {
        const searchValue = `%${search.trim().toLowerCase()}%`;
        addFilter(searchValue, (index) => `(
          LOWER(COALESCE(u.full_name, u.first_name, u.username, '')) LIKE $${index}
          OR LOWER(COALESCE(o.organization_name, '')) LIKE $${index}
          OR LOWER(COALESCE(u.phone, '')) LIKE $${index}
          OR LOWER(COALESCE(u.email, u.username, '')) LIKE $${index}
        )`);
      }

      const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 200);
      const safeOffset = Math.max(parseInt(String(offset), 10) || 0, 0);
      const where = `WHERE ${filters.join(' AND ')}`;
      const pageParams = [...params, safeLimit, safeOffset];
      const limitIndex = pageParams.length - 1;
      const offsetIndex = pageParams.length;
      const registrationQuery = buildRegistrationSelect(where);
      const sql = `${registrationQuery}
        ORDER BY u.created_ts DESC, u.uuid DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
      const result = await queryRegistrationRows(sql, pageParams);
      let rows = result.rows || [];
      let total = rows.length > 0 ? Number(rows[0].total) || 0 : 0;

      if (rows.length === 0 || rows[0].total === undefined) {
        const fromClause = registrationQuery.slice(registrationQuery.indexOf('FROM'));
        const countSql = `SELECT COUNT(*) AS total ${fromClause}`;
        const countResult = await queryRegistrationRows(countSql, params);
        total = Number(countResult.rows[0]?.total) || 0;
      }

      rows = rows.map((row) => normalizeClientRow(row));
      return { total, clients: rows, limit: safeLimit, offset: safeOffset };
    } catch (err) {
      throw createPersistenceError(err, 'list-registrations');
    }
  }

  let clients = memoryClients;

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
  const numLimit = Math.min(Math.max(parseInt(String(limit), 10) || 100, 1), 200);
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
async function updateClientRegistrationStatus(id, action, remarks = '', actor = {}) {
  const normAction = String(action || '').toLowerCase().trim();
  if (!['accept', 'reject'].includes(normAction)) {
    const invalidAction = new Error('Registration action must be accept or reject.');
    invalidAction.code = 'INVALID_REGISTRATION_ACTION';
    throw invalidAction;
  }
  const isAccept = normAction === 'accept';
  const newStatus = isAccept ? 'Accepted' : 'Rejected';
  const isApproved = isAccept;
  const verificationStatus = isAccept ? 'VERIFIED' : 'REJECTED';
  const normalizedRemarks = String(remarks || '');
  const actorId = actor.uuid || actor.id || actor.sub || null;
  const actorName = actor.fullName || actor.name || actor.email || 'Management Authority';
  const actorEmail = actor.email || null;

  if (pool.hasStorage()) {
    try {
      const eventId = crypto.randomUUID();
      const d1 = getD1Binding() || getD1HttpClient();
      let updatedRow;

      if (d1) {
        const statements = [
          {
            text: `UPDATE "user"
              SET is_approved = $1, verification_status = $2, last_modified_ts = CURRENT_TIMESTAMP
              WHERE uuid = $3
                AND COALESCE(is_approved, false) = false
                AND LOWER(COALESCE(verification_status, '')) NOT IN ('verified', 'accepted', 'active', 'rejected')
                AND role_uuid IN (SELECT uuid FROM role WHERE LOWER(REPLACE(role_name, ' ', '')) IN ($4, $5, $6, $7, $8, $9))
              RETURNING uuid AS id, COALESCE(full_name, first_name, username) AS "userName",
                COALESCE(phone, '') AS "phoneNumber", COALESCE(email, username) AS "userEmail",
                created_ts AS "regDate", is_approved AS "isApproved", verification_status AS "verificationStatus",
                source_type AS "sourceTypeRaw", is_whats_app AS "isWhatsApp"`,
            params: [isApproved, verificationStatus, id, ...BUYER_ROLE_NAMES],
          },
          {
            text: `INSERT INTO client_registration_events
              (id, user_id, user_email, action, previous_status, new_status,
               actor_id, actor_name, actor_email, remarks, created_at)
              SELECT $1, u.uuid, u.email, $3, 'New', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP
              FROM "user" u WHERE u.uuid = $2 AND changes() = 1
              RETURNING id`,
            params: [eventId, id, newStatus, actorId, actorName, actorEmail, normalizedRemarks],
          },
          {
            text: `UPDATE buyer_accounts SET status = $1, updated_at = CURRENT_TIMESTAMP
              WHERE EXISTS (SELECT 1 FROM client_registration_events WHERE id = $2)
                AND (id = $3 OR LOWER(corporate_email) =
                  (SELECT LOWER(email) FROM "user" WHERE uuid = $3))`,
            params: [isAccept ? 'ACTIVE_VERIFIED' : 'REJECTED', eventId, id],
          },
        ];
        const results = await batchD1(d1, statements);
        updatedRow = results[0]?.rows?.[0] || null;
        if (updatedRow && !results[1]?.rows?.[0]) {
          throw new Error('Registration status changed without a durable event record.');
        }
      } else {
        updatedRow = await pool.withTransaction(async (client) => {
          const rolePredicate = buildBuyerRolePredicate(2);
          const currentSql = `${buildRegistrationSelect(`WHERE u.uuid = $1 AND ${rolePredicate}`)} FOR UPDATE OF u`;
          const currentResult = await client.query(currentSql, [id, ...BUYER_ROLE_NAMES]);
          const current = currentResult.rows[0];
          if (!current) return null;
          if (normalizeStatus(current.isApproved, current.verificationStatus) !== 'New') {
            throw registrationConflict();
          }

          const updateSql = `UPDATE "user"
            SET is_approved = $1, verification_status = $2, last_modified_ts = CURRENT_TIMESTAMP
            WHERE uuid = $3 AND COALESCE(is_approved, false) = false
              AND LOWER(COALESCE(verification_status, '')) NOT IN ('verified', 'accepted', 'active', 'rejected')
              AND role_uuid IN (SELECT uuid FROM role WHERE LOWER(REPLACE(role_name, ' ', '')) IN ($4, $5, $6, $7, $8, $9))
            RETURNING uuid AS id, COALESCE(full_name, first_name, username) AS "userName",
              COALESCE(phone, '') AS "phoneNumber", COALESCE(email, username) AS "userEmail",
              created_ts AS "regDate", is_approved AS "isApproved", verification_status AS "verificationStatus",
              source_type AS "sourceTypeRaw", is_whats_app AS "isWhatsApp"`;
          const updateResult = await client.query(updateSql, [isApproved, verificationStatus, id, ...BUYER_ROLE_NAMES]);
          const saved = updateResult.rows[0];
          if (!saved) throw registrationConflict();

          await client.query(
            `UPDATE buyer_accounts SET status = $1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $2 OR LOWER(corporate_email) = LOWER($3)`,
            [isAccept ? 'ACTIVE_VERIFIED' : 'REJECTED', id, saved.userEmail]
          );
          await client.query(
            `INSERT INTO client_registration_events
              (id, user_id, user_email, action, previous_status, new_status,
               actor_id, actor_name, actor_email, remarks, created_at)
              VALUES ($1, $2, $3, $4, 'New', $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
            [eventId, saved.id, saved.userEmail, newStatus, actorId, actorName, actorEmail, normalizedRemarks]
          );
          return { ...saved, companyName: current.companyName };
        });
      }

      if (!updatedRow) {
        const current = await findRegistrationInDatabase(id);
        if (!current) return null;
        throw registrationConflict();
      }

      const updated = normalizeClientRow({ ...updatedRow, companyName: updatedRow.companyName || 'Enterprise Client' });
      syncBuyerAccountCache(id, updated.userEmail, newStatus, isApproved, verificationStatus);
      logger.audit(`Client registration ${newStatus.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
        registrationId: id,
        actorId,
        eventId,
      });
      return { ...updated, remarks: normalizedRemarks };
    } catch (err) {
      if (err?.code === 'REGISTRATION_ALREADY_PROCESSED') throw err;
      throw createPersistenceError(err, 'update-registration-status', id, normAction);
    }
  }

  const client = memoryClients.find((candidate) => candidate.id === id);
  if (!client) return null;
  if (client.status !== 'New') throw registrationConflict();
  client.status = newStatus;
  client.isApproved = isApproved;
  client.verificationStatus = verificationStatus;
  if (normalizedRemarks) client.remarks = normalizedRemarks;
  syncBuyerAccountCache(id, client.userEmail, newStatus, isApproved, verificationStatus);
  logger.audit(`Client registration ${newStatus.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
    registrationId: id,
    actorId,
  });
  return client;
}

function syncBuyerAccountCache(id, email, status, isApproved, verificationStatus) {
  try {
    const storeService = require('../services/storeService');
    const matchingBuyer = (storeService.buyerAccounts || []).find((buyer) => (
      buyer.id === id || String(buyer.corporateEmail || '').toLowerCase() === String(email || '').toLowerCase()
    ));
    if (matchingBuyer) {
      matchingBuyer.status = status === 'Accepted' ? 'ACTIVE_VERIFIED' : 'REJECTED';
      matchingBuyer.profileVerified = isApproved;
      matchingBuyer.verificationStatus = verificationStatus;
    }
  } catch (error) {
    logger.warn('Could not synchronize the registration decision to the process-local buyer cache', {
      error,
      operation: 'sync-registration-cache',
      registrationId: id,
    }, 'REGISTRATION_QUERIES');
  }
}

module.exports = {
  INITIAL_CLIENTS,
  resetMemoryClients,
  getRegisteredClients,
  updateClientRegistrationStatus,
};

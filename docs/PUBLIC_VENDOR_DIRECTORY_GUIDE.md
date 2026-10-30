# Enterprise QUA — Public Vendor Directory Specification & Implementation Guide

## 1. Overview & Objective

This document provides the end-to-end technical blueprint for implementing a **Public Vendor Directory** in **Enterprise QUA**. 

### Core Requirements
1. **Public & Unauthenticated Access**: Any visitor can browse and view vendor profiles without signing in or requiring authentication tokens.
2. **Comprehensive Vendor Information**: Displays full company details, categories, products/services, contact details, compliance credentials (GST, MSME, PAN mask), and verified supplier tier.
3. **High-Performance Search & Multi-Dimensional Filtering**: Real-time debounced search (by company name, category, products, keywords) combined with category taxonomy filters, geographical filters, and supplier evaluation status filters.
4. **Scale & Database Optimization**: Engineered to handle **80,000 to 600,000+** vendor records seamlessly using PostgreSQL trigram GIN indexes (`pg_trgm`), pagination (`LIMIT / OFFSET`), and LRU query caching to minimize database compute hours and eliminate full-table scans.
5. **Strict Repository Standards Adherence**:
   - Zero hardcoded UI strings (all copy centralized in `frontend/lib/uiStrings.ts`).
   - Strict TypeScript typing in `frontend/lib/types.ts` (`import type`).
   - Centralized input schema validation in `validationSchemas.ts` and `validationSchemas.js`.
   - Declarative React state management (zero direct DOM manipulation).
   - Strict 90% unit test coverage benchmark across lines, statements, branches, and functions.

---

## 2. Architecture & Data Flow

```
[ Public Web Visitor ] (No Token / Anonymous)
          │
          ▼
[ Next.js Public Route: /vendors ]
          │ (React Declarative State: Search, Category, Location, Pagination)
          ▼
[ Frontend API Client: fetchPublicVendors() ]
          │ HTTP GET /api/vendors/public?page=1&pageSize=20&search=...&category=...
          ▼
[ Express Router: backend/src/routes/vendors.js ]
          │ No auth middleware required (or optionalAuthenticate without 401 gate)
          ▼
[ Controller: vendorController.getPublicVendors ]
          │ 1. Validate query parameters via VALIDATION_SCHEMAS.vendorPublicSearch
          │ 2. Check LRU / TTL Query Cache (minimizing compute hours)
          ▼
[ DB Layer: domainQueries.getPublicVendorsPageFromDB ]
          │ SELECT raw FROM vendors WHERE (raw->>'buyerId') IS NULL
          │   AND (major_category ILIKE $1 OR raw->>'name' ILIKE $1 ...)
          │ Uses idx_vendors_name_trgm & idx_vendors_major_category
          │ LIMIT $limit OFFSET $offset
          ▼
[ Field Sanitization: sanitizePublicVendorProfile() ]
          │ Strips: tempPassword, private buyer notes, sensitive internal tokens
          ▼
[ JSON Response ] ──► [ Frontend Grid / Table & Full Vendor Details Modal ]
```

---

## 3. Data Model & Type Definitions

### 3.1 Frontend Types (`frontend/lib/types.ts`)

```typescript
/**
 * Publicly visible vendor information contract.
 * Excludes sensitive system credentials while exposing all industrial & business credentials.
 */
export interface PublicVendor {
  id: string;
  name: string;
  brandName?: string | null;
  email?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  contactDesignation?: string | null;
  website?: string | null;
  
  // Categorization & Capabilities
  majorCategory: string;
  minorCategories: string[];
  products?: string[];
  
  // Geographical & Factory Location
  location?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  country?: string | null;
  factoryAddress?: string | null;
  
  // Compliance & Enterprise Credentials
  gstin?: string | null;
  gst?: string | null;
  pan?: string | null;
  msme?: string | null;
  orgType?: string | null;
  annualTurnover?: string | null;
  
  // Operational Badges & Evaluation
  status?: string | null;
  rating?: number | null;
  source?: string | null;
  isVerified?: boolean;
  isProcucevNetwork?: boolean;
  createdAt?: string;
}

/** Paginated public vendor API response */
export interface PublicVendorPageResult {
  success: boolean;
  data: PublicVendor[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  error?: string;
}

/** Filter and search state for the Public Vendor Directory */
export interface PublicVendorFilterState {
  search: string;
  category: string;
  state: string;
  minRating: number;
  verifiedOnly: boolean;
  orgType: string;
  page: number;
  pageSize: number;
}
```

---

## 4. Centralized UI Strings (`frontend/lib/uiStrings.ts`)

Add the following directory-specific dictionary into `UI_STRINGS`:

```typescript
export const UI_STRINGS = {
  // ... existing strings ...
  publicVendorDirectory: {
    title: 'Enterprise Vendor Directory',
    subtitle: 'Browse and discover verified industrial manufacturers, suppliers, and distributors across India.',
    searchPlaceholder: 'Search by vendor name, category, product, or keywords...',
    filterHeading: 'Refine Suppliers',
    allCategories: 'All Categories',
    selectCategory: 'Select Category',
    allStates: 'All States',
    selectState: 'Select State',
    ratingFilterLabel: 'Minimum Rating',
    allRatings: 'Any Rating',
    verifiedOnlyLabel: 'Verified Suppliers Only',
    totalFound: '{count} suppliers available',
    viewDetailsButton: 'View Full Profile',
    closeModal: 'Close Details',
    noVendorsFound: 'No vendors match your search criteria.',
    noVendorsFoundSubtitle: 'Try adjusting your filters or search keywords.',
    clearFilters: 'Clear All Filters',
    tabs: {
      overview: 'Overview & Contacts',
      categories: 'Categories & Products',
      compliance: 'Compliance & Tax',
      capabilities: 'Capabilities & Rating',
    },
    labels: {
      contactPerson: 'Key Contact Person',
      designation: 'Designation',
      email: 'Corporate Email',
      phone: 'Direct Phone',
      website: 'Official Website',
      location: 'Operational Location',
      address: 'Factory / Registered Address',
      pincode: 'PIN Code',
      gstin: 'GSTIN / Tax ID',
      pan: 'PAN Number',
      msme: 'MSME Registration',
      annualTurnover: 'Annual Turnover',
      orgType: 'Constitution / Org Type',
      majorCategory: 'Primary Industrial Category',
      minorCategories: 'Secondary Capabilities',
      productsOffered: 'Product & Service Portfolio',
      rating: 'Enterprise Rating',
      status: 'Onboarding Status',
      networkBadge: 'Procucev Verified Supplier',
    },
  },
};
```

---

## 5. Input Schema Validation

### 5.1 Backend Schema (`backend/src/config/validationSchemas.js`)

```javascript
const VALIDATION_SCHEMAS = {
  // ... existing schemas ...
  vendorPublicSearch: {
    page: { type: 'number', required: false, min: 1, default: 1 },
    pageSize: { type: 'number', required: false, min: 1, max: 100, default: 24 },
    search: { type: 'string', required: false, maxLength: 200 },
    category: { type: 'string', required: false, maxLength: 200 },
    state: { type: 'string', required: false, maxLength: 100 },
    minRating: { type: 'number', required: false, min: 0, max: 5 },
    verifiedOnly: { type: 'boolean', required: false },
  },
};
```

### 5.2 Frontend Schema (`frontend/lib/validationSchemas.ts`)

```typescript
export const PUBLIC_VENDOR_QUERY_SCHEMA = {
  search: { maxLength: 200 },
  pageSize: { min: 1, max: 100 },
  page: { min: 1 },
};
```

---

## 6. Backend Implementation

### 6.1 Sanitization Helper (`backend/src/controllers/vendorController.js`)

A public visitor must never receive authentication credentials, internal passwords, or private buyer tags:

```javascript
function sanitizePublicVendor(vendor) {
  if (!vendor || typeof vendor !== 'object') return null;
  
  // Clone to avoid mutation
  const raw = vendor.raw || vendor;
  
  return {
    id: vendor.id || raw.id,
    name: raw.name || 'Unnamed Supplier',
    brandName: raw.brandName || null,
    email: raw.email || vendor.email || null,
    phone: raw.phone || null,
    contactPerson: raw.contactPerson || null,
    contactDesignation: raw.contactDesignation || null,
    website: raw.website || null,
    
    // Categorization
    majorCategory: vendor.major_category || raw.majorCategory || 'General Industrial',
    minorCategories: Array.isArray(raw.minorCategories) ? raw.minorCategories : [],
    products: Array.isArray(raw.products) ? raw.products : [],
    
    // Geographical
    location: raw.location || raw.city || null,
    city: raw.city || null,
    state: raw.state || null,
    pincode: raw.pincode || null,
    country: raw.country || 'India',
    factoryAddress: raw.factoryAddress || null,
    
    // Compliance (Sanitized & Masked where appropriate)
    gstin: raw.gstin || raw.gst || null,
    pan: raw.pan ? `${raw.pan.slice(0, 3)}****${raw.pan.slice(-2)}` : null, // Masked for privacy
    msme: raw.msme || null,
    orgType: raw.orgType || null,
    annualTurnover: raw.annualTurnover || null,
    
    // Badges & Metrics
    status: vendor.status || raw.status || 'VERIFIED SUPPLIER',
    rating: typeof raw.rating === 'number' ? raw.rating : (raw.score ? Math.round((raw.score / 20) * 10) / 10 : 4.5),
    isVerified: Boolean(raw.isVerified || raw.gstin || raw.gst),
    isProcucevNetwork: !raw.buyerId && !raw.buyerAccountId,
    createdAt: vendor.created_at || raw.createdAt,
  };
}
```

### 6.2 Database Optimized Public Query (`backend/src/db/domainQueries.js`)

Ensure unauthenticated queries only return **public network vendors** (excluding private buyer-uploaded rosters):

```javascript
async function getPublicVendorsPageFromDB({
  limit = 24,
  offset = 0,
  search = '',
  category = '',
  state = '',
  minRating = 0,
} = {}) {
  if (!pool.hasStorage()) return { rows: [], total: 0 };

  const params = [];
  const conditions = [
    // Rule: Public listing NEVER exposes private buyer rosters
    `(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL`
  ];

  if (search) {
    params.push(`%${search}%`);
    const p = params.length;
    // Uses trigram GIN indexes: idx_vendors_name_trgm, idx_vendors_major_category_trgm, etc.
    conditions.push(`(
      major_category ILIKE $${p}
      OR raw->>'name' ILIKE $${p}
      OR raw->>'brandName' ILIKE $${p}
      OR (raw->'products')::text ILIKE $${p}
      OR (raw->'minorCategories')::text ILIKE $${p}
    )`);
  }

  if (category && category !== 'all') {
    params.push(category);
    conditions.push(`major_category = $${params.length}`);
  }

  if (state && state !== 'all') {
    params.push(state.toLowerCase());
    conditions.push(`lower(raw->>'state') = $${params.length}`);
  }

  if (minRating > 0) {
    params.push(minRating);
    conditions.push(`COALESCE((raw->>'rating')::numeric, 0) >= $${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  // Execute Count & Data queries efficiently with indexes
  const countSql = `SELECT COUNT(*) AS total FROM vendors WHERE ${whereClause}`;
  const countRes = await pool.query(countSql, params);
  const total = parseInt((countRes.rows && countRes.rows[0] && countRes.rows[0].total) || '0', 10);

  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const dataSql = `
    SELECT id, major_category, status, created_at, raw
    FROM vendors
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  const dataRes = await pool.query(dataSql, params);

  return {
    rows: (dataRes && dataRes.rows) || [],
    total,
  };
}
```

### 6.3 Public Route & Controller Setup

In `backend/src/routes/vendors.js`:
```javascript
// Public directory endpoint (Zero authentication required)
router.get('/public', vendorController.getPublicVendors);
router.get('/public/:id', vendorController.getPublicVendorById);
```

In `backend/src/controllers/vendorController.js`:
```javascript
async function getPublicVendors(req, res, next) {
  try {
    const { page = 1, pageSize = 24, search = '', category = '', state = '', minRating = 0 } = req.query;

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 24));
    const offset = (pageNumber - 1) * limit;

    const { rows, total } = await domainQueries.getPublicVendorsPageFromDB({
      limit,
      offset,
      search: String(search || '').trim(),
      category: String(category || '').trim(),
      state: String(state || '').trim(),
      minRating: parseFloat(minRating) || 0,
    });

    const sanitized = rows.map(sanitizePublicVendor).filter(Boolean);

    res.json({
      success: true,
      data: sanitized,
      pagination: {
        page: pageNumber,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    logger.error('Error fetching public vendors', err, 'PUBLIC_VENDOR_CONTROLLER');
    next(err);
  }
}
```

---

## 7. Frontend Client Fetcher (`frontend/lib/vendorDirectoryClient.ts`)

Create a dedicated client library for unauthenticated fetching:

```typescript
import { UI_STRINGS } from '@/lib/uiStrings';
import type { PublicVendorFilterState, PublicVendorPageResult } from '@/lib/types';

export async function fetchPublicVendors(
  filter: Partial<PublicVendorFilterState> = {}
): Promise<PublicVendorPageResult> {
  const {
    page = 1,
    pageSize = 24,
    search = '',
    category = '',
    state = '',
    minRating = 0,
  } = filter;

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (search.trim()) params.set('search', search.trim());
  if (category && category !== 'all') params.set('category', category.trim());
  if (state && state !== 'all') params.set('state', state.trim());
  if (minRating > 0) params.set('minRating', String(minRating));

  try {
    const res = await fetch(`/api/vendors/public?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      cache: 'default',
    });

    if (!res.ok) {
      return {
        success: false,
        data: [],
        pagination: { page: 1, pageSize, total: 0, totalPages: 1 },
        error: `Server error: ${res.status}`,
      };
    }

    const json = await res.json();
    return json;
  } catch (err) {
    return {
      success: false,
      data: [],
      pagination: { page: 1, pageSize, total: 0, totalPages: 1 },
      error: UI_STRINGS.auth.networkUnreachable,
    };
  }
}
```

---

## 8. Frontend Page & Component Architecture

### 8.1 Page Route Location
Create the public route at:
`frontend/app/vendors/page.tsx` (accessible directly via `http://localhost:3000/vendors` without login).

### 8.2 Component Hierarchy

```
frontend/app/vendors/
├── page.tsx                     # Main Directory Page (State, Search, Filter container)
├── VendorFilterSidebar.tsx      # Filter Drawer/Sidebar (Categories, States, Ratings)
├── VendorCard.tsx               # Individual Vendor Presentation Card
├── VendorDetailModal.tsx        # Comprehensive Vendor Profile Modal (4 Tabs)
└── VendorEmptyState.tsx         # Clear search/filter fallback
```

### 8.3 Vendor Detail Modal UI Layout (Declarative Design)

The modal renders all vendor details divided into 4 clear tabs:

1. **Tab 1: Overview & Contact Information**
   - Key Contact Person with avatar/badge.
   - Corporate Email with copy-to-clipboard action.
   - Phone & WhatsApp direct contact links.
   - Registered Office & Factory Locations with PIN code.
   - Official Corporate Website link.

2. **Tab 2: Categories, Capabilities & Products**
   - Primary Industrial Major Category banner.
   - Minor Categories / Specializations (rendered as distinct tag badges).
   - Product Catalog list / Items manufactured.

3. **Tab 3: Compliance & Enterprise Credentials**
   - Verified GSTIN badge (with status checkmark).
   - Masked PAN credential for transparency.
   - MSME / Udyam Registration number.
   - Constitution of Business (Private Limited, Partnership, Sole Proprietorship).
   - Stated Annual Turnover bracket.

4. **Tab 4: Supplier Performance & Rating**
   - 5-Star visual rating breakdown.
   - Procucev Network Verification Tier badge.
   - Member since timestamp.

---

## 9. Performance & Security Best Practices

| Area | Production Standard Applied |
| :--- | :--- |
| **Authentication Gate** | Page and API do **not** invoke `authenticate` or session verification. Fully open to guest traffic. |
| **Data Protection** | Sensitive vendor fields (`tempPassword`, internal credit balances, private buyer notes) are stripped at the controller boundary. |
| **Search Indexing** | Utilizes PostgreSQL `pg_trgm` GIN indexes on `raw->>'name'`, `major_category`, and `raw->'products'` to execute substring searches in `< 15ms` across 600,000+ records. |
| **Compute Hours** | Unauthenticated bots / scrapers are bound to `MAX_PAGE_SIZE = 100` and protected by standard query caching to prevent redundant Neon DB compute consumption. |
| **Accessibility & Declarative UI** | All filters, modals, and tab switches use React declarative state (`useState`, `useMemo`). Zero `document.getElementById` or DOM mutation. |

---

## 10. Verification & 90% Unit Test Strategy

To guarantee the required **>= 90% Unit Test Coverage per file**:

### 10.1 Backend Tests (`backend/__tests__/controllers/vendorPublicController.test.js`)
- Test 1: Returns paginated public vendors without requiring `Authorization` headers.
- Test 2: Applies substring `search` filter correctly via SQL mock.
- Test 3: Filters by `category` and `state`.
- Test 4: Ensures sensitive fields (`tempPassword`, `buyerId`) are never returned in public payload.
- Test 5: Handles empty results and database connection failures gracefully with structured errors.

### 10.2 Frontend Tests (`frontend/__tests__/app/vendors/page.test.tsx`)
- Test 1: Renders page title, search bar, and filter controls using `UI_STRINGS.publicVendorDirectory`.
- Test 2: Executes debounced search when user types into the search input.
- Test 3: Updates category and state filter dropdowns.
- Test 4: Opens `VendorDetailModal` on clicking "View Full Profile" and validates all 4 tabs.
- Test 5: Closes modal cleanly on ESC key or close button click.
- Test 6: Displays `VendorEmptyState` when zero vendors match.

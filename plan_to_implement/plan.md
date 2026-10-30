The code review is complete. I’ll now lay out the full plan, including security enforcement, OTP login, inactivity logout, session-history reporting, vendor visibility, testing, and deployment order.

# Complete Phased Implementation Plan

**This is a plan only; no application code has been implemented.**

## 1. Target Behavior

1. The Vendor Directory’s **data and page content** will be accessible only to authenticated users with the `category_manager` role.
2. Buyers, vendors, admins, logged-out visitors, and forged role sessions cannot access directory APIs by calling them directly.
3. Selecting **Vendor Directory** on the main login page opens a dedicated login containing
   - Procucev email address
   - Email OTP
   - No password
   - No mobile number
   - No shared passkey or demo key
   - No registration option
4. Only an active, approved `category_manager` account with an `@procucev.com` email can receive and verify the OTP.
5. Every directory session ends after **5 minutes of inactivity**.
6. Every directory login records identity, login time, logout time, duration, last activity, IP/device information, and logout reason.
7. Vendors successfully created or imported by a Category Manager appear in the private directory by default, without requiring evaluation or approval.
8. Existing buyer-private vendors remain excluded.

### Recommended implementation decisions

- Treat “Procucev mail ID” as an email ending in **`@procucev.com`**, case-insensitive.
- Interpret “Category Manager only” strictly: **do not automatically include admins**.
- Require the dedicated directory OTP even when someone already has another application session. This prevents unaudited directory access and ensures every directory session follows the same inactivity rules.
- Calculate session duration as `logout_at - login_at`; this is elapsed session time, not a claim about productive working time.

---

## 2. Important Findings From the Current Code

- The directory login is still a shared-passkey gate in [VendorDirectoryLoginGate.tsx:27](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/app/vendors/VendorDirectoryLoginGate.tsx#L27).
- The backend accepts shared directory credentials and returns a 24-hour token in [vendorController.js:1195](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/backend/src/controllers/vendorController.js#L1195).
- Anonymous directory endpoints remain exposed in [vendors.js:14](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/backend/src/routes/vendors.js#L14).
- The canonical role is already `category_manager` in [types.ts:1](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/lib/types.ts#L1).
- Backend role middleware already exists in [auth.js:110](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/backend/src/middleware/auth.js#L110).
- Existing OTP login requires email and mobile and can send SMS, so it cannot be reused unchanged for this requirement.
- Category-Manager-created and imported network vendors are already visible without an approval gate. The remaining work is preserving that behavior, adding regression tests, and refreshing caches after uploads.
- The current frontend coverage failure must be resolved through meaningful tests, particularly for [page.tsx](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/app/vendors/login/page.tsx) and [vendorAuthClient.ts](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/lib/vendorAuthClient.ts).

---

# Phase 1 — Database and Session-Audit Foundation

## Objective

Create durable directory-session records before implementing OTP and automatic logout.

## Implementation steps

1. Add a `vendor_directory_sessions` table through the existing migration process and update [schema.sql](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/backend/src/db/schema.sql).

2. Include these fields
   - `id` — UUID used as the directory session ID
   - `user_uuid`
   - `email`
   - `role`
   - `auth_method` — initially `EMAIL_OTP`
   - `login_at`
   - `last_activity_at`
   - `logout_at`
   - `duration_seconds`
   - `logout_reason`
   - `status` — `ACTIVE`, `CLOSED`
   - `ip_address`
   - `user_agent`
   - `created_at`

3. Support logout reasons such as
   - `MANUAL`
   - `INACTIVITY`
   - `TOKEN_EXPIRED`
   - `REVOKED`
   - `SESSION_EXPIRED`

4. Add indexes for
   - `user_uuid + login_at`
   - `email + login_at`
   - `status + last_activity_at`

5. Add a dedicated query module supporting the project’s PostgreSQL, D1, and development fallback patterns
   - Create session
   - Find active session
   - Update activity
   - Close session
   - List session history
   - Reconcile abandoned sessions

6. Extend JWT creation in [authService.js:199](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/backend/src/services/authService.js#L199) so directory tokens contain
   - `sessionId`
   - `scope: vendor_directory`
   - Existing user ID, email, and role claims

7. Never store raw JWTs or OTP codes in session-history records.

## Acceptance criteria

- A directory login can be represented from creation through logout.
- Duration and logout reason can be queried later.
- Multiple logins by the same user remain separate records.
- Existing authentication tables and OTP behavior remain unaffected.

---

# Phase 2 — Dedicated Procucev Email-OTP Backend

## Objective

Implement email-only OTP specifically for Category Manager directory access without changing the main platform login.

## New endpoints

- `POST /api/auth/vendor-directory/request-otp`
- `POST /api/auth/vendor-directory/verify-otp`

## Implementation steps

1. Add schemas in the centralized backend validation module
   - Normalize email to lowercase and trim whitespace.
   - Validate standard email format.
   - Require the `@procucev.com` domain.
   - Validate six-digit OTP format.

2. During OTP request
   - Resolve the account from the identity database.
   - Confirm it is active and approved.
   - Confirm its canonical role is exactly `category_manager`.
   - Do not issue an OTP for unauthorized accounts.
   - Do not require a mobile number.
   - Send the OTP only through the existing mailer service.

3. Namespace stored OTP keys by email and purpose, for example `VENDOR_DIRECTORY_LOGIN`, so these codes cannot be exchanged with another login flow.

4. Add
   - OTP expiration
   - Single-use consumption
   - Maximum verification attempts
   - Resend throttling
   - Request rate limiting by IP and normalized email

5. During verification
   - Recheck domain, account status, and role.
   - Reject expired, consumed, or incorrect OTPs.
   - Create the directory-session database record.
   - Issue a signed token containing the session ID and directory scope.
   - Return the user and session expiry/activity information.

6. Centralize configuration and messages in the existing constants and validation modules. Remove the old shared directory key from environment examples after its endpoint is retired.

## Acceptance criteria

- A valid Category Manager receives an email OTP without entering a mobile number.
- Buyer, vendor, admin, non-Procucev, inactive, and unknown accounts cannot obtain directory access.
- An OTP cannot be reused or used against another email/purpose.
- Successful verification creates both a signed session token and an audit record.

---

# Phase 3 — Protect Directory APIs and Remove Passkey Access

## Objective

Make authorization a backend guarantee rather than only a frontend display rule.

## Implementation steps

1. Replace anonymous `/public` directory routes with authenticated directory routes, or protect equivalent existing routes after migrating all consumers.

2. Apply this middleware sequence
   - `authenticate`
   - `requireRole('category_manager')`
   - A new directory-session middleware

3. The directory-session middleware must verify
   - Token scope is `vendor_directory`
   - `sessionId` exists
   - Database session is active
   - Token user matches the session user
   - Five-minute inactivity limit has not been exceeded

4. Protect directory list, filters, details, and any other endpoints exposing supplier contact/compliance information.

5. Update the directory data client to send the directory bearer token. It currently does not send authorization, so this is a required change alongside the route migration.

6. Replace public caching with private/no-store response behavior. Ensure shared browser or CDN caches cannot serve one user’s protected response to another visitor.

7. Remove
   - `/directory-auth`
   - Shared passkey verification
   - Hardcoded fallback credentials
   - Demo-key behavior
   - The obsolete 24-hour anonymous directory token

8. Do **not** blanket-restrict unrelated vendor APIs used by buyers, vendors, RFQs, and onboarding. Migrate directory consumers specifically to avoid regressions.

## Acceptance criteria

- Anonymous requests return `401`.
- Authenticated non-Category-Manager requests return `403`.
- A Category Manager token without a valid directory session cannot access directory data.
- Expired/inactive sessions return a identifiable session error.
- No protected directory response is publicly cacheable.
- Existing non-directory vendor workflows continue working.

---

# Phase 4 — Frontend OTP Login and Route Guard

## Objective

Replace the passkey UI and connect the directory page to the new authenticated session.

## Implementation steps

1. Rebuild [VendorDirectoryLoginGate.tsx](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/app/vendors/VendorDirectoryLoginGate.tsx) into a two-step flow
   - Enter Procucev email and request OTP
   - Enter OTP and verify

2. Include
   - Loading states
   - Resend countdown
   - Expired/incorrect OTP guidance
   - Email-delivery failure guidance
   - Accessible labels and keyboard navigation
   - Centralized UI strings and validation schemas

3. Rewrite [vendorAuthClient.ts](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/lib/vendorAuthClient.ts) to
   - Call the new OTP endpoints
   - Store only the authenticated directory session
   - Expose session ID, user, and activity state
   - Clear session data on logout or authorization failure
   - Remove offline shared-key authentication

4. Update [login/page.tsx](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/app/vendors/login/page.tsx)
   - Redirect an already-valid directory session to `/vendors`
   - Otherwise render the OTP flow
   - Never treat the presence of a token as proof of validity; validate with the backend

5. Update [vendors/page.tsx:58](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/app/vendors/page.tsx#L58)
   - Show no vendor data while session validation is pending
   - Redirect unauthenticated visitors to directory login
   - Show an access-denied result for invalid roles
   - Handle server-side session expiry

6. Navigation behavior
   - On the logged-out main login page, **Vendor Directory** remains an entry to the OTP login.
   - After authentication, show the direct directory navigation only for `category_manager`.
   - Hide it for buyer, vendor, and admin navigation.

## Acceptance criteria

- No passkey or demo-key UI remains.
- The complete email-to-OTP-to-directory journey works.
- Unauthorized users never see directory records, including during loading.
- Main application login sessions are not accidentally overwritten.

---

# Phase 5 — Five-Minute Inactivity Logout

## Objective

Implement reliable client behavior plus server-side enforcement and audit closure.

## Frontend implementation

1. Create a directory-specific inactivity hook using React state/effects.

2. Track genuine interaction
   - Mouse/pointer movement
   - Keyboard input
   - Click/touch
   - Scroll
   - Touch interaction

3. Throttle activity processing so mouse movement does not continuously execute timers or state updates.

4. Reset a 300-second timer after activity.

5. At timeout
   - Call the backend logout endpoint with reason `INACTIVITY`
   - Revoke the token
   - Close the audit record
   - Clear local session data
   - Redirect to directory login with an explanatory timeout message

6. Synchronize activity and logout across directory tabs using `BroadcastChannel` or an equivalent storage event.

7. Handle hidden tabs and resume
   - On visibility restoration, compare current time with last activity.
   - Log out immediately if five minutes have already elapsed.

## Backend implementation

1. Add a throttled activity heartbeat endpoint.

2. Send a heartbeat no more than approximately once per minute, only when the page is active and the user has interacted.

3. Reject heartbeats and directory requests when the stored last activity is more than five minutes old.

4. Close abandoned sessions using a scheduled reconciliation job where supported, with lazy reconciliation as a fallback
   - `logout_at = last_activity_at + 5 minutes`
   - `logout_reason = INACTIVITY`

5. Do not depend solely on `beforeunload`; browser closure and crashes are not guaranteed to send logout requests.

## Acceptance criteria

- No activity for five minutes logs the user out.
- Activity shortly before five minutes extends the session.
- One tab’s logout ends the other directory tabs.
- Direct API calls cannot bypass inactivity enforcement.
- Browser closure does not leave a permanently active audit session.

---

# Phase 6 — Login History and Audit Reporting

## Objective

Make the stored login history queryable and visible to authorized personnel.

## Implementation steps

1. Add a protected session-history API with filters for
   - Email/user
   - Date range
   - Logout reason
   - Active/closed status

2. Return
   - Name and email
   - Role
   - Login time
   - Last activity
   - Logout time
   - Duration
   - Logout reason
   - IP address and user agent where permitted

3. Restrict reporting authorization
   - Admin: all directory session history
   - Category Manager: optionally their own history only
   - No public or vendor access

4. Add a session-history section to the existing audit interface at [audit-log.tsx:95](file:///S:/procucev/Precucev-github/Enterprise_qua_nextjs/frontend/app/admin/audit-log.tsx#L95), or expose it through a dedicated audit tab.

5. Add pagination and stable descending login-time sorting.

6. Preserve structured backend audit logs for OTP requested, login succeeded/failed, manual logout, inactivity logout, and rejected authorization.

## Acceptance criteria

- Every successful directory login has exactly one session record.
- Manual and inactivity logouts close the same record rather than creating duplicates.
- Duration matches login/logout timestamps.
- Unauthorized roles cannot read the history.
- OTPs and raw tokens never appear in reports or logs.

---

# Phase 7 — New Vendor Visibility by Default

## Objective

Guarantee that Category Manager additions appear immediately inside the now-private directory.

## Implementation steps

1. Preserve the current network-vendor defaults for single creation and bulk import
   - No buyer ownership
   - Procucev network/category-manager source
   - No mandatory evaluation or approval gate

2. Ensure every successfully persisted Category Manager vendor is included in directory list, filters, pagination, and search.

3. Keep buyer-owned vendors excluded.

4. After single creation or bulk import
   - Invalidate the frontend directory cache
   - Invalidate relevant server query caches
   - Refetch the directory
   - Display the new vendor without requiring a browser reload

5. Return useful creation/import results so partially failed bulk uploads can be reported accurately.

6. Add regression tests proving
   - Unevaluated CM-created vendors are visible
   - CM bulk-imported vendors are visible
   - Buyer-private vendors remain hidden
   - New records do not become anonymously publicly visible

**No new `is_public` flag is currently needed; existing ownership-based visibility already supports the requirement.**

---

# Phase 8 — Testing, Quality Gates, and Deployment

## Test coverage

1. **Backend authentication tests**
   - Domain, role, account-status, OTP expiry, attempts, single use, resend limits
   - No SMS/mobile dependency
   - Correct JWT scope and session ID

2. **Authorization tests**
   - Anonymous, buyer, vendor, admin, valid CM, inactive CM, expired session
   - Direct API access and cache headers

3. **Inactivity tests**
   - Timer at 299 and 300 seconds
   - Activity reset
   - Cross-tab logout
   - Hidden-tab/resume behavior
   - Heartbeat rejection and abandoned-session reconciliation

4. **Audit tests**
   - Login/logout records, duration, reasons, filtering, authorization

5. **Frontend tests**
   - OTP request/verify/resend/error/loading flows
   - Route guards and role-based navigation
   - Upload success followed by directory refresh

6. Replace obsolete passkey tests instead of retaining tests for removed behavior.

## Mandatory verification

Run, in order

```bash
npm run build
npm run test:coverage
npm run check:coverage
npm run typecheck
npm run lint
npm run db:migrate
npm run check:quality
```

Every changed file must independently meet the repository’s **90% statements, branches, functions, and lines** requirement. No coverage exclusions.

Also perform browser testing for

- Valid Category Manager OTP login
- Invalid domain and wrong-role login
- Manual logout
- Five-minute inactivity logout
- Vendor creation/import and immediate visibility
- Direct URL/API access attempts
- Existing buyer/vendor login regressions

## Deployment order

1. Apply the database migration.
2. Deploy backend OTP, session, and protected directory APIs.
3. Deploy the frontend OTP flow and route guards.
4. Remove remaining passkey configuration and obsolete client code.
5. Verify production email delivery, audit writes, token revocation, and private cache behavior.
6. Monitor backend error and audit logs during initial usage.

---

## Recommended Implementation Sequence

**Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8**

Phases 1–4 form the minimum secure, usable OTP directory. Phase 5 adds inactivity enforcement, Phase 6 exposes the audit history, and Phase 7 finalizes the upload-visibility guarantees.
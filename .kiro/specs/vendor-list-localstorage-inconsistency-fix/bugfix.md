# Bugfix Requirements Document

## Introduction

The same buyer account shows different vendor figures on different PCs or browsers. For the Procucev organisation (buyer Sudheer Kangala) on `/buyer/vendor-summary`, PC A shows TOTAL VENDOR 29 / ACTIVE 29 / "Select All (29 suppliers)" and PC B shows TOTAL VENDOR 12 / ACTIVE 12 / "Select All (12 suppliers)". The OCR and 360° evaluated counts (1) match on both PCs.

The cause is that the client builds the buyer's vendor list by merging the server vendor list with vendor upload history kept in the browser's local storage. Vendors that were uploaded on one PC, especially through CSV/text uploads that never reach the server, exist only in that PC's browser. Changes to vendors, such as activating, deactivating, editing, or deleting, are also partly applied only to local storage. Each browser therefore shows a different vendor list, different counts, different supplier selections for RFQs, and different upload history.

The user asked for a fix across the whole application, not only the vendor figures. The server (database via the backend API) must be the only source of truth for business data, so every PC and browser shows the same figures for the same account. Authentication/session tokens and pure UI preferences (theme, column layouts, dismissed reminders, session-timer bookkeeping) may stay in browser storage. Vendor data that exists today only in local storage must not be lost.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a buyer opens the vendor summary page on a browser whose local storage holds vendor upload history THEN the system adds local-only vendors that do not match a server vendor to the list, so TOTAL VENDOR, ACTIVE, and INACTIVE counts differ from other browsers for the same account

1.2 WHEN a buyer opens the vendor summary page on a browser with no local upload history (new PC, other browser, cleared storage) THEN the system shows only the server vendors, so that browser shows fewer vendors than a browser that holds local history

1.3 WHEN a buyer uploads a vendor file of CSV or text type THEN the system keeps the parsed vendors only in that browser's local storage and does not persist them to the server

1.4 WHEN a vendor upload of any file type completes THEN the system records the upload history (batches, file names, row records) only in that browser's local storage, so other browsers cannot see it

1.5 WHEN a server vendor has no GSTIN or vendor code and a matching local upload record has one THEN the system shows the locally stored GSTIN or vendor code on that vendor only in the browser that holds the record

1.6 WHEN a buyer activates, deactivates, edits, or deletes a vendor that exists in local upload history THEN the system applies the change only to local storage, so the vendor's status and details differ between browsers

1.7 WHEN a buyer selects suppliers in the manual RFQ flow (including "Select All") THEN the system offers the merged list including local-only vendors, so the supplier choices and count differ between browsers and RFQs can target vendors the server does not know

1.8 WHEN the vendor evaluation summary, ingestion wizard, or store-level vendor and evaluation lookups read the buyer's vendors THEN the system uses the merged list including local-only vendors, so these screens show figures that depend on the browser

1.9 WHEN the cached vendor list in session storage is older than the server data THEN the system can show stale vendor figures until the cache is refreshed

1.10 WHEN any other screen in the application stores or reads business data (vendors, upload history, statuses, counts, tasks, approvals, tickets, documents, payment dues, registrations, scorecards, or similar records) in browser storage as its source of truth THEN the system shows data that differs between browsers for the same account

### Expected Behavior (Correct)

2.1 WHEN a buyer opens the vendor summary page on any browser THEN the system SHALL build the vendor list, TOTAL VENDOR, ACTIVE, INACTIVE, and "Select All (N suppliers)" figures only from server data, so the figures are identical on every PC and browser for the same account

2.2 WHEN a buyer opens the vendor summary page on a browser with no local storage data THEN the system SHALL show the same complete vendor list and figures as any other browser for that account

2.3 WHEN a buyer uploads a vendor file of any supported type, including CSV and text THEN the system SHALL persist the resulting vendors to the server through the backend, and SHALL NOT show them as saved until the server confirms the save

2.4 WHEN a vendor upload of any file type completes THEN the system SHALL store the upload history on the server, scoped to the uploading buyer's organisation, and SHALL show the same upload history on every browser for that account

2.5 WHEN vendor attributes such as GSTIN or vendor code are shown THEN the system SHALL show the values stored on the server and SHALL NOT fill them in from browser storage

2.6 WHEN a buyer activates, deactivates, edits, or deletes a vendor THEN the system SHALL apply the change on the server and SHALL show the server result on every browser for that account

2.7 WHEN a buyer selects suppliers in the manual RFQ flow THEN the system SHALL offer only server vendors that belong to the buyer, so the supplier list and "Select All" count are identical on every browser

2.8 WHEN the vendor evaluation summary, ingestion wizard, or store-level vendor and evaluation lookups read the buyer's vendors THEN the system SHALL use only the server vendor list

2.9 WHEN a client-side cache of server data exists THEN the system SHALL treat it as a short-lived performance cache that is replaced by fresh server data on load, and SHALL NOT use it as a source of truth across sessions or devices

2.10 WHEN any screen in the application needs business data THEN the system SHALL read it from and write it to the server, keeping browser storage only for authentication/session tokens and pure UI preferences

2.11 WHEN a buyer signs in on a browser whose local storage still holds legacy vendor upload history with vendors that are not on the server THEN the system SHALL run a one-time, idempotent migration that sends those vendors (and their upload history) to the server for the owning buyer's organisation, without creating duplicates of vendors already on the server

2.12 WHEN the one-time migration has confirmed that the server accepted the legacy local data THEN the system SHALL remove the legacy business data from browser storage and SHALL NOT read it again for display

2.13 WHEN the one-time migration fails or partly fails (network error, validation error, session expiry) THEN the system SHALL keep the legacy local data unchanged so it can be retried, and SHALL NOT discard any vendor record

2.14 WHEN legacy local upload history belongs to a different buyer or organisation than the signed-in account THEN the system SHALL NOT migrate it into the signed-in account

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a buyer's server vendor list contains duplicate entries by email, vendor code, or name THEN the system SHALL CONTINUE TO deduplicate them the same way as today

3.2 WHEN vendors are shown to a buyer THEN the system SHALL CONTINUE TO filter them by buyer ownership so a buyer sees only their organisation's vendors

3.3 WHEN RFQ and PO summaries are filtered by vendor THEN the system SHALL CONTINUE TO apply the same filtering rules as today

3.4 WHEN vendor categories are shown, counted, or filtered THEN the system SHALL CONTINUE TO normalise categories the same way as today

3.5 WHEN OCR and 360° evaluation counts are shown on the vendor summary page THEN the system SHALL CONTINUE TO show the same server-derived values as today

3.6 WHEN a buyer uploads a non-CSV vendor file (for example Excel or PDF) that currently goes through the backend start-job path THEN the system SHALL CONTINUE TO process it through the backend with the same parsing, validation, and confirmation flow

3.7 WHEN a buyer cancels or abandons an unconfirmed upload in the initial setup flow THEN the system SHALL CONTINUE TO discard that unconfirmed upload so it does not appear as saved vendors

3.8 WHEN the application stores authentication tokens or session data in browser storage THEN the system SHALL CONTINUE TO store and read them the same way, so sign-in, sign-out, and authenticated API calls keep working

3.9 WHEN the application stores pure UI preferences (theme, table column settings, dismissed reminders, session-timer expiry and role) in browser storage THEN the system SHALL CONTINUE TO store and apply them per browser

3.10 WHEN a buyer opens the vendor summary page on a browser that never had local upload history THEN the system SHALL CONTINUE TO show the same server vendors it shows today

3.11 WHEN the server vendor list is loaded from the bootstrap endpoint THEN the system SHALL CONTINUE TO load vendors, evaluations, RFQs, and other bootstrap data in one request with the same performance characteristics

3.12 WHEN vendor upload history is shown THEN the system SHALL CONTINUE TO show only uploads made by the current buyer's organisation, with file name, upload time, and record counts

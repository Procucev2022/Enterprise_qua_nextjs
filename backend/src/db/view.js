#!/usr/bin/env node
// ==============================================================================
// NEON POSTGRESQL DATABASE VIEWER & LIVE RECORD EDITOR
// ==============================================================================
// Serves an interactive localhost Web UI and CLI summary to inspect and edit all
// tables, records, and raw JSONB payloads in the Neon PostgreSQL database.
// ==============================================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const pool = require('./pool');

const DEFAULT_PORT = parseInt(process.env.DB_VIEW_PORT || process.env.PORT || '5005', 10);

const KNOWN_POSTGRES_TABLES = [
  'vendors',
  'rfqs',
  'evaluations',
  'vendor_catalogue',
  'buyer_accounts',
  'user',
  'organization',
  'category_division',
  'org_division_category',
  'ai_feed',
  'audit_logs',
];

/**
 * Determine primary key column for a given table.
 */
function getPrimaryKeyColumn(tableName, sampleRow = null) {
  if (sampleRow) {
    if ('id' in sampleRow) return 'id';
    if ('uuid' in sampleRow) return 'uuid';
    if ('otp_key' in sampleRow) return 'otp_key';
    if ('signature' in sampleRow) return 'signature';
  }
  const uuidTables = ['role', 'org_types', 'master_status', 'organization', 'user', 'category_division', 'org_division_category'];
  if (uuidTables.includes(tableName)) return 'uuid';
  if (tableName === 'auth_otp_codes') return 'otp_key';
  if (tableName === 'auth_revoked_tokens') return 'signature';
  return 'id';
}

/**
 * Fetch rows and schema for a specific PostgreSQL table.
 */
async function fetchPostgresTable(tableName) {
  if (!pool.pool) return { rows: [], columns: [], count: 0, pkColumn: 'id' };
  try {
    const countRes = await pool.query(`SELECT count(*) as total FROM "${tableName}"`);
    const count = parseInt(countRes?.rows?.[0]?.total || 0, 10);
    const result = await pool.query(`SELECT * FROM "${tableName}" LIMIT 500`);
    const rows = result.rows || [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    const pkColumn = getPrimaryKeyColumn(tableName, rows[0]);
    return { rows, columns, count, pkColumn };
  } catch {
    return { rows: [], columns: [], count: 0, pkColumn: 'id' };
  }
}

/**
 * Discover all public tables and fetch their schemas & row counts.
 */
async function getAllPostgresData() {
  if (!pool.pool) return {};
  const data = {};
  
  let tableList = KNOWN_POSTGRES_TABLES;
  try {
    const res = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    if (res?.rows?.length > 0) {
      const dynamicList = res.rows.map((r) => r.table_name);
      tableList = Array.from(new Set([...KNOWN_POSTGRES_TABLES, ...dynamicList]));
    }
  } catch {
    // Keep standard KNOWN_POSTGRES_TABLES
  }

  for (const table of tableList) {
    data[table] = await viewModule.fetchPostgresTable(table);
  }
  return data;
}

/**
 * Update a single record in a PostgreSQL table.
 */
async function updateTableRecord(tableName, recordId, updates) {
  if (!pool.pool) throw new Error('Database pool is not configured');
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error('Invalid table name');
  if (!recordId) throw new Error('Record ID is required for update');
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw new Error('No fields provided to update');
  }

  const pkColumn = getPrimaryKeyColumn(tableName);
  const keys = Object.keys(updates).filter((k) => /^[a-zA-Z0-9_]+$/.test(k) && k !== pkColumn);
  
  if (keys.length === 0) {
    throw new Error('No editable column fields provided');
  }

  const setClauses = [];
  const values = [];

  keys.forEach((key, index) => {
    setClauses.push(`"${key}" = $${index + 1}`);
    let val = updates[key];
    if (val !== null && typeof val === 'object') {
      val = JSON.stringify(val);
    }
    values.push(val);
  });

  const queryText = `UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE "${pkColumn}" = $${keys.length + 1} RETURNING *`;
  values.push(recordId);

  const res = await pool.query(queryText, values);
  if (!res.rows || res.rows.length === 0) {
    throw new Error(`Record with ${pkColumn}='${recordId}' not found in table '${tableName}'`);
  }
  return res.rows[0];
}

/**
 * Insert a new record into a PostgreSQL table.
 */
async function insertTableRecord(tableName, recordData) {
  if (!pool.pool) throw new Error('Database pool is not configured');
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error('Invalid table name');
  if (!recordData || typeof recordData !== 'object' || Object.keys(recordData).length === 0) {
    throw new Error('No record data provided');
  }

  const keys = Object.keys(recordData).filter((k) => /^[a-zA-Z0-9_]+$/.test(k));
  if (keys.length === 0) {
    throw new Error('No valid columns provided');
  }

  const cols = keys.map((k) => `"${k}"`).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => {
    const val = recordData[k];
    if (val !== null && typeof val === 'object') {
      return JSON.stringify(val);
    }
    return val;
  });

  const queryText = `INSERT INTO "${tableName}" (${cols}) VALUES (${placeholders}) RETURNING *`;
  const res = await pool.query(queryText, values);
  return res.rows[0];
}

/**
 * Delete a single record from a PostgreSQL table.
 */
async function deleteTableRecord(tableName, recordId) {
  if (!pool.pool) throw new Error('Database pool is not configured');
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) throw new Error('Invalid table name');
  if (!recordId) throw new Error('Record ID is required for deletion');

  const pkColumn = getPrimaryKeyColumn(tableName);
  const queryText = `DELETE FROM "${tableName}" WHERE "${pkColumn}" = $1 RETURNING *`;
  const res = await pool.query(queryText, [recordId]);
  if (!res.rows || res.rows.length === 0) {
    throw new Error(`Record with ${pkColumn}='${recordId}' not found in table '${tableName}'`);
  }
  return res.rows[0];
}

/**
 * HTML Template for the Neon DB Viewer & Live Editor UI.
 */
function getViewerHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neon PostgreSQL — Database Viewer & Editor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #0B0F19;
      --bg-surface: #111827;
      --bg-elevated: #1F2937;
      --bg-glass: rgba(17, 24, 39, 0.85);
      --border-subtle: #374151;
      --border-focus: #00E699;
      --text-primary: #F9FAFB;
      --text-secondary: #9CA3AF;
      --text-muted: #6B7280;
      --accent-neon: #00E699;
      --accent-neon-glow: rgba(0, 230, 153, 0.35);
      --accent-blue: #3B82F6;
      --accent-warning: #F59E0B;
      --accent-danger: #EF4444;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
      --shadow-lg: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: radial-gradient(circle at top right, #064E3B 0%, var(--bg-base) 50%);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    header {
      background: var(--bg-glass);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-subtle);
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-badge {
      background: linear-gradient(135deg, #00E699, #059669);
      width: 38px;
      height: 38px;
      border-radius: var(--radius-md);
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 1.15rem;
      color: #064E3B;
      box-shadow: 0 0 15px var(--accent-neon-glow);
    }

    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .brand-subtitle {
      font-size: 0.75rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    button, .btn {
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0.55rem 1rem;
      border-radius: var(--radius-md);
      border: 1px solid var(--border-subtle);
      background: var(--bg-elevated);
      color: var(--text-primary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
      text-decoration: none;
    }

    button:hover, .btn:hover {
      background: #2D3748;
      border-color: #4B5563;
      transform: translateY(-1px);
    }

    .btn-primary {
      background: linear-gradient(135deg, #059669, #00E699);
      color: #064E3B;
      border-color: #00E699;
      font-weight: 700;
      box-shadow: 0 0 12px rgba(0, 230, 153, 0.4);
    }
    .btn-primary:hover {
      background: linear-gradient(135deg, #047857, #059669);
      color: #FFF;
      box-shadow: 0 0 18px rgba(0, 230, 153, 0.6);
    }

    .btn-edit {
      background: rgba(59, 130, 246, 0.15);
      border-color: rgba(59, 130, 246, 0.4);
      color: #93C5FD;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
    }
    .btn-edit:hover {
      background: rgba(59, 130, 246, 0.3);
      border-color: #3B82F6;
      color: #FFF;
    }

    .btn-delete {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.3);
      color: #FCA5A5;
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
    }
    .btn-delete:hover {
      background: rgba(239, 68, 68, 0.3);
      border-color: #EF4444;
      color: #FFF;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.3rem 0.75rem;
      border-radius: 9999px;
      background: rgba(0, 230, 153, 0.15);
      color: var(--accent-neon);
      border: 1px solid rgba(0, 230, 153, 0.3);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-neon);
      box-shadow: 0 0 8px var(--accent-neon);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .container {
      max-width: 1600px;
      margin: 0 auto;
      padding: 2rem;
      width: 100%;
      flex: 1;
    }

    /* KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .kpi-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .kpi-card:hover {
      border-color: var(--accent-neon);
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      transform: translateY(-2px);
    }

    .kpi-card::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, #00E699, #3B82F6);
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .kpi-card:hover::after { opacity: 1; }

    .kpi-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }

    .kpi-value {
      font-size: 1.8rem;
      font-weight: 800;
      color: var(--text-primary);
      letter-spacing: -0.03em;
    }

    .kpi-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* Tab Controls */
    .tabs-wrapper {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 0.5rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-secondary);
      padding: 0.55rem 1.1rem;
      font-size: 0.85rem;
      font-weight: 600;
      border-radius: var(--radius-md);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .tab-btn:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    .tab-btn.active {
      background: rgba(0, 230, 153, 0.15);
      color: var(--accent-neon);
      border-color: rgba(0, 230, 153, 0.4);
      box-shadow: 0 0 12px rgba(0, 230, 153, 0.2);
    }

    .tab-badge {
      background: rgba(0, 0, 0, 0.35);
      font-size: 0.7rem;
      padding: 0.15rem 0.45rem;
      border-radius: 9999px;
      font-weight: 700;
    }

    /* Table Toolbar */
    .table-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      overflow: hidden;
      box-shadow: var(--shadow-lg);
    }

    .table-toolbar {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      background: rgba(17, 24, 39, 0.6);
    }

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex: 1;
      min-width: 280px;
    }

    .search-box {
      position: relative;
      flex: 1;
      max-width: 400px;
    }

    .search-input {
      width: 100%;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 0.55rem 1rem 0.55rem 2.25rem;
      font-size: 0.85rem;
      color: var(--text-primary);
      outline: none;
      transition: all 0.2s ease;
    }

    .search-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(0, 230, 153, 0.2);
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
      font-size: 0.9rem;
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    /* Data Table */
    .table-responsive {
      overflow-x: auto;
      max-height: 65vh;
    }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    table.data-table th {
      background: #0E1626;
      color: var(--text-secondary);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--border-subtle);
      position: sticky;
      top: 0;
      z-index: 10;
      white-space: nowrap;
      user-select: none;
      cursor: pointer;
    }

    table.data-table th:hover {
      color: var(--text-primary);
    }

    table.data-table td {
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid rgba(55, 65, 81, 0.4);
      color: var(--text-primary);
      vertical-align: middle;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    table.data-table tr:hover td {
      background: rgba(0, 230, 153, 0.04);
    }

    .actions-cell {
      display: flex;
      gap: 0.4rem;
      align-items: center;
      white-space: nowrap;
    }

    .badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: var(--radius-sm);
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-green { background: rgba(0, 230, 153, 0.2); color: #00E699; }
    .badge-blue { background: rgba(59, 130, 246, 0.2); color: #60A5FA; }
    .badge-amber { background: rgba(245, 158, 11, 0.2); color: #FBBF24; }
    .badge-red { background: rgba(239, 68, 68, 0.2); color: #EF4444; }

    .json-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      background: #080D17;
      border: 1px solid var(--border-subtle);
      padding: 0.25rem 0.5rem;
      border-radius: var(--radius-sm);
      color: #6EE7B7;
      cursor: pointer;
      display: inline-block;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .json-code:hover {
      border-color: var(--accent-neon);
      color: #FFF;
    }

    .empty-state {
      padding: 4rem 2rem;
      text-align: center;
      color: var(--text-muted);
    }
    .empty-icon {
      font-size: 2.5rem;
      margin-bottom: 0.75rem;
      opacity: 0.5;
    }

    /* Modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      display: none;
      place-items: center;
      z-index: 1000;
      padding: 1.5rem;
    }
    .modal-overlay.open { display: grid; }

    .modal-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 850px;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
      animation: modalIn 0.2s ease-out;
    }

    @keyframes modalIn {
      from { opacity: 0; transform: scale(0.96) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    .modal-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-title {
      font-size: 1.1rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
      background: rgba(17, 24, 39, 0.4);
    }

    .modal-json {
      background: #080C14;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 1.25rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #E2E8F0;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }

    /* Form Inputs in Edit Modal */
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.25rem;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .form-group.full-width {
      grid-column: 1 / -1;
    }

    .form-label {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .form-input, .form-select, .form-textarea {
      width: 100%;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 0.65rem 0.85rem;
      font-size: 0.88rem;
      color: var(--text-primary);
      outline: none;
      transition: all 0.2s ease;
      font-family: inherit;
    }

    .form-input:focus, .form-select:focus, .form-textarea:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(0, 230, 153, 0.2);
    }

    .form-textarea {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      min-height: 140px;
      resize: vertical;
      line-height: 1.4;
    }

    .form-input:disabled {
      background: #171E2E;
      color: var(--text-muted);
      cursor: not-allowed;
      border-color: #2D3748;
    }

    .json-valid-indicator {
      font-size: 0.7rem;
      font-weight: 600;
    }
    .json-valid-indicator.valid { color: #00E699; }
    .json-valid-indicator.invalid { color: #EF4444; }

    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: var(--bg-elevated);
      border: 1px solid var(--accent-neon);
      color: var(--text-primary);
      padding: 0.75rem 1.25rem;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      font-size: 0.85rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s ease;
      z-index: 2000;
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    .toast.error {
      border-color: var(--accent-danger);
      color: #FCA5A5;
    }

    footer {
      border-top: 1px solid var(--border-subtle);
      padding: 1.25rem 2rem;
      text-align: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      background: var(--bg-surface);
      margin-top: auto;
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="logo-badge">N</div>
      <div>
        <div class="brand-title">Neon PostgreSQL Database Viewer & Editor</div>
        <div class="brand-subtitle">Procucev Enterprise Domain DB</div>
      </div>
    </div>
    <div class="header-actions">
      <div class="status-pill" id="healthPill">
        <div class="status-dot"></div>
        <span id="healthText">Neon Connected</span>
      </div>
      <button onclick="fetchAllData()" id="refreshBtn">🔄 Refresh</button>
      <button onclick="openAddModal()" class="btn btn-primary">➕ Add Record</button>
      <a href="/api/all-data" target="_blank" class="btn">⬇️ Export JSON</a>
    </div>
  </header>

  <main class="container">
    <!-- Top KPI Cards -->
    <section class="kpi-grid" id="kpiGrid">
      <div class="kpi-card">
        <div class="kpi-title">Vendors</div>
        <div class="kpi-value" id="kpiVendors">-</div>
        <div class="kpi-meta">Neon vendors table</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">RFQs</div>
        <div class="kpi-value" id="kpiRfqs">-</div>
        <div class="kpi-meta">Neon rfqs table</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Evaluations</div>
        <div class="kpi-value" id="kpiEvaluations">-</div>
        <div class="kpi-meta">Neon evaluations table</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Vendor Catalogue</div>
        <div class="kpi-value" id="kpiCatalogue">-</div>
        <div class="kpi-meta">Neon catalogue items</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Buyer Accounts</div>
        <div class="kpi-value" id="kpiBuyers">-</div>
        <div class="kpi-meta">Neon buyer accounts</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">AI Feed & Audit</div>
        <div class="kpi-value" id="kpiFeed">-</div>
        <div class="kpi-meta">Neon events & audit logs</div>
      </div>
    </section>

    <!-- Table Selector Tabs -->
    <div class="tabs-wrapper" id="tableTabs">
      <!-- Tabs populated dynamically -->
    </div>

    <!-- Main Table View -->
    <div class="table-card">
      <div class="table-toolbar">
        <div class="toolbar-left">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="searchInput" class="search-input" placeholder="Search rows in active table..." oninput="handleSearch(this.value)">
          </div>
          <span id="rowCountLabel" style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 500;">0 records</span>
        </div>
        <div class="toolbar-right">
          <button onclick="openAddModal()">➕ Add Row</button>
          <button onclick="exportActiveTableCsv()">📊 Export CSV</button>
        </div>
      </div>

      <div class="table-responsive">
        <table class="data-table" id="dataTable">
          <thead id="tableHead"></thead>
          <tbody id="tableBody"></tbody>
        </table>
        <div class="empty-state" id="emptyState" style="display:none;">
          <div class="empty-icon">📂</div>
          <div style="font-weight:600; font-size:1rem; margin-bottom:0.25rem;">No Records in this Neon Table</div>
          <div>This table currently contains 0 rows or no rows match your search filter. Click "+ Add Record" to insert one.</div>
        </div>
      </div>
    </div>
  </main>

  <!-- JSON Inspector Modal -->
  <div class="modal-overlay" id="jsonModal" onclick="closeModal('jsonModal')">
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="modalTitle">Record Details</div>
        <div style="display:flex; gap:0.5rem;">
          <button onclick="copyModalJson()">📋 Copy JSON</button>
          <button onclick="closeModal('jsonModal')">✕</button>
        </div>
      </div>
      <div class="modal-body">
        <pre class="modal-json" id="modalContent"></pre>
      </div>
    </div>
  </div>

  <!-- Edit Record Modal -->
  <div class="modal-overlay" id="editModal" onclick="closeModal('editModal')">
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="editModalTitle">✏️ Edit Record</div>
        <button onclick="closeModal('editModal')">✕</button>
      </div>
      <div class="modal-body">
        <form id="editForm" onsubmit="handleSaveEdit(event)">
          <div class="form-grid" id="editFormGrid">
            <!-- Dynamic edit inputs -->
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" onclick="closeModal('editModal')">Cancel</button>
        <button type="button" class="btn btn-primary" id="saveEditBtn" onclick="submitEditForm()">💾 Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Add Record Modal -->
  <div class="modal-overlay" id="addModal" onclick="closeModal('addModal')">
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="addModalTitle">➕ Add New Record</div>
        <button onclick="closeModal('addModal')">✕</button>
      </div>
      <div class="modal-body">
        <form id="addForm" onsubmit="handleSaveAdd(event)">
          <div class="form-grid" id="addFormGrid">
            <!-- Dynamic add inputs -->
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button type="button" onclick="closeModal('addModal')">Cancel</button>
        <button type="button" class="btn btn-primary" id="saveAddBtn" onclick="submitAddForm()">➕ Insert Record</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Ready</div>

  <footer>
    Neon PostgreSQL Domain Database Viewer & Editor • Procucev Enterprise (QUA AI 2.0)
  </footer>

  <script>
    let globalData = {};
    let activeTable = 'vendors';
    let searchQuery = '';
    let sortColumn = null;
    let sortDirection = 1;
    let currentEditingRow = null;
    let currentEditingId = null;

    async function fetchAllData() {
      const refreshBtn = document.getElementById('refreshBtn');
      if (refreshBtn) refreshBtn.innerText = '⏳ Loading...';
      try {
        const res = await fetch('/api/all-data');
        const json = await res.json();
        globalData = json.tables || {};
        renderKPIs();
        renderTabs();
        renderActiveTable();
        showToast('Neon data refreshed successfully!');
      } catch (err) {
        console.error('Fetch error:', err);
        showToast('Failed to fetch Neon data', true);
      } finally {
        if (refreshBtn) refreshBtn.innerText = '🔄 Refresh';
      }
    }

    function renderKPIs() {
      document.getElementById('kpiVendors').innerText = globalData.vendors?.count ?? 0;
      document.getElementById('kpiRfqs').innerText = globalData.rfqs?.count ?? 0;
      document.getElementById('kpiEvaluations').innerText = globalData.evaluations?.count ?? 0;
      document.getElementById('kpiCatalogue').innerText = globalData.vendor_catalogue?.count ?? 0;
      document.getElementById('kpiBuyers').innerText = globalData.buyer_accounts?.count ?? 0;
      const feedCount = (globalData.ai_feed?.count ?? 0) + (globalData.audit_logs?.count ?? 0);
      document.getElementById('kpiFeed').innerText = feedCount;
    }

    function renderTabs() {
      const tabsWrapper = document.getElementById('tableTabs');
      tabsWrapper.innerHTML = '';

      Object.keys(globalData).forEach(tableName => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn' + (activeTable === tableName ? ' active' : '');
        btn.innerHTML = \`\${tableName} <span class="tab-badge">\${globalData[tableName].count || 0}</span>\`;
        btn.onclick = () => {
          activeTable = tableName;
          searchQuery = '';
          const searchInput = document.getElementById('searchInput');
          if (searchInput) searchInput.value = '';
          renderTabs();
          renderActiveTable();
        };
        tabsWrapper.appendChild(btn);
      });
    }

    function getActiveTableData() {
      return globalData[activeTable] || { rows: [], columns: [], count: 0, pkColumn: 'id' };
    }

    function renderActiveTable() {
      const tableData = getActiveTableData();
      const rows = tableData.rows || [];
      const thead = document.getElementById('tableHead');
      const tbody = document.getElementById('tableBody');
      const emptyState = document.getElementById('emptyState');
      const countLabel = document.getElementById('rowCountLabel');

      thead.innerHTML = '';
      tbody.innerHTML = '';

      // Filter rows
      let filteredRows = rows.filter(row => {
        if (!searchQuery) return true;
        return Object.values(row).some(val => {
          if (val === null || val === undefined) return false;
          if (typeof val === 'object') return JSON.stringify(val).toLowerCase().includes(searchQuery);
          return String(val).toLowerCase().includes(searchQuery);
        });
      });

      // Sort rows
      if (sortColumn) {
        filteredRows.sort((a, b) => {
          const valA = a[sortColumn] ?? '';
          const valB = b[sortColumn] ?? '';
          if (valA < valB) return -1 * sortDirection;
          if (valA > valB) return 1 * sortDirection;
          return 0;
        });
      }

      countLabel.innerText = \`\${filteredRows.length} of \${rows.length} records\`;

      if (filteredRows.length === 0) {
        emptyState.style.display = 'block';
        return;
      }
      emptyState.style.display = 'none';

      // Build Headers
      const columns = tableData.columns.length > 0 ? tableData.columns : Object.keys(rows[0] || {});
      const pkCol = tableData.pkColumn || (columns.includes('uuid') ? 'uuid' : 'id');
      const headerRow = document.createElement('tr');
      
      const actionTh = document.createElement('th');
      actionTh.innerText = 'ACTIONS';
      actionTh.style.width = '180px';
      headerRow.appendChild(actionTh);

      columns.forEach(col => {
        const th = document.createElement('th');
        th.innerHTML = \`\${col.toUpperCase()} \${sortColumn === col ? (sortDirection === 1 ? '▲' : '▼') : ''}\`;
        th.onclick = () => {
          if (sortColumn === col) {
            sortDirection *= -1;
          } else {
            sortColumn = col;
            sortDirection = 1;
          }
          renderActiveTable();
        };
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);

      // Build Body Rows
      filteredRows.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const rowId = row[pkCol] || row.id || row.uuid;

        // Action cell (Inspect, Edit, Delete)
        const actionTd = document.createElement('td');
        const actionWrap = document.createElement('div');
        actionWrap.className = 'actions-cell';

        const viewBtn = document.createElement('button');
        viewBtn.style.padding = '0.25rem 0.5rem';
        viewBtn.style.fontSize = '0.75rem';
        viewBtn.innerText = '🔍';
        viewBtn.title = 'View raw JSON';
        viewBtn.onclick = () => openJsonModal(\`\${activeTable} #\${rowId || idx + 1}\`, row);
        actionWrap.appendChild(viewBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-edit';
        editBtn.innerHTML = '✏️ Edit';
        editBtn.title = 'Edit record';
        editBtn.onclick = () => openEditModal(row, pkCol);
        actionWrap.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-delete';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete record';
        deleteBtn.onclick = () => handleDeleteRecord(rowId);
        actionWrap.appendChild(deleteBtn);

        actionTd.appendChild(actionWrap);
        tr.appendChild(actionTd);

        columns.forEach(col => {
          const td = document.createElement('td');
          const val = row[col];

          if (val === null || val === undefined) {
            td.innerHTML = '<span style="color:var(--text-muted); font-style:italic;">null</span>';
          } else if (typeof val === 'object') {
            const span = document.createElement('span');
            span.className = 'json-code';
            span.innerText = JSON.stringify(val);
            span.title = 'Click to inspect JSON';
            span.onclick = () => openJsonModal(\`\${col} (\${activeTable})\`, val);
            td.appendChild(span);
          } else if (col === 'status') {
            const badge = document.createElement('span');
            const strVal = String(val).toUpperCase();
            badge.className = 'badge ' + (strVal.includes('ACTIVE') || strVal.includes('OPEN') ? 'badge-green' : strVal.includes('PEND') ? 'badge-amber' : strVal.includes('REJECT') || strVal.includes('CANCEL') ? 'badge-red' : 'badge-blue');
            badge.innerText = val;
            td.appendChild(badge);
          } else if (typeof val === 'boolean') {
            const badge = document.createElement('span');
            badge.className = 'badge ' + (val ? 'badge-green' : 'badge-amber');
            badge.innerText = val ? 'TRUE' : 'FALSE';
            td.appendChild(badge);
          } else {
            td.innerText = String(val);
          }
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });
    }

    function handleSearch(q) {
      searchQuery = (q || '').trim().toLowerCase();
      renderActiveTable();
    }

    function openJsonModal(title, data) {
      document.getElementById('modalTitle').innerText = title;
      document.getElementById('modalContent').innerText = JSON.stringify(data, null, 2);
      document.getElementById('jsonModal').classList.add('open');
    }

    function openEditModal(row, pkCol) {
      currentEditingRow = row;
      currentEditingId = row[pkCol] || row.id || row.uuid;
      const title = document.getElementById('editModalTitle');
      title.innerText = \`✏️ Edit \${activeTable} record (\${currentEditingId})\`;

      const grid = document.getElementById('editFormGrid');
      grid.innerHTML = '';

      const tableData = getActiveTableData();
      const columns = tableData.columns.length > 0 ? tableData.columns : Object.keys(row);

      columns.forEach(col => {
        const group = document.createElement('div');
        group.className = 'form-group';
        const val = row[col];
        const isPk = (col === pkCol || col === 'id' || col === 'uuid' || col === 'sequence');
        const isJson = (typeof val === 'object' && val !== null) || col === 'raw';

        const label = document.createElement('label');
        label.className = 'form-label';
        label.innerText = col;

        if (isJson) {
          group.classList.add('full-width');
          const indicator = document.createElement('span');
          indicator.className = 'json-valid-indicator valid';
          indicator.id = \`json_status_\${col}\`;
          indicator.innerText = 'Valid JSON';
          label.appendChild(indicator);

          const textarea = document.createElement('textarea');
          textarea.className = 'form-textarea';
          textarea.name = col;
          textarea.rows = 8;
          textarea.value = typeof val === 'object' ? JSON.stringify(val, null, 2) : (val || '{}');
          textarea.oninput = () => {
            try {
              JSON.parse(textarea.value);
              indicator.className = 'json-valid-indicator valid';
              indicator.innerText = 'Valid JSON';
            } catch (err) {
              indicator.className = 'json-valid-indicator invalid';
              indicator.innerText = 'Invalid JSON: ' + err.message;
            }
          };
          group.appendChild(label);
          group.appendChild(textarea);
        } else if (typeof val === 'boolean') {
          const select = document.createElement('select');
          select.className = 'form-select';
          select.name = col;
          select.innerHTML = \`
            <option value="true" \${val === true ? 'selected' : ''}>true</option>
            <option value="false" \${val === false ? 'selected' : ''}>false</option>
          \`;
          group.appendChild(label);
          group.appendChild(select);
        } else {
          const input = document.createElement('input');
          input.className = 'form-input';
          input.name = col;
          input.type = typeof val === 'number' ? 'number' : 'text';
          input.value = val === null || val === undefined ? '' : val;
          if (isPk) {
            input.disabled = true;
            input.title = 'Primary key cannot be modified';
          }
          group.appendChild(label);
          group.appendChild(input);
        }

        grid.appendChild(group);
      });

      document.getElementById('editModal').classList.add('open');
    }

    function openAddModal() {
      const title = document.getElementById('addModalTitle');
      title.innerText = \`➕ Add New Record into "\${activeTable}"\`;

      const grid = document.getElementById('addFormGrid');
      grid.innerHTML = '';

      const tableData = getActiveTableData();
      const columns = tableData.columns.length > 0 ? tableData.columns : ['id', 'status', 'created_at'];

      columns.forEach(col => {
        if (col === 'sequence') return; // auto-generated
        const group = document.createElement('div');
        group.className = 'form-group';
        const isJson = col === 'raw' || col.endsWith('_json');

        const label = document.createElement('label');
        label.className = 'form-label';
        label.innerText = col;

        if (isJson) {
          group.classList.add('full-width');
          const textarea = document.createElement('textarea');
          textarea.className = 'form-textarea';
          textarea.name = col;
          textarea.rows = 6;
          textarea.value = '{}';
          group.appendChild(label);
          group.appendChild(textarea);
        } else {
          const input = document.createElement('input');
          input.className = 'form-input';
          input.name = col;
          input.placeholder = \`Enter \${col}...\`;
          if (col === 'id' || col === 'uuid') {
            input.value = 'rec_' + Math.random().toString(36).substring(2, 10);
          }
          group.appendChild(label);
          group.appendChild(input);
        }
        grid.appendChild(group);
      });

      document.getElementById('addModal').classList.add('open');
    }

    function closeModal(modalId) {
      const m = document.getElementById(modalId);
      if (m) m.classList.remove('open');
    }

    function submitEditForm() {
      const form = document.getElementById('editForm');
      if (form) form.requestSubmit();
    }

    async function handleSaveEdit(e) {
      e.preventDefault();
      if (!currentEditingId) return showToast('Missing Record ID', true);

      const saveBtn = document.getElementById('saveEditBtn');
      saveBtn.innerText = '💾 Saving...';
      saveBtn.disabled = true;

      try {
        const form = document.getElementById('editForm');
        const formData = new FormData(form);
        const payload = {};

        for (const [key, val] of formData.entries()) {
          const origVal = currentEditingRow[key];
          if ((typeof origVal === 'object' && origVal !== null) || key === 'raw') {
            try {
              payload[key] = JSON.parse(val);
            } catch (err) {
              showToast(\`Invalid JSON in "\${key}": \${err.message}\`, true);
              saveBtn.innerText = '💾 Save Changes';
              saveBtn.disabled = false;
              return;
            }
          } else if (val === 'true' && typeof origVal === 'boolean') {
            payload[key] = true;
          } else if (val === 'false' && typeof origVal === 'boolean') {
            payload[key] = false;
          } else if (typeof origVal === 'number') {
            payload[key] = Number(val);
          } else {
            payload[key] = val;
          }
        }

        const res = await fetch(\`/api/table/\${activeTable}/\${encodeURIComponent(currentEditingId)}\`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update record');

        closeModal('editModal');
        showToast(\`Record \${currentEditingId} in "\${activeTable}" updated successfully!\`);
        await fetchAllData();
      } catch (err) {
        console.error('Update error:', err);
        showToast(\`Update failed: \${err.message}\`, true);
      } finally {
        saveBtn.innerText = '💾 Save Changes';
        saveBtn.disabled = false;
      }
    }

    function submitAddForm() {
      const form = document.getElementById('addForm');
      if (form) form.requestSubmit();
    }

    async function handleSaveAdd(e) {
      e.preventDefault();
      const saveBtn = document.getElementById('saveAddBtn');
      saveBtn.innerText = '➕ Inserting...';
      saveBtn.disabled = true;

      try {
        const form = document.getElementById('addForm');
        const formData = new FormData(form);
        const payload = {};

        for (const [key, val] of formData.entries()) {
          if (!val && val !== '0' && val !== 'false') continue;
          if (key === 'raw' || key.endsWith('_json')) {
            try {
              payload[key] = JSON.parse(val);
            } catch {
              payload[key] = {};
            }
          } else {
            payload[key] = val;
          }
        }

        const res = await fetch(\`/api/table/\${activeTable}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to insert record');

        closeModal('addModal');
        showToast(\`New record created in "\${activeTable}" successfully!\`);
        await fetchAllData();
      } catch (err) {
        console.error('Insert error:', err);
        showToast(\`Insert failed: \${err.message}\`, true);
      } finally {
        saveBtn.innerText = '➕ Insert Record';
        saveBtn.disabled = false;
      }
    }

    async function handleDeleteRecord(id) {
      if (!id) return;
      if (!confirm(\`Are you sure you want to permanently delete record "\${id}" from \${activeTable}?\`)) {
        return;
      }

      try {
        const res = await fetch(\`/api/table/\${activeTable}/\${encodeURIComponent(id)}\`, {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete record');

        showToast(\`Record "\${id}" deleted from "\${activeTable}"\`);
        await fetchAllData();
      } catch (err) {
        console.error('Delete error:', err);
        showToast(\`Delete failed: \${err.message}\`, true);
      }
    }

    function copyModalJson() {
      const text = document.getElementById('modalContent').innerText;
      navigator.clipboard.writeText(text).then(() => {
        showToast('JSON copied to clipboard!');
      });
    }

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => t.classList.remove('show'), 3000);
    }

    function exportActiveTableCsv() {
      const tableData = getActiveTableData();
      const rows = tableData.rows || [];
      if (rows.length === 0) return showToast('No rows to export', true);
      const columns = tableData.columns.length > 0 ? tableData.columns : Object.keys(rows[0]);
      
      const csvLines = [columns.join(',')];
      rows.forEach(r => {
        const line = columns.map(c => {
          const val = r[c];
          if (val === null || val === undefined) return '';
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return \`"\${str.replace(/"/g, '""')}"\`;
        });
        csvLines.push(line.join(','));
      });

      const blob = new Blob([csvLines.join('\\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`neon_\${activeTable}_\${new Date().toISOString().slice(0,10)}.csv\`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV export downloaded!');
    }

    // Initialize
    window.addEventListener('DOMContentLoaded', fetchAllData);
  </script>
</body>
</html>`;
}

/**
 * Creates Express app for the Neon DB viewer & live record editor.
 */
function createViewerApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/overview', async (req, res) => {
    try {
      const health = pool.pool
        ? await (pool.checkDatabaseHealth ? pool.checkDatabaseHealth() : pool.checkDomainDBHealth())
        : { poolStatus: 'NOT_CONFIGURED' };
      const pgData = await viewModule.getAllPostgresData();

      res.json({
        domainHealth: health,
        tableCounts: Object.fromEntries(Object.entries(pgData).map(([k, v]) => [k, v.count])),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tables', async (req, res) => {
    try {
      const pgData = await viewModule.getAllPostgresData();
      res.json({
        tables: Object.keys(pgData).map((name) => ({
          name,
          count: pgData[name].count,
          columns: pgData[name].columns,
          pkColumn: pgData[name].pkColumn,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    try {
      const data = await viewModule.fetchPostgresTable(tableName);
      return res.json({ table: tableName, ...data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // UPDATE Record endpoint
  app.put('/api/table/:tableName/:recordId', async (req, res) => {
    const { tableName, recordId } = req.params;
    try {
      const updated = await viewModule.updateTableRecord(tableName, recordId, req.body);
      return res.json({ success: true, table: tableName, record: updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // INSERT Record endpoint
  app.post('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    try {
      const created = await viewModule.insertTableRecord(tableName, req.body);
      return res.status(201).json({ success: true, table: tableName, record: created });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // DELETE Record endpoint
  app.delete('/api/table/:tableName/:recordId', async (req, res) => {
    const { tableName, recordId } = req.params;
    try {
      const deleted = await viewModule.deleteTableRecord(tableName, recordId);
      return res.json({ success: true, table: tableName, deletedRecord: deleted });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/all-data', async (req, res) => {
    try {
      const tables = await viewModule.getAllPostgresData();
      res.json({
        timestamp: new Date().toISOString(),
        database: 'Neon PostgreSQL',
        tables,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(viewModule.getViewerHtml());
  });

  return app;
}

/**
 * Starts the localhost server.
 */
function startViewerServer(port = DEFAULT_PORT) {
  const app = viewModule.createViewerApp();
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const actualPort = server.address().port;
      const url = `http://localhost:${actualPort}`;
      resolve({ server, port: actualPort, url, close: () => new Promise((cb) => server.close(cb)) });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        server.listen(0, () => {
          const actualPort = server.address().port;
          const url = `http://localhost:${actualPort}`;
          resolve({ server, port: actualPort, url, close: () => new Promise((cb) => server.close(cb)) });
        });
      } else {
        reject(err);
      }
    });
  });
}

function printSummaryTable(title, rows, columns) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }
  console.table(
    rows.map((row) => {
      const picked = {};
      columns.forEach((col) => {
        picked[col] = row[col];
      });
      return picked;
    })
  );
}

/**
 * CLI print function for terminal execution.
 */
async function view() {
  if (!pool.pool) {
    console.error('[db:view] DATABASE_URL is not set — nothing to view.');
    process.exitCode = 1;
    return;
  }

  const health = await (pool.checkDatabaseHealth ? pool.checkDatabaseHealth() : pool.checkDomainDBHealth());
  console.log(`[db:view] Connected to ${health.providerLabel || 'Database'} (${health.poolStatus || 'ACTIVE'})`);

  const vendors = await pool.query(
    'SELECT id, email, major_category, status, source, created_at, raw FROM vendors ORDER BY created_at DESC LIMIT 500'
  );
  const rfqs = await pool.query(
    'SELECT id, rfq_number, category, status, sourcing_mode, budget, created_at, raw FROM rfqs ORDER BY created_at DESC LIMIT 500'
  );

  viewModule.printSummaryTable('Vendors', vendors.rows, ['id', 'email', 'major_category', 'status', 'source', 'created_at']);
  viewModule.printSummaryTable('RFQs', rfqs.rows, ['id', 'rfq_number', 'category', 'status', 'sourcing_mode', 'budget', 'created_at']);

  console.log('\n[db:view] Full stored records (the `raw` JSONB column each row hydrates from):');
  console.log('\n--- Vendors (raw) ---');
  console.log(JSON.stringify(vendors.rows.map((r) => r.raw), null, 2));
  console.log('\n--- RFQs (raw) ---');
  console.log(JSON.stringify(rfqs.rows.map((r) => r.raw), null, 2));
}

/** Runs view() and starts the interactive localhost server. */
async function runCli(options = {}) {
  const isTest = (process.env.NODE_ENV === 'test' && !options.startServer) || options.once || process.argv.includes('--once') || process.argv.includes('--cli');

  try {
    await viewModule.view();
    if (isTest) {
      return process.exit(process.exitCode || 0);
    }

    const { url } = await viewModule.startViewerServer();
    console.log('\n================================================================================');
    console.log(`✨ Neon PostgreSQL Database Viewer & Live Editor is live!`);
    console.log(`👉 Open in your browser: \x1b[36m${url}\x1b[0m`);
    console.log(`📊 Showing & Editing ALL data in Neon PostgreSQL database.`);
    console.log('Press Ctrl+C to stop.');
    console.log('================================================================================\n');
  } catch (err) {
    console.error('[db:view] Failed:', err.message);
    process.exit(1);
  }
}

const viewModule = {
  view,
  runCli,
  createViewerApp,
  startViewerServer,
  getViewerHtml,
  fetchPostgresTable,
  getAllPostgresData,
  getPrimaryKeyColumn,
  updateTableRecord,
  insertTableRecord,
  deleteTableRecord,
  printSummaryTable,
};

/* istanbul ignore next */
if (require.main === module) {
  viewModule.runCli();
}

module.exports = viewModule;

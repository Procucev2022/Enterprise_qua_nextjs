#!/usr/bin/env node
// ==============================================================================
// NEON POSTGRESQL DATABASE VIEWER
// ==============================================================================
// Serves an interactive localhost Web UI and CLI summary to inspect all tables,
// records, and raw JSONB payloads in the Neon PostgreSQL database.
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
  'ai_feed',
  'audit_logs',
];

/**
 * Fetch rows and schema for a specific PostgreSQL table.
 */
async function fetchPostgresTable(tableName) {
  if (!pool.pool) return { rows: [], columns: [], count: 0 };
  try {
    const countRes = await pool.query(`SELECT count(*) as total FROM "${tableName}"`);
    const count = parseInt(countRes?.rows?.[0]?.total || 0, 10);
    const result = await pool.query(`SELECT * FROM "${tableName}" LIMIT 500`);
    const rows = result.rows || [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, columns, count };
  } catch {
    return { rows: [], columns: [], count: 0 };
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
 * HTML Template for the Neon DB Viewer UI.
 */
function getViewerHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neon PostgreSQL — Database Viewer</title>
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
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
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
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
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
        <div class="brand-title">Neon PostgreSQL Database Viewer</div>
        <div class="brand-subtitle">Procucev Enterprise Domain DB</div>
      </div>
    </div>
    <div class="header-actions">
      <div class="status-pill" id="healthPill">
        <div class="status-dot"></div>
        <span id="healthText">Neon Connected</span>
      </div>
      <button onclick="fetchAllData()" id="refreshBtn">🔄 Refresh</button>
      <a href="/api/all-data" target="_blank" class="btn btn-primary">⬇️ Export Neon JSON</a>
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
          <div>This table currently contains 0 rows or no rows match your search filter.</div>
        </div>
      </div>
    </div>
  </main>

  <!-- JSON Inspector Modal -->
  <div class="modal-overlay" id="jsonModal" onclick="closeModal(event)">
    <div class="modal-card" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title" id="modalTitle">Record Details</div>
        <div style="display:flex; gap:0.5rem;">
          <button onclick="copyModalJson()">📋 Copy JSON</button>
          <button onclick="closeModal()">✕</button>
        </div>
      </div>
      <div class="modal-body">
        <pre class="modal-json" id="modalContent"></pre>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">Copied to clipboard!</div>

  <footer>
    Neon PostgreSQL Domain Database Viewer • Procucev Enterprise (QUA AI 2.0)
  </footer>

  <script>
    let globalData = {};
    let activeTable = 'vendors';
    let searchQuery = '';
    let sortColumn = null;
    let sortDirection = 1;

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
        showToast('Failed to fetch Neon data');
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
      return globalData[activeTable] || { rows: [], columns: [], count: 0 };
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
      const headerRow = document.createElement('tr');
      
      const actionTh = document.createElement('th');
      actionTh.innerText = 'ACTIONS';
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

        // Action cell (Inspect JSON)
        const actionTd = document.createElement('td');
        const viewBtn = document.createElement('button');
        viewBtn.style.padding = '0.25rem 0.6rem';
        viewBtn.style.fontSize = '0.75rem';
        viewBtn.innerText = '🔍 View JSON';
        viewBtn.onclick = () => openModal(\`\${activeTable} #\${idx + 1}\`, row);
        actionTd.appendChild(viewBtn);
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
            span.onclick = () => openModal(\`\${col} (\${activeTable})\`, val);
            td.appendChild(span);
          } else if (col === 'status') {
            const badge = document.createElement('span');
            const strVal = String(val).toUpperCase();
            badge.className = 'badge ' + (strVal.includes('ACTIVE') || strVal.includes('OPEN') ? 'badge-green' : strVal.includes('PEND') ? 'badge-amber' : 'badge-blue');
            badge.innerText = val;
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

    function openModal(title, data) {
      document.getElementById('modalTitle').innerText = title;
      document.getElementById('modalContent').innerText = JSON.stringify(data, null, 2);
      document.getElementById('jsonModal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('jsonModal').classList.remove('open');
    }

    function copyModalJson() {
      const text = document.getElementById('modalContent').innerText;
      navigator.clipboard.writeText(text).then(() => {
        showToast('JSON copied to clipboard!');
      });
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    }

    function exportActiveTableCsv() {
      const tableData = getActiveTableData();
      const rows = tableData.rows || [];
      if (rows.length === 0) return showToast('No rows to export');
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
 * Creates Express app for the Neon DB viewer.
 */
function createViewerApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/overview', async (req, res) => {
    try {
      const health = pool.pool ? await pool.checkDomainDBHealth() : { poolStatus: 'NOT_CONFIGURED' };
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
        tables: Object.keys(pgData).map((name) => ({ name, count: pgData[name].count, columns: pgData[name].columns })),
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

  const health = await pool.checkDomainDBHealth();
  console.log(`[db:view] Connected to ${health.providerLabel} (${health.poolStatus})`);

  const vendors = await pool.query(
    'SELECT id, email, major_category, status, source, created_at, raw FROM vendors ORDER BY created_at DESC'
  );
  const rfqs = await pool.query(
    'SELECT id, rfq_number, category, status, sourcing_mode, budget, created_at, raw FROM rfqs ORDER BY created_at DESC'
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
    console.log(`✨ Neon PostgreSQL Database Viewer Web UI is live!`);
    console.log(`👉 Open in your browser: \x1b[36m${url}\x1b[0m`);
    console.log(`📊 Showing ALL data in Neon PostgreSQL database.`);
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
  printSummaryTable,
};

/* istanbul ignore next */
if (require.main === module) {
  viewModule.runCli();
}

module.exports = viewModule;

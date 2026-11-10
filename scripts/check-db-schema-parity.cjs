#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const dbDir = path.join(rootDir, 'backend', 'src', 'db');
const DIALECT_TABLES = new Map([
  ['schema_migration_locks', 'D1 uses a database lease; PostgreSQL uses advisory locks.'],
]);
const D1_LEGACY_COLUMNS = new Map([
  ['auth_otp_codes.id', 'Legacy D1 row identifier; OTP operations key by otp_key.'],
  ['auth_otp_codes.email', 'Legacy D1 compatibility column used only by the NOT NULL fallback in authSessionQueries.'],
  ['auth_revoked_tokens.jti', 'Legacy D1 token identifier; revocation operations key by signature.'],
  ['category_division.division_name', 'Legacy taxonomy alias; runtime taxonomy reads use division and category.'],
  ['category_division.last_modified_ts', 'Legacy taxonomy timestamp; runtime taxonomy writes do not use it.'],
  ['org_division_category.org_uuid', 'Legacy organization alias; runtime category ownership uses organization_id.'],
  ['org_division_category.division_uuid', 'Legacy taxonomy link; runtime category writes use division text.'],
  ['org_division_category.last_modified_ts', 'Legacy category timestamp; runtime category writes use created_ts.'],
  ['organization.contact_name', 'Legacy D1 alias; new writes now use contact_person. Retain until production data is reconciled.'],
  ['organization.contact_email', 'Legacy D1 alias; new writes now use email. Retain until production data is reconciled.'],
  ['organization.contact_phone', 'Legacy D1 alias; new writes now use organization_phonenumber. Retain until production data is reconciled.'],
  ['organization.is_active', 'Legacy organization flag; identity activity is stored on user rows. Retain until production data is reconciled.'],
  ['organization.logo_url', 'Legacy unused profile field. Retain until production data is reconciled.'],
  ['user.organization_name', 'Legacy denormalized organization name; new D1 writes no longer populate it.'],
  ['user.is_password_changed', 'Legacy password flag; current auth state uses reset_password.'],
]);
const SKIPPED_DEFINITION_WORDS = new Set(['constraint', 'primary', 'unique', 'check', 'foreign']);
const REQUIRED_ACCESS_PATHS = Object.freeze({
  postgres: [
    { table: 'organization', columns: ['organization_name', 'org_type_uuid'], query: 'identity registration organization reuse' },
    { table: 'user', columns: ['lower(username)', 'phone'], query: 'case-insensitive sign-in narrowed by phone' },
    { table: 'org_division_category', columns: ['user_id', 'is_active', 'division', 'category'], query: 'buyer category reads and ordering by user' },
    { table: 'org_division_category', columns: ['organization_id', 'is_active', 'division', 'category'], query: 'buyer category fallback reads and ordering by organization' },
    { table: 'vendors', columns: ['lower(raw->>\'buyerId\')'], query: 'case-insensitive buyer vendor ownership lookup by buyer ID' },
    { table: 'vendors', columns: ['lower(raw->>\'buyerAccountId\')'], query: 'case-insensitive buyer vendor ownership lookup by account ID' },
    { table: 'vendors', columns: ['lower(raw->>\'buyerEmail\')'], query: 'case-insensitive buyer vendor ownership lookup by email' },
    { table: 'vendor_catalogue', columns: ['created_at', 'id'], query: 'bounded catalogue listing by creation time' },
    { table: 'vendor_catalogue', columns: ['vendor_id', 'created_at', 'id'], query: 'bounded vendor catalogue listing by creation time' },
    { table: 'vendor_catalogue', columns: ['vendor_id', 'lower(trim(sku))'], query: 'normalized duplicate SKU check by vendor' },
  ],
  d1: [
    { table: 'organization', columns: ['organization_name', 'org_type_uuid'], query: 'identity registration organization reuse' },
    { table: 'user', columns: ['lower(username)', 'phone'], query: 'case-insensitive sign-in narrowed by phone' },
    { table: 'org_division_category', columns: ['user_id', 'is_active', 'division', 'category'], query: 'buyer category reads and ordering by user' },
    { table: 'org_division_category', columns: ['organization_id', 'is_active', 'division', 'category'], query: 'buyer category fallback reads and ordering by organization' },
    { table: 'vendors', columns: ['lower(json_extract(raw, \'$.buyerId\'))'], query: 'case-insensitive buyer vendor ownership lookup by buyer ID' },
    { table: 'vendors', columns: ['lower(json_extract(raw, \'$.buyerAccountId\'))'], query: 'case-insensitive buyer vendor ownership lookup by account ID' },
    { table: 'vendors', columns: ['lower(json_extract(raw, \'$.buyerEmail\'))'], query: 'case-insensitive buyer vendor ownership lookup by email' },
    { table: 'vendor_catalogue', columns: ['created_at', 'id'], query: 'bounded catalogue listing by creation time' },
    { table: 'vendor_catalogue', columns: ['vendor_id', 'created_at', 'id'], query: 'bounded vendor catalogue listing by creation time' },
    { table: 'vendor_catalogue', columns: ['vendor_id', 'lower(trim(sku))'], query: 'normalized duplicate SKU check by vendor' },
  ],
});

function stripSqlComments(sql) {
  let output = '';
  let quote = '';
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (quote) {
      output += current;
      if (current === quote) {
        if (next === quote) {
          output += next;
          index += 1;
        } else {
          quote = '';
        }
      }
      continue;
    }

    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output += current;
      continue;
    }
    if (current === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (current === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      index += 1;
      output += ' ';
      continue;
    }
    output += current;
  }
  return output;
}

function findClosingParen(source, openIndex) {
  let depth = 0;
  let quote = '';
  for (let index = openIndex; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (quote) {
      if (current === quote) {
        if (next === quote) index += 1;
        else quote = '';
      }
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      continue;
    }
    if (current === '(') depth += 1;
    if (current === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelDefinitions(definitions) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  for (let index = 0; index < definitions.length; index += 1) {
    const current = definitions[index];
    const next = definitions[index + 1];
    if (quote) {
      if (current === quote) {
        if (next === quote) index += 1;
        else quote = '';
      }
      continue;
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current;
      continue;
    }
    if (current === '(') depth += 1;
    else if (current === ')') depth -= 1;
    else if (current === ',' && depth === 0) {
      parts.push(definitions.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = definitions.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function getColumnName(definition) {
  const match = /^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([a-z_][a-z0-9_]*))/i.exec(definition);
  if (!match) return null;
  const name = (match[1] || match[2] || match[3] || match[4]).toLowerCase();
  return SKIPPED_DEFINITION_WORDS.has(name) ? null : name;
}

function addColumns(tableMap, tableName, columns) {
  const name = tableName.toLowerCase();
  const table = tableMap.get(name) || new Set();
  for (const column of columns) table.add(column.toLowerCase());
  tableMap.set(name, table);
}

function parseSchemaFiles(files) {
  const tables = new Map();
  for (const filePath of files) {
    const source = stripSqlComments(fs.readFileSync(filePath, 'utf8'));
    const createPattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|([a-z_][a-z0-9_]*))\s*\(/gi;
    let createMatch;
    while ((createMatch = createPattern.exec(source))) {
      const tableName = createMatch[1] || createMatch[2] || createMatch[3];
      const openIndex = createPattern.lastIndex - 1;
      const closeIndex = findClosingParen(source, openIndex);
      if (closeIndex < 0) throw new Error(`Unclosed CREATE TABLE definition in ${filePath}`);
      const definitions = splitTopLevelDefinitions(source.slice(openIndex + 1, closeIndex));
      addColumns(tables, tableName, definitions.map(getColumnName).filter(Boolean));
      createPattern.lastIndex = closeIndex + 1;
    }

    const alterPattern = /\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:"([^"]+)"|`([^`]+)`|([a-z_][a-z0-9_]*))\s+([\s\S]*?);/gi;
    let alterMatch;
    while ((alterMatch = alterPattern.exec(source))) {
      const tableName = alterMatch[1] || alterMatch[2] || alterMatch[3];
      const additions = /\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|([a-z_][a-z0-9_]*))/gi;
      let additionMatch;
      while ((additionMatch = additions.exec(alterMatch[4]))) {
        const columnName = additionMatch[1] || additionMatch[2] || additionMatch[3];
        addColumns(tables, tableName, [columnName]);
      }
    }
  }
  return tables;
}

function normalizeIndexExpression(expression) {
  return expression
    .replace(/["`]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function parseIndexFiles(files) {
  const indexes = new Map();
  for (const filePath of files) {
    const source = stripSqlComments(fs.readFileSync(filePath, 'utf8'));
    const createPattern = /\bCREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|([a-z_][a-z0-9_]*))\s+ON\s+(?:ONLY\s+)?(?:"([^"]+)"|`([^`]+)`|([a-z_][a-z0-9_]*))(?:\s+USING\s+[a-z_][a-z0-9_]*)?\s*\(/gi;
    let createMatch;
    while ((createMatch = createPattern.exec(source))) {
      const indexName = (createMatch[2] || createMatch[3] || createMatch[4]).toLowerCase();
      const tableName = (createMatch[5] || createMatch[6] || createMatch[7]).toLowerCase();
      const openIndex = createPattern.lastIndex - 1;
      const closeIndex = findClosingParen(source, openIndex);
      if (closeIndex < 0) throw new Error(`Unclosed CREATE INDEX definition in ${filePath}`);
      const columns = splitTopLevelDefinitions(source.slice(openIndex + 1, closeIndex))
        .map(normalizeIndexExpression);
      if (!indexes.has(indexName)) {
        indexes.set(indexName, { name: indexName, table: tableName, columns, unique: Boolean(createMatch[1]) });
      }
      createPattern.lastIndex = closeIndex + 1;
    }

    const dropPattern = /\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:(?:"[^"]+"|`[^`]+`|[a-z_][a-z0-9_]*)\s*\.\s*)?(?:"([^"]+)"|`([^`]+)`|([a-z_][a-z0-9_]*))/gi;
    let dropMatch;
    while ((dropMatch = dropPattern.exec(source))) {
      indexes.delete((dropMatch[1] || dropMatch[2] || dropMatch[3]).toLowerCase());
    }
  }
  return indexes;
}

function hasIndexPrefix(indexes, required) {
  const table = required.table.toLowerCase();
  const columns = required.columns.map(normalizeIndexExpression);
  return [...indexes.values()].some((index) => index.table === table &&
    columns.every((column, position) => index.columns[position] === column));
}

function compareRequiredAccessPaths(postgresIndexes, d1Indexes) {
  return {
    postgres: REQUIRED_ACCESS_PATHS.postgres.filter((required) => !hasIndexPrefix(postgresIndexes, required)),
    d1: REQUIRED_ACCESS_PATHS.d1.filter((required) => !hasIndexPrefix(d1Indexes, required)),
  };
}

function migrationFiles(extension) {
  return fs.readdirSync(path.join(dbDir, 'migrations'))
    .filter((name) => name.endsWith(extension))
    .sort()
    .map((name) => path.join(dbDir, 'migrations', name));
}

function compareSchemas(postgresTables, d1Tables, dialectExceptions = DIALECT_TABLES) {
  const missingFromD1 = [...postgresTables.keys()].filter((name) => !d1Tables.has(name)).sort();
  const missingFromPostgres = [...d1Tables.keys()]
    .filter((name) => !postgresTables.has(name) && !dialectExceptions.has(name))
    .sort();
  const columnDifferences = [];
  const allowedColumnDifferences = [];

  for (const [tableName, postgresColumns] of postgresTables.entries()) {
    const d1Columns = d1Tables.get(tableName);
    if (!d1Columns) continue;
    const postgresOnly = [...postgresColumns].filter((column) => !d1Columns.has(column)).sort();
    const allD1Only = [...d1Columns].filter((column) => !postgresColumns.has(column)).sort();
    const d1Only = allD1Only.filter((column) => !D1_LEGACY_COLUMNS.has(`${tableName}.${column}`));
    const allowedD1Only = allD1Only
      .filter((column) => D1_LEGACY_COLUMNS.has(`${tableName}.${column}`))
      .map((column) => ({ column, reason: D1_LEGACY_COLUMNS.get(`${tableName}.${column}`) }));
    if (allowedD1Only.length) {
      allowedColumnDifferences.push({ table: tableName, columns: allowedD1Only });
    }
    if (postgresOnly.length || d1Only.length) {
      columnDifferences.push({ table: tableName, postgresOnly, d1Only });
    }
  }

  return {
    tableCount: [...postgresTables.keys()].filter((name) => d1Tables.has(name)).length,
    missingFromD1,
    missingFromPostgres,
    columnDifferences: columnDifferences.sort((left, right) => left.table.localeCompare(right.table)),
    allowedColumnDifferences: allowedColumnDifferences.sort((left, right) => left.table.localeCompare(right.table)),
    dialectExceptions: [...dialectExceptions.entries()].map(([table, reason]) => ({ table, reason })),
  };
}

function runSchemaParityCheck() {
  const postgresFiles = [path.join(dbDir, 'schema.sql'), ...migrationFiles('.pg.sql')];
  const d1Files = [path.join(dbDir, 'schema.d1.sql'), ...migrationFiles('.d1.sql')];
  const result = compareSchemas(parseSchemaFiles(postgresFiles), parseSchemaFiles(d1Files));
  result.requiredAccessPathDifferences = compareRequiredAccessPaths(
    parseIndexFiles(postgresFiles),
    parseIndexFiles(d1Files)
  );
  console.log(JSON.stringify(result, null, 2));
  const hasDrift = result.missingFromD1.length > 0 ||
    result.missingFromPostgres.length > 0 ||
    result.columnDifferences.length > 0 ||
    result.requiredAccessPathDifferences.postgres.length > 0 ||
    result.requiredAccessPathDifferences.d1.length > 0;
  if (hasDrift) {
    console.error('Database schema parity check failed. Add a matching migration or document a dialect exception.');
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) runSchemaParityCheck();

module.exports = {
  stripSqlComments,
  findClosingParen,
  splitTopLevelDefinitions,
  getColumnName,
  parseSchemaFiles,
  normalizeIndexExpression,
  parseIndexFiles,
  hasIndexPrefix,
  compareRequiredAccessPaths,
  compareSchemas,
  runSchemaParityCheck,
};

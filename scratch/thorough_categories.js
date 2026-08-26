const xlsx = require('xlsx');
const fs = require('fs');

function readCategoriesFromFile(filename, startCol) {
  const wb = xlsx.readFile(filename);
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

  const headerRow = rows[0];
  const categoryMap = {};

  // Map column index to Major Category name
  const colToMajor = {};
  for (let c = startCol; c < headerRow.length; c++) {
    const rawMajor = headerRow[c];
    if (rawMajor && typeof rawMajor === 'string') {
      const majClean = rawMajor.trim();
      if (majClean && majClean !== 'Major Category' && majClean !== 'Minor Category') {
        colToMajor[c] = majClean;
        if (!categoryMap[majClean]) {
          categoryMap[majClean] = [];
        }
      }
    }
  }

  // Iterate all data rows
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    Object.keys(colToMajor).forEach(colIdxStr => {
      const colIdx = parseInt(colIdxStr, 10);
      const majName = colToMajor[colIdx];
      const val = row[colIdx];
      if (val && typeof val === 'string' && val.trim() !== '' && val.trim() !== 'Minor Category') {
        categoryMap[majName].push(val.trim());
      }
    });
  }

  return categoryMap;
}

const set1Map = readCategoriesFromFile('1st Set of Major & Minor Categories.xlsx', 1);
const set2Map = readCategoriesFromFile('2nd Set of Major & Minor Categories.xlsx', 2);

// Merge all major categories
const allMajorKeys = Array.from(new Set([...Object.keys(set1Map), ...Object.keys(set2Map)]));

console.log(`Found ${allMajorKeys.length} Major Categories across both files.\n`);

// Helper to normalize minor string for deduplication (case-insensitive & whitespace trimmed)
function normalizeString(str) {
  return str.trim().replace(/\s+/g, ' ');
}

const consolidatedList = [];

allMajorKeys.forEach(maj => {
  const list1 = set1Map[maj] || [];
  const list2 = set2Map[maj] || [];

  // Track seen normalized items to remove duplicates
  const seenNormalized = new Set();
  const uniqueMinors = [];

  [...list1, ...list2].forEach(item => {
    const norm = normalizeString(item);
    const normLower = norm.toLowerCase();
    if (!seenNormalized.has(normLower)) {
      seenNormalized.add(normLower);
      uniqueMinors.push(norm);
    }
  });

  // Sort alphabetically
  uniqueMinors.sort((a, b) => a.localeCompare(b));

  consolidatedList.push({
    majorCategory: maj,
    set1Count: list1.length,
    set2Count: list2.length,
    totalUniqueCount: uniqueMinors.length,
    minorCategories: uniqueMinors
  });

  console.log(`• ${maj}: Set1 (${list1.length}) + Set2 (${list2.length}) => ${uniqueMinors.length} Unique Minors`);
});

// Write to lib/categories.json
const finalCategoriesJson = consolidatedList.map(c => ({
  majorCategory: c.majorCategory,
  minorCategories: c.minorCategories
}));

fs.writeFileSync('lib/categories.json', JSON.stringify(finalCategoriesJson, null, 2));
console.log(`\nSuccessfully updated lib/categories.json with ${finalCategoriesJson.length} Major Categories!`);

const fs = require('fs');
const dump = JSON.parse(fs.readFileSync('scratch/categories_dump.json', 'utf8'));

const majorMap = {};

function processMatrix(matrix, startRow, startCol) {
  if (!matrix || matrix.length < 2) return;

  const headerRow = matrix[startRow];
  if (!headerRow) return;

  // Find Major Categories in the header row
  const categoryColumns = [];
  for (let c = startCol; c < headerRow.length; c++) {
    const val = headerRow[c];
    if (val && typeof val === 'string' && val.trim() !== '' && val.trim() !== 'Major Category' && val.trim() !== 'Minor Category') {
      const majName = val.trim();
      if (!majorMap[majName]) {
        majorMap[majName] = new Set();
      }
      categoryColumns.push({ colIndex: c, majorName: majName });
    }
  }

  // Iterate over data rows
  for (let r = startRow + 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    categoryColumns.forEach(({ colIndex, majorName }) => {
      const minVal = row[colIndex];
      if (minVal && typeof minVal === 'string' && minVal.trim() !== '') {
        const cleanedMin = minVal.trim();
        majorMap[majorName].add(cleanedMin);
      }
    });
  }
}

// Process Set 1
processMatrix(dump.set1["Categories & Divisions"], 0, 1);

// Process Set 2
processMatrix(dump.set2["Categories"], 0, 2);

// Format final JSON output
const finalData = Object.keys(majorMap).map(maj => ({
  majorCategory: maj,
  minorCategories: Array.from(majorMap[maj]).sort(),
}));

console.log(JSON.stringify(finalData, null, 2));

fs.writeFileSync('lib/categories.json', JSON.stringify(finalData, null, 2));
console.log(`Saved consolidated categories (${finalData.length} Major Categories) to lib/categories.json`);

const xlsx = require('xlsx');
const fs = require('fs');

function parseWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath);
  const result = {};

  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const json = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    result[sheetName] = json;
  });

  return result;
}

const set1 = parseWorkbook('1st Set of Major & Minor Categories.xlsx');
const set2 = parseWorkbook('2nd Set of Major & Minor Categories.xlsx');

console.log('=== SET 1 ===');
console.log(JSON.stringify(set1, null, 2).slice(0, 3000));

console.log('=== SET 2 ===');
console.log(JSON.stringify(set2, null, 2).slice(0, 3000));

// Dump full output to JSON for inspection
fs.writeFileSync('scratch/categories_dump.json', JSON.stringify({ set1, set2 }, null, 2));
console.log('Saved to scratch/categories_dump.json');

const xlsx = require('xlsx');

function dumpFile(filename) {
  console.log(`\n=================== FILE: ${filename} ===================`);
  const wb = xlsx.readFile(filename);
  wb.SheetNames.forEach(sheetName => {
    console.log(`--- SHEET: ${sheetName} ---`);
    const sheet = wb.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Total Rows: ${data.length}`);
    data.slice(0, 15).forEach((row, rIdx) => {
      console.log(`Row ${rIdx}:`, JSON.stringify(row));
    });
  });
}

dumpFile('1st Set of Major & Minor Categories.xlsx');
dumpFile('2nd Set of Major & Minor Categories.xlsx');

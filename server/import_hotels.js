require('dotenv').config();
const xlsx = require('xlsx');
const pool = require('./db');
const { STEP_KEYS } = require('./steps');

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node server/import_hotels.js "path/to/Hotel_Onboardings.xlsx"');
  process.exit(1);
}

// Excel column index for each step, in STEP_KEYS order. The source sheet skips
// column 18, and "comments" lives in column 21 — hence the gap here.
const STEP_EXCEL_COLS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 22];
const COMMENTS_EXCEL_COL = 21;

if (STEP_EXCEL_COLS.length !== STEP_KEYS.length) {
  throw new Error(
    `STEP_EXCEL_COLS (${STEP_EXCEL_COLS.length}) is out of sync with STEP_KEYS (${STEP_KEYS.length}) — ` +
    'update the column mapping after changing the checklist.'
  );
}

// Column list + SQL are derived from STEP_KEYS so this stays in sync with the app.
const INSERT_COLUMNS = ['sita', 'hotel_name', 'opening_date', ...STEP_KEYS, 'comments'];
const INSERT_SQL = `
  INSERT INTO hotels (${INSERT_COLUMNS.join(', ')})
  VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
  ON CONFLICT (sita) DO UPDATE SET
    ${INSERT_COLUMNS.filter((c) => c !== 'sita').map((c) => `${c} = EXCLUDED.${c}`).join(',\n    ')}
`;

// Turns an Excel cell into a boolean — anything with real content (like "X") counts as true
function toBool(value) {
  return Boolean(value && String(value).trim() !== '');
}

async function run() {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const sheet = workbook.Sheets['Current Onboardings'];

  if (!sheet) {
    console.error('Could not find a sheet named "Current Onboardings" in this file.');
    process.exit(1);
  }

  // header: 1 -> rows as plain arrays (not objects), since the real headers span 3 messy rows
  // range: 4  -> skip those 3 header rows + column-number row, start at row 5
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, range: 4 });

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const sita = row[0] ? String(row[0]).trim() : '';

    if (!sita) {
      skipped++;
      continue; // blank/garbage rows past the real data (e.g. trailing junk rows)
    }

    const hotelName = row[1] ? String(row[1]).trim() : '(name pending)';
    const openingDate = row[2] instanceof Date ? row[2] : null;
    const stepValues = STEP_EXCEL_COLS.map((i) => toBool(row[i]));
    const comments = row[COMMENTS_EXCEL_COL] ? String(row[COMMENTS_EXCEL_COL]) : null;

    await pool.query(INSERT_SQL, [sita, hotelName, openingDate, ...stepValues, comments]);

    imported++;
  }

  console.log(`Done. Imported/updated ${imported} hotels, skipped ${skipped} blank rows.`);
  await pool.end();
}

run().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});

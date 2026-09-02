const fs = require('fs');
const xlsx = require('xlsx');

// [db column, Excel header] for every field pulled from the onboarding-form export.
// This is the single place that knows the mapping — the INSERT and the value list
// below are both generated from it.
const COLUMN_MAP = [
  ['form_response_id', 'Id'],
  ['completion_time', 'Completion time'],
  ['email', 'Email'],
  ['sita_code', 'SITA code'],
  ['hotel_name', "Hotel's name"],
  ['hotel_short_name', "Hotel's short name"],
  ['general_manager', 'General Manager'],
  ['contract_type', 'Contract type'],
  ['md_leased', 'Managing Director: Leased'],
  ['area_franchised', 'Area - Franchised'],
  ['md_emea_franchised', 'MDs/FDs EMEA - Franchised'],
  ['md_seap_franchised', 'MD SEAP - Franchised'],
  ['md_china_franchised', 'MD China - Franchised'],
  ['md_south_asia_franchised', 'MD South Asia (India, Nepal) - Franchised'],
  ['area_managed', 'Area - Managed'],
  ['md_china_managed', 'MD China - Managed'],
  ['md_europe_managed', 'MD Europe - Managed'],
  ['md_mea_managed', 'MD MEA - Managed'],
  ['md_seap_managed', 'MD SEAP - Managed'],
  ['md_south_asia_managed', 'MD South Asia (India, Nepal)- Managed'],
  ['star_rating', 'Official Star rating'],
  ['expected_opening_date', 'Expected opening date'],
  ['services_offered', 'Services offered at the hotel'],
  ['bar_outlets', 'BAR outlets'],
  ['restaurant_outlets', 'RESTAURANT outlets'],
  ['tripadvisor_link', "Hotel's Tripadvisor link"],
  ['compset_tripadvisor_links', "Compset's Tripadvisor links (max 10 competitors)"],
  ['me_lead_catcher_email', 'M&E Lead Catcher Email Address'],
  ['country', 'Country of the Hotel'],
];

const DB_COLUMNS = COLUMN_MAP.map(([col]) => col);
const PLACEHOLDERS = DB_COLUMNS.map((_, i) => `$${i + 1}`).join(',');
const CONFLICT_SET = DB_COLUMNS
  .filter((c) => c !== 'sita_code')
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('imported_at = NOW()')
  .join(',\n        ');

const INSERT_SQL = `
  INSERT INTO form_submissions (${DB_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT (sita_code) DO UPDATE SET
        ${CONFLICT_SET}
`;

// Excel headers sometimes carry stray whitespace/line breaks — trim every key so
// lookups don't silently fail because of an invisible character mismatch.
function normalizeRow(row) {
  const out = {};
  for (const key in row) out[key.trim()] = row[key];
  return out;
}

function rowsFromWorkbook(buffer) {
  let workbook;
  try {
    workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    const e = new Error('Could not read that file as an Excel workbook');
    e.userFacing = true;
    throw e;
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet);
}

// Parse an .xlsx buffer and upsert every row into form_submissions, keyed on
// sita_code. One transaction — a bad row rolls the whole import back.
// Returns { inserted, skipped }.
async function importSubmissions(pool, buffer) {
  const rows = rowsFromWorkbook(buffer);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    let skipped = 0;
    for (const raw of rows) {
      const row = normalizeRow(raw);
      if (!row['SITA code']) {
        skipped++; // no conflict key -> can't be deduped, skip it
        continue;
      }
      await client.query(INSERT_SQL, COLUMN_MAP.map(([, header]) => row[header]));
      inserted++;
    }
    await client.query('COMMIT');
    return { inserted, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function importSubmissionsFromFile(pool, filePath) {
  return importSubmissions(pool, fs.readFileSync(filePath));
}

module.exports = { importSubmissions, importSubmissionsFromFile };

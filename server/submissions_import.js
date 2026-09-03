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

// Rows are deduped on (form_response_id, completion_time) — one row per form
// submission, NOT one per hotel. Two submissions for the same SITA (e.g. someone
// re-fills the form to add missing info) are kept as two separate rows; a re-import
// of the same export just updates the rows it already has.
//
// form_response_id alone is NOT unique: Microsoft Forms numbers responses 1, 2, 3…
// *per form*, so two different form exports both contain an "Id" 18. Pairing it
// with the submission timestamp makes the key safe.
const CONFLICT_TARGET = '(form_response_id, completion_time)';
const CONFLICT_KEYS = new Set(['form_response_id', 'completion_time']);
const CONFLICT_SET = DB_COLUMNS
  .filter((c) => !CONFLICT_KEYS.has(c))
  .map((c) => `${c} = EXCLUDED.${c}`)
  .concat('imported_at = NOW()')
  .join(',\n        ');

const INSERT_SQL = `
  INSERT INTO form_submissions (${DB_COLUMNS.join(', ')})
  VALUES (${PLACEHOLDERS})
  ON CONFLICT ${CONFLICT_TARGET} DO UPDATE SET
        ${CONFLICT_SET}
`;

// One-off migration for databases created before the dedupe key changed from
// UNIQUE(sita_code) to UNIQUE(form_response_id, completion_time). Safe to run on
// every startup; a no-op once done (and if the table doesn't exist yet, see
// README Step 3).
async function ensureSchema(pool) {
  await pool.query(`
    DO $$
    DECLARE
      removed integer;
    BEGIN
      IF to_regclass('form_submissions') IS NULL THEN
        RETURN;
      END IF;

      -- old dedupe key: drop the UNIQUE on sita_code so a hotel can have >1 submission
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'form_submissions'::regclass
          AND conname = 'form_submissions_sita_code_key'
      ) THEN
        ALTER TABLE form_submissions DROP CONSTRAINT form_submissions_sita_code_key;
      END IF;

      -- new dedupe key: UNIQUE on (form_response_id, completion_time)
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'form_submissions'::regclass
          AND conname = 'form_submissions_submission_key'
      ) THEN
        -- clear any exact-duplicate submission rows first (same Forms Id AND same
        -- timestamp = the same submission imported twice), keeping the newest.
        WITH dups AS (
          DELETE FROM form_submissions a
            USING form_submissions b
           WHERE a.form_response_id = b.form_response_id
             AND a.completion_time = b.completion_time
             AND a.id < b.id
          RETURNING a.id
        )
        SELECT count(*) INTO removed FROM dups;
        IF removed > 0 THEN
          RAISE NOTICE '[submissions] migration removed % duplicate submission row(s)', removed;
        END IF;

        ALTER TABLE form_submissions
          ADD CONSTRAINT form_submissions_submission_key UNIQUE (form_response_id, completion_time);
      END IF;
    END $$;
  `);
}

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
// (form_response_id, completion_time). One transaction — a bad row rolls the whole
// import back. Returns { inserted, skipped }.
async function importSubmissions(pool, buffer) {
  const rows = rowsFromWorkbook(buffer);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;
    let skipped = 0;
    for (const raw of rows) {
      const row = normalizeRow(raw);
      // The dedupe key is (Id, Completion time) — without both, a re-import would
      // duplicate the row. A SITA code is required for the row to be usable at all.
      const missingKey = row['Id'] === undefined || row['Id'] === null || row['Id'] === ''
        || row['Completion time'] === undefined || row['Completion time'] === null || row['Completion time'] === '';
      if (missingKey || !row['SITA code']) {
        skipped++;
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

module.exports = { importSubmissions, importSubmissionsFromFile, ensureSchema };

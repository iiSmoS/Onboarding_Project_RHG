// Monthly report notes.
//
// Every month the onboarding report needs a hand-kept list of: hotels that were
// onboarded, rebrandings, SITA-code changes and hotel-name changes (plus a
// free-text "other updates" bucket). This module stores those notes per calendar
// month and exposes:
//
//   - an Express router (CRUD) mounted in index.js under /monthly-notes
//   - ensureTable()            -> creates the table on server startup
//   - recordHotelEdit()        -> auto-logs SITA / name changes made via PATCH /hotels/:id
//   - recordOnboarding()       -> auto-logs a hotel when "Added to monthly report" is ticked
//
// The frontend lives at public/monthly.html + public/monthly.js.

const express = require('express');
const pool = require('./db');

// The note types. `key` is stored in the DB and validated on write; `label` is
// shown on the page and used for the "Copy for report" text. Order here is the
// order groups appear on the page and in the copied report.
const NOTE_KINDS = [
  { key: 'onboarding',  label: 'Onboarded hotels' },
  { key: 'rebranding',  label: 'Rebrandings' },
  { key: 'sita_change', label: 'SITA code changes' },
  { key: 'name_change', label: 'Name changes' },
  { key: 'other',       label: 'Extra updates' },
];
const KIND_KEYS = new Set(NOTE_KINDS.map((k) => k.key));

// Columns a client is allowed to set on create / edit.
const EDITABLE = ['kind', 'hotel_id', 'sita', 'hotel_name', 'old_value', 'new_value', 'note'];

// Column list for reads. report_month is a DATE — the pg driver would hand it
// back as a timezone-shifted Date, so format it to a plain YYYY-MM-DD string.
const SELECT_COLS = `
  id, to_char(report_month, 'YYYY-MM-DD') AS report_month, kind, hotel_id,
  sita, hotel_name, old_value, new_value, note, auto_generated, created_at
`;

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_notes (
      id             SERIAL PRIMARY KEY,
      report_month   DATE NOT NULL,                 -- always the 1st of the month
      kind           VARCHAR(30) NOT NULL,
      hotel_id       INTEGER REFERENCES hotels(id) ON DELETE SET NULL,
      sita           VARCHAR(50),
      hotel_name     VARCHAR(255),
      old_value      TEXT,
      new_value      TEXT,
      note           TEXT,
      auto_generated BOOLEAN DEFAULT FALSE,
      created_at     TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_monthly_notes_month ON monthly_notes (report_month)'
  );
}

// Normalise "2026-08", "2026-08-14", a Date, etc. to a "YYYY-MM-01" string.
// Returns null if it can't be parsed.
function monthKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const trimOrNull = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};

// ---- Auto-capture helpers (called from the /hotels routes) -------------------

// Log a note when a hotel's SITA or name is edited. If an auto note of the same
// kind already exists for this hotel in the current month, its "new" value is
// updated in place so the month keeps a single before/after per hotel.
async function recordAutoChange({ hotelId, kind, sita, hotelName, oldValue, newValue }) {
  const month = currentMonthKey();

  const existing = await pool.query(
    `SELECT id FROM monthly_notes
      WHERE hotel_id = $1 AND kind = $2 AND report_month = $3 AND auto_generated = TRUE
      ORDER BY id
      LIMIT 1`,
    [hotelId, kind, month]
  );

  if (existing.rows.length) {
    await pool.query(
      `UPDATE monthly_notes
          SET new_value = $1, sita = $2, hotel_name = $3
        WHERE id = $4`,
      [newValue, sita, hotelName, existing.rows[0].id]
    );
    return;
  }

  await pool.query(
    `INSERT INTO monthly_notes
       (report_month, kind, hotel_id, sita, hotel_name, old_value, new_value, auto_generated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
    [month, kind, hotelId, sita, hotelName, oldValue, newValue]
  );
}

// Compare a hotel row before/after an edit and log SITA / name changes.
// Never throws — a logging failure must not fail the hotel edit.
async function recordHotelEdit(before, after) {
  try {
    const beforeSita = (before.sita || '').trim();
    const afterSita = (after.sita || '').trim();
    const beforeName = (before.hotel_name || '').trim();
    const afterName = (after.hotel_name || '').trim();

    if (beforeSita && afterSita && beforeSita !== afterSita) {
      await recordAutoChange({
        hotelId: after.id,
        kind: 'sita_change',
        sita: afterSita,
        hotelName: afterName,
        oldValue: beforeSita,
        newValue: afterSita,
      });
    }

    if (beforeName && afterName && beforeName !== afterName) {
      await recordAutoChange({
        hotelId: after.id,
        kind: 'name_change',
        sita: afterSita,
        hotelName: afterName,
        oldValue: beforeName,
        newValue: afterName,
      });
    }
  } catch (err) {
    console.error('[monthly-notes] failed to auto-log hotel edit:', err);
  }
}

// Log a hotel as onboarded when its "Added to monthly report" step is ticked.
// Idempotent per hotel per month. Never throws.
async function recordOnboarding(hotel) {
  try {
    const month = currentMonthKey();
    const existing = await pool.query(
      `SELECT id FROM monthly_notes
        WHERE hotel_id = $1 AND kind = 'onboarding' AND report_month = $2
        LIMIT 1`,
      [hotel.id, month]
    );
    if (existing.rows.length) return;

    await pool.query(
      `INSERT INTO monthly_notes
         (report_month, kind, hotel_id, sita, hotel_name, auto_generated)
       VALUES ($1, 'onboarding', $2, $3, $4, TRUE)`,
      [month, hotel.id, (hotel.sita || '').trim() || null, (hotel.hotel_name || '').trim() || null]
    );
  } catch (err) {
    console.error('[monthly-notes] failed to auto-log onboarding:', err);
  }
}

// ---- Router ----------------------------------------------------------------

const router = express.Router();

// Config for the frontend, mirrors GET /config/steps
router.get('/monthly-notes/kinds', (req, res) => {
  res.json(NOTE_KINDS);
});

// Months that have at least one note, newest first (for the month picker).
router.get('/monthly-notes/months', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT to_char(report_month, 'YYYY-MM') AS month
         FROM monthly_notes
        GROUP BY report_month
        ORDER BY report_month DESC`
    );
    res.json(result.rows.map((r) => r.month));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong fetching months' });
  }
});

// Notes for one month (defaults to the current month).
router.get('/monthly-notes', async (req, res) => {
  const month = monthKey(req.query.month) || currentMonthKey();
  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLS} FROM monthly_notes
        WHERE report_month = $1
        ORDER BY created_at, id`,
      [month]
    );
    res.json({ month: month.slice(0, 7), notes: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong fetching notes' });
  }
});

router.post('/monthly-notes', async (req, res) => {
  const month = monthKey(req.body.month);
  const kind = req.body.kind;

  if (!month) return res.status(400).json({ error: 'A valid month is required' });
  if (!KIND_KEYS.has(kind)) return res.status(400).json({ error: 'Invalid note kind' });

  const values = {
    kind,
    hotel_id: req.body.hotel_id || null,
    sita: trimOrNull(req.body.sita),
    hotel_name: trimOrNull(req.body.hotel_name),
    old_value: trimOrNull(req.body.old_value),
    new_value: trimOrNull(req.body.new_value),
    note: trimOrNull(req.body.note),
  };

  try {
    const result = await pool.query(
      `INSERT INTO monthly_notes
         (report_month, kind, hotel_id, sita, hotel_name, old_value, new_value, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${SELECT_COLS}`,
      [month, values.kind, values.hotel_id, values.sita, values.hotel_name,
       values.old_value, values.new_value, values.note]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong creating the note' });
  }
});

router.patch('/monthly-notes/:id', async (req, res) => {
  const { id } = req.params;

  // Build a SET clause from whichever editable fields were sent.
  const sets = [];
  const params = [];

  if (req.body.month !== undefined) {
    const month = monthKey(req.body.month);
    if (!month) return res.status(400).json({ error: 'A valid month is required' });
    params.push(month);
    sets.push(`report_month = $${params.length}`);
  }

  for (const field of EDITABLE) {
    if (req.body[field] === undefined) continue;
    if (field === 'kind' && !KIND_KEYS.has(req.body.kind)) {
      return res.status(400).json({ error: 'Invalid note kind' });
    }
    let value = req.body[field];
    if (field === 'hotel_id') value = value || null;
    else if (field !== 'kind') value = trimOrNull(value);
    params.push(value);
    sets.push(`${field} = $${params.length}`);
  }

  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);

  try {
    const result = await pool.query(
      `UPDATE monthly_notes SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SELECT_COLS}`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong updating the note' });
  }
});

router.delete('/monthly-notes/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM monthly_notes WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Note not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong deleting the note' });
  }
});

module.exports = {
  NOTE_KINDS,
  ensureTable,
  recordHotelEdit,
  recordOnboarding,
  router,
};

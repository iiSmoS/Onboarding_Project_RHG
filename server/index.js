const express = require('express');
const multer = require('multer');

const pool = require('./db');
const app = express();
const PORT = 3000;

const {EMAIL_TEMPLATES, fillTemplate} = require('./email_templates');
const {ONBOARDING_STEPS, STEP_KEYS} = require('./steps');
const {importSubmissions, ensureSchema} = require('./submissions_import');
const importStatus = require('./import_status');
const monthlyNotes = require('./monthly_notes');

// Validated set of column names PATCH /hotels/:id/step may touch. The step name
// is interpolated into SQL below, so this allowlist is what keeps that safe —
// never bypass it.
const ALLOWED_STEPS = new Set(STEP_KEYS);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: 10 * 1024 * 1024}, // 10 MB — the form exports are small
});

app.use(express.static('public'));
app.use(express.json());

// Monthly report notes (see server/monthly_notes.js). The table is created on
// startup so a fresh machine doesn't need an extra setup step.
app.use(monthlyNotes.router);
monthlyNotes.ensureTable().catch((err) => {
  console.error('[monthly-notes] could not create the monthly_notes table:', err);
});

// Migrate form_submissions' dedupe key (sita_code -> form_response_id) if needed.
ensureSchema(pool).catch((err) => {
  console.error('[submissions] schema migration failed:', err);
});

// Lets the frontend render the checklist without keeping its own copy of the list
app.get('/config/steps', (req, res) => {
  res.json(ONBOARDING_STEPS);
});

app.get('/hotels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM hotels ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong fetching hotels' });
  }
});

app.post('/hotels', async (req, res) => {
  const {sita, hotel_name, opening_date} = req.body;

  if(!sita || !hotel_name){
    return res.status(400).json({error: 'sita and hotel_name are required'});
  }

  try{
    const result = await pool.query(
      `INSERT INTO hotels (sita, hotel_name, opening_date)
      VALUES ($1, $2, $3)
      RETURNING *`,
      [sita, hotel_name, opening_date]
    );
    res.status(201).json(result.rows[0]);
  } catch (err){
    console.error(err);
    res.status(500).json({error: 'Something went wrong creating the hotel'});
  }
});

// Edit a hotel's core fields (SITA, name, opening date)
app.patch('/hotels/:id', async (req, res) => {
  const {id} = req.params;
  const {sita, hotel_name, opening_date} = req.body;

  if(!sita || !hotel_name){
    return res.status(400).json({error: 'sita and hotel_name are required'});
  }

  try{
    // Grab the current row first so we can spot SITA / name changes and log them
    // to the monthly report notes.
    const existing = await pool.query('SELECT * FROM hotels WHERE id = $1', [id]);
    if(existing.rows.length === 0){
      return res.status(404).json({error: 'Hotel not found'});
    }

    const result = await pool.query(
      `UPDATE hotels
         SET sita = $1, hotel_name = $2, opening_date = $3
       WHERE id = $4
       RETURNING *`,
      [sita, hotel_name, opening_date || null, id]
    );

    await monthlyNotes.recordHotelEdit(existing.rows[0], result.rows[0]);

    res.json(result.rows[0]);
  } catch (err){
    console.error(err);
    res.status(500).json({error: 'Something went wrong updating the hotel'});
  }
});

app.delete('/hotels/:id', async (req, res) => {
  const {id} = req.params;

  try{
    const result = await pool.query('DELETE FROM hotels WHERE id = $1 RETURNING id', [id]);

    if(result.rows.length === 0){
      return res.status(404).json({error: 'Hotel not found'});
    }

    res.json({deleted: result.rows[0].id});
  } catch (err){
    console.error(err);
    res.status(500).json({error: 'Something went wrong deleting the hotel'});
  }
});

app.patch('/hotels/:id/step', async (req, res) => {
  const {id} = req.params;
  const {step, value} = req.body;

  if(!ALLOWED_STEPS.has(step)){
    return res.status(400).json({error: 'Invalid step name'});
  }

  try{
    const result = await pool.query(
      `UPDATE hotels SET ${step} = $1 WHERE id = $2 RETURNING *`,[value,id]
    );

    if(result.rows.length === 0){
      return res.status(404).json({error: 'Hotel not found'});
    }

    // Ticking "Added to monthly report" logs the hotel as onboarded for this month.
    if(step === 'added_to_monthly_report' && value){
      await monthlyNotes.recordOnboarding(result.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (err){
    console.error(err);
    res.status(500).json({error: 'Something went wrong updating the status'});
  }
});

app.get('/hotels/:id/email-preview/:templateName', async (req,res) => {
  const {id, templateName} = req.params;
  const template = EMAIL_TEMPLATES[templateName];

  if(!template){
    return res.status(400).json({error: 'Unknown template'});
  }

  try{
    // Pull the GM's name from the matching form submission (keyed by SITA, which
    // sometimes carries stray whitespace in either table — hence TRIM on both sides).
    const result = await pool.query(
      `SELECT h.*,
              COALESCE(NULLIF(TRIM(fs.general_manager), ''), 'General Manager') AS gm_name
         FROM hotels h
         LEFT JOIN LATERAL (
           SELECT general_manager
             FROM form_submissions
            WHERE TRIM(sita_code) = TRIM(h.sita)
            ORDER BY imported_at DESC
            LIMIT 1
         ) fs ON true
        WHERE h.id = $1`,
      [id]
    );
    const hotel = result.rows[0];

    if(!hotel){
      return res.status(404).json({error: 'Hotel not found'});
    }

    hotel.gm_name = String(hotel.gm_name).trim(); // drop any leading/trailing space from the source data

    res.json({
      subject: fillTemplate(template.subject, hotel),
      bodyHtml: fillTemplate(template.bodyHtml, hotel),
    });
  } catch(err){
    console.error(err);
    res.status(500).json({error: 'Something went wrong generating the email'});
  }
});

// Manual upload path. The parse + upsert itself lives in submissions_import.js so
// the file watcher (see watch_submissions.js) can reuse it.
app.post('/form-submissions/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const { inserted, skipped } = await importSubmissions(pool, req.file.buffer);
    importStatus.set({ source: 'upload', ok: true, inserted, skipped });
    const message = skipped
      ? `Imported ${inserted} rows, skipped ${skipped} without an Id, timestamp or SITA code`
      : `Imported ${inserted} rows`;
    res.json({ message, count: inserted, skipped });
  } catch (err) {
    console.error(err);
    importStatus.set({ source: 'upload', ok: false, error: err.message });
    res.status(err.userFacing ? 400 : 500)
      .json({ error: err.userFacing ? err.message : 'Something went wrong importing the file' });
  }
});

// Outcome of the most recent import (manual or auto) — powers the status line on the page
app.get('/form-submissions/status', (req, res) => {
  res.json(importStatus.get() || { at: null });
});

app.get('/form-submissions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM form_submissions ORDER BY imported_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong fetching form submissions' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Auto-import: if SUBMISSIONS_XLSX_PATH points at an .xlsx export of the onboarding
// form, watch it and import into form_submissions on startup and on every change.
if (process.env.SUBMISSIONS_XLSX_PATH) {
  const { watchSubmissionsFile } = require('./watch_submissions');
  const seconds = Number(process.env.SUBMISSIONS_XLSX_POLL_SECONDS) || 5;
  watchSubmissionsFile(pool, process.env.SUBMISSIONS_XLSX_PATH, { intervalMs: seconds * 1000 });
}

// Keep a stray async error from silently killing the process (and with it the
// file watcher). Log everything; on a truly unexpected crash, exit non-zero so a
// supervisor (Task Scheduler / PM2) can restart us cleanly.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — exiting for a restart:', err);
  process.exit(1);
});

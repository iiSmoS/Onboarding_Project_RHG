require('dotenv').config();
const pool = require('./db');
const { STEP_KEYS } = require('./steps');

// Canonical checklist order — defines what "before" means for the backfill
const STEP_ORDER = STEP_KEYS;

// The hotels you're still actively working on — everything else gets marked fully complete
const ACTIVE_SITA_CODES = [
  'CJBIA', 'BAHPD', 'NTEIA', 'HKTBA', 'ACHDA', 'VIEIA', 'BLRSB', 'CPHIB',
  'GHVBA', 'CPHID', 'BUDIB', 'FCOCB', 'INIDA', 'JEDPI', 'JEDZI', 'DYUCA',
  'BLRIF', 'IDRDA', 'MANBA', 'ATHRR', 'NKGZA', 'KLXBA', 'DACIF', 'CMBBA', 'BBIIB',
].map(code => code.trim());

async function run() {
  const result = await pool.query('SELECT * FROM hotels ORDER BY id');
  const hotels = result.rows;

  let backfilledCount = 0;
  let completedCount = 0;
  let skippedCount = 0;

  for (const hotel of hotels) {
    const sita = hotel.sita ? hotel.sita.trim() : '';
    const isActive = ACTIVE_SITA_CODES.includes(sita);

    if (isActive) {
      // Active hotel: check everything up to the last step that's already true
      let lastTrueIndex = -1;
      STEP_ORDER.forEach((key, index) => {
        if (hotel[key]) lastTrueIndex = index;
      });

      if (lastTrueIndex === -1) {
        skippedCount++;
        continue; // no steps done yet, nothing to backfill
      }

      const stepsToFix = STEP_ORDER.slice(0, lastTrueIndex + 1).filter(key => !hotel[key]);

      if (stepsToFix.length === 0) {
        skippedCount++;
        continue; // already consistent
      }

      const setClause = stepsToFix.map(key => `${key} = TRUE`).join(', ');
      await pool.query(`UPDATE hotels SET ${setClause} WHERE id = $1`, [hotel.id]);

      console.log(`[ACTIVE] Backfilled ${sita} (${hotel.hotel_name}): ${stepsToFix.join(', ')}`);
      backfilledCount++;

    } else {
      // Not in your active list -> treat as fully completed
      const alreadyDone = STEP_ORDER.every(key => hotel[key]);

      if (alreadyDone) {
        skippedCount++;
        continue;
      }

      const setClause = STEP_ORDER.map(key => `${key} = TRUE`).join(', ');
      await pool.query(`UPDATE hotels SET ${setClause} WHERE id = $1`, [hotel.id]);

      console.log(`[DONE] Marked fully complete: ${sita} (${hotel.hotel_name})`);
      completedCount++;
    }
  }

  console.log(`\nDone. ${backfilledCount} active hotels backfilled, ${completedCount} hotels marked fully complete, ${skippedCount} already correct.`);
  await pool.end();
}

run().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
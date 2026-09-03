const fs = require('fs');
const { importSubmissionsFromFile } = require('./submissions_import');
const importStatus = require('./import_status');

// Watch a single .xlsx file and re-import it into form_submissions whenever it
// changes. Point SUBMISSIONS_XLSX_PATH at, e.g., a OneDrive/SharePoint-synced
// copy of the onboarding-form export so new responses land in the DB on their own.
//
// Uses fs.watchFile (mtime polling) rather than fs event watching — it's more
// reliable for files updated by sync clients, and the file being replaced
// wholesale (as Excel/OneDrive do) doesn't break it.
function watchSubmissionsFile(pool, filePath, { intervalMs = 5000 } = {}) {
  let chain = Promise.resolve();
  let queued = false;
  let lastSig = '';

  const runImport = (reason) => {
    if (queued) return; // an import is already lined up; it'll pick up the latest file
    queued = true;
    chain = chain.then(async () => {
      queued = false;
      const source = reason === 'startup' ? 'startup' : 'watch';
      try {
        const { inserted, skipped } = await importSubmissionsFromFile(pool, filePath);
        importStatus.set({ source, ok: true, inserted, skipped });
        console.log(
          `[submissions] ${reason}: imported ${inserted} row(s)` +
          (skipped ? `, skipped ${skipped} without an Id, timestamp or SITA code` : '')
        );
      } catch (err) {
        // Locked file (Excel open), half-written file, bad workbook — log and wait
        // for the next change rather than crashing the server.
        importStatus.set({ source, ok: false, error: err.message });
        console.error(`[submissions] ${reason}: import failed — ${err.message} (will retry on next change)`);
      }
    });
  };

  // Catch up once on startup, in case the file changed while the server was down.
  fs.promises.access(filePath).then(
    () => runImport('startup'),
    () => console.warn(`[submissions] ${filePath} not found yet — will import when it appears`)
  );

  fs.watchFile(filePath, { interval: intervalMs }, (curr) => {
    if (curr.mtimeMs === 0) return; // file removed
    const sig = `${curr.mtimeMs}:${curr.size}`;
    if (sig === lastSig) return;
    lastSig = sig;

    // Wait one more interval and re-check: if the signature hasn't moved, the
    // write has settled and it's safe to read.
    setTimeout(() => {
      try {
        const s = fs.statSync(filePath);
        if (`${s.mtimeMs}:${s.size}` === sig) runImport('file changed');
      } catch {
        /* file gone between poll and stat — ignore */
      }
    }, intervalMs);
  });

  console.log(`[submissions] watching ${filePath} for changes (checking every ${intervalMs / 1000}s)`);
}

module.exports = { watchSubmissionsFile };

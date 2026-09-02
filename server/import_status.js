// Remembers the outcome of the most recent form_submissions import (manual upload
// or file-watch), so the Submissions page can show "last import: …" and surface
// failures that would otherwise only appear in the server console.
//
// In-memory only — resets when the server restarts.
let last = null;

module.exports = {
  get() {
    return last;
  },
  set(info) {
    last = { at: new Date().toISOString(), ...info };
  },
};

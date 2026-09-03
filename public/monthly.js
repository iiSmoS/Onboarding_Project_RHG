// Monthly report notes page. Talks to the /monthly-notes API in server/monthly_notes.js.

const monthPicker = document.getElementById('month-picker');
const noteCount = document.getElementById('note-count');
const notesBody = document.getElementById('notes-body');
const addForm = document.getElementById('add-note-form');
const kindSelect = document.getElementById('note-kind');
const fieldsBox = document.getElementById('note-fields');
const copyBtn = document.getElementById('copy-report');
const copyStatus = document.getElementById('copy-status');

// Which input fields each note type shows, and their labels. Field names map 1:1
// to columns on the monthly_notes table.
const FIELD_DEFS = {
  onboarding:  [['sita', 'SITA code'], ['hotel_name', 'Hotel name'], ['note', 'Detail (optional)']],
  rebranding:  [['sita', 'SITA code'], ['old_value', 'Old brand / name'], ['new_value', 'New brand / name'], ['note', 'Detail (optional)']],
  sita_change: [['hotel_name', 'Hotel name'], ['old_value', 'Old SITA code'], ['new_value', 'New SITA code'], ['note', 'Detail (optional)']],
  name_change: [['sita', 'SITA code'], ['old_value', 'Old name'], ['new_value', 'New name'], ['note', 'Detail (optional)']],
  other:       [['note', 'Update']],
};

let KINDS = [];          // [{key, label}] from the server, in display order
let currentNotes = [];   // notes for the shown month
let editingId = null;    // id of the note whose inline edit form is open

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value) {
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function labelForKind(key) {
  const k = KINDS.find((x) => x.key === key);
  return k ? k.label : key;
}

// One note rendered as a single line of report text.
function formatNote(n) {
  const paren = n.note ? ` (${n.note})` : '';
  const arrow = `${n.old_value || '?'} → ${n.new_value || '?'}`;
  if (n.kind === 'onboarding') {
    return [n.sita, n.hotel_name].filter(Boolean).join(' — ') || '(unnamed hotel)';
  }
  if (n.kind === 'rebranding') {
    return `${n.sita ? n.sita + ' — ' : ''}${arrow}${paren}`;
  }
  if (n.kind === 'sita_change') {
    return `${n.hotel_name ? n.hotel_name + ' — ' : ''}${arrow}${paren}`;
  }
  if (n.kind === 'name_change') {
    return `${n.sita ? n.sita + ' — ' : ''}${arrow}${paren}`;
  }
  return n.note || '(empty note)';
}

// Build the plain-text report block for the current month.
function buildReportText() {
  const lines = [`MONTHLY REPORT NOTES — ${monthLabel(monthPicker.value)}`, ''];
  let any = false;

  for (const kind of KINDS) {
    const rows = currentNotes.filter((n) => n.kind === kind.key);
    if (rows.length === 0) continue;
    any = true;
    lines.push(kind.label.toUpperCase());
    rows.forEach((n) => lines.push(`- ${formatNote(n)}`));
    lines.push('');
  }

  if (!any) lines.push('(no notes for this month)');
  return lines.join('\n').trim() + '\n';
}

// --- Rendering ------------------------------------------------------------

function fieldInputs(kind, values = {}) {
  return FIELD_DEFS[kind].map(([name, label]) => {
    const val = escapeHtml(values[name] ?? '');
    const input = name === 'note'
      ? `<textarea name="${name}" rows="2">${val}</textarea>`
      : `<input type="text" name="${name}" value="${val}">`;
    return `<label>${escapeHtml(label)}${input}</label>`;
  }).join('');
}

function renderAddFields() {
  fieldsBox.innerHTML = fieldInputs(kindSelect.value);
}

function noteRowHtml(n) {
  if (n.id === editingId) {
    return `
      <li class="mn-note mn-note--editing" data-id="${n.id}">
        <form class="mn-edit" data-id="${n.id}">
          <div class="mn-fields">${fieldInputs(n.kind, n)}</div>
          <div class="mn-edit__actions">
            <button type="submit">Save</button>
            <button type="button" class="mn-cancel">Cancel</button>
          </div>
        </form>
      </li>`;
  }
  return `
    <li class="mn-note" data-id="${n.id}">
      <span class="mn-note__text">${escapeHtml(formatNote(n))}</span>
      <span class="mn-note__actions">
        ${n.auto_generated ? '<span class="mn-auto">auto</span>' : ''}
        <button type="button" class="mn-edit-btn" data-id="${n.id}">Edit</button>
        <button type="button" class="mn-del-btn" data-id="${n.id}">Delete</button>
      </span>
    </li>`;
}

function render() {
  noteCount.textContent = currentNotes.length;

  if (currentNotes.length === 0) {
    notesBody.innerHTML = `<p class="empty-note">No notes for ${escapeHtml(monthLabel(monthPicker.value))} yet.</p>`;
    return;
  }

  notesBody.innerHTML = KINDS.map((kind) => {
    const rows = currentNotes.filter((n) => n.kind === kind.key);
    if (rows.length === 0) return '';
    return `
      <div class="mn-group">
        <h3>${escapeHtml(kind.label)} <span class="mn-group__count">${rows.length}</span></h3>
        <ul class="mn-list">${rows.map(noteRowHtml).join('')}</ul>
      </div>`;
  }).join('');
}

// --- Data --------------------------------------------------------------

async function loadNotes() {
  try {
    const res = await fetch(`/monthly-notes?month=${encodeURIComponent(monthPicker.value)}`);
    if (!res.ok) throw new Error(`GET /monthly-notes failed: ${res.status}`);
    const data = await res.json();
    currentNotes = data.notes;
    render();
  } catch (err) {
    console.error(err);
    notesBody.innerHTML = '<p class="empty-note">Could not load notes. Is the server running?</p>';
  }
}

function collectFields(formEl, kind) {
  const body = {};
  for (const [name] of FIELD_DEFS[kind]) {
    body[name] = formEl.elements[name].value.trim();
  }
  return body;
}

// --- Events ----------------------------------------------------------

kindSelect.addEventListener('change', renderAddFields);

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const kind = kindSelect.value;
  const body = { month: monthPicker.value, kind, ...collectFields(addForm, kind) };

  const res = await fetch('/monthly-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not add the note');
    return;
  }
  addForm.reset();
  renderAddFields();
  loadNotes();
});

notesBody.addEventListener('click', async (e) => {
  const id = e.target.dataset.id;

  if (e.target.classList.contains('mn-edit-btn')) {
    editingId = Number(id);
    render();
    return;
  }
  if (e.target.classList.contains('mn-cancel')) {
    editingId = null;
    render();
    return;
  }
  if (e.target.classList.contains('mn-del-btn')) {
    if (!confirm('Delete this note?')) return;
    const res = await fetch(`/monthly-notes/${id}`, { method: 'DELETE' });
    if (!res.ok) { alert('Could not delete the note'); return; }
    loadNotes();
  }
});

notesBody.addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('mn-edit')) return;
  e.preventDefault();

  const id = e.target.dataset.id;
  const note = currentNotes.find((n) => String(n.id) === String(id));
  const body = collectFields(e.target, note.kind);

  const res = await fetch(`/monthly-notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not save the note');
    return;
  }
  editingId = null;
  loadNotes();
});

monthPicker.addEventListener('change', () => {
  editingId = null;
  loadNotes();
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildReportText());
    copyStatus.className = 'import-status';
    copyStatus.textContent = `Copied ${currentNotes.length} note(s) for ${monthLabel(monthPicker.value)}.`;
  } catch (err) {
    console.error(err);
    copyStatus.className = 'import-status import-status--error';
    copyStatus.textContent = 'Could not copy to the clipboard.';
  }
  setTimeout(() => { copyStatus.textContent = ''; }, 4000);
});

// --- Init ------------------------------------------------------------

async function init() {
  monthPicker.value = currentMonthValue();
  try {
    const res = await fetch('/monthly-notes/kinds');
    if (!res.ok) throw new Error(`GET /monthly-notes/kinds failed: ${res.status}`);
    KINDS = await res.json();
  } catch (err) {
    console.error(err);
    notesBody.innerHTML = '<p class="empty-note">Could not load the note types.</p>';
    return;
  }

  kindSelect.innerHTML = KINDS.map((k) => `<option value="${k.key}">${escapeHtml(k.label)}</option>`).join('');
  renderAddFields();
  loadNotes();
}

init();

const COLUMNS = [
  { key: 'form_response_id', label: 'Id' },
  { key: 'completion_time', label: 'Completion time', isDate: true },
  { key: 'email', label: 'Email' },
  { key: 'sita_code', label: 'SITA code' },
  { key: 'hotel_name', label: "Hotel's name" },
  { key: 'hotel_short_name', label: "Hotel's short name" },
  { key: 'general_manager', label: 'General Manager' },
  { key: 'contract_type', label: 'Contract type' },
  { key: 'md_leased', label: 'Managing Director: Leased' },
  { key: 'area_franchised', label: 'Area - Franchised' },
  { key: 'md_emea_franchised', label: 'MDs/FDs EMEA - Franchised' },
  { key: 'md_seap_franchised', label: 'MD SEAP - Franchised' },
  { key: 'md_china_franchised', label: 'MD China - Franchised' },
  { key: 'md_south_asia_franchised', label: 'MD South Asia (India, Nepal) - Franchised' },
  { key: 'area_managed', label: 'Area - Managed' },
  { key: 'md_china_managed', label: 'MD China - Managed' },
  { key: 'md_europe_managed', label: 'MD Europe - Managed' },
  { key: 'md_mea_managed', label: 'MD MEA - Managed' },
  { key: 'md_seap_managed', label: 'MD SEAP - Managed' },
  { key: 'md_south_asia_managed', label: 'MD South Asia (India, Nepal)- Managed' },
  { key: 'star_rating', label: 'Official Star rating' },
  { key: 'expected_opening_date', label: 'Expected opening date', isDate: true },
  { key: 'services_offered', label: 'Services offered at the hotel' },
  { key: 'bar_outlets', label: 'BAR outlets' },
  { key: 'restaurant_outlets', label: 'RESTAURANT outlets' },
  { key: 'tripadvisor_link', label: "Hotel's Tripadvisor link" },
  { key: 'compset_tripadvisor_links', label: "Compset's Tripadvisor links" },
  { key: 'me_lead_catcher_email', label: 'M&E Lead Catcher Email Address' },
  { key: 'country', label: 'Country of the Hotel' },
];

// Fields matched against the search box
const SEARCH_KEYS = ['hotel_name', 'hotel_short_name', 'sita_code', 'country', 'general_manager', 'email'];

const submissionsBody = document.getElementById('submissions-body');
const submissionsCount = document.getElementById('submissions-count');
const searchInput = document.getElementById('submissions-search');
const uploadForm = document.getElementById('upload-form');
const uploadStatus = document.getElementById('upload-status');
const importStatusLine = document.getElementById('import-status-line');

let allSubmissions = [];
let lastImportAt = null; // timestamp of the import we last reflected on the page

// Escape anything from the server before dropping it into innerHTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatValue(sub, col) {
  const value = sub[col.key];
  if (value === null || value === undefined) return '';
  if (col.isDate) return String(value).split('T')[0];
  return value;
}

function dateOnly(value) {
  return value ? String(value).split('T')[0] : null;
}

function cardMarkup(sub) {
  const opening = dateOnly(sub.expected_opening_date);
  const submitted = dateOnly(sub.completion_time);

  const tags = [
    sub.sita_code ? `<span class="tag">SITA ${escapeHtml(sub.sita_code)}</span>` : '',
    sub.country ? `<span class="chip">${escapeHtml(sub.country)}</span>` : '',
    sub.contract_type ? `<span class="chip">${escapeHtml(sub.contract_type)}</span>` : '',
    opening ? `<span class="chip chip--date">Opens ${opening}</span>` : '',
  ].join('');

  const metaBits = [
    sub.general_manager ? `GM: ${escapeHtml(sub.general_manager)}` : '',
    sub.email ? escapeHtml(sub.email) : '',
    submitted ? `Submitted ${submitted}` : '',
  ].filter(Boolean).join('<span class="dot">·</span>');

  // Full breakdown: every column that actually has a value
  const detail = COLUMNS.map((col) => {
    const value = formatValue(sub, col);
    if (value === '' || value === null || value === undefined) return '';
    const isLink = col.key === 'tripadvisor_link' && /^https?:\/\//i.test(value);
    const rendered = isLink
      ? `<a href="${escapeHtml(value)}" target="_blank" rel="noopener">${escapeHtml(value)}</a>`
      : escapeHtml(value);
    return `<div class="sub-field"><dt>${escapeHtml(col.label)}</dt><dd>${rendered}</dd></div>`;
  }).join('');

  const shortName = sub.hotel_short_name && sub.hotel_short_name !== sub.hotel_name
    ? `<p class="sub-card__sub">${escapeHtml(sub.hotel_short_name)}</p>`
    : '';

  return `
    <div class="sub-card__main">
      <div class="sub-card__info">
        <div class="sub-card__tags">${tags}</div>
        <h3>${escapeHtml(sub.hotel_name || '(no name)')}</h3>
        ${shortName}
        ${metaBits ? `<p class="sub-card__meta">${metaBits}</p>` : ''}
      </div>
      <button class="toggle-details" type="button">Details</button>
    </div>
    <dl class="sub-card__detail hidden">${detail}</dl>
  `;
}

function renderCards() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? allSubmissions.filter((sub) =>
        SEARCH_KEYS.some((k) => String(sub[k] ?? '').toLowerCase().includes(q)))
    : allSubmissions;

  submissionsCount.textContent = filtered.length;
  submissionsBody.innerHTML = '';

  if (filtered.length === 0) {
    submissionsBody.innerHTML = `<p class="empty-note">${
      allSubmissions.length ? 'No submissions match your search.' : 'No submissions yet — upload an Excel export above.'
    }</p>`;
    return;
  }

  filtered.forEach((sub) => {
    const card = document.createElement('article');
    card.className = 'sub-card';
    card.innerHTML = cardMarkup(sub);
    submissionsBody.appendChild(card);
  });
}

async function loadSubmissions() {
  try {
    const res = await fetch('/form-submissions');
    if (!res.ok) throw new Error(`GET /form-submissions failed: ${res.status}`);
    allSubmissions = await res.json();
    renderCards();
  } catch (err) {
    console.error(err);
    submissionsBody.innerHTML = '<p class="empty-note">Could not load submissions. Is the server running?</p>';
  }
}

function timeAgo(iso) {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 90) return 'a minute ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  return `${Math.round(hrs / 24)} day(s) ago`;
}

// Show the outcome of the most recent import; if an auto-import brought in new
// data since we last looked, refresh the list too.
async function refreshImportStatus() {
  let s;
  try {
    const res = await fetch('/form-submissions/status');
    if (!res.ok) return;
    s = await res.json();
  } catch {
    return;
  }

  if (!s || !s.at) {
    importStatusLine.textContent = '';
    return;
  }

  const auto = s.source === 'watch' || s.source === 'startup';
  if (s.ok) {
    importStatusLine.className = 'import-status';
    importStatusLine.textContent =
      `Last import: ${s.inserted} row(s)` +
      (s.skipped ? `, ${s.skipped} skipped` : '') +
      ` · ${timeAgo(s.at)}${auto ? ' (auto)' : ''}`;
  } else {
    importStatusLine.className = 'import-status import-status--error';
    importStatusLine.textContent = `Last import failed · ${timeAgo(s.at)} · ${s.error}`;
  }

  if (s.ok && auto && s.at !== lastImportAt && lastImportAt !== null) {
    loadSubmissions(); // new responses arrived on their own — pull them in
  }
  lastImportAt = s.at;
}

submissionsBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-details');
  if (!btn) return;
  const card = btn.closest('.sub-card');
  const detail = card.querySelector('.sub-card__detail');
  const nowHidden = detail.classList.toggle('hidden');
  // Expanded cards break out to full width so the detail grid has room
  card.classList.toggle('is-expanded', !nowHidden);
  btn.textContent = nowHidden ? 'Details' : 'Hide';
});

searchInput.addEventListener('input', renderCards);

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById('excel-file');
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  uploadStatus.textContent = 'Uploading...';

  try {
    const res = await fetch('/form-submissions/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    uploadStatus.textContent = res.ok ? data.message : `Error: ${data.error}`;
    if (res.ok) {
      loadSubmissions();
      refreshImportStatus();
    }
  } catch (err) {
    uploadStatus.textContent = 'Upload failed';
  }
});

loadSubmissions();
refreshImportStatus();
setInterval(refreshImportStatus, 30000); // catch watch-triggered imports without a manual refresh

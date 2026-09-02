const form = document.getElementById('add-hotel-form');
const hotelsBody = document.getElementById('hotels-body');
const hotelCount = document.getElementById('hotel-count');

// Filled from GET /config/steps so this page doesn't keep its own copy of the list
let STEPS = [];

let allHotels = []; // holds the full unfiltered list fetched from the server
const openCards = new Set(); // hotel ids whose Details panel is expanded, so re-render keeps them open

const statusSelect = document.getElementById('status-filter');
const sortOrderSelect = document.getElementById('sort-order');
const clearFiltersBtn = document.getElementById('clear-filters');

const DEFAULT_STATUS = 'in_progress';
const DEFAULT_SORT = 'asc';

// Escape anything from the server before dropping it into innerHTML
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Whole days from today (local, midnight) to the opening date. Negative = in the past.
function daysUntil(isoDate) {
  if (!isoDate) return null;
  const target = new Date(`${isoDate.split('T')[0]}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Countdown badge + urgency level, bucketed by how close the opening is.
// Completed hotels get no urgency treatment — they're done.
function deadlineStatus(hotel) {
  const days = daysUntil(hotel.opening_date);
  if (days === null) return null;
  if (hotel.completed) return { level: 'done', label: 'Opened', cardClass: '' };

  const d = Math.abs(days);
  const dayWord = d === 1 ? 'day' : 'days';

  if (days < 0) return { level: 'overdue', label: `Overdue ${d} ${dayWord}`, cardClass: 'hotel-card--urgent' };
  if (days === 0) return { level: 'overdue', label: 'Opens today', cardClass: 'hotel-card--urgent' };
  if (days <= 7) return { level: 'urgent', label: `${days} ${dayWord} left`, cardClass: 'hotel-card--urgent' };
  if (days <= 30) return { level: 'soon', label: `${days} days left`, cardClass: 'hotel-card--warning' };
  if (days <= 90) return { level: 'upcoming', label: `${days} days left`, cardClass: '' };
  return { level: 'far', label: `${days} days left`, cardClass: '' };
}

async function loadHotels() {
  try {
    const res = await fetch('/hotels');
    if (!res.ok) throw new Error(`GET /hotels failed: ${res.status}`);
    allHotels = await res.json();
    renderHotels();
  } catch (err) {
    console.error(err);
    hotelsBody.innerHTML = '<p class="progress-label">Could not load hotels. Is the server running?</p>';
  }
}

function matchesStatus(hotel, status) {
  if (status === 'all') return true;
  if (status === 'completed') return hotel.completed;
  if (status === 'in_progress') return !hotel.completed;

  // The remaining buckets are about the opening date and only apply to open items
  if (hotel.completed) return false;
  const days = daysUntil(hotel.opening_date);
  if (days === null) return false;
  if (status === 'overdue') return days < 0;
  if (status === 'opening_soon') return days >= 0 && days <= 30;
  return false;
}

function renderHotels() {
  const status = statusSelect.value;

  const filtered = allHotels.filter(hotel => matchesStatus(hotel, status));

// Sort by opening date — hotels with no date always go last, regardless of direction
const sortDirection = sortOrderSelect.value; // 'asc' or 'desc'
filtered.sort((a, b) => {
  if (!a.opening_date && !b.opening_date) return 0;
  if (!a.opening_date) return 1;
  if (!b.opening_date) return -1;

  const dateA = new Date(a.opening_date);
  const dateB = new Date(b.opening_date);

  return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
});

  hotelsBody.innerHTML = '';
  hotelCount.textContent = filtered.length;

  filtered.forEach(hotel => {
    const completedCount = STEPS.filter(s => hotel[s.key]).length;
    const total = STEPS.length;
    const pct = hotel.completed ? 100 : Math.round((completedCount / total) * 100);
    const detailsOpen = openCards.has(String(hotel.id));

    const deadline = deadlineStatus(hotel);

    const card = document.createElement('article');
    card.classList.add('hotel-card');
    if (hotel.completed) card.classList.add('hotel-card--completed');
    if (deadline && deadline.cardClass) card.classList.add(deadline.cardClass);

    const checkboxesHtml = STEPS.map(s => `
      <label class="step-item">
        <input type="checkbox" data-id="${hotel.id}" data-step="${s.key}" ${hotel[s.key] ? 'checked' : ''}>
        <span>${escapeHtml(s.label)}</span>
      </label>
    `).join('');

    card.innerHTML = `
      <div class="hotel-card__main">
        <div class="ring" style="--pct: ${pct}"><span>${pct}%</span></div>
        <div class="hotel-card__info">
          <div class="hotel-card__tags">
            <span class="tag">SITA ${escapeHtml(hotel.sita)}</span>
            <span class="date">Opens ${hotel.opening_date ? hotel.opening_date.split('T')[0] : 'TBC'}</span>
            ${deadline && deadline.level !== 'done' ? `<span class="deadline deadline--${deadline.level}">${deadline.label}</span>` : ''}
            ${hotel.completed ? '<span class="tag tag--done">Completed</span>' : ''}
          </div>
          <h3>${escapeHtml(hotel.hotel_name)}</h3>
          <p class="progress-label">${completedCount} of ${total} steps done</p>
        </div>
        <button class="toggle-details" data-id="${hotel.id}">Details</button>
      </div>
      <div class="hotel-card__details ${detailsOpen ? '' : 'hidden'}" data-detail-for="${hotel.id}">
        <div class="steps-grid">${checkboxesHtml}</div>

        <div class="email-section">
          <div class="email-buttons">
            <button class="preview-email" data-id="${hotel.id}" data-template="first_onboarding_email">
              Generate GM First email
            </button>
            <button class="preview-email" data-id="${hotel.id}" data-template="gm_reminder">
              Generate GM reminder email
            </button>
          </div>
          <div class="email-preview hidden" data-preview-for="${hotel.id}">
            <p class="email-subject-line"></p>
            <div class="email-body" contenteditable="true"></div>
            <button class="copy-email" data-id="${hotel.id}">Copy email</button>
          </div>
        </div>

        <div class="hotel-admin">
          <div class="hotel-admin__buttons">
            <button type="button" class="edit-hotel" data-id="${hotel.id}">Edit hotel</button>
            <button type="button" class="delete-hotel" data-id="${hotel.id}">Delete</button>
          </div>
          <form class="hotel-edit hidden" data-edit-for="${hotel.id}">
            <label>SITA
              <input name="sita" value="${escapeHtml(hotel.sita)}" required>
            </label>
            <label>Hotel name
              <input name="hotel_name" value="${escapeHtml(hotel.hotel_name)}" required>
            </label>
            <label>Opening date
              <input type="date" name="opening_date" value="${hotel.opening_date ? hotel.opening_date.split('T')[0] : ''}">
            </label>
            <div class="hotel-edit__actions">
              <button type="submit">Save</button>
              <button type="button" class="cancel-edit">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    hotelsBody.appendChild(card);
  });
}

hotelsBody.addEventListener('click', async (e) => {
  // --- Edit hotel: reveal the inline form ---
  if (e.target.classList.contains('edit-hotel')) {
    const admin = e.target.closest('.hotel-admin');
    admin.querySelector('.hotel-edit').classList.remove('hidden');
    admin.querySelector('.hotel-admin__buttons').classList.add('hidden');
    return;
  }
  if (e.target.classList.contains('cancel-edit')) {
    const admin = e.target.closest('.hotel-admin');
    admin.querySelector('.hotel-edit').classList.add('hidden');
    admin.querySelector('.hotel-admin__buttons').classList.remove('hidden');
    return;
  }

  // --- Delete hotel ---
  if (e.target.classList.contains('delete-hotel')) {
    const id = e.target.dataset.id;
    const hotel = allHotels.find(h => String(h.id) === String(id));
    if (!confirm(`Delete "${hotel ? hotel.hotel_name : 'this hotel'}"? This can't be undone.`)) return;
    try {
      const res = await fetch(`/hotels/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
      allHotels = allHotels.filter(h => String(h.id) !== String(id));
      openCards.delete(String(id));
      renderHotels();
    } catch (err) {
      console.error(err);
      alert('Could not delete the hotel');
    }
    return;
  }

  // Generate/preview an email. The two buttons share one preview box:
  //  - click a button        -> show that template
  //  - click the other one   -> switch to it (box stays open)
  //  - click the same one    -> close the box (toggle, like Details)
  if (e.target.classList.contains('preview-email')) {
    const btn = e.target;
    const id = btn.dataset.id;
    const templateName = btn.dataset.template;
    const section = btn.closest('.email-section');
    const previewBox = section.querySelector('.email-preview');
    const buttons = section.querySelectorAll('.preview-email');

    const showingThisAlready = !previewBox.classList.contains('hidden')
      && previewBox.dataset.template === templateName;

    if (showingThisAlready) {
      previewBox.classList.add('hidden');
      previewBox.dataset.template = '';
      buttons.forEach(b => b.classList.remove('preview-email--active'));
      return;
    }

    const res = await fetch(`/hotels/${id}/email-preview/${templateName}`);
    if (!res.ok) {
      alert('Could not generate the email');
      return;
    }
    const data = await res.json();

    previewBox.querySelector('.email-subject-line').textContent = `Subject: ${data.subject}`;
    previewBox.querySelector('.email-body').innerHTML = data.bodyHtml;
    previewBox.dataset.template = templateName;
    previewBox.classList.remove('hidden');
    buttons.forEach(b => b.classList.toggle('preview-email--active', b === btn));
  }

  // Copy the email (subject + rendered HTML body) to clipboard
  if (e.target.classList.contains('copy-email')) {
    const previewBox = e.target.closest('.email-preview');
    const bodyEl = previewBox.querySelector('.email-body');

    const htmlBlob = new Blob([bodyEl.innerHTML], { type: 'text/html' });
    const textBlob = new Blob([bodyEl.innerText], { type: 'text/plain' });

    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob })
    ]);

    e.target.textContent = 'Copied!';
    setTimeout(() => { e.target.textContent = 'Copy email'; }, 1500);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const sita = document.getElementById('sita').value;
  const hotel_name = document.getElementById('hotel_name').value;
  const opening_date = document.getElementById('opening_date').value;

  const res = await fetch('/hotels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sita, hotel_name, opening_date })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Could not add the hotel');
    return;
  }

  form.reset();
  loadHotels();
});

// Save an inline hotel edit (submit bubbles up from the card's form)
hotelsBody.addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('hotel-edit')) return;
  e.preventDefault();

  const formEl = e.target;
  const id = formEl.dataset.editFor;
  const body = {
    sita: formEl.sita.value.trim(),
    hotel_name: formEl.hotel_name.value.trim(),
    opening_date: formEl.opening_date.value || null,
  };

  try {
    const res = await fetch(`/hotels/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Save failed: ${res.status}`);
    }
    const updated = await res.json();
    const idx = allHotels.findIndex(h => h.id === updated.id);
    if (idx !== -1) allHotels[idx] = updated;
    renderHotels(); // card stays open via openCards; the edit form re-renders collapsed
  } catch (err) {
    console.error(err);
    alert(err.message || 'Could not save the hotel');
  }
});

hotelsBody.addEventListener('click', (e) => {
  if (e.target.classList.contains('toggle-details')) {
    const id = e.target.dataset.id;
    const detail = hotelsBody.querySelector(`[data-detail-for="${id}"]`);
    const nowHidden = detail.classList.toggle('hidden');
    if (nowHidden) openCards.delete(id);
    else openCards.add(id);
  }
});

hotelsBody.addEventListener('change', async (e) => {
  if (e.target.type === 'checkbox') {
    const id = e.target.dataset.id;
    const step = e.target.dataset.step;
    const value = e.target.checked;

    try {
      const res = await fetch(`/hotels/${id}/step`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, value })
      });
      if (!res.ok) throw new Error(`PATCH step failed: ${res.status}`);

      // Patch just this hotel from the response instead of refetching the whole list
      const updated = await res.json();
      const idx = allHotels.findIndex(h => h.id === updated.id);
      if (idx !== -1) allHotels[idx] = updated;
      renderHotels();
    } catch (err) {
      console.error(err);
      e.target.checked = !value; // roll the checkbox back so the UI matches the server
      alert('Could not save that change');
    }
  }
});

statusSelect.addEventListener('change', renderHotels);
sortOrderSelect.addEventListener('change', renderHotels);

clearFiltersBtn.addEventListener('click', () => {
  statusSelect.value = DEFAULT_STATUS;
  sortOrderSelect.value = DEFAULT_SORT;
  renderHotels();
});

async function init() {
  try {
    const res = await fetch('/config/steps');
    if (!res.ok) throw new Error(`GET /config/steps failed: ${res.status}`);
    STEPS = await res.json();
  } catch (err) {
    console.error(err);
    hotelsBody.innerHTML = '<p class="progress-label">Could not load the checklist config.</p>';
    return;
  }
  loadHotels();
}

init();

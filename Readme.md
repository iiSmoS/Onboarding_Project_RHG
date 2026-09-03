# Hotel Onboarding Tracker

An internal webapp to track hotels through the onboarding process, generate reminder emails, and import onboarding form responses from Excel.

## What you need installed

### 1. Node.js (LTS version)
Download from https://nodejs.org

Check it's installed:
```bash
node -v
npm -v
```

### 2. PostgreSQL
Download from https://www.postgresql.org/download/

During install, you'll set a password for the default `postgres` user — you'll need it for `.env` later.

Check it's installed:
```bash
psql --version
```

If `psql` isn't recognized in your terminal, add PostgreSQL's `bin` folder (e.g. `C:\Program Files\PostgreSQL\18\bin`) to your system's PATH environment variable, then reopen the terminal. Alternatively, run it with the full path:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres
```

### 3. A code editor
[VS Code](https://code.visualstudio.com) is what this project was built in. Recommended extensions:
- **REST Client** — for testing API endpoints via `requests.http`
- **PostgreSQL** by Microsoft (`ms-ossdata.vscode-pgsql`) — browse tables and run SQL without leaving the editor (see below)

### 4. Viewing the database
Use the **PostgreSQL** extension above. Add a connection with:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| User | `postgres` |
| Password | your `.env` `DB_PASSWORD` |
| Database | `hotel_onboarding` |

It gives you a schema tree in the sidebar and a query editor for any `.sql` file — enough for
peeking at rows and running the schema in Step 3. (pgAdmin or JetBrains DataGrip also work if
you want a full admin GUI, but they're not needed for this project.)

---

## What NOT to copy onto a USB key / new machine

- **`node_modules/`** — regenerate it with `npm install` instead of copying (it can be huge and is fully derived from `package.json`)
- **`.env`** — contains your database password; copy it separately and never commit it to Git or share it publicly

---

## Setting up on a new machine

### Step 1: Copy the project folder
Copy everything **except** `node_modules` onto the new machine.

### Step 2: Install dependencies
```bash
npm install
```
This reinstalls `express`, `pg`, `dotenv`, `nodemon`, `multer`, and `xlsx` automatically from `package.json`.

### Step 3: Recreate the database

```sql
CREATE DATABASE hotel_onboarding;
```

Then, connected to that database, run:

```sql
CREATE TABLE hotels (
  id SERIAL PRIMARY KEY,
  sita VARCHAR(50) NOT NULL,
  hotel_name VARCHAR(255) NOT NULL,
  opening_date DATE,
  gm_email VARCHAR(255),
  received_opening_info BOOLEAN DEFAULT FALSE,
  gm_contacted BOOLEAN DEFAULT FALSE,
  gm_missing_info BOOLEAN DEFAULT FALSE,
  gm_contacted_again BOOLEAN DEFAULT FALSE,
  all_info_filled BOOLEAN DEFAULT FALSE,
  onboarding_page_filled BOOLEAN DEFAULT FALSE,
  it_ticket_sent BOOLEAN DEFAULT FALSE,
  it_onboarding_confirmed BOOLEAN DEFAULT FALSE,
  onboarding_excel_prepared BOOLEAN DEFAULT FALSE,
  onboarding_excel_sent BOOLEAN DEFAULT FALSE,
  reviewpro_confirmed BOOLEAN DEFAULT FALSE,
  gm_manage_sent BOOLEAN DEFAULT FALSE,
  gm_second_email_sent BOOLEAN DEFAULT FALSE,
  survey_data_sent BOOLEAN DEFAULT FALSE,
  it_confirmed_survey_sending BOOLEAN DEFAULT FALSE,
  surveys_sent BOOLEAN DEFAULT FALSE,
  completed BOOLEAN DEFAULT FALSE,
  comments TEXT,
  added_to_monthly_report BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE form_submissions (
  id SERIAL PRIMARY KEY,
  form_response_id INTEGER,
  completion_time TIMESTAMP,
  email VARCHAR(255),
  sita_code VARCHAR(50) UNIQUE,
  hotel_name VARCHAR(255),
  hotel_short_name VARCHAR(255),
  general_manager VARCHAR(255),
  contract_type VARCHAR(255),
  md_leased VARCHAR(255),
  area_franchised VARCHAR(100),
  md_emea_franchised VARCHAR(255),
  md_seap_franchised VARCHAR(255),
  md_china_franchised VARCHAR(255),
  md_south_asia_franchised VARCHAR(255),
  area_managed VARCHAR(100),
  md_china_managed VARCHAR(255),
  md_europe_managed VARCHAR(255),
  md_mea_managed VARCHAR(255),
  md_seap_managed VARCHAR(255),
  md_south_asia_managed VARCHAR(255),
  star_rating TEXT,
  expected_opening_date DATE,
  services_offered TEXT,
  bar_outlets TEXT,
  restaurant_outlets TEXT,
  tripadvisor_link TEXT,
  compset_tripadvisor_links TEXT,
  me_lead_catcher_email VARCHAR(255),
  country VARCHAR(100),
  imported_at TIMESTAMP DEFAULT NOW()
);
```

> Note: `sita_code` has a `UNIQUE` constraint — re-uploading a file with the same SITA code updates that hotel's row instead of duplicating it. `star_rating` is `TEXT` (not a short `VARCHAR`) because real submissions sometimes contain full sentences instead of a simple rating.

There is also a `monthly_notes` table behind the **Monthly Report** page. You don't
need to create it by hand — the server runs `CREATE TABLE IF NOT EXISTS` for it on
startup. For reference, its shape is:

```sql
CREATE TABLE monthly_notes (
  id             SERIAL PRIMARY KEY,
  report_month   DATE NOT NULL,                 -- always the 1st of the month
  kind           VARCHAR(30) NOT NULL,          -- onboarding | rebranding | sita_change | name_change | other
  hotel_id       INTEGER REFERENCES hotels(id) ON DELETE SET NULL,
  sita           VARCHAR(50),
  hotel_name     VARCHAR(255),
  old_value      TEXT,
  new_value      TEXT,
  note           TEXT,
  auto_generated BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMP DEFAULT NOW()
);
```

### Step 4: Recreate the `.env` file
In the project root, create a file named `.env`:

```
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hotel_onboarding

# Optional — auto-import of the onboarding-form responses (see below)
SUBMISSIONS_XLSX_PATH=
SUBMISSIONS_XLSX_POLL_SECONDS=5
```

### Step 5: Run the app
```bash
npm run dev
```

You should see:
```
Server running at http://localhost:3000
```

Open `http://localhost:3000` in your browser — this loads the **Hotels** page. Use the navbar to switch to **Form Submissions**.

---

## Auto-importing form responses (optional)

Instead of uploading the Excel file on the Form Submissions page every time, you can
have the server watch the file and import it automatically.

1. Get a copy of the form export that updates on its own — e.g. in Microsoft Forms,
   **Open results in Excel**, save that workbook into a OneDrive/SharePoint folder that
   syncs to this machine. New responses then flow into the local `.xlsx`.
2. In `.env`, set `SUBMISSIONS_XLSX_PATH` to that file's full path, for example:
   ```
   SUBMISSIONS_XLSX_PATH=C:\Users\you\OneDrive\Onboarding\Form responses.xlsx
   ```
3. Restart `npm run dev`. You'll see:
   ```
   [submissions] watching C:\Users\you\OneDrive\Onboarding\Form responses.xlsx for changes (checking every 5s)
   [submissions] startup: imported 42 row(s)
   ```

From then on the server re-imports on startup and whenever the file changes (same
upsert-by-SITA-code logic as the manual upload). The manual **Upload** button still
works. If the file is briefly locked (Excel has it open) or mid-save, that pass is
skipped and retried on the next change. `SUBMISSIONS_XLSX_POLL_SECONDS` controls how
often it checks (default 5). Leave `SUBMISSIONS_XLSX_PATH` blank to disable.

The Form Submissions page shows a **"Last import: … "** line under the header (or the
error, in red, if the last import failed) and pulls in new rows on its own after an
auto-import.

---

## Keeping it running (so auto-import survives a reboot)

`npm run dev` only runs while that terminal is open. For the file watcher to keep
working after a restart, run the server as a background task:

- **`npm start`** runs it without nodemon (`node server/index.js`).
- **`start-server.bat`** (in the project root) does the same and relaunches it 10s
  after any crash. Point Windows **Task Scheduler** at it:
  1. Task Scheduler → **Create Task**
  2. *General*: give it a name; tick **Run whether user is logged on or not**
  3. *Triggers*: **New… → At startup** (or *At log on*)
  4. *Actions*: **New… → Start a program →** browse to `start-server.bat`
  5. *Settings*: tick **If the task fails, restart every 1 minute**

Check `http://localhost:3000` after a reboot to confirm it came back up.

---

## Project structure

```
hotel-onboarding-app/
├── server/
│   ├── index.js              → Express app + all API routes
│   ├── db.js                 → PostgreSQL connection pool
│   ├── steps.js              → single source of truth for the onboarding checklist
│   ├── monthly_notes.js      → Monthly Report notes: table + CRUD routes + auto-capture of SITA/name changes
│   ├── submissions_import.js → parse an .xlsx export + upsert into form_submissions
│   ├── watch_submissions.js  → watch SUBMISSIONS_XLSX_PATH and auto-import on change
│   ├── import_status.js      → remembers the last import outcome (for the status line)
│   └── email_templates.js    → email templates + fillTemplate() helper
├── public/
│   ├── index.html            → Hotels page (tracker, progress rings, email generator)
│   ├── submissions.html      → Form Submissions page (upload + full data table)
│   ├── monthly.html          → Monthly Report page (per-month notes + "Copy for report")
│   ├── style.css              → shared styling for all pages
│   ├── app.js                 → Hotels page logic
│   ├── submissions.js         → Form Submissions page logic
│   └── monthly.js             → Monthly Report page logic
├── requests.http               → test API requests (used with the REST Client extension)
├── package.json
└── .env                        → NOT committed to Git, holds DB credentials
```

## Pages

- **Hotels** (`index.html`) — add a hotel, track its 18-step onboarding progress with a progress ring, expand a card to check off individual steps, generate a GM reminder email pre-filled with hotel data
- **Form Submissions** (`submissions.html`) — upload an `.xlsx` export of onboarding form responses; parses and inserts/updates rows in `form_submissions`, then displays every column in a scrollable table
- **Monthly Report** (`monthly.html`) — the running notes for each month's report: onboarded hotels, rebrandings, SITA-code changes, name changes and free-text "extra updates". Pick a month, add/edit/delete notes grouped by type, and hit **Copy for report** to put the whole month on the clipboard as formatted text. Editing a hotel's SITA or name on the Hotels page, or ticking its "Added to monthly report" step, files a note here automatically for the current month (shown with an **auto** tag; still editable).

## API routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/hotels` | List all hotels |
| POST | `/hotels` | Create a hotel |
| PATCH | `/hotels/:id` | Edit a hotel's SITA, name and opening date |
| DELETE | `/hotels/:id` | Delete a hotel |
| PATCH | `/hotels/:id/step` | Toggle one onboarding step for a hotel |
| GET | `/hotels/:id/email-preview/:templateName` | Generate a filled-in email (subject + HTML body) from a template |
| GET | `/form-submissions` | List all imported form submissions |
| GET | `/form-submissions/status` | Outcome of the most recent import (manual or auto) |
| POST | `/form-submissions/upload` | Upload an `.xlsx` file, parse it, and insert/update rows |
| GET | `/monthly-notes/kinds` | The five note types + labels (for the page) |
| GET | `/monthly-notes/months` | Months that have notes, newest first (for the month picker) |
| GET | `/monthly-notes?month=YYYY-MM` | Notes for one month (defaults to the current month) |
| POST | `/monthly-notes` | Add a note (`month`, `kind`, plus `sita`/`hotel_name`/`old_value`/`new_value`/`note`) |
| PATCH | `/monthly-notes/:id` | Edit a note's fields |
| DELETE | `/monthly-notes/:id` | Delete a note |

---

## A note on corporate/work laptops

If you're working on a company laptop, keep the project folder **outside** any auto-synced location (OneDrive, SharePoint, etc.). Syncing `node_modules` can trigger security scanners due to third-party README files bundled inside dependencies. Also check your company's acceptable use policy regarding personal projects on work devices.
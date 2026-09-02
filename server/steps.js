// Single source of truth for the onboarding checklist.
//
// Order matters:
//   - the Hotels page renders steps in this order
//   - backfill_steps.js treats "every step before the last checked one" as
//     implicitly complete, so reordering changes what gets backfilled
//
// Served to the frontend via GET /config/steps, and used server-side to
// validate PATCH /hotels/:id/step and to build the import SQL.
const ONBOARDING_STEPS = [
  { key: 'received_opening_info', label: 'Received opening info' },
  { key: 'gm_contacted', label: 'Contacted GM' },
  { key: 'gm_missing_info', label: 'Missing info' },
  { key: 'gm_contacted_again', label: 'Contacted GM again' },
  { key: 'all_info_filled', label: 'All info filled in' },
  { key: 'onboarding_page_filled', label: 'Onboarding page filled' },
  { key: 'it_ticket_sent', label: 'IT ticket sent' },
  { key: 'it_onboarding_confirmed', label: 'IT confirmed onboarding' },
  { key: 'onboarding_excel_prepared', label: 'Onboarding Excel prepared' },
  { key: 'onboarding_excel_sent', label: 'Onboarding Excel sent' },
  { key: 'reviewpro_confirmed', label: 'ReviewPro confirmed' },
  { key: 'gm_manage_sent', label: 'GM Manage+ email sent' },
  { key: 'gm_second_email_sent', label: 'GM 2nd email sent (Vero copy)' },
  { key: 'survey_data_sent', label: 'Survey data sent to IT' },
  { key: 'it_confirmed_survey_sending', label: 'IT confirmed survey sending' },
  { key: 'surveys_sent', label: 'Surveys sent' },
  { key: 'completed', label: 'Completed' },
  { key: 'added_to_monthly_report', label: 'Added to monthly report' },
];

const STEP_KEYS = ONBOARDING_STEPS.map((s) => s.key);

module.exports = { ONBOARDING_STEPS, STEP_KEYS };

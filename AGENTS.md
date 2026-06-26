# Mazaya v2 Coding Rules

## Safety
- Do not read, print, expose, or ask the user to show .env, API keys, bot tokens, Supabase keys, Google credentials, or private secrets.
- Never run cat .env.
- Do not broad-refactor working code.
- One small patch at a time.
- Preserve existing working Telegram, Supabase, and Google Sheets integrations unless a change is required.

## Architecture
- Telegram is the operating interface.
- Supabase is the source of truth.
- Google Sheets is reporting only.
- Reminders are pending actions only.
- Follow-ups are completed communication history.
- Field visits are visit history.
- Companies are current company state.
- Tasks must not pollute CRM data.
- Personal tasks must not pollute company records.
- Drafting module is later and must not be built now.

## Workflow rule
Every important workflow must follow:
Ask required fields → Preview → Confirm/Edit/Cancel → Save only after Confirm → Sync Now/Later.

## Data rules
- Never overwrite old visits or old follow-ups.
- Revisit creates a new field visit row.
- Follow-up creates a new follow-up history row.
- Reminder reschedule must not create follow-up history.
- Skipping a follow-up note must not erase the previous latest note.

## Development rules
- Run type-check/build after patches when available.
- Ask before changing workflow logic, reporting logic, field names, status options, report columns, schema tables, or sync behavior.

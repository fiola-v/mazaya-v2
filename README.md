# Mazaya v2

Mazaya v2 is a Telegram-based daily operating system scaffold for field work, CRM history, reminders, tasks, notes, reporting, and later drafting.

## Architecture

- Telegram is the operating interface.
- Supabase is the source of truth.
- Google Sheets is reporting only.
- Reminders are pending actions.
- Follow-ups are completed communication history.
- Field visits are visit history.
- Companies are current company state.
- Tasks stay separate from CRM.
- Drafting is a later placeholder.

## Phase 1 Scope

This scaffold includes:

- TypeScript project setup
- Safe environment validation with `dotenv` and `zod`
- Telegraf bot startup
- `/health`, `/start`, and `/command`
- Command Center shell buttons
- Placeholder button responses
- Proposed Supabase schema only

It does not implement field visits, follow-ups, tasks, reports, reminders, notes, or drafting workflows yet.

## Setup

```bash
npm install
```

Create a local `.env` from `.env.example` and fill it locally. Do not commit secrets.

## Commands

```bash
npm run dev
npm run type-check
npm run build
npm run start
```

Do not run `supabase/schema.sql` until the schema is reviewed and approved.

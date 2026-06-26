-- Mazaya v2 production-ready baseline schema.
-- Review before running. Do not run migrations from this file automatically.

create extension if not exists pgcrypto;

create or replace function set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_code text unique,
  company_name text not null,
  industry text,
  website text,
  address text,
  visit_status text,
  interest_level text,
  client_pipeline_status text not null default 'Potential Client',
  current_blocker text,
  latest_human_note text,
  current_next_action text,
  next_action_date date,
  main_contact_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_company_name_not_blank check (length(trim(company_name)) > 0),
  constraint companies_client_pipeline_status_check check (
    client_pipeline_status in (
      'Potential Client',
      'Follow Up Needed',
      'Meeting Scheduled',
      'Onboarding Scheduled',
      'Training Scheduled',
      'Onboarded',
      'Rejected',
      'Remove From Pipeline',
      'No Action'
    )
  ),
  constraint companies_visit_status_check check (
    visit_status is null
    or visit_status in ('Visited', 'Closed Wrong Location', 'Moved', 'Not Headquarter', 'Office Is Empty')
  ),
  constraint companies_interest_level_check check (
    interest_level is null
    or interest_level in ('Interested', 'Neutral', 'Unclear', 'Not Interested')
  )
);

create table if not exists company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_name text not null,
  role_title text,
  phone text,
  whatsapp text,
  email text,
  decision_maker_status text,
  is_main_contact boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_contacts_contact_name_not_blank check (length(trim(contact_name)) > 0),
  constraint company_contacts_decision_maker_status_check check (
    decision_maker_status is null
    or decision_maker_status in ('Decision Maker', 'Not Decision Maker', 'Influencer', 'Unknown')
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_main_contact_id_fkey'
  ) then
    alter table companies
      add constraint companies_main_contact_id_fkey
      foreign key (main_contact_id)
      references company_contacts(id)
      on delete set null;
  end if;
end
$$;

create table if not exists field_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references company_contacts(id) on delete set null,
  visit_date date not null default current_date,
  decision_maker_status text,
  visit_status text,
  interest_level text,
  blocker text,
  info_sent boolean,
  next_step text,
  next_action_date date,
  visit_note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint field_visits_visit_status_check check (
    visit_status is null
    or visit_status in ('Visited', 'Closed Wrong Location', 'Moved', 'Not Headquarter', 'Office Is Empty')
  ),
  constraint field_visits_interest_level_check check (
    interest_level is null
    or interest_level in ('Interested', 'Neutral', 'Unclear', 'Not Interested')
  ),
  constraint field_visits_decision_maker_status_check check (
    decision_maker_status is null
    or decision_maker_status in ('Decision Maker', 'Not Decision Maker', 'Influencer', 'Unknown')
  ),
  constraint field_visits_next_step_check check (
    next_step is null
    or next_step in (
      'Call',
      'Send More Info',
      'Schedule Meeting',
      'Schedule Onboarding',
      'Wait for Client Reply',
      'Follow Up Later',
      'No Further Action'
    )
  )
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  priority text,
  due_date date,
  due_time time,
  notes text,
  status text not null default 'Open',
  owner text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_not_blank check (length(trim(title)) > 0),
  constraint tasks_category_check check (
    category in ('Work Task', 'Team Task', 'Personal Task', 'Errand', 'Reminder')
  ),
  constraint tasks_status_check check (status in ('Open', 'Done', 'Rescheduled', 'Cancelled'))
);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  contact_id uuid references company_contacts(id) on delete set null,
  task_id uuid references tasks(id) on delete cascade,
  reminder_type text not null,
  action text not null,
  due_date date not null,
  due_time time,
  status text not null default 'Open',
  completed_at timestamptz,
  rescheduled_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_action_not_blank check (length(trim(action)) > 0),
  constraint reminders_status_check check (status in ('Open', 'Completed', 'Rescheduled', 'Cancelled'))
);

-- When rescheduling an active reminder, keep status = 'Open', update due_date/due_time, and set rescheduled_at = now(). Do not create follow-up history.
create table if not exists follow_ups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  contact_id uuid references company_contacts(id) on delete set null,
  reminder_id uuid references reminders(id) on delete set null,
  follow_up_date date not null default current_date,
  follow_up_status text not null default 'Completed',
  follow_up_result text,
  next_step text,
  next_action_date date,
  current_pipeline_status text,
  follow_up_note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint follow_ups_follow_up_status_check check (follow_up_status = 'Completed'),
  constraint follow_ups_follow_up_result_check check (
    follow_up_result is null
    or follow_up_result in (
      'Positive',
      'Neutral',
      'No Answer',
      'Need to Call Again',
      'Need to Schedule a Meeting',
      'Schedule a Meeting',
      'Meeting Scheduled',
      'Rejected'
    )
  ),
  constraint follow_ups_next_step_check check (
    next_step is null
    or next_step in (
      'Call',
      'Send More Info',
      'Schedule Meeting',
      'Schedule Onboarding',
      'Wait for Client Reply',
      'Follow Up Later',
      'No Further Action'
    )
  )
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  contact_id uuid references company_contacts(id) on delete set null,
  entity_type text not null default 'general',
  entity_id uuid,
  note_scope text not null default 'General',
  note_type text not null default 'Human',
  content text not null,
  sync_scope text not null default 'None',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_content_not_blank check (length(trim(content)) > 0),
  constraint notes_entity_type_check check (
    entity_type in ('company', 'contact', 'field_visit', 'follow_up', 'task', 'general', 'personal')
  ),
  constraint notes_note_scope_check check (
    note_scope in ('Company', 'General', 'Personal', 'System', 'Audit')
  ),
  constraint notes_note_type_check check (note_type in ('Human', 'System', 'Audit')),
  constraint notes_sync_scope_check check (sync_scope in ('None', 'CRM Reporting', 'Internal', 'Personal'))
);

create table if not exists report_sync_queue (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  change_type text not null,
  status text not null default 'Pending',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz,
  constraint report_sync_queue_status_check check (status in ('Pending', 'Synced', 'Failed')),
  constraint report_sync_queue_attempts_check check (attempts >= 0)
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  contact_id uuid references company_contacts(id) on delete set null,
  entity_type text,
  entity_id uuid,
  activity_type text not null,
  summary text not null,
  details jsonb,
  source text not null default 'telegram',
  source_room text,
  created_by text,
  created_at timestamptz not null default now()
);

comment on table activity_logs is 'Activity logs are debug/audit only and must not be used as founder-facing reporting rows.';

drop trigger if exists set_updated_at_companies on companies;
create trigger set_updated_at_companies
before update on companies
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_company_contacts on company_contacts;
create trigger set_updated_at_company_contacts
before update on company_contacts
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_field_visits on field_visits;
create trigger set_updated_at_field_visits
before update on field_visits
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_tasks on tasks;
create trigger set_updated_at_tasks
before update on tasks
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_reminders on reminders;
create trigger set_updated_at_reminders
before update on reminders
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_follow_ups on follow_ups;
create trigger set_updated_at_follow_ups
before update on follow_ups
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_notes on notes;
create trigger set_updated_at_notes
before update on notes
for each row execute function set_updated_at_timestamp();

drop trigger if exists set_updated_at_report_sync_queue on report_sync_queue;
create trigger set_updated_at_report_sync_queue
before update on report_sync_queue
for each row execute function set_updated_at_timestamp();

create index if not exists idx_companies_company_code on companies(company_code);
create index if not exists idx_companies_company_name on companies(company_name);
create index if not exists idx_companies_client_pipeline_status on companies(client_pipeline_status);
create index if not exists idx_companies_visit_status on companies(visit_status);
create index if not exists idx_companies_next_action_date on companies(next_action_date);
create index if not exists idx_companies_main_contact_id on companies(main_contact_id);

create index if not exists idx_company_contacts_company_id on company_contacts(company_id);
create index if not exists idx_company_contacts_contact_name on company_contacts(contact_name);
create index if not exists idx_company_contacts_phone on company_contacts(phone);
create index if not exists idx_company_contacts_email on company_contacts(email);
create index if not exists idx_company_contacts_is_main_contact on company_contacts(company_id, is_main_contact);

create index if not exists idx_field_visits_company_visit_date on field_visits(company_id, visit_date);
create index if not exists idx_field_visits_contact_id on field_visits(contact_id);
create index if not exists idx_field_visits_next_action_date on field_visits(next_action_date);

create index if not exists idx_tasks_status_due_date on tasks(status, due_date);
create index if not exists idx_tasks_category on tasks(category);
create index if not exists idx_tasks_owner on tasks(owner);

create index if not exists idx_reminders_status_due_date on reminders(status, due_date);
create index if not exists idx_reminders_company_id on reminders(company_id);
create index if not exists idx_reminders_contact_id on reminders(contact_id);
create index if not exists idx_reminders_task_id on reminders(task_id);

create index if not exists idx_follow_ups_company_follow_up_date on follow_ups(company_id, follow_up_date);
create index if not exists idx_follow_ups_contact_id on follow_ups(contact_id);
create index if not exists idx_follow_ups_reminder_id on follow_ups(reminder_id);
create index if not exists idx_follow_ups_next_action_date on follow_ups(next_action_date);
create index if not exists idx_follow_ups_current_pipeline_status on follow_ups(current_pipeline_status);

create index if not exists idx_notes_company_id on notes(company_id);
create index if not exists idx_notes_contact_id on notes(contact_id);
create index if not exists idx_notes_entity on notes(entity_type, entity_id);
create index if not exists idx_notes_sync_scope on notes(sync_scope);

create index if not exists idx_report_sync_queue_status on report_sync_queue(status, created_at);
create index if not exists idx_report_sync_queue_entity on report_sync_queue(entity_type, entity_id);

create index if not exists idx_activity_logs_created_at on activity_logs(created_at);
create index if not exists idx_activity_logs_entity on activity_logs(entity_type, entity_id);

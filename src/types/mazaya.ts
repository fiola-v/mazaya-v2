export type CommandCenterAction =
  | 'field_visit'
  | 'follow_ups'
  | 'reminders'
  | 'tasks'
  | 'quick_note'
  | 'start_my_day'
  | 'end_of_day_review'
  | 'pipeline'
  | 'report_room'
  | 'draft_message_later';

export type SessionScope = 'command_center';

export interface MazayaSession {
  scope: SessionScope;
  createdAt: string;
  updatedAt: string;
}

export interface CommandCenterButton {
  label: string;
  action: CommandCenterAction;
}

export type CompanyPipelineStatus =
  | 'Potential Client'
  | 'Follow Up Needed'
  | 'Meeting Scheduled'
  | 'Onboarding Scheduled'
  | 'Training Scheduled'
  | 'Onboarded'
  | 'Rejected'
  | 'Remove From Pipeline'
  | 'No Action';

export type VisitStatus = 'Visited' | 'Closed Wrong Location' | 'Moved' | 'Not Headquarter' | 'Office Is Empty';
export type InterestLevel = 'Interested' | 'Neutral' | 'Unclear' | 'Not Interested';
export type DecisionMakerStatus = 'Decision Maker' | 'Not Decision Maker' | 'Influencer' | 'Unknown';
export type FollowUpResult =
  | 'Positive'
  | 'Neutral'
  | 'No Answer'
  | 'Need to Call Again'
  | 'Need to Schedule a Meeting'
  | 'Schedule a Meeting'
  | 'Meeting Scheduled'
  | 'Rejected';
export type NextStep =
  | 'Call'
  | 'Send More Info'
  | 'Schedule Meeting'
  | 'Schedule Onboarding'
  | 'Wait for Client Reply'
  | 'Follow Up Later'
  | 'No Further Action';
export type ReminderStatus = 'Open' | 'Completed' | 'Rescheduled' | 'Cancelled';
export type TaskCategory = 'Work Task' | 'Team Task' | 'Personal Task' | 'Errand' | 'Reminder';
export type TaskStatus = 'Open' | 'Done' | 'Rescheduled' | 'Cancelled';
export type ReportSyncStatus = 'Pending' | 'Synced' | 'Failed';

export interface CompanyRow {
  id: string;
  company_code: string | null;
  company_name: string;
  industry: string | null;
  website: string | null;
  address: string | null;
  visit_status: VisitStatus | null;
  interest_level: InterestLevel | null;
  client_pipeline_status: CompanyPipelineStatus;
  current_blocker: string | null;
  latest_human_note: string | null;
  current_next_action: string | null;
  next_action_date: string | null;
  main_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyContactRow {
  id: string;
  company_id: string;
  contact_name: string;
  role_title: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  decision_maker_status: DecisionMakerStatus | null;
  is_main_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldVisitRow {
  id: string;
  company_id: string;
  contact_id: string | null;
  visit_date: string;
  decision_maker_status: DecisionMakerStatus | null;
  visit_status: VisitStatus | null;
  interest_level: InterestLevel | null;
  blocker: string | null;
  info_sent: boolean | null;
  next_step: NextStep | null;
  next_action_date: string | null;
  visit_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderRow {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  task_id: string | null;
  reminder_type: string;
  action: string;
  due_date: string;
  due_time: string | null;
  status: ReminderStatus;
  completed_at: string | null;
  rescheduled_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowUpRow {
  id: string;
  company_id: string;
  contact_id: string | null;
  reminder_id: string | null;
  follow_up_date: string;
  follow_up_status: string;
  follow_up_result: FollowUpResult | null;
  next_step: NextStep | null;
  next_action_date: string | null;
  current_pipeline_status: CompanyPipelineStatus | string | null;
  follow_up_note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  entity_type: string;
  entity_id: string | null;
  note_scope: string;
  note_type: string;
  content: string;
  sync_scope: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportSyncQueueRow {
  id: string;
  entity_type: string;
  entity_id: string;
  change_type: string;
  status: ReportSyncStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export interface ActivityLogRow {
  id: string;
  company_id: string | null;
  contact_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  activity_type: string;
  summary: string;
  details: unknown | null;
  source: string;
  source_room: string | null;
  created_by: string | null;
  created_at: string;
}

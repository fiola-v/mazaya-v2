import { supabase } from '../../db/supabase';
import { ReminderRow, ReminderStatus } from '../../types/mazaya';

export interface ReminderCreateInput {
  company_id?: string | null;
  contact_id?: string | null;
  task_id?: string | null;
  reminder_type: string;
  action: string;
  due_date: string;
  due_time?: string | null;
  created_by?: string | null;
}

export interface ReminderRescheduleInput {
  due_date: string;
  due_time?: string | null;
}

export interface ReminderPendingActionInput {
  company_id: string;
  contact_id?: string | null;
  reminder_type: string;
  action: string;
  due_date: string;
  due_time?: string | null;
  created_by?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

export async function createReminder(input: ReminderCreateInput): Promise<ReminderRow> {
  const payload = {
    status: 'Open' as ReminderStatus,
    ...input,
  };

  const { data, error } = await supabase.from('reminders').insert(payload).select('*').single();

  if (error) {
    throwSupabaseError('createReminder', error);
  }

  return data as ReminderRow;
}

export async function listOpenReminders(): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'Open')
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true, nullsFirst: false });

  if (error) {
    throwSupabaseError('listOpenReminders', error);
  }

  return (data ?? []) as ReminderRow[];
}

export async function listRemindersByCompany(companyId: string): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('company_id', companyId)
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listRemindersByCompany', error);
  }

  return (data ?? []) as ReminderRow[];
}

export async function createOrUpdateCompanyReminder(input: ReminderPendingActionInput): Promise<ReminderRow> {
  const reminders = await listRemindersByCompany(input.company_id);
  const openReminder = reminders.find((reminder) => reminder.status === 'Open') ?? null;

  if (!openReminder) {
    return createReminder(input);
  }

  const { data, error } = await supabase
    .from('reminders')
    .update({
      contact_id: input.contact_id ?? openReminder.contact_id,
      reminder_type: input.reminder_type,
      action: input.action,
      due_date: input.due_date,
      due_time: input.due_time ?? null,
      status: 'Open',
      rescheduled_at: new Date().toISOString(),
    })
    .eq('id', openReminder.id)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('createOrUpdateCompanyReminder', error);
  }

  return data as ReminderRow;
}

export async function rescheduleReminder(reminderId: string, input: ReminderRescheduleInput): Promise<ReminderRow> {
  const { data, error } = await supabase
    .from('reminders')
    .update({
      due_date: input.due_date,
      due_time: input.due_time ?? null,
      status: 'Open',
      rescheduled_at: new Date().toISOString(),
    })
    .eq('id', reminderId)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('rescheduleReminder', error);
  }

  return data as ReminderRow;
}

export async function completeReminder(reminderId: string): Promise<ReminderRow> {
  const { data, error } = await supabase
    .from('reminders')
    .update({
      status: 'Completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', reminderId)
    .select('*')
    .single();

  if (error) {
    throwSupabaseError('completeReminder', error);
  }

  return data as ReminderRow;
}

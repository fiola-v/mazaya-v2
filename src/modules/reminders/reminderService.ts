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
  exclude_reminder_id?: string | null;
}

export interface ReminderDuplicateMatchInput {
  company_id: string;
  action: string;
  due_date: string;
  due_time?: string | null;
}

function throwSupabaseError(operation: string, error: { message: string; details?: string | null; hint?: string | null }) {
  throw new Error(`${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`);
}

function normalizeReminderAction(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeReminderTime(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function isActiveReminderStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'open' || normalized === 'pending';
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

export async function listOpenRemindersDueOnOrBefore(dueDate: string): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'Open')
    .lte('due_date', dueDate)
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true, nullsFirst: false });

  if (error) {
    throwSupabaseError('listOpenRemindersDueOnOrBefore', error);
  }

  return (data ?? []) as ReminderRow[];
}

export async function listOpenRemindersDueBetween(startDate: string, endDate: string): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('status', 'Open')
    .gte('due_date', startDate)
    .lte('due_date', endDate)
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true, nullsFirst: false });

  if (error) {
    throwSupabaseError('listOpenRemindersDueBetween', error);
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

export async function getReminderById(reminderId: string): Promise<ReminderRow | null> {
  const { data, error } = await supabase.from('reminders').select('*').eq('id', reminderId).maybeSingle();

  if (error) {
    throwSupabaseError('getReminderById', error);
  }

  return (data as ReminderRow | null) ?? null;
}

export async function findMatchingActiveCompanyReminder(input: ReminderDuplicateMatchInput): Promise<ReminderRow | null> {
  const reminders = await listRemindersByCompany(input.company_id);
  const normalizedAction = normalizeReminderAction(input.action);
  const normalizedDueTime = normalizeReminderTime(input.due_time);

  return (
    reminders.find((reminder) => {
      if (!isActiveReminderStatus(reminder.status)) {
        return false;
      }

      if (normalizeReminderAction(reminder.action) !== normalizedAction) {
        return false;
      }

      if (reminder.due_date !== input.due_date) {
        return false;
      }

      const reminderDueTime = normalizeReminderTime(reminder.due_time);
      if (normalizedDueTime && reminderDueTime && reminderDueTime !== normalizedDueTime) {
        return false;
      }

      if (normalizedDueTime && !reminderDueTime) {
        return false;
      }

      return true;
    }) ?? null
  );
}

export async function createOrUpdateCompanyReminder(input: ReminderPendingActionInput): Promise<ReminderRow> {
  const { exclude_reminder_id: _excludeReminderId, ...reminderInput } = input;
  const reminders = await listRemindersByCompany(input.company_id);
  const openReminder =
    reminders.find((reminder) => reminder.status === 'Open' && reminder.id !== _excludeReminderId) ?? null;

  if (!openReminder) {
    return createReminder(reminderInput);
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

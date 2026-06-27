import { supabase } from '../../db/supabase';
import {
  CompanyRow,
  FieldVisitRow,
  FollowUpRow,
  ReminderRow,
} from '../../types/mazaya';

const BUSINESS_TIME_ZONE = 'Asia/Dubai';
const BUSINESS_TIME_ZONE_OFFSET_MINUTES = 240;

export interface TodayVisitItem {
  visit: FieldVisitRow;
  company: CompanyRow;
  isRevisit: boolean;
}

export interface ReminderItem {
  reminder: ReminderRow;
  company: CompanyRow;
}

export interface FollowUpItem {
  followUp: FollowUpRow;
  company: CompanyRow;
}

export interface PriorityCompanyItem {
  company: CompanyRow;
  reasons: string[];
  dueDate: string | null;
  score: number;
}

export interface ReportsSnapshot {
  businessDate: string;
  tomorrowDate: string;
  todayVisits: TodayVisitItem[];
  newCompanyVisits: TodayVisitItem[];
  revisits: TodayVisitItem[];
  followUpsLoggedToday: FollowUpItem[];
  remindersCreatedToday: ReminderRow[];
  openRemindersDueToday: ReminderItem[];
  overdueReminders: ReminderItem[];
  tomorrowFollowUps: FollowUpItem[];
  priorityCompanies: PriorityCompanyItem[];
}

function throwSupabaseError(
  operation: string,
  error: {
    message: string;
    details?: string | null;
    hint?: string | null;
  }
): never {
  throw new Error(
    `${operation} failed: ${error.message}${error.details ? ` | ${error.details}` : ''}${error.hint ? ` | ${error.hint}` : ''}`
  );
}

function getBusinessDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value ?? '0', 10);
  const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value ?? '0', 10);
  const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value ?? '0', 10);

  return { year, month, day };
}

function getBusinessDateOnly(date: Date): string {
  const { year, month, day } = getBusinessDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getBusinessDateRange(date: Date): { startIso: string; endIso: string } {
  const { year, month, day } = getBusinessDateParts(date);
  const startUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - BUSINESS_TIME_ZONE_OFFSET_MINUTES * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
}

function formatUtcRangeForBusinessDate(date: Date): { startIso: string; endIso: string; businessDate: string } {
  const range = getBusinessDateRange(date);
  return {
    ...range,
    businessDate: getBusinessDateOnly(date),
  };
}

async function listFieldVisitsByDate(visitDate: string): Promise<FieldVisitRow[]> {
  const { data, error } = await supabase
    .from('field_visits')
    .select('*')
    .eq('visit_date', visitDate)
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listFieldVisitsByDate', error);
  }

  return (data ?? []) as FieldVisitRow[];
}

async function listFieldVisitsBeforeDate(companyIds: string[], visitDate: string): Promise<FieldVisitRow[]> {
  if (companyIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from('field_visits')
    .select('id, company_id, visit_date, created_at')
    .in('company_id', companyIds)
    .lt('visit_date', visitDate)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listFieldVisitsBeforeDate', error);
  }

  return (data ?? []) as FieldVisitRow[];
}

async function listFollowUpsByDate(followUpDate: string): Promise<FollowUpRow[]> {
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('follow_up_date', followUpDate)
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listFollowUpsByDate', error);
  }

  return (data ?? []) as FollowUpRow[];
}

async function listFollowUpsWithNextActionDate(nextActionDate: string): Promise<FollowUpRow[]> {
  const { data, error } = await supabase
    .from('follow_ups')
    .select('*')
    .eq('next_action_date', nextActionDate)
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listFollowUpsWithNextActionDate', error);
  }

  return (data ?? []) as FollowUpRow[];
}

async function listRemindersCreatedBetween(startIso: string, endIso: string): Promise<ReminderRow[]> {
  const { data, error } = await supabase
    .from('reminders')
    .select('*')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false });

  if (error) {
    throwSupabaseError('listRemindersCreatedBetween', error);
  }

  return (data ?? []) as ReminderRow[];
}

async function listOpenRemindersDueOnOrBefore(dueDate: string): Promise<ReminderRow[]> {
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

async function listCompaniesByIds(companyIds: string[]): Promise<Map<string, CompanyRow>> {
  if (companyIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase.from('companies').select('*').in('id', companyIds);

  if (error) {
    throwSupabaseError('listCompaniesByIds', error);
  }

  const entries = (data ?? []).map((company) => [company.id, company as CompanyRow] as const);
  return new Map(entries);
}

async function listInterestedCompaniesWithNextAction(): Promise<CompanyRow[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('interest_level', 'Interested')
    .not('current_next_action', 'is', null)
    .not('next_action_date', 'is', null)
    .order('next_action_date', { ascending: true });

  if (error) {
    throwSupabaseError('listInterestedCompaniesWithNextAction', error);
  }

  return (data ?? []) as CompanyRow[];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasPriorityKeywords(company: CompanyRow): boolean {
  const text = [company.current_blocker, company.latest_human_note, company.current_next_action]
    .map(normalizeText)
    .join(' ');

  return (
    text.includes('decision maker') ||
    text.includes('finance') ||
    text.includes('onboarding')
  );
}

function addPriorityReason(
  priorities: Map<string, PriorityCompanyItem>,
  company: CompanyRow,
  reason: string,
  score: number,
  dueDate: string | null
): void {
  const existing = priorities.get(company.id);
  if (!existing) {
    priorities.set(company.id, {
      company,
      reasons: [reason],
      dueDate,
      score,
    });
    return;
  }

  if (!existing.reasons.includes(reason)) {
    existing.reasons.push(reason);
  }

  existing.score = Math.max(existing.score, score);

  if (dueDate && (!existing.dueDate || dueDate < existing.dueDate)) {
    existing.dueDate = dueDate;
  }
}

function buildPriorityCompanies(
  companiesById: Map<string, CompanyRow>,
  openReminders: ReminderItem[],
  interestedCompanies: CompanyRow[]
): PriorityCompanyItem[] {
  const priorities = new Map<string, PriorityCompanyItem>();

  for (const item of openReminders) {
    const company = item.company;
    addPriorityReason(
      priorities,
      company,
      `Overdue reminder: ${item.reminder.action}`,
      100,
      item.reminder.due_date
    );
  }

  for (const company of interestedCompanies) {
    addPriorityReason(
      priorities,
      company,
      'Interested and next action set',
      80,
      company.next_action_date ?? null
    );
  }

  for (const company of companiesById.values()) {
    if (hasPriorityKeywords(company)) {
      addPriorityReason(
        priorities,
        company,
        'Needs decision-maker, finance, or onboarding follow-up',
        70,
        company.next_action_date ?? null
      );
    }
  }

  return [...priorities.values()].sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score;
    }

    const aDueDate = a.dueDate ?? '9999-12-31';
    const bDueDate = b.dueDate ?? '9999-12-31';
    if (aDueDate !== bDueDate) {
      return aDueDate.localeCompare(bDueDate);
    }

    return a.company.company_name.localeCompare(b.company.company_name);
  });
}

function buildReminderItemMap(reminders: ReminderRow[], companiesById: Map<string, CompanyRow>): ReminderItem[] {
  return reminders.flatMap((reminder) => {
    if (!reminder.company_id) {
      return [];
    }

    const company = companiesById.get(reminder.company_id);
    if (!company) {
      return [];
    }

    return [{ reminder, company }];
  });
}

function buildFollowUpItemMap(followUps: FollowUpRow[], companiesById: Map<string, CompanyRow>): FollowUpItem[] {
  return followUps.flatMap((followUp) => {
    const company = companiesById.get(followUp.company_id);
    if (!company) {
      return [];
    }

    return [{ followUp, company }];
  });
}

export async function buildReportsSnapshot(now = new Date()): Promise<ReportsSnapshot> {
  const { businessDate, startIso, endIso } = formatUtcRangeForBusinessDate(now);
  const tomorrowDate = getBusinessDateOnly(new Date(now.getTime() + 24 * 60 * 60 * 1000));

  const [todayVisits, followUpsToday, followUpsTomorrow, remindersCreatedToday, openRemindersDueOnOrBeforeToday, interestedCompanies] =
    await Promise.all([
      listFieldVisitsByDate(businessDate),
      listFollowUpsByDate(businessDate),
      listFollowUpsWithNextActionDate(tomorrowDate),
      listRemindersCreatedBetween(startIso, endIso),
      listOpenRemindersDueOnOrBefore(businessDate),
      listInterestedCompaniesWithNextAction(),
    ]);

  const todayCompanyIds = [...new Set(todayVisits.map((visit) => visit.company_id))];
  const companyIds = new Set<string>([
    ...todayCompanyIds,
    ...followUpsToday.map((followUp) => followUp.company_id),
    ...followUpsTomorrow.map((followUp) => followUp.company_id),
    ...openRemindersDueOnOrBeforeToday.filter((reminder) => Boolean(reminder.company_id)).map((reminder) => reminder.company_id as string),
    ...interestedCompanies.map((company) => company.id),
  ]);

  const companiesById = await listCompaniesByIds([...companyIds]);
  const visitsBeforeToday = await listFieldVisitsBeforeDate(todayCompanyIds, businessDate);
  const visitedBeforeTodayCompanyIds = new Set(visitsBeforeToday.map((visit) => visit.company_id));

  const todayVisitItems = todayVisits
    .map((visit) => ({
      visit,
      company: companiesById.get(visit.company_id),
      isRevisit: visitedBeforeTodayCompanyIds.has(visit.company_id),
    }))
    .filter((item): item is TodayVisitItem => Boolean(item.company));

  const reminderItems = buildReminderItemMap(openRemindersDueOnOrBeforeToday, companiesById);
  const overdueReminders = reminderItems.filter((item) => item.reminder.due_date < businessDate);
  const openRemindersDueToday = reminderItems.filter((item) => item.reminder.due_date === businessDate);
  const followUpTodayItems = buildFollowUpItemMap(followUpsToday, companiesById);
  const followUpTomorrowItems = buildFollowUpItemMap(followUpsTomorrow, companiesById);

  return {
    businessDate,
    tomorrowDate,
    todayVisits: todayVisitItems,
    newCompanyVisits: todayVisitItems.filter((item) => !item.isRevisit),
    revisits: todayVisitItems.filter((item) => item.isRevisit),
    followUpsLoggedToday: followUpTodayItems,
    remindersCreatedToday: remindersCreatedToday,
    openRemindersDueToday,
    overdueReminders,
    tomorrowFollowUps: followUpTomorrowItems,
    priorityCompanies: buildPriorityCompanies(companiesById, overdueReminders, interestedCompanies),
  };
}

import { Context, Telegraf } from 'telegraf';
import { getSessionKey } from '../../bot/session';
import { CompanyContactRow, CompanyRow, FieldVisitRow, ReminderRow } from '../../types/mazaya';
import { getMainContactForCompany } from '../contacts/contactService';
import { listFieldVisitsByCompany } from '../fieldVisits/fieldVisitService';
import { listRemindersByCompany } from '../reminders/reminderService';
import { findCompaniesByName, getCompanyByCode, getCompanyById } from './companyService';

interface CompanyLookupState {
  companyIds: string[];
}

const MAX_CHOICE_RESULTS = 10;
const lookupSessions = new Map<string, CompanyLookupState>();

function getLookupKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

function valueOrFallback(value: string | null | undefined): string {
  return value || 'Not captured';
}

function pickReminder(reminders: ReminderRow[]): ReminderRow | null {
  return reminders.find((reminder) => reminder.status === 'Open') ?? reminders[0] ?? null;
}

function formatReminderStatus(reminder: ReminderRow | null): string {
  if (!reminder) {
    return 'Not available';
  }

  return `${reminder.status} - ${reminder.action} on ${reminder.due_date}`;
}

function formatCompanyReportCard(
  company: CompanyRow,
  mainContact: CompanyContactRow | null,
  latestVisit: FieldVisitRow | null,
  reminder: ReminderRow | null
): string {
  return [
    'Company Report Card',
    '',
    `Company name: ${company.company_name}`,
    `Report Card ID: ${valueOrFallback(company.company_code)}`,
    `Industry: ${valueOrFallback(company.industry)}`,
    `Main contact: ${valueOrFallback(mainContact?.contact_name)}`,
    `Phone: ${valueOrFallback(mainContact?.phone)}`,
    `WhatsApp: ${valueOrFallback(mainContact?.whatsapp)}`,
    `Email: ${valueOrFallback(mainContact?.email)}`,
    `Latest visit status: ${valueOrFallback(latestVisit?.visit_status ?? company.visit_status)}`,
    `Decision maker status: ${valueOrFallback(latestVisit?.decision_maker_status ?? mainContact?.decision_maker_status)}`,
    `Interest level: ${valueOrFallback(latestVisit?.interest_level ?? company.interest_level)}`,
    `Next action: ${valueOrFallback(company.current_next_action ?? latestVisit?.next_step)}`,
    `Next action date: ${valueOrFallback(company.next_action_date ?? latestVisit?.next_action_date)}`,
    `Reminder status: ${formatReminderStatus(reminder)}`,
  ].join('\n');
}

async function showCompanyReportCard(ctx: Context, company: CompanyRow): Promise<void> {
  const [mainContact, fieldVisits, reminders] = await Promise.all([
    getMainContactForCompany(company.id),
    listFieldVisitsByCompany(company.id),
    listRemindersByCompany(company.id),
  ]);

  await ctx.reply(formatCompanyReportCard(company, mainContact, fieldVisits[0] ?? null, pickReminder(reminders)));
}

async function showCompanyChoices(ctx: Context, companies: CompanyRow[]): Promise<void> {
  const choices = companies.slice(0, MAX_CHOICE_RESULTS);
  lookupSessions.set(getLookupKey(ctx), {
    companyIds: choices.map((company) => company.id),
  });

  const extraCount = companies.length - choices.length;
  const lines = choices.map(
    (company, index) => `${index + 1}. ${company.company_name} - ${valueOrFallback(company.company_code)}`
  );

  await ctx.reply(
    [
      'Multiple companies found. Reply with the number to choose:',
      '',
      ...lines,
      extraCount > 0 ? '' : null,
      extraCount > 0 ? `${extraCount} more matches not shown. Search with more detail if needed.` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
  );
}

async function lookupCompanies(query: string): Promise<CompanyRow[]> {
  const exactCompany = await getCompanyByCode(query);
  if (exactCompany) {
    return [exactCompany];
  }

  return findCompaniesByName(query);
}

async function handleCompanyLookup(ctx: Context, query: string): Promise<void> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    await ctx.reply('Please include a Report Card ID or company name.\n\nExample: /company RC-26-0002');
    return;
  }

  const companies = await lookupCompanies(normalizedQuery);
  if (companies.length === 0) {
    await ctx.reply('No company found. Please check the Report Card ID or company name.');
    return;
  }

  if (companies.length === 1) {
    lookupSessions.delete(getLookupKey(ctx));
    await showCompanyReportCard(ctx, companies[0]);
    return;
  }

  await showCompanyChoices(ctx, companies);
}

export function registerCompanyLookupWorkflow(bot: Telegraf): void {
  bot.command('company', async (ctx) => {
    const query = ctx.message.text.replace(/^\/company(?:@\w+)?\s*/i, '');
    await handleCompanyLookup(ctx, query);
  });
}

export async function handleCompanyLookupText(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return false;
  }

  const state = lookupSessions.get(getLookupKey(ctx));
  if (!state) {
    return false;
  }

  const choice = Number.parseInt(message.text.trim(), 10);
  if (!Number.isInteger(choice) || choice < 1 || choice > state.companyIds.length) {
    await ctx.reply('Please reply with one of the listed numbers.');
    return true;
  }

  lookupSessions.delete(getLookupKey(ctx));
  const company = await getCompanyById(state.companyIds[choice - 1]);
  if (!company) {
    await ctx.reply('That company is no longer available. Please search again.');
    return true;
  }

  await showCompanyReportCard(ctx, company);
  return true;
}

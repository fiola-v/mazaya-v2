import { Context, Markup, Telegraf } from 'telegraf';
import { showCommandCenter } from '../../bot/commandCenter';
import { getSessionKey } from '../../bot/session';
import { CompanyContactRow, CompanyRow, FieldVisitRow, FollowUpRow, ReminderRow } from '../../types/mazaya';
import { getMainContactForCompany } from '../contacts/contactService';
import { listFieldVisitsByCompany } from '../fieldVisits/fieldVisitService';
import { listLatestFollowUpsByCompany } from '../followUps/followUpService';
import { listRemindersByCompany } from '../reminders/reminderService';
import {
  findCompaniesByName,
  getCompanyByCode,
  getCompanyById,
  listCompaniesPage,
  listRecentCompanies,
} from './companyService';

type CompanyLookupMode = 'lookup_choices' | 'search_prompt' | 'search_choices' | 'recent' | 'all';

interface CompanyLookupState {
  mode: CompanyLookupMode;
  companyIds: string[];
  allOffset?: number;
}

const MAX_CHOICE_RESULTS = 10;
const lookupSessions = new Map<string, CompanyLookupState>();

function getLookupKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

export function clearCompanyLookupState(ctx: Context): void {
  lookupSessions.delete(getLookupKey(ctx));
}

function valueOrFallback(value: string | null | undefined): string {
  return value || 'Not captured';
}

const BUSINESS_TIME_ZONE = 'Asia/Dubai';

function getBusinessDateOnly(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function reminderDisplayStatus(reminder: ReminderRow): string {
  const today = getBusinessDateOnly(new Date());
  return reminder.due_date < today ? 'Overdue' : 'Open';
}

function sortOpenReminders(reminders: ReminderRow[]): ReminderRow[] {
  const today = getBusinessDateOnly(new Date());
  return [...reminders].sort((a, b) => {
    const aOverdueRank = a.due_date < today ? 0 : 1;
    const bOverdueRank = b.due_date < today ? 0 : 1;
    if (aOverdueRank !== bOverdueRank) {
      return aOverdueRank - bOverdueRank;
    }

    if (a.due_date !== b.due_date) {
      return a.due_date.localeCompare(b.due_date);
    }

    const aCreatedAt = a.created_at ?? '';
    const bCreatedAt = b.created_at ?? '';
    return aCreatedAt.localeCompare(bCreatedAt);
  });
}

function pickOpenReminders(reminders: ReminderRow[]): ReminderRow[] {
  return sortOpenReminders(reminders.filter((reminder) => reminder.status === 'Open'));
}

function formatOpenReminders(reminders: ReminderRow[]): string[] {
  if (reminders.length === 0) {
    return ['Open reminders', 'Not available'];
  }

  return [
    'Open reminders',
    '',
    ...reminders.flatMap((reminder, index) => [
      `${index + 1}. ${reminder.action}`,
      `   Due date: ${reminder.due_time ? `${reminder.due_date} ${reminder.due_time}` : reminder.due_date}`,
      `   Status: ${reminderDisplayStatus(reminder)}`,
      '',
    ]),
  ];
}

function formatLatestFollowUps(followUps: FollowUpRow[]): string[] {
  if (followUps.length === 0) {
    return ['Latest follow-ups', 'Not available'];
  }

  return [
    'Latest follow-ups',
    '',
    ...followUps.flatMap((followUp, index) => [
      `${index + 1}. ${followUp.follow_up_date} - ${valueOrFallback(followUp.follow_up_result)}`,
      `   Next step: ${valueOrFallback(followUp.next_step)}`,
      `   Note: ${valueOrFallback(followUp.follow_up_note)}`,
      '',
    ]),
  ];
}

function lastVisitedDate(latestVisit: FieldVisitRow | null): string {
  if (!latestVisit) {
    return 'Not captured';
  }

  if (latestVisit.visit_date) {
    return latestVisit.visit_date;
  }

  return latestVisit.created_at.slice(0, 10);
}

function formatCompanyReportCard(
  company: CompanyRow,
  mainContact: CompanyContactRow | null,
  latestVisit: FieldVisitRow | null,
  openReminders: ReminderRow[],
  followUps: FollowUpRow[]
): string {
  return [
    'Company Report Card',
    '',
    'Company',
    `Name: ${company.company_name}`,
    `Report Card ID: ${valueOrFallback(company.company_code)}`,
    `Industry: ${valueOrFallback(company.industry)}`,
    '',
    'Contact',
    `Main contact: ${valueOrFallback(mainContact?.contact_name)}`,
    `Role: ${valueOrFallback(mainContact?.role_title)}`,
    `Phone: ${valueOrFallback(mainContact?.phone)}`,
    `WhatsApp: ${valueOrFallback(mainContact?.whatsapp)}`,
    `Email: ${valueOrFallback(mainContact?.email)}`,
    '',
    'Status',
    `Latest visit status: ${valueOrFallback(latestVisit?.visit_status ?? company.visit_status)}`,
    `Last visited: ${lastVisitedDate(latestVisit)}`,
    `Interest level: ${valueOrFallback(latestVisit?.interest_level ?? company.interest_level)}`,
    '',
    'Next action',
    `Action: ${valueOrFallback(company.current_next_action ?? latestVisit?.next_step)}`,
    `Date: ${valueOrFallback(company.next_action_date ?? latestVisit?.next_action_date)}`,
    '',
    ...formatOpenReminders(openReminders),
    '',
    ...formatLatestFollowUps(followUps),
  ].join('\n');
}

async function showCompanyReportCard(ctx: Context, company: CompanyRow): Promise<void> {
  const [mainContact, fieldVisits, reminders, followUps] = await Promise.all([
    getMainContactForCompany(company.id),
    listFieldVisitsByCompany(company.id),
    listRemindersByCompany(company.id),
    listLatestFollowUpsByCompany(company.id, 3),
  ]);

  await ctx.reply(
    formatCompanyReportCard(company, mainContact, fieldVisits[0] ?? null, pickOpenReminders(reminders), followUps)
  );
}

async function showCompanyChoices(ctx: Context, companies: CompanyRow[], mode: CompanyLookupMode): Promise<void> {
  const choices = companies.slice(0, MAX_CHOICE_RESULTS);
  lookupSessions.set(getLookupKey(ctx), {
    mode,
    companyIds: choices.map((company) => company.id),
  });

  const extraCount = companies.length - choices.length;
  const lines = choices.map((company, index) => `${index + 1}. ${company.company_name} - ${valueOrFallback(company.company_code)}`);

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

  await showCompanyChoices(ctx, companies, 'lookup_choices');
}

async function showCompaniesRoom(ctx: Context): Promise<void> {
  await ctx.reply(
    'Companies Database\n\nWhat do you want to do?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Search Company', 'companies:search')],
      [Markup.button.callback('Recent Companies', 'companies:recent')],
      [Markup.button.callback('All Companies', 'companies:all:0')],
      [Markup.button.callback('Back to Command Center', 'companies:back_command')],
    ])
  );
}

function buildAllCompaniesKeyboard(offset: number, hasPrevious: boolean, hasNext: boolean) {
  const rows = [];
  const nav: Array<ReturnType<typeof Markup.button.callback>> = [];

  if (hasPrevious) {
    nav.push(Markup.button.callback('Previous Page', `companies:all:${Math.max(0, offset - MAX_CHOICE_RESULTS)}`));
  }

  if (hasNext) {
    nav.push(Markup.button.callback('Next Page', `companies:all:${offset + MAX_CHOICE_RESULTS}`));
  }

  if (nav.length > 0) {
    rows.push(nav);
  }

  rows.push([Markup.button.callback('Back to Companies', 'companies:back')]);
  return Markup.inlineKeyboard(rows);
}

async function showRecentCompanies(ctx: Context): Promise<void> {
  const companies = await listRecentCompanies(MAX_CHOICE_RESULTS);
  if (companies.length === 0) {
    lookupSessions.delete(getLookupKey(ctx));
    await ctx.reply('No companies found yet.');
    return;
  }

  const contacts = await Promise.all(companies.map((company) => getMainContactForCompany(company.id)));
  lookupSessions.set(getLookupKey(ctx), { mode: 'recent', companyIds: companies.map((company) => company.id) });

  const lines = companies.flatMap((company, index) => [
    `${index + 1}. ${company.company_name}`,
    `   Report Card ID: ${valueOrFallback(company.company_code)}`,
    `   Main contact: ${valueOrFallback(contacts[index]?.contact_name)}`,
    '',
  ]);

  await ctx.reply(['Recent Companies', '', ...lines].join('\n').trim());
}

async function showAllCompaniesPage(ctx: Context, offset: number): Promise<void> {
  const companies = await listCompaniesPage(offset, MAX_CHOICE_RESULTS + 1);
  const visible = companies.slice(0, MAX_CHOICE_RESULTS);
  const hasNext = companies.length > MAX_CHOICE_RESULTS;

  if (visible.length === 0 && offset > 0) {
    await showAllCompaniesPage(ctx, Math.max(0, offset - MAX_CHOICE_RESULTS));
    return;
  }

  if (visible.length === 0) {
    lookupSessions.delete(getLookupKey(ctx));
    await ctx.reply('No companies found yet.');
    return;
  }

  lookupSessions.set(getLookupKey(ctx), {
    mode: 'all',
    companyIds: visible.map((company) => company.id),
    allOffset: offset,
  });

  const lines = visible.flatMap((company, index) => [
    `${index + 1}. ${company.company_name}`,
    `   Report Card ID: ${valueOrFallback(company.company_code)}`,
    '',
  ]);

  await ctx.reply(
    ['All Companies', '', ...lines].join('\n').trim(),
    buildAllCompaniesKeyboard(offset, offset > 0, hasNext)
  );
}

export function registerCompanyLookupWorkflow(bot: Telegraf): void {
  bot.command('company', async (ctx) => {
    const query = ctx.message.text.replace(/^\/company(?:@\w+)?\s*/i, '');
    await handleCompanyLookup(ctx, query);
  });

  bot.command('companies', async (ctx) => {
    await showCompaniesRoom(ctx);
  });

  bot.action('cc:companies_database', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCompaniesRoom(ctx);
  });

  bot.action('companies:search', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    lookupSessions.set(getLookupKey(ctx), { mode: 'search_prompt', companyIds: [] });
    await ctx.reply('Type the company name or Report Card ID to search.');
  });

  bot.action('companies:recent', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showRecentCompanies(ctx);
  });

  bot.action(/^companies:all:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const offset = Number.parseInt((ctx.match as RegExpMatchArray | undefined)?.[1] ?? '0', 10);
    await showAllCompaniesPage(ctx, Number.isFinite(offset) ? offset : 0);
  });

  bot.action('companies:back', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCompaniesRoom(ctx);
  });

  bot.action('companies:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
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

  const text = message.text.trim();
  if (state.mode === 'search_prompt') {
    const companies = await lookupCompanies(text);
    if (companies.length === 0) {
      await ctx.reply('No company found. Please check the Report Card ID or company name.');
      return true;
    }

    if (companies.length === 1) {
      lookupSessions.delete(getLookupKey(ctx));
      await showCompanyReportCard(ctx, companies[0]);
      return true;
    }

    await showCompanyChoices(ctx, companies, 'search_choices');
    return true;
  }

  const choice = Number.parseInt(text, 10);
  if (!Number.isInteger(choice) || choice < 1 || choice > state.companyIds.length) {
    await ctx.reply('Please reply with one of the listed numbers.');
    return true;
  }

  const company = await getCompanyById(state.companyIds[choice - 1]);
  if (!company) {
    await ctx.reply('That company is no longer available. Please search again.');
    return true;
  }

  lookupSessions.delete(getLookupKey(ctx));
  await showCompanyReportCard(ctx, company);
  return true;
}

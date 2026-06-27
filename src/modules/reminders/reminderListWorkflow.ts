import { Context, Markup, Telegraf } from 'telegraf';
import { showCommandCenter } from '../../bot/commandCenter';
import { getSessionKey } from '../../bot/session';
import { CompanyContactRow, CompanyRow, ReminderRow } from '../../types/mazaya';
import { getCompanyByCode } from '../companies/companyService';
import { getCompanyById } from '../companies/companyService';
import { getCompanyContactById, getMainContactForCompany } from '../contacts/contactService';
import { startFollowUpLoggingForCompany } from '../followUps/followUpLoggingWorkflow';
import { getReminderById, listOpenRemindersDueBetween, listOpenRemindersDueOnOrBefore, listRemindersByCompany } from './reminderService';

type ReminderListRange = 'today' | 'week';

interface ReminderListItem {
  reminder: ReminderRow;
  company: CompanyRow;
  contact: CompanyContactRow | null;
}

interface ReminderListState {
  items: ReminderListItem[];
}

const latestLists = new Map<string, ReminderListState>();
const BUSINESS_TIME_ZONE = 'Asia/Dubai';

function getChatKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', 'reminder-list');
}

function getBusinessDateParts(date: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);

  const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value ?? '0', 10);
  const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value ?? '0', 10);
  const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value ?? '0', 10);
  const weekdayName = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayName] ?? 1;

  return { year, month, day, weekday };
}

function toBusinessDateOnly(date: Date): string {
  const { year, month, day } = getBusinessDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getCurrentWeekEndDate(today: Date): string {
  const { weekday } = getBusinessDateParts(today);
  const daysUntilSunday = 7 - weekday;
  const { year, month, day } = getBusinessDateParts(today);
  const next = new Date(Date.UTC(year, month - 1, day + daysUntilSunday, 12, 0, 0));
  return toBusinessDateOnly(next);
}

function valueOrFallback(value: string | null | undefined): string {
  return value || 'Not captured';
}

function formatDue(reminder: ReminderRow): string {
  return reminder.due_time ? `${reminder.due_date} ${reminder.due_time}` : reminder.due_date;
}

function reminderStatus(reminder: ReminderRow, today: string): string {
  return reminder.due_date < today ? 'Overdue' : 'Open';
}

function isActiveReminderStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'open' || normalized === 'pending';
}

function formatActiveReminderStatus(reminder: ReminderRow, today: string): string {
  if (reminder.due_date < today) {
    return 'Overdue';
  }

  const normalized = reminder.status.trim().toLowerCase();
  if (normalized === 'pending') {
    return 'Pending';
  }

  return 'Open';
}

function sortActiveReminders(reminders: ReminderRow[]): ReminderRow[] {
  const today = toBusinessDateOnly(new Date());
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

async function resolveReminderItem(reminder: ReminderRow): Promise<ReminderListItem | null> {
  if (!reminder.company_id) {
    return null;
  }

  const company = await getCompanyById(reminder.company_id);
  if (!company) {
    return null;
  }

  const contact = reminder.contact_id
    ? await getCompanyContactById(reminder.contact_id)
    : await getMainContactForCompany(company.id);

  return {
    reminder,
    company,
    contact,
  };
}

async function getReminderList(range: ReminderListRange): Promise<ReminderListItem[]> {
  const now = new Date();
  const today = toBusinessDateOnly(now);
  const reminders =
    range === 'today'
      ? await listOpenRemindersDueOnOrBefore(today)
      : await listOpenRemindersDueBetween(today, getCurrentWeekEndDate(now));

  const items = await Promise.all(reminders.map((reminder) => resolveReminderItem(reminder)));
  return items.filter((item): item is ReminderListItem => item !== null);
}

function formatReminderList(title: string, items: ReminderListItem[]): string {
  const today = toBusinessDateOnly(new Date());
  const lines = items.flatMap((item, index) => [
    `${index + 1}. ${item.company.company_name}`,
    `   Report Card ID: ${valueOrFallback(item.company.company_code)}`,
    `   Contact: ${valueOrFallback(item.contact?.contact_name)}`,
    `   Next step: ${item.reminder.action}`,
    `   Due: ${formatDue(item.reminder)}`,
    `   Status: ${reminderStatus(item.reminder, today)}`,
    '',
  ]);

  return [title, '', ...lines].join('\n').trim();
}

async function showReminderList(ctx: Context, range: ReminderListRange, title: string): Promise<void> {
  const items = await getReminderList(range);
  if (items.length === 0) {
    latestLists.delete(getChatKey(ctx));
    await ctx.reply(`No pending follow-ups for ${range === 'today' ? 'today' : 'this week'}.`);
    return;
  }

  latestLists.set(getChatKey(ctx), { items });
  await ctx.reply(formatReminderList(title, items));
}

function parseRange(commandText: string): ReminderListRange | null {
  const [, rawRange] = commandText.trim().split(/\s+/, 2);
  if (rawRange === 'today' || rawRange === 'week') {
    return rawRange;
  }

  return null;
}

function parseCommandArgument(commandText: string): string | null {
  const [, rawArgument] = commandText.trim().split(/\s+/, 2);
  return rawArgument?.trim() || null;
}

function parseReportCardId(argument: string): string | null {
  if (!/^RC-\d{2}-\d{4,}$/i.test(argument)) {
    return null;
  }

  return argument.toUpperCase();
}

function formatCompanyReminderList(company: CompanyRow, items: ReminderListItem[]): string {
  const today = toBusinessDateOnly(new Date());
  const lines = items.flatMap((item, index) => [
    `${index + 1}. ${item.reminder.action}`,
    `   Due date: ${formatDue(item.reminder)}`,
    `   Status: ${formatActiveReminderStatus(item.reminder, today)}`,
    '',
  ]);

  return [
    `Reminders for ${company.company_name}`,
    `Report Card ID: ${valueOrFallback(company.company_code)}`,
    '',
    ...lines,
  ]
    .join('\n')
    .trim();
}

async function showCompanyReminderList(ctx: Context, reportCardId: string): Promise<void> {
  const company = await getCompanyByCode(reportCardId);
  if (!company) {
    latestLists.delete(getChatKey(ctx));
    await ctx.reply('No company found for that Report Card ID. Please check it and try again.');
    return;
  }

  const reminders = await listRemindersByCompany(company.id);
  const activeReminders = sortActiveReminders(reminders.filter((reminder) => isActiveReminderStatus(reminder.status)));

  if (activeReminders.length === 0) {
    latestLists.delete(getChatKey(ctx));
    await ctx.reply(
      [
        `No open reminders found for ${company.company_name}.`,
        `Report Card ID: ${valueOrFallback(company.company_code)}`,
      ].join('\n')
    );
    return;
  }

  const itemsResolved = await Promise.all(activeReminders.map((reminder) => resolveReminderItem(reminder)));
  const items = itemsResolved.filter((item): item is ReminderListItem => item !== null);
  latestLists.set(getChatKey(ctx), { items });
  await ctx.reply(formatCompanyReminderList(company, items));
}

async function showReminderRoom(ctx: Context): Promise<void> {
  await ctx.reply(
    'Reminders & Follow-Ups\n\nWhat do you want to do?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Today', 'reminders_room:today')],
      [Markup.button.callback('This Week', 'reminders_room:week')],
      [Markup.button.callback('Log Follow-Up', 'reminders_room:log')],
      [Markup.button.callback('Done Reminder', 'reminders_room:done')],
      [Markup.button.callback('Back to Command Center', 'reminders_room:back_command')],
    ])
  );
}

function todayCategoryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('All', 'reminders_room:today:all')],
    [Markup.button.callback('Follow-Up Reminders', 'reminders_room:today:followups')],
    [Markup.button.callback('Back', 'reminders_room:back')],
  ]);
}

function weekCategoryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('All', 'reminders_room:week:all')],
    [Markup.button.callback('Follow-Up Reminders', 'reminders_room:week:followups')],
    [Markup.button.callback('Back', 'reminders_room:back')],
  ]);
}

export function registerReminderListWorkflow(bot: Telegraf): void {
  bot.command(['reminders', 'followups', 'reminder'], async (ctx) => {
    const commandText = ctx.message.text;
    const isReminderAlias = /^\/reminder(?:@\w+)?(?:\s|$)/i.test(commandText);
    const range = parseRange(commandText);
    if (!range) {
      const argument = parseCommandArgument(commandText);
      if (argument) {
        const reportCardId = parseReportCardId(argument);
        if (reportCardId && (isReminderAlias || /^\/reminders(?:@\w+)?(?:\s|$)/i.test(commandText))) {
          await showCompanyReminderList(ctx, reportCardId);
          return;
        }
      }

      await showReminderRoom(ctx);
      return;
    }

    const title = range === 'today' ? "Today's Follow-Ups" : 'This Week Follow-Ups';
    await showReminderList(ctx, range, title);
  });

  bot.action('cc:reminders', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReminderRoom(ctx);
  });

  bot.action('reminders_room:today', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply("Today's Follow-Ups\n\nChoose a category:", todayCategoryKeyboard());
  });

  bot.action('reminders_room:week', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('This Week Follow-Ups\n\nChoose a category:', weekCategoryKeyboard());
  });

  bot.action('reminders_room:today:all', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReminderList(ctx, 'today', "Today's Follow-Ups");
  });

  bot.action('reminders_room:today:followups', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReminderList(ctx, 'today', "Today's Follow-Ups");
  });

  bot.action('reminders_room:week:all', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReminderList(ctx, 'week', 'This Week Follow-Ups');
  });

  bot.action('reminders_room:week:followups', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReminderList(ctx, 'week', 'This Week Follow-Ups');
  });

  bot.action('reminders_room:log', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Type /log RC-26-0002 to log a follow-up.');
  });

  bot.action('reminders_room:done', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Open Today or This Week first, then use /done 1.');
  });

  bot.action('reminders_room:back', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReminderRoom(ctx);
  });

  bot.action('reminders_room:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
  });

  bot.command('done', async (ctx) => {
    const [, rawChoice] = ctx.message.text.trim().split(/\s+/, 2);
    const state = latestLists.get(getChatKey(ctx));
    if (!state) {
      await ctx.reply(
        'No reminder list is active. Run /reminders today, /reminders week, or /reminders RC-26-0002 first.'
      );
      return;
    }

    const choice = Number.parseInt(rawChoice ?? '', 10);
    if (!Number.isInteger(choice) || choice < 1 || choice > state.items.length) {
      await ctx.reply('Invalid reminder number. Please choose a number from the latest reminder list.');
      return;
    }

    const item = state.items[choice - 1];
    const latestReminder = await getReminderById(item.reminder.id);
    if (!latestReminder) {
      await ctx.reply('That reminder is no longer available. Refresh the list and try again.');
      return;
    }

    if (!isActiveReminderStatus(latestReminder.status)) {
      await ctx.reply('That reminder is already completed.');
      return;
    }

    latestLists.delete(getChatKey(ctx));
    await ctx.reply(
      [
        'Selected follow-up:',
        '',
        `Company: ${item.company.company_name}`,
        `Report Card ID: ${valueOrFallback(item.company.company_code)}`,
        `Next step: ${item.reminder.action}`,
        `Due: ${formatDue(item.reminder)}`,
      ].join('\n')
    );

    await startFollowUpLoggingForCompany(ctx, item.company, {
      completingReminderId: item.reminder.id,
    });
  });
}

import { Context, Telegraf } from 'telegraf';
import { getSessionKey } from '../../bot/session';
import { addDays, toDateOnly } from '../../utils/dates';
import { CompanyContactRow, CompanyRow, ReminderRow } from '../../types/mazaya';
import { getCompanyById } from '../companies/companyService';
import { getCompanyContactById, getMainContactForCompany } from '../contacts/contactService';
import { startFollowUpLoggingForCompany } from '../followUps/followUpLoggingWorkflow';
import { listOpenRemindersDueBetween, listOpenRemindersDueOnOrBefore } from './reminderService';

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

function getChatKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', 'reminder-list');
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

function getCurrentWeekEndDate(today: Date): string {
  const endOfWeek = new Date(today);
  const dayOfWeek = endOfWeek.getDay();
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  endOfWeek.setDate(endOfWeek.getDate() + daysUntilSunday);
  return toDateOnly(endOfWeek);
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
  const today = toDateOnly(now);
  const reminders =
    range === 'today'
      ? await listOpenRemindersDueOnOrBefore(today)
      : await listOpenRemindersDueBetween(toDateOnly(addDays(now, 1)), getCurrentWeekEndDate(now));

  const items = await Promise.all(reminders.map((reminder) => resolveReminderItem(reminder)));
  return items.filter((item): item is ReminderListItem => item !== null);
}

function formatReminderList(title: string, items: ReminderListItem[]): string {
  const today = toDateOnly(new Date());
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

export function registerReminderListWorkflow(bot: Telegraf): void {
  bot.command(['reminders', 'followups'], async (ctx) => {
    const range = parseRange(ctx.message.text);
    if (!range) {
      await ctx.reply('Usage:\n/reminders today\n/reminders week');
      return;
    }

    const title = range === 'today' ? "Today's Follow-Ups" : 'This Week Follow-Ups';
    await showReminderList(ctx, range, title);
  });

  bot.command('done', async (ctx) => {
    const [, rawChoice] = ctx.message.text.trim().split(/\s+/, 2);
    const state = latestLists.get(getChatKey(ctx));
    if (!state) {
      await ctx.reply('No active reminder list. Run /reminders today or /reminders week first.');
      return;
    }

    const choice = Number.parseInt(rawChoice ?? '', 10);
    if (!Number.isInteger(choice) || choice < 1 || choice > state.items.length) {
      await ctx.reply('Please choose a valid number from the latest reminder list.');
      return;
    }

    const item = state.items[choice - 1];
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

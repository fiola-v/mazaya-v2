import { Context, Markup, Telegraf } from 'telegraf';
import { showCommandCenter } from '../../bot/commandCenter';
import { getSessionKey } from '../../bot/session';
import { escapeHtml } from '../../utils/telegram';
import { CompanyRow } from '../../types/mazaya';
import { buildReportsSnapshot, FollowUpItem, ReminderItem, ReportsSnapshot, TodayVisitItem } from './reportSummaryService';

type ReportsRoomView = 'menu' | 'today_review' | 'today_visits' | 'overdue' | 'tomorrow';

interface ReportsRoomState {
  reviewedAt?: string;
  lastView?: ReportsRoomView;
}

const sessions = new Map<string, ReportsRoomState>();
const MAX_LIST_ITEMS = 5;

function getWorkflowKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

function getState(ctx: Context): ReportsRoomState {
  return sessions.get(getWorkflowKey(ctx)) ?? {};
}

function setState(ctx: Context, state: ReportsRoomState): void {
  sessions.set(getWorkflowKey(ctx), state);
}

function clearState(ctx: Context): void {
  sessions.delete(getWorkflowKey(ctx));
}

function safe(value: string | null | undefined): string {
  return escapeHtml(value || 'Not captured');
}

function formatDueDate(dueDate: string, dueTime: string | null): string {
  return dueTime ? `${dueDate} ${dueTime}` : dueDate;
}

function companyLabel(company: CompanyRow): string {
  const reportCardId = company.company_code ?? 'Not captured';
  return `${company.company_name} - ${reportCardId}`;
}

function buildMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Today\'s Review', 'reports:today_review')],
    [Markup.button.callback('Tomorrow\'s Follow-Ups', 'reports:tomorrow')],
    [Markup.button.callback('Overdue Reminders', 'reports:overdue')],
    [Markup.button.callback('Sync Now', 'reports:sync_now')],
    [Markup.button.callback('Back to Command Center', 'reports:back_command')],
  ]);
}

function buildTodayReviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Show today visits', 'reports:today_visits')],
    [Markup.button.callback('Show overdue', 'reports:overdue')],
    [Markup.button.callback('Show tomorrow', 'reports:tomorrow')],
    [Markup.button.callback('Mark reviewed', 'reports:mark_reviewed')],
    [
      Markup.button.callback('Sync Now', 'reports:sync_now'),
      Markup.button.callback('Back', 'reports:menu'),
    ],
  ]);
}

function buildDetailKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Back to Review', 'reports:today_review')],
    [Markup.button.callback('Back to Command Center', 'reports:back_command')],
  ]);
}

function buildTodayVisitsKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Back to Review', 'reports:today_review')],
    [Markup.button.callback('Back to Command Center', 'reports:back_command')],
  ]);
}

function buildReminderList(reminders: ReminderItem[], title: string): string {
  if (reminders.length === 0) {
    return [title, '', 'No items found.'].join('\n');
  }

  const lines = reminders.slice(0, MAX_LIST_ITEMS).flatMap((item, index) => [
    `${index + 1}. ${safe(companyLabel(item.company))}`,
    `   <b>Due:</b> ${safe(formatDueDate(item.reminder.due_date, item.reminder.due_time))}`,
    `   <b>Action:</b> ${safe(item.reminder.action)}`,
    '',
  ]);

  const extraCount = reminders.length - MAX_LIST_ITEMS;
  return [
    title,
    '',
    ...lines,
    extraCount > 0 ? `...and ${extraCount} more.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildFollowUpList(followUps: FollowUpItem[], title: string): string {
  if (followUps.length === 0) {
    return [title, '', 'No items found.'].join('\n');
  }

  const lines = followUps.slice(0, MAX_LIST_ITEMS).flatMap((item, index) => [
    `${index + 1}. ${safe(companyLabel(item.company))}`,
    `   <b>Next action:</b> ${safe(item.followUp.next_step)}`,
    `   <b>Due:</b> ${safe(formatDueDate(item.followUp.next_action_date ?? 'Not captured', null))}`,
    '',
  ]);

  const extraCount = followUps.length - MAX_LIST_ITEMS;
  return [
    title,
    '',
    ...lines,
    extraCount > 0 ? `...and ${extraCount} more.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildVisitList(visits: TodayVisitItem[], title: string): string {
  if (visits.length === 0) {
    return [title, '', 'No items found.'].join('\n');
  }

  const lines = visits.slice(0, MAX_LIST_ITEMS).flatMap((item, index) => [
    `${index + 1}. ${safe(companyLabel(item.company))}`,
    `   <b>Type:</b> ${item.isRevisit ? 'Revisit' : 'New company visit'}`,
    `   <b>Visit date:</b> ${safe(item.visit.visit_date)}`,
    '',
  ]);

  const extraCount = visits.length - MAX_LIST_ITEMS;
  return [
    title,
    '',
    ...lines,
    extraCount > 0 ? `...and ${extraCount} more.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function buildTodayReviewMessage(snapshot: ReportsSnapshot, reviewedAt?: string): string {
  const reviewStatus = reviewedAt ? `Reviewed in this session at ${reviewedAt}` : 'Not reviewed yet';
  const priorityLines = snapshot.priorityCompanies.slice(0, MAX_LIST_ITEMS).flatMap((item, index) => [
    `${index + 1}. ${safe(companyLabel(item.company))}`,
    `   <b>Reason:</b> ${safe(item.reasons.join('; '))}`,
    item.dueDate ? `   <b>Due:</b> ${safe(item.dueDate)}` : null,
    '',
  ]);
  const extraPriorityCount = snapshot.priorityCompanies.length - MAX_LIST_ITEMS;

  return [
    '<b>End-of-Day Review</b>',
    `<b>Date:</b> ${safe(snapshot.businessDate)}`,
    `<b>Review status:</b> ${safe(reviewStatus)}`,
    '',
    '<b>Field activity</b>',
    `New company visits: ${snapshot.newCompanyVisits.length}`,
    `Revisits: ${snapshot.revisits.length}`,
    '',
    '<b>Follow-ups</b>',
    `Logged today: ${snapshot.followUpsLoggedToday.length}`,
    '',
    '<b>Reminders</b>',
    `Created today: ${snapshot.remindersCreatedToday.length}`,
    `Due today: ${snapshot.openRemindersDueToday.length}`,
    `Overdue: ${snapshot.overdueReminders.length}`,
    `Due tomorrow: ${snapshot.tomorrowFollowUps.length}`,
    '',
    '<b>Priority actions</b>',
    priorityLines.length > 0 ? priorityLines.join('\n') : 'No priority companies identified from current CRM signals.',
    extraPriorityCount > 0 ? `...and ${extraPriorityCount} more.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

async function showReportsMenu(ctx: Context): Promise<void> {
  const state = getState(ctx);
  setState(ctx, {
    ...state,
    lastView: 'menu',
  });
  await ctx.reply(
    [
      '<b>Reports Room</b>',
      '',
      'Review today\'s CRM activity before any reporting or sync.',
      '',
      'Choose an option:',
    ].join('\n'),
    {
      parse_mode: 'HTML',
      ...buildMenuKeyboard(),
    }
  );
}

async function showTodayReview(ctx: Context): Promise<void> {
  const snapshot = await buildReportsSnapshot();
  const state = {
    ...getState(ctx),
    lastView: 'today_review' as const,
  };
  setState(ctx, state);

  await ctx.reply(
    buildTodayReviewMessage({
      ...snapshot,
    }, state.reviewedAt),
    {
    parse_mode: 'HTML',
    ...buildTodayReviewKeyboard(),
    }
  );
}

async function showTodayVisits(ctx: Context): Promise<void> {
  const snapshot = await buildReportsSnapshot();
  setState(ctx, {
    ...getState(ctx),
    lastView: 'today_visits',
  });

  await ctx.reply(
    [
      '<b>Today\'s Visits</b>',
      '',
      `<b>New company visits:</b> ${snapshot.newCompanyVisits.length}`,
      buildVisitList(snapshot.newCompanyVisits, '<b>New company visits</b>'),
      '',
      `<b>Existing company revisits:</b> ${snapshot.revisits.length}`,
      buildVisitList(snapshot.revisits, '<b>Existing company revisits</b>'),
    ].join('\n'),
    {
      parse_mode: 'HTML',
      ...buildTodayVisitsKeyboard(),
    }
  );
}

async function showOverdueReminders(ctx: Context): Promise<void> {
  const snapshot = await buildReportsSnapshot();
  setState(ctx, {
    ...getState(ctx),
    lastView: 'overdue',
  });

  await ctx.reply(buildReminderList(snapshot.overdueReminders, '<b>Overdue reminders</b>'), {
    parse_mode: 'HTML',
    ...buildDetailKeyboard(),
  });
}

async function showTomorrowFollowUps(ctx: Context): Promise<void> {
  const snapshot = await buildReportsSnapshot();
  setState(ctx, {
    ...getState(ctx),
    lastView: 'tomorrow',
  });

  await ctx.reply(buildFollowUpList(snapshot.tomorrowFollowUps, '<b>Tomorrow\'s follow-ups</b>'), {
    parse_mode: 'HTML',
    ...buildDetailKeyboard(),
  });
}

async function markReviewed(ctx: Context): Promise<void> {
  const nextState = {
    ...getState(ctx),
    reviewedAt: new Date().toISOString(),
    lastView: 'today_review' as const,
  };
  setState(ctx, nextState);

  await ctx.reply('Marked reviewed for this session only. Nothing was saved to Supabase.');
}

async function showSyncPlaceholder(ctx: Context): Promise<void> {
  await ctx.reply('Google Sheets sync will be enabled in the reporting phase. This item is not synced yet.');
}

export async function showReportsRoom(ctx: Context): Promise<void> {
  await showReportsMenu(ctx);
}

export function registerReportsRoomWorkflow(bot: Telegraf): void {
  bot.command('reports', async (ctx) => {
    await showReportsMenu(ctx);
  });

  bot.command('report', async (ctx) => {
    await showReportsMenu(ctx);
  });

  bot.action('cc:report_room', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReportsMenu(ctx);
  });

  bot.action('reports:menu', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReportsMenu(ctx);
  });

  bot.action('reports:today_review', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showTodayReview(ctx);
  });

  bot.action('reports:today_visits', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showTodayVisits(ctx);
  });

  bot.action('reports:overdue', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showOverdueReminders(ctx);
  });

  bot.action('reports:tomorrow', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showTomorrowFollowUps(ctx);
  });

  bot.action('reports:mark_reviewed', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await markReviewed(ctx);
  });

  bot.action('reports:sync_now', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showSyncPlaceholder(ctx);
  });

  bot.action('reports:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
  });
}

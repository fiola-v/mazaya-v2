import { Context, Markup, Telegraf } from 'telegraf';
import { showCommandCenter } from '../../bot/commandCenter';
import { getSessionKey } from '../../bot/session';
import { env } from '../../config/env';
import { addDays, isDateOnly, toDateOnly } from '../../utils/dates';
import { normalizeWhatsAppDisplay } from '../../utils/phone';
import { escapeHtml } from '../../utils/telegram';
import { getCompanyByCode } from '../companies/companyService';
import { getMainContactForCompany } from '../contacts/contactService';
import { listFieldVisitsByCompany } from '../fieldVisits/fieldVisitService';
import { createFollowUp } from '../followUps/followUpService';
import { listLatestFollowUpsByCompany } from '../followUps/followUpService';
import {
  createReminder,
  deleteReminderById,
  findMatchingActiveCompanyReminder,
  listRemindersByCompany,
} from '../reminders/reminderService';
import { DraftChannel, DraftContextInput, DraftGenerationResult, generateSalesDraft } from './openaiDraftService';

type DraftGoalPreset =
  | 'Book meeting'
  | 'Follow up no reply'
  | 'Include decision maker'
  | 'Push onboarding'
  | 'Send credibility info'
  | 'Clarify real interest';

type DraftStep =
  | 'awaiting_report_card_id'
  | 'choose_type'
  | 'choose_goal'
  | 'custom_goal'
  | 'extra_context'
  | 'preview'
  | 'add_instruction'
  | 'next_step_menu'
  | 'reminder_choice'
  | 'reminder_text'
  | 'reminder_date'
  | 'reminder_custom_date'
  | 'reminder_preview';

interface DraftReminderDraft {
  text: string;
  dueDate: string | null;
  dueTime: string | null;
}

interface CompanyDraftContext {
  companyId: string;
  companyName: string;
  reportCardId: string;
  industry: string | null;
  mainContactName: string | null;
  role: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  latestVisitStatus: string | null;
  lastVisitedDate: string | null;
  interestLevel: string | null;
  blocker: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  latestVisitNote: string | null;
  openReminders: Array<{ action: string; dueDate: string; dueTime: string | null; status: string }>;
  latestFollowUps: Array<{ date: string; result: string | null; nextStep: string | null; note: string | null }>;
}

interface DraftState {
  step: DraftStep;
  context?: CompanyDraftContext;
  draftType?: DraftChannel;
  draftGoal?: string;
  customGoal?: string;
  extraContext?: string | null;
  addInstruction?: string | null;
  result?: DraftGenerationResult;
  reminderDraft?: DraftReminderDraft;
  lastCreatedReminder?: {
    id: string;
    text: string;
    dueDate: string;
  };
}

const sessions = new Map<string, DraftState>();
const BUSINESS_TIME_ZONE = 'Asia/Dubai';

function getDraftKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

function getState(ctx: Context): DraftState | undefined {
  return sessions.get(getDraftKey(ctx));
}

function setState(ctx: Context, state: DraftState): void {
  sessions.set(getDraftKey(ctx), state);
}

function clearState(ctx: Context): void {
  sessions.delete(getDraftKey(ctx));
}

function valueOrFallback(value: string | null | undefined): string {
  return value || 'Not captured';
}

function safe(value: string | null | undefined): string {
  return escapeHtml(valueOrFallback(value));
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  if (!text || text.toLowerCase() === 'skip') {
    return null;
  }

  return text;
}

function isActiveReminderStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'open' || normalized === 'pending';
}

function toBusinessDateOnly(date: Date): string {
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

function buildDraftMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Draft by Report Card ID', 'drafts:by_rc')],
    [Markup.button.callback('Back to Command Center', 'drafts:back_command')],
  ]);
}

function buildDraftTypeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('WhatsApp follow-up', 'drafts:type:whatsapp')],
    [Markup.button.callback('Email follow-up', 'drafts:type:email')],
    [Markup.button.callback('LinkedIn follow-up', 'drafts:type:linkedin')],
    [Markup.button.callback('Back', 'drafts:type:back')],
  ]);
}

function buildDraftGoalKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Book meeting', 'drafts:goal:book_meeting')],
    [Markup.button.callback('Follow up no reply', 'drafts:goal:follow_up_no_reply')],
    [Markup.button.callback('Include decision maker', 'drafts:goal:include_decision_maker')],
    [Markup.button.callback('Push onboarding', 'drafts:goal:push_onboarding')],
    [Markup.button.callback('Send credibility info', 'drafts:goal:send_credibility_info')],
    [Markup.button.callback('Clarify real interest', 'drafts:goal:clarify_real_interest')],
    [Markup.button.callback('Custom goal', 'drafts:goal:custom')],
  ]);
}

function buildDraftPreviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Regenerate', 'drafts:preview:regenerate')],
    [Markup.button.callback('Add instruction', 'drafts:preview:add_instruction')],
    [Markup.button.callback('Change type', 'drafts:preview:change_type')],
    [Markup.button.callback('Next step', 'drafts:preview:next_step')],
    [Markup.button.callback('Done', 'drafts:preview:done')],
    [Markup.button.callback('Cancel', 'drafts:preview:cancel')],
  ]);
}

function buildNextStepKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Set follow-up reminder', 'drafts:next:set_reminder')],
    [Markup.button.callback('Log as message sent', 'drafts:next:log_sent')],
    [Markup.button.callback('Finish without CRM update', 'drafts:next:finish')],
    [Markup.button.callback('Back to draft', 'drafts:next:back')],
  ]);
}

function buildReminderDateKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Today', 'drafts:reminder_date:today')],
    [Markup.button.callback('Tomorrow', 'drafts:reminder_date:tomorrow')],
    [Markup.button.callback('Next Week', 'drafts:reminder_date:next_week')],
    [Markup.button.callback('Custom Date', 'drafts:reminder_date:custom')],
    [Markup.button.callback('No Date', 'drafts:reminder_date:none')],
  ]);
}

function buildReminderChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Use suggestion', 'drafts:reminder_choice:use_suggestion')],
    [Markup.button.callback('Write my own', 'drafts:reminder_choice:write_own')],
    [Markup.button.callback('Back to draft', 'drafts:reminder_choice:back')],
    [Markup.button.callback('Cancel reminder', 'drafts:reminder_choice:cancel')],
  ]);
}

function buildReminderPreviewKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Confirm', 'drafts:reminder:confirm')],
    [Markup.button.callback('Edit text', 'drafts:reminder:edit_text')],
    [Markup.button.callback('Change date', 'drafts:reminder:change_date')],
    [Markup.button.callback('Cancel reminder', 'drafts:reminder:cancel')],
  ]);
}

function buildReminderCreatedKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('View company reminders', 'drafts:reminder_created:view')],
    [Markup.button.callback('Undo reminder', 'drafts:reminder_created:undo')],
    [Markup.button.callback('Back to draft', 'drafts:reminder_created:back')],
    [Markup.button.callback('Done', 'drafts:reminder_created:done')],
  ]);
}

function mapDraftType(raw: string): DraftChannel | null {
  switch (raw) {
    case 'whatsapp':
      return 'WhatsApp follow-up';
    case 'email':
      return 'Email follow-up';
    case 'linkedin':
      return 'LinkedIn follow-up';
    default:
      return null;
  }
}

function mapGoalPreset(raw: string): DraftGoalPreset | null {
  switch (raw) {
    case 'book_meeting':
      return 'Book meeting';
    case 'follow_up_no_reply':
      return 'Follow up no reply';
    case 'include_decision_maker':
      return 'Include decision maker';
    case 'push_onboarding':
      return 'Push onboarding';
    case 'send_credibility_info':
      return 'Send credibility info';
    case 'clarify_real_interest':
      return 'Clarify real interest';
    default:
      return null;
  }
}

function parseReportCardId(raw: string): string | null {
  const text = raw.trim();
  if (!/^RC-\d{2}-\d{4,}$/i.test(text)) {
    return null;
  }

  return text.toUpperCase();
}

function parseDateHint(hint: string | null | undefined): string | null {
  if (!hint) {
    return null;
  }

  const match = hint.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (!match || !isDateOnly(match[0])) {
    return null;
  }

  return match[0];
}

function buildMissingDetailsMessage(reportCardId: string, missing: string[]): string {
  return [
    '<b>Missing draft details</b>',
    '',
    'I need a little more context before creating a good draft.',
    '',
    '<b>Missing:</b>',
    ...missing.map((item) => `- ${escapeHtml(item)}`),
    '',
    'You can update the company first, then run:',
    `<code>/draft ${escapeHtml(reportCardId)}</code>`,
  ].join('\n');
}

function buildDraftPreview(state: DraftState): string {
  const context = state.context as CompanyDraftContext;
  const result = state.result as DraftGenerationResult;
  const contextLines: string[] = [];
  if (context.mainContactName) {
    contextLines.push(`<b>Contact:</b> ${safe(context.mainContactName)}`);
  }

  if (context.industry) {
    contextLines.push(`<b>Industry:</b> ${safe(context.industry)}`);
  }

  contextLines.push(`<b>Goal:</b> ${safe(state.draftGoal)}`);

  if (context.nextAction) {
    contextLines.push(`<b>Next action:</b> ${safe(context.nextAction)}`);
  }

  if (context.openReminders.length > 0) {
    const reminder = context.openReminders[0];
    const reminderDue = reminder.dueTime ? `${reminder.dueDate} ${reminder.dueTime}` : reminder.dueDate;
    contextLines.push(`<b>Open reminder:</b> ${safe(reminder.action)}${reminderDue ? ` (${safe(reminderDue)})` : ''}`);
  }

  if (context.latestFollowUps.length > 0) {
    const followUp = context.latestFollowUps[0];
    contextLines.push(`<b>Latest follow-up:</b> ${safe(followUp.result ?? followUp.note ?? followUp.date)}`);
  }

  const subjectLine = result.subject_line ? `<b>Subject:</b> ${safe(result.subject_line)}` : null;
  return [
    '<b>Draft Preview</b>',
    '',
    '<b>Company</b>',
    `<b>Name:</b> ${safe(context.companyName)}`,
    `<b>Report Card ID:</b> ${safe(context.reportCardId)}`,
    `<b>Type:</b> ${safe(state.draftType)}`,
    `<b>Goal:</b> ${safe(state.draftGoal)}`,
    '',
    '<b>Context used</b>',
    ...contextLines.map((line) => `• ${line}`),
    '',
    '<b>Deal read</b>',
    `<b>Stage:</b> ${safe(result.current_stage)}`,
    '',
    '<b>Likely blocker:</b>',
    safe(result.likely_blocker),
    '',
    '<b>Recommended next action:</b>',
    safe(result.recommended_next_action),
    '',
    '<b>Draft</b>',
    ...(subjectLine ? [subjectLine, ''] : []),
    safe(result.draft_text),
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function buildReminderPreview(state: DraftState): string {
  const context = state.context as CompanyDraftContext;
  const reminder = state.reminderDraft as DraftReminderDraft;
  return [
    '<b>Reminder Preview</b>',
    '',
    `<b>Company:</b> ${safe(context.companyName)}`,
    `<b>Report Card ID:</b> ${safe(context.reportCardId)}`,
    '',
    '<b>Reminder:</b>',
    safe(reminder.text),
    '',
    `<b>Date:</b> ${safe(reminder.dueDate)}`,
  ].join('\n');
}

async function showDraftRoom(ctx: Context): Promise<void> {
  clearState(ctx);
  await ctx.reply(
    [
      '<b>Drafts Room</b>',
      '',
      'Create follow-up drafts using CRM data.',
      '',
      'Choose an option:',
    ].join('\n'),
    { parse_mode: 'HTML', ...buildDraftMenuKeyboard() }
  );
}

async function askReportCardId(ctx: Context): Promise<void> {
  setState(ctx, { step: 'awaiting_report_card_id' });
  await ctx.reply('Send the Report Card ID, for example RC-26-0003.');
}

async function loadCompanyContext(reportCardId: string): Promise<CompanyDraftContext | null> {
  const company = await getCompanyByCode(reportCardId);
  if (!company) {
    return null;
  }

  const [mainContact, fieldVisits, reminders, followUps] = await Promise.all([
    getMainContactForCompany(company.id),
    listFieldVisitsByCompany(company.id),
    listRemindersByCompany(company.id),
    listLatestFollowUpsByCompany(company.id, 3),
  ]);

  const latestVisit = fieldVisits[0] ?? null;
  const openReminders = reminders
    .filter((item) => isActiveReminderStatus(item.status))
    .map((item) => ({
      action: item.action,
      dueDate: item.due_date,
      dueTime: item.due_time ?? null,
      status: item.status,
    }));

  return {
    companyId: company.id,
    companyName: company.company_name,
    reportCardId: company.company_code ?? reportCardId,
    industry: company.industry ?? null,
    mainContactName: mainContact?.contact_name ?? null,
    role: mainContact?.role_title ?? null,
    phone: mainContact?.phone ?? null,
    whatsapp: normalizeWhatsAppDisplay(mainContact?.whatsapp, mainContact?.phone),
    email: mainContact?.email ?? null,
    latestVisitStatus: latestVisit?.visit_status ?? company.visit_status ?? null,
    lastVisitedDate: latestVisit?.visit_date ?? (latestVisit?.created_at ? latestVisit.created_at.slice(0, 10) : null),
    interestLevel: latestVisit?.interest_level ?? company.interest_level ?? null,
    blocker: latestVisit?.blocker ?? company.current_blocker ?? null,
    nextAction: company.current_next_action ?? latestVisit?.next_step ?? null,
    nextActionDate: company.next_action_date ?? latestVisit?.next_action_date ?? null,
    latestVisitNote: latestVisit?.visit_note ?? company.latest_human_note ?? null,
    openReminders,
    latestFollowUps: followUps.map((row) => ({
      date: row.follow_up_date,
      result: row.follow_up_result ?? null,
      nextStep: row.next_step ?? null,
      note: row.follow_up_note ?? null,
    })),
  };
}

function getMissingRequirements(context: CompanyDraftContext): string[] {
  const missing: string[] = [];
  if (!context.companyName.trim()) {
    missing.push('Company name');
  }

  if (!context.industry) {
    missing.push('Industry');
  }

  if (!context.mainContactName && !context.phone && !context.whatsapp && !context.email) {
    missing.push('Contact name or phone/email');
  }

  const hasDealSignal = Boolean(
    context.nextAction ||
      context.openReminders.length > 0 ||
      context.latestFollowUps.length > 0 ||
      context.blocker ||
      context.latestVisitNote
  );

  if (!hasDealSignal) {
    missing.push('Next action, blocker, latest follow-up, or visit note');
  }

  return missing;
}

async function askDraftType(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'choose_type';
  setState(ctx, state);
  await ctx.reply(
    [
      `<b>Draft for ${safe(state.context?.companyName)}</b>`,
      `<b>Report Card ID:</b> ${safe(state.context?.reportCardId)}`,
      '',
      'Choose draft type:',
    ].join('\n'),
    { parse_mode: 'HTML', ...buildDraftTypeKeyboard() }
  );
}

async function askDraftGoal(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'choose_goal';
  setState(ctx, state);
  await ctx.reply(
    ['<b>Draft goal</b>', '', 'What is the goal of this message?'].join('\n'),
    { parse_mode: 'HTML', ...buildDraftGoalKeyboard() }
  );
}

async function askExtraContext(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'extra_context';
  setState(ctx, state);
  await ctx.reply(
    [
      '<b>Extra context</b>',
      '',
      'Paste what they said or any extra instruction.',
      'You can also send skip.',
      '',
      'Examples:',
      '- "He liked the demo but needs GM approval."',
      '- "Ask for a meeting tomorrow at 3 PM with the CFO."',
      '- "They asked for trade license first."',
    ].join('\n'),
    { parse_mode: 'HTML' }
  );
}

function buildGenerationInput(state: DraftState): DraftContextInput {
  const context = state.context as CompanyDraftContext;
  return {
    companyName: context.companyName,
    reportCardId: context.reportCardId,
    industry: context.industry ?? 'Not captured',
    contactName: context.mainContactName,
    role: context.role,
    phone: context.phone,
    whatsapp: context.whatsapp,
    email: context.email,
    latestVisitStatus: context.latestVisitStatus,
    lastVisitedDate: context.lastVisitedDate,
    interestLevel: context.interestLevel,
    blocker: context.blocker,
    nextAction: context.nextAction,
    nextActionDate: context.nextActionDate,
    openReminders: context.openReminders,
    latestFollowUps: context.latestFollowUps,
    latestVisitNote: context.latestVisitNote,
  };
}

async function generateAndShowPreview(ctx: Context, state: DraftState): Promise<void> {
  if (!env.OPENAI_API_KEY) {
    await ctx.reply('Drafts API is not configured. Add OPENAI_API_KEY to .env.');
    return;
  }

  let generation: DraftGenerationResult;
  try {
    generation = await generateSalesDraft({
      draftType: state.draftType as DraftChannel,
      draftGoal: state.draftGoal as string,
      extraContext: state.extraContext ?? null,
      addInstruction: state.addInstruction ?? null,
      crm: buildGenerationInput(state),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN_DRAFT_ERROR';
    if (code === 'OPENAI_DRAFT_MODEL_MISSING') {
      await ctx.reply('Draft model is not configured. Add OPENAI_DRAFT_MODEL to .env.');
      return;
    }

    if (code === 'OPENAI_MODEL_NOT_AVAILABLE') {
      await ctx.reply('Draft model is not available for this API project. Update OPENAI_DRAFT_MODEL in .env.');
      return;
    }

    await ctx.reply('Could not generate a draft right now. Please try again.');
    return;
  }

  state.result = generation;
  state.step = 'preview';
  setState(ctx, state);

  await ctx.reply(buildDraftPreview(state), { parse_mode: 'HTML', ...buildDraftPreviewKeyboard() });
}

async function startDraftByReportCard(ctx: Context, reportCardId: string): Promise<void> {
  const normalized = parseReportCardId(reportCardId);
  if (!normalized) {
    await ctx.reply('Please send a valid Report Card ID like RC-26-0003.');
    return;
  }

  const context = await loadCompanyContext(normalized);
  if (!context) {
    await ctx.reply('No company found for that Report Card ID. Please check it and try again.');
    return;
  }

  const missing = getMissingRequirements(context);
  if (missing.length > 0) {
    clearState(ctx);
    await ctx.reply(buildMissingDetailsMessage(normalized, missing), { parse_mode: 'HTML' });
    return;
  }

  const state: DraftState = { step: 'choose_type', context };
  setState(ctx, state);
  await askDraftType(ctx, state);
}

async function askAddInstruction(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'add_instruction';
  setState(ctx, state);
  await ctx.reply('Send one short instruction for regeneration. Example: "Make it shorter and add two meeting options."');
}

async function askReminderChoice(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'reminder_choice';
  const suggested = state.result?.suggested_reminder_text || state.result?.recommended_next_action || 'Follow up';
  state.reminderDraft = {
    text: suggested,
    dueDate: parseDateHint(state.result?.suggested_reminder_date_hint) ?? null,
    dueTime: null,
  };
  setState(ctx, state);
  await ctx.reply(
    [
      '<b>Set follow-up reminder</b>',
      '',
      '<b>Suggested reminder:</b>',
      safe(suggested),
      '',
      'What do you want to do?',
    ].join('\n'),
    { parse_mode: 'HTML', ...buildReminderChoiceKeyboard() }
  );
}

async function askReminderText(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'reminder_text';
  setState(ctx, state);
  await ctx.reply('Send the reminder text.');
}

async function askReminderDate(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'reminder_date';
  setState(ctx, state);
  await ctx.reply('Choose reminder date:', buildReminderDateKeyboard());
}

async function showReminderPreview(ctx: Context, state: DraftState): Promise<void> {
  state.step = 'reminder_preview';
  setState(ctx, state);
  await ctx.reply(buildReminderPreview(state), { parse_mode: 'HTML', ...buildReminderPreviewKeyboard() });
}

function resolveReminderDate(choice: 'today' | 'tomorrow' | 'next_week' | 'none'): string {
  if (choice === 'today') {
    return toBusinessDateOnly(new Date());
  }

  if (choice === 'tomorrow') {
    return toBusinessDateOnly(addDays(new Date(), 1));
  }

  if (choice === 'next_week') {
    return toBusinessDateOnly(addDays(new Date(), 7));
  }

  return toBusinessDateOnly(new Date());
}

function formatCompanyReminderListForDrafts(companyName: string, reportCardId: string, reminders: Array<{
  action: string;
  dueDate: string;
  dueTime: string | null;
  status: string;
}>): string {
  const today = toBusinessDateOnly(new Date());
  const lines = reminders.map((item, index) => {
    const status = item.dueDate < today ? 'Overdue' : 'Open';
    const due = item.dueTime ? `${item.dueDate} ${item.dueTime}` : item.dueDate;
    return `${index + 1}. ${safe(item.action)}\n   <b>Due date:</b> ${safe(due)}\n   <b>Status:</b> ${safe(status)}\n`;
  });

  return [
    `<b>Reminders for ${safe(companyName)}</b>`,
    `<b>Report Card ID:</b> ${safe(reportCardId)}`,
    '',
    ...(lines.length > 0 ? lines : ['No open reminders found.']),
  ].join('\n');
}

export function registerDraftsWorkflow(bot: Telegraf): void {
  bot.command(['drafts', 'draft'], async (ctx) => {
    const rawArg = ctx.message.text.replace(/^\/(?:drafts|draft)(?:@\w+)?\s*/i, '').trim();
    if (!rawArg) {
      await showDraftRoom(ctx);
      return;
    }

    await startDraftByReportCard(ctx, rawArg);
  });

  bot.action('cc:draft_message_later', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showDraftRoom(ctx);
  });

  bot.action('drafts:by_rc', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await askReportCardId(ctx);
  });

  bot.action('drafts:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await showCommandCenter(ctx);
  });

  bot.action(/^drafts:type:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const action = (ctx.match as RegExpMatchArray | undefined)?.[1] ?? '';

    if (action === 'back') {
      await showDraftRoom(ctx);
      return;
    }

    const draftType = mapDraftType(action);
    if (!state || !state.context || !draftType) {
      await ctx.reply('Could not select draft type. Please start again with /draft RC-26-0003.');
      return;
    }

    state.draftType = draftType;
    await askDraftGoal(ctx, state);
  });

  bot.action(/^drafts:goal:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const action = (ctx.match as RegExpMatchArray | undefined)?.[1] ?? '';
    if (!state || !state.context || !state.draftType) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    if (action === 'custom') {
      state.step = 'custom_goal';
      setState(ctx, state);
      await ctx.reply('Type the custom goal/context in one message.');
      return;
    }

    const preset = mapGoalPreset(action);
    if (!preset) {
      await ctx.reply('Could not record draft goal. Please choose again.');
      return;
    }

    state.draftGoal = preset;
    state.customGoal = undefined;
    await askExtraContext(ctx, state);
  });

  bot.action('drafts:preview:regenerate', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context || !state.draftType || !state.draftGoal) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    state.addInstruction = null;
    await generateAndShowPreview(ctx, state);
  });

  bot.action('drafts:preview:add_instruction', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context || !state.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    await askAddInstruction(ctx, state);
  });

  bot.action('drafts:preview:change_type', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    await askDraftType(ctx, state);
  });

  bot.action('drafts:preview:next_step', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context || !state.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    state.step = 'next_step_menu';
    setState(ctx, state);
    await ctx.reply('<b>Next step after draft</b>\n\nWhat do you want to do?', {
      parse_mode: 'HTML',
      ...buildNextStepKeyboard(),
    });
  });

  bot.action('drafts:preview:done', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Draft ready to copy.');
  });

  bot.action('drafts:preview:cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Draft cancelled.');
  });

  bot.action('drafts:next:set_reminder', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context || !state.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    await askReminderChoice(ctx, state);
  });

  bot.action(/^drafts:reminder_choice:(use_suggestion|write_own|back|cancel)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const action = (ctx.match as RegExpMatchArray | undefined)?.[1] ?? '';
    if (!state?.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    if (action === 'use_suggestion') {
      if (!state.reminderDraft) {
        await askReminderChoice(ctx, state);
        return;
      }
      await askReminderDate(ctx, state);
      return;
    }

    if (action === 'write_own') {
      await askReminderText(ctx, state);
      return;
    }

    state.reminderDraft = undefined;
    setState(ctx, state);
    await ctx.reply(buildDraftPreview(state), { parse_mode: 'HTML', ...buildDraftPreviewKeyboard() });
  });

  bot.action('drafts:next:log_sent', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    // Keep existing /log workflow untouched in MVP.
    const draftType = state.draftType ?? 'draft message';
    const note = state.result?.crm_note || 'Draft generated and marked as sent by user';

    await createFollowUp({
      company_id: state.context.companyId,
      contact_id: null,
      follow_up_date: toDateOnly(new Date()),
      follow_up_result: null,
      next_step: null,
      next_action_date: null,
      current_pipeline_status: null,
      follow_up_note: `[${draftType}] Message sent. ${note}`,
      created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
    });

    clearState(ctx);
    await ctx.reply('Message was logged as sent.');
  });

  bot.action('drafts:next:finish', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Draft ready to copy. No CRM update was made.');
  });

  bot.action('drafts:next:back', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    await ctx.reply(buildDraftPreview(state), { parse_mode: 'HTML', ...buildDraftPreviewKeyboard() });
  });

  bot.action(/^drafts:reminder_date:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const choice = (ctx.match as RegExpMatchArray | undefined)?.[1] ?? '';
    if (!state?.context || !state.reminderDraft) {
      await ctx.reply('Reminder draft expired. Start again from Draft Preview → Next step.');
      return;
    }

    if (choice === 'custom') {
      state.step = 'reminder_custom_date';
      setState(ctx, state);
      await ctx.reply('Type the custom date in YYYY-MM-DD format.');
      return;
    }

    if (choice !== 'today' && choice !== 'tomorrow' && choice !== 'next_week' && choice !== 'none') {
      await ctx.reply('Please choose a valid date option.');
      return;
    }

    state.reminderDraft.dueDate = resolveReminderDate(choice);
    await showReminderPreview(ctx, state);
  });

  bot.action('drafts:reminder:edit_text', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.reminderDraft) {
      await ctx.reply('Reminder draft expired. Start again from Draft Preview → Next step.');
      return;
    }

    await askReminderText(ctx, state);
  });

  bot.action('drafts:reminder:change_date', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.reminderDraft) {
      await ctx.reply('Reminder draft expired. Start again from Draft Preview → Next step.');
      return;
    }

    await askReminderDate(ctx, state);
  });

  bot.action('drafts:reminder:cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    state.reminderDraft = undefined;
    setState(ctx, state);
    await ctx.reply(buildDraftPreview(state), { parse_mode: 'HTML', ...buildDraftPreviewKeyboard() });
  });

  bot.action('drafts:reminder:confirm', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context || !state.reminderDraft) {
      await ctx.reply('Reminder draft expired. Start again from Draft Preview → Next step.');
      return;
    }

    const reminderText = normalizeOptionalText(state.reminderDraft.text);
    const dueDate = state.reminderDraft.dueDate;
    if (!reminderText || !dueDate) {
      await ctx.reply('Reminder is missing text or date. Please edit and try again.');
      return;
    }

    const duplicate = await findMatchingActiveCompanyReminder({
      company_id: state.context.companyId,
      action: reminderText,
      due_date: dueDate,
      due_time: state.reminderDraft.dueTime,
    });

    if (duplicate) {
      await ctx.reply('Reminder already open.');
      return;
    }

    const createdReminder = await createReminder({
      company_id: state.context.companyId,
      contact_id: null,
      reminder_type: 'follow_up',
      action: reminderText,
      due_date: dueDate,
      due_time: state.reminderDraft.dueTime,
      created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
    });

    state.lastCreatedReminder = {
      id: createdReminder.id,
      text: reminderText,
      dueDate,
    };
    setState(ctx, state);

    await ctx.reply(
      [
        '<b>Reminder created.</b>',
        '',
        `<b>Company:</b> ${safe(state.context.companyName)}`,
        `<b>Report Card ID:</b> ${safe(state.context.reportCardId)}`,
        `<b>Reminder:</b> ${safe(reminderText)}`,
        `<b>Date:</b> ${safe(dueDate)}`,
      ].join('\n'),
      { parse_mode: 'HTML', ...buildReminderCreatedKeyboard() }
    );
  });

  bot.action('drafts:reminder_created:view', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    const reminders = await listRemindersByCompany(state.context.companyId);
    const active = reminders
      .filter((item) => isActiveReminderStatus(item.status))
      .map((item) => ({
        action: item.action,
        dueDate: item.due_date,
        dueTime: item.due_time ?? null,
        status: item.status,
      }));

    await ctx.reply(
      formatCompanyReminderListForDrafts(state.context.companyName, state.context.reportCardId, active),
      { parse_mode: 'HTML' }
    );
  });

  bot.action('drafts:reminder_created:undo', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.context || !state.lastCreatedReminder) {
      await ctx.reply('There is no reminder to undo in this draft session.');
      return;
    }

    const removed = await deleteReminderById(state.lastCreatedReminder.id);
    if (!removed) {
      await ctx.reply('That reminder could not be undone because it was already removed.');
      return;
    }

    const removedText = state.lastCreatedReminder.text;
    const removedDate = state.lastCreatedReminder.dueDate;
    state.lastCreatedReminder = undefined;
    setState(ctx, state);

    await ctx.reply(
      [
        '<b>Reminder undone.</b>',
        '',
        `<b>Company:</b> ${safe(state.context.companyName)}`,
        `<b>Report Card ID:</b> ${safe(state.context.reportCardId)}`,
        `<b>Reminder:</b> ${safe(removedText)}`,
        `<b>Date:</b> ${safe(removedDate)}`,
      ].join('\n'),
      { parse_mode: 'HTML', ...buildReminderCreatedKeyboard() }
    );
  });

  bot.action('drafts:reminder_created:back', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.result) {
      await ctx.reply('Draft session expired. Please run /draft RC-26-0003 again.');
      return;
    }

    await ctx.reply(buildDraftPreview(state), { parse_mode: 'HTML', ...buildDraftPreviewKeyboard() });
  });

  bot.action('drafts:reminder_created:done', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Draft ready to copy.');
  });
}

export async function handleDraftsText(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return false;
  }

  const state = getState(ctx);
  if (!state) {
    return false;
  }

  const text = message.text.trim();
  if (text.startsWith('/')) {
    return false;
  }

  if (state.step === 'awaiting_report_card_id') {
    await startDraftByReportCard(ctx, text);
    return true;
  }

  if (state.step === 'custom_goal') {
    const goal = normalizeOptionalText(text);
    if (!goal) {
      await ctx.reply('Please type a custom goal in one message.');
      return true;
    }

    state.customGoal = goal;
    state.draftGoal = goal;
    await askExtraContext(ctx, state);
    return true;
  }

  if (state.step === 'extra_context') {
    state.extraContext = normalizeOptionalText(text);
    state.addInstruction = null;
    await generateAndShowPreview(ctx, state);
    return true;
  }

  if (state.step === 'add_instruction') {
    const instruction = normalizeOptionalText(text);
    if (!instruction) {
      await ctx.reply('Please send one short instruction.');
      return true;
    }

    state.addInstruction = instruction;
    await generateAndShowPreview(ctx, state);
    return true;
  }

  if (state.step === 'reminder_text') {
    const reminderText = normalizeOptionalText(text);
    if (!reminderText) {
      await ctx.reply('Please send a reminder text.');
      return true;
    }

    if (!state.reminderDraft) {
      state.reminderDraft = { text: reminderText, dueDate: null, dueTime: null };
    } else {
      state.reminderDraft.text = reminderText;
    }

    await askReminderDate(ctx, state);
    return true;
  }

  if (state.step === 'reminder_custom_date') {
    if (!isDateOnly(text)) {
      await ctx.reply('Please enter a valid date in YYYY-MM-DD format.');
      return true;
    }

    if (!state.reminderDraft) {
      state.reminderDraft = { text: 'Follow up', dueDate: text, dueTime: null };
    } else {
      state.reminderDraft.dueDate = text;
    }

    await showReminderPreview(ctx, state);
    return true;
  }

  return false;
}

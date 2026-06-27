import { Context, Markup, Telegraf } from 'telegraf';
import { getSessionKey } from '../../bot/session';
import { addDays, isDateOnly, toDateOnly } from '../../utils/dates';
import { CompanyContactRow, CompanyRow, FollowUpNextStep, FollowUpResult } from '../../types/mazaya';
import { findCompaniesByName, getCompanyByCode, getCompanyById } from '../companies/companyService';
import { getMainContactForCompany } from '../contacts/contactService';
import { createFollowUp } from './followUpService';
import { completeReminder, createOrUpdateCompanyReminder } from '../reminders/reminderService';

type FollowUpStep =
  | 'company_query'
  | 'company_choice'
  | 'result'
  | 'notes'
  | 'next_step'
  | 'next_action_datetime'
  | 'preview';

interface FollowUpLoggingState {
  step: FollowUpStep;
  companyIds?: string[];
  company?: CompanyRow;
  mainContact?: CompanyContactRow | null;
  result?: FollowUpResult;
  note?: string | null;
  nextStep?: FollowUpNextStep;
  nextActionDate?: string | null;
  nextActionTime?: string | null;
  completingReminderId?: string | null;
}

const sessions = new Map<string, FollowUpLoggingState>();
const MAX_COMPANY_CHOICES = 10;

function getWorkflowKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

function getState(ctx: Context): FollowUpLoggingState | undefined {
  return sessions.get(getWorkflowKey(ctx));
}

function setState(ctx: Context, state: FollowUpLoggingState): void {
  sessions.set(getWorkflowKey(ctx), state);
}

function clearState(ctx: Context): void {
  sessions.delete(getWorkflowKey(ctx));
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  if (!text || text.toLowerCase() === 'skip') {
    return null;
  }

  return text;
}

function valueOrFallback(value: string | null | undefined): string {
  return value || 'Not captured';
}

function buildResultKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('No reply', 'follow_up:result:no_reply')],
    [Markup.button.callback('Interested', 'follow_up:result:interested')],
    [Markup.button.callback('Meeting scheduled', 'follow_up:result:meeting_scheduled')],
    [Markup.button.callback('Onboarding requested', 'follow_up:result:onboarding_requested')],
    [Markup.button.callback('Need decision maker', 'follow_up:result:need_decision_maker')],
    [Markup.button.callback('Need finance approval', 'follow_up:result:need_finance_approval')],
    [Markup.button.callback('Waiting for next update', 'follow_up:result:waiting_for_next_update')],
    [Markup.button.callback('Not interested', 'follow_up:result:not_interested')],
  ]);
}

function buildNextStepKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Follow up later', 'follow_up:next:follow_up_later')],
    [Markup.button.callback('Schedule meeting', 'follow_up:next:schedule_meeting')],
    [Markup.button.callback('Schedule onboarding', 'follow_up:next:schedule_onboarding')],
    [Markup.button.callback('Send information/deck', 'follow_up:next:send_information_deck')],
    [Markup.button.callback('No next action', 'follow_up:next:no_next_action')],
  ]);
}

function mapResult(action: string): FollowUpResult | null {
  switch (action) {
    case 'no_reply':
      return 'No reply';
    case 'interested':
      return 'Interested';
    case 'meeting_scheduled':
      return 'Meeting scheduled';
    case 'onboarding_requested':
      return 'Onboarding requested';
    case 'need_decision_maker':
      return 'Need decision maker';
    case 'need_finance_approval':
      return 'Need finance approval';
    case 'waiting_for_next_update':
      return 'Waiting for next update';
    case 'not_interested':
      return 'Not interested';
    default:
      return null;
  }
}

function mapNextStep(action: string): FollowUpNextStep | null {
  switch (action) {
    case 'follow_up_later':
      return 'Follow up later';
    case 'schedule_meeting':
      return 'Schedule meeting';
    case 'schedule_onboarding':
      return 'Schedule onboarding';
    case 'send_information_deck':
      return 'Send information/deck';
    case 'no_next_action':
      return 'No next action';
    default:
      return null;
  }
}

function parseDateTime(value: string): { date: string; time: string | null } | null {
  const text = value.trim();
  const normalizedText = text.toLowerCase();
  if (normalizedText === 'today') {
    return { date: toDateOnly(new Date()), time: null };
  }

  if (normalizedText === 'tomorrow') {
    return { date: toDateOnly(addDays(new Date(), 1)), time: null };
  }

  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?$/);
  if (!match || !isDateOnly(match[1])) {
    return null;
  }

  if (match[2]) {
    const [hour, minute] = match[2].split(':').map((item) => Number.parseInt(item, 10));
    if (hour > 23 || minute > 59) {
      return null;
    }
  }

  return {
    date: match[1],
    time: match[2] ?? null,
  };
}

function reminderPrompt(nextStep: FollowUpNextStep): string {
  switch (nextStep) {
    case 'Follow up later':
      return 'When should we follow up?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM.';
    case 'Schedule meeting':
      return 'When is the meeting or meeting follow-up?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM.';
    case 'Schedule onboarding':
      return 'When is the onboarding or next onboarding action?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM.';
    case 'Send information/deck':
      return 'When should we send the information/deck or follow up?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM, or send skip.';
    case 'No next action':
      return '';
  }
}

function reminderAction(nextStep: FollowUpNextStep): string {
  switch (nextStep) {
    case 'Follow up later':
      return 'Follow up later';
    case 'Schedule meeting':
      return 'Schedule meeting';
    case 'Schedule onboarding':
      return 'Schedule onboarding';
    case 'Send information/deck':
      return 'Send information/deck';
    case 'No next action':
      return 'No next action';
  }
}

async function askCompanyQuery(ctx: Context): Promise<void> {
  setState(ctx, { step: 'company_query' });
  await ctx.reply('Follow-Up Logging\n\nWhich company is this for?\n\nSend the Report Card ID or company name.');
}

async function askResult(ctx: Context, state: FollowUpLoggingState): Promise<void> {
  state.step = 'result';
  setState(ctx, state);
  await ctx.reply('What was the follow-up result?', buildResultKeyboard());
}

async function askNotes(ctx: Context, state: FollowUpLoggingState): Promise<void> {
  state.step = 'notes';
  setState(ctx, state);
  await ctx.reply('Add follow-up notes.\n\nYou can send skip.');
}

async function askNextStep(ctx: Context, state: FollowUpLoggingState): Promise<void> {
  state.step = 'next_step';
  setState(ctx, state);
  await ctx.reply('What is the next step?', buildNextStepKeyboard());
}

async function askNextActionDateTime(ctx: Context, state: FollowUpLoggingState): Promise<void> {
  if (!state.nextStep) {
    await ctx.reply('Next step is missing. Please start again.');
    clearState(ctx);
    return;
  }

  state.step = 'next_action_datetime';
  setState(ctx, state);
  await ctx.reply(reminderPrompt(state.nextStep));
}

function buildPreviewMessage(state: FollowUpLoggingState): string {
  return [
    'Follow-Up Preview',
    '',
    `Company: ${valueOrFallback(state.company?.company_name)}`,
    `Report Card ID: ${valueOrFallback(state.company?.company_code)}`,
    `Main contact: ${valueOrFallback(state.mainContact?.contact_name)}`,
    `Result: ${valueOrFallback(state.result)}`,
    `Notes: ${valueOrFallback(state.note)}`,
    `Next step: ${valueOrFallback(state.nextStep)}`,
    `Next action date: ${valueOrFallback(state.nextActionDate)}`,
    `Next action time: ${valueOrFallback(state.nextActionTime)}`,
    `Reminder: ${state.nextStep && state.nextStep !== 'No next action' && state.nextActionDate ? 'Will create or update' : 'Not created'}`,
  ].join('\n');
}

async function showPreview(ctx: Context, state: FollowUpLoggingState): Promise<void> {
  state.step = 'preview';
  setState(ctx, state);
  await ctx.reply(
    buildPreviewMessage(state),
    Markup.inlineKeyboard([
      [Markup.button.callback('Confirm', 'follow_up:confirm')],
      [Markup.button.callback('Edit', 'follow_up:edit')],
      [Markup.button.callback('Cancel', 'follow_up:cancel')],
    ])
  );
}

async function findCompanies(query: string): Promise<CompanyRow[]> {
  const exactCompany = await getCompanyByCode(query);
  if (exactCompany) {
    return [exactCompany];
  }

  return findCompaniesByName(query);
}

export async function startFollowUpLoggingForCompany(
  ctx: Context,
  company: CompanyRow,
  options?: { completingReminderId?: string | null }
): Promise<void> {
  const state: FollowUpLoggingState = {
    step: 'result',
    company,
    mainContact: await getMainContactForCompany(company.id),
    completingReminderId: options?.completingReminderId ?? null,
  };
  await askResult(ctx, state);
}

async function setCompany(ctx: Context, state: FollowUpLoggingState, company: CompanyRow): Promise<void> {
  state.company = company;
  state.mainContact = await getMainContactForCompany(company.id);
  await askResult(ctx, state);
}

async function showCompanyChoices(ctx: Context, state: FollowUpLoggingState, companies: CompanyRow[]): Promise<void> {
  const choices = companies.slice(0, MAX_COMPANY_CHOICES);
  state.step = 'company_choice';
  state.companyIds = choices.map((company) => company.id);
  setState(ctx, state);

  await ctx.reply(
    [
      'Multiple companies found. Reply with the number to choose:',
      '',
      ...choices.map((company, index) => `${index + 1}. ${company.company_name} - ${valueOrFallback(company.company_code)}`),
    ].join('\n')
  );
}

async function saveFollowUp(ctx: Context, state: FollowUpLoggingState): Promise<void> {
  if (!state.company || !state.result || !state.nextStep) {
    throw new Error('Follow-up is missing required fields.');
  }

  const completedReminderId = state.completingReminderId ?? null;

  await createFollowUp({
    company_id: state.company.id,
    contact_id: state.mainContact?.id ?? null,
    reminder_id: completedReminderId,
    follow_up_date: toDateOnly(new Date()),
    follow_up_result: state.result,
    next_step: state.nextStep,
    next_action_date: state.nextActionDate ?? null,
    current_pipeline_status: state.company.client_pipeline_status,
    follow_up_note: state.note ?? null,
    created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
  });

  if (completedReminderId) {
    await completeReminder(completedReminderId);
  }

  let nextReminderId: string | null = null;
  if (state.nextStep !== 'No next action' && state.nextActionDate) {
    const reminder = await createOrUpdateCompanyReminder({
      company_id: state.company.id,
      contact_id: state.mainContact?.id ?? null,
      reminder_type: 'follow_up',
      action: reminderAction(state.nextStep),
      due_date: state.nextActionDate,
      due_time: state.nextActionTime ?? null,
      created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
      exclude_reminder_id: completedReminderId,
    });
    nextReminderId = reminder.id;
  }

  await ctx.reply(
    [
      'Follow-up saved.',
      '',
      `Company: ${state.company.company_name}`,
      `Report Card ID: ${valueOrFallback(state.company.company_code)}`,
      `Result: ${state.result}`,
      `Next step: ${state.nextStep}`,
      completedReminderId ? 'Completed reminder: Done' : null,
      `New reminder: ${nextReminderId ? 'Created or updated' : 'Not created'}`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n')
  );
}

export function registerFollowUpLoggingWorkflow(bot: Telegraf): void {
  bot.command('log', async (ctx) => {
    const reportCardId = ctx.message.text.replace(/^\/log(?:@\w+)?\s*/i, '').trim();
    if (!reportCardId) {
      await ctx.reply('Usage:\n/log RC-26-0002');
      return;
    }

    const company = await getCompanyByCode(reportCardId);
    if (!company) {
      await ctx.reply('No company found for that Report Card ID. Please check it and try again.');
      return;
    }

    await startFollowUpLoggingForCompany(ctx, company);
  });

  bot.action('cc:follow_ups', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await askCompanyQuery(ctx);
  });

  bot.action(/^follow_up:result:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const result = mapResult((ctx.match as RegExpMatchArray | undefined)?.[1] ?? '');
    if (!state || !result) {
      await ctx.reply('Could not record the follow-up result. Please start again.');
      clearState(ctx);
      return;
    }

    state.result = result;
    await askNotes(ctx, state);
  });

  bot.action(/^follow_up:next:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const nextStep = mapNextStep((ctx.match as RegExpMatchArray | undefined)?.[1] ?? '');
    if (!state || !nextStep) {
      await ctx.reply('Could not record the next step. Please start again.');
      clearState(ctx);
      return;
    }

    state.nextStep = nextStep;
    state.nextActionDate = null;
    state.nextActionTime = null;
    if (nextStep === 'No next action') {
      await showPreview(ctx, state);
      return;
    }

    await askNextActionDateTime(ctx, state);
  });

  bot.action('follow_up:confirm', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state) {
      await ctx.reply('This follow-up draft expired. Please start again.');
      return;
    }

    try {
      await saveFollowUp(ctx, state);
      clearState(ctx);
    } catch (error) {
      clearState(ctx);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await ctx.reply(`Could not save the follow-up.\n\n${message}`);
    }
  });

  bot.action('follow_up:edit', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await askCompanyQuery(ctx);
  });

  bot.action('follow_up:cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Follow-up logging cancelled.');
  });
}

export async function handleFollowUpLoggingText(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return false;
  }

  const state = getState(ctx);
  if (!state) {
    return false;
  }

  const rawText = message.text.trim();
  if (rawText.startsWith('/')) {
    return false;
  }

  if (state.step === 'company_query') {
    const query = normalizeOptionalText(rawText);
    if (!query) {
      await ctx.reply('Please send a Report Card ID or company name.');
      return true;
    }

    const companies = await findCompanies(query);
    if (companies.length === 0) {
      await ctx.reply('No company found. Please check the Report Card ID or company name.');
      return true;
    }

    if (companies.length === 1) {
      await setCompany(ctx, state, companies[0]);
      return true;
    }

    await showCompanyChoices(ctx, state, companies);
    return true;
  }

  if (state.step === 'company_choice') {
    const choice = Number.parseInt(rawText, 10);
    if (!Number.isInteger(choice) || !state.companyIds || choice < 1 || choice > state.companyIds.length) {
      await ctx.reply('Please reply with one of the listed numbers.');
      return true;
    }

    const company = await getCompanyById(state.companyIds[choice - 1]);
    if (!company) {
      await ctx.reply('That company is no longer available. Please search again.');
      await askCompanyQuery(ctx);
      return true;
    }

    await setCompany(ctx, state, company);
    return true;
  }

  if (state.step === 'notes') {
    state.note = normalizeOptionalText(rawText);
    await askNextStep(ctx, state);
    return true;
  }

  if (state.step === 'next_action_datetime') {
    const text = normalizeOptionalText(rawText);
    if (!text && state.nextStep === 'Send information/deck') {
      state.nextActionDate = null;
      state.nextActionTime = null;
      await showPreview(ctx, state);
      return true;
    }

    if (!text) {
      await ctx.reply('Please enter a date as YYYY-MM-DD or YYYY-MM-DD HH:MM.');
      return true;
    }

    const parsed = parseDateTime(text);
    if (!parsed) {
      await ctx.reply('Please enter a valid date/time as YYYY-MM-DD or YYYY-MM-DD HH:MM.');
      return true;
    }

    state.nextActionDate = parsed.date;
    state.nextActionTime = parsed.time;
    await showPreview(ctx, state);
    return true;
  }

  if (state.step === 'preview') {
    await ctx.reply('Please use the Confirm, Edit, or Cancel buttons.');
    return true;
  }

  return false;
}

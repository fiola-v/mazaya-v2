import { Context, Markup, Telegraf } from 'telegraf';
import { getSessionKey } from '../../bot/session';
import { isDateOnly, toDateOnly } from '../../utils/dates';
import {
  CompanyRow,
  CompanyContactRow,
  FollowUpNextStep,
  InterestLevel,
  NextStep,
  VisitStatus,
} from '../../types/mazaya';
import { findCompaniesByName, getCompanyByCode, getCompanyById, updateCompanyCurrentState } from '../companies/companyService';
import { getMainContactForCompany } from '../contacts/contactService';
import { createFieldVisit } from './fieldVisitService';
import { createReminder } from '../reminders/reminderService';
import { clearCompanyLookupState } from '../companies/companyLookupWorkflow';

type RevisitStep =
  | 'company_query'
  | 'company_choice'
  | 'visit_status'
  | 'interest_level'
  | 'visit_note'
  | 'next_step'
  | 'next_action_datetime'
  | 'preview';

interface RevisitState {
  step: RevisitStep;
  companyIds?: string[];
  company?: CompanyRow;
  mainContact?: CompanyContactRow | null;
  visitStatus?: VisitStatus;
  interestLevel?: InterestLevel;
  visitNote?: string | null;
  nextStep?: FollowUpNextStep;
  nextActionDate?: string | null;
  nextActionTime?: string | null;
}

const sessions = new Map<string, RevisitState>();
const MAX_COMPANY_CHOICES = 10;

function getWorkflowKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

function getState(ctx: Context): RevisitState | undefined {
  return sessions.get(getWorkflowKey(ctx));
}

function setState(ctx: Context, state: RevisitState): void {
  sessions.set(getWorkflowKey(ctx), state);
}

function clearState(ctx: Context): void {
  sessions.delete(getWorkflowKey(ctx));
}

function valueOrFallback(value: string | null | undefined): string {
  return value || 'Not captured';
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  if (!text || text.toLowerCase() === 'skip') {
    return null;
  }

  return text;
}

function buildVisitStatusKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Visited', 'revisit:visit_status:visited')],
    [Markup.button.callback('Closed Wrong Location', 'revisit:visit_status:closed_wrong_location')],
    [Markup.button.callback('Moved', 'revisit:visit_status:moved')],
    [Markup.button.callback('Not Headquarter', 'revisit:visit_status:not_headquarter')],
    [Markup.button.callback('Office Is Empty', 'revisit:visit_status:office_is_empty')],
  ]);
}

function buildInterestLevelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Interested', 'revisit:interest:interested')],
    [Markup.button.callback('Neutral', 'revisit:interest:neutral')],
    [Markup.button.callback('Unclear', 'revisit:interest:unclear')],
    [Markup.button.callback('Not Interested', 'revisit:interest:not_interested')],
  ]);
}

function buildNextStepKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Follow up later', 'revisit:next:follow_up_later')],
    [Markup.button.callback('Schedule meeting', 'revisit:next:schedule_meeting')],
    [Markup.button.callback('Schedule onboarding', 'revisit:next:schedule_onboarding')],
    [Markup.button.callback('Send information/deck', 'revisit:next:send_information_deck')],
    [Markup.button.callback('No next action', 'revisit:next:no_next_action')],
  ]);
}

function mapVisitStatus(action: string): VisitStatus | null {
  switch (action) {
    case 'visited':
      return 'Visited';
    case 'closed_wrong_location':
      return 'Closed Wrong Location';
    case 'moved':
      return 'Moved';
    case 'not_headquarter':
      return 'Not Headquarter';
    case 'office_is_empty':
      return 'Office Is Empty';
    default:
      return null;
  }
}

function mapInterestLevel(action: string): InterestLevel | null {
  switch (action) {
    case 'interested':
      return 'Interested';
    case 'neutral':
      return 'Neutral';
    case 'unclear':
      return 'Unclear';
    case 'not_interested':
      return 'Not Interested';
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

function mapNextStepToFieldVisitStep(nextStep: FollowUpNextStep | null): NextStep | null {
  switch (nextStep) {
    case 'Follow up later':
      return 'Follow Up Later';
    case 'Schedule meeting':
      return 'Schedule Meeting';
    case 'Schedule onboarding':
      return 'Schedule Onboarding';
    case 'Send information/deck':
      return 'Send More Info';
    case 'No next action':
      return 'No Further Action';
    default:
      return null;
  }
}

function parseDateTime(value: string): { date: string; time: string | null } | null {
  const text = value.trim();
  if (text.toLowerCase() === 'today') {
    return { date: toDateOnly(new Date()), time: null };
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

  return { date: match[1], time: match[2] ?? null };
}

function reminderPrompt(nextStep: FollowUpNextStep): string {
  switch (nextStep) {
    case 'Follow up later':
      return 'When should we follow up?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM.';
    case 'Schedule meeting':
      return 'When is the meeting?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM.';
    case 'Schedule onboarding':
      return 'When is onboarding or next onboarding action?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM.';
    case 'Send information/deck':
      return 'When should we send information/deck or follow up?\n\nType YYYY-MM-DD or YYYY-MM-DD HH:MM, or send skip.';
    case 'No next action':
      return '';
  }
}

function buildPreviewMessage(state: RevisitState): string {
  return [
    'Existing Company Revisit Preview',
    '',
    `Company: ${valueOrFallback(state.company?.company_name)}`,
    `Report Card ID: ${valueOrFallback(state.company?.company_code)}`,
    `Main contact: ${valueOrFallback(state.mainContact?.contact_name)}`,
    `Visit status: ${valueOrFallback(state.visitStatus)}`,
    `Interest level: ${valueOrFallback(state.interestLevel)}`,
    `Visit notes: ${valueOrFallback(state.visitNote)}`,
    `Next step: ${valueOrFallback(state.nextStep)}`,
    `Next action date: ${valueOrFallback(state.nextActionDate)}`,
    `Next action time: ${valueOrFallback(state.nextActionTime)}`,
    `Reminder: ${state.nextStep && state.nextStep !== 'No next action' && state.nextActionDate ? 'Will create' : 'Not created'}`,
  ].join('\n');
}

async function askCompanyQuery(ctx: Context): Promise<void> {
  clearCompanyLookupState(ctx);
  setState(ctx, { step: 'company_query' });
  await ctx.reply('Existing Company Revisit\n\nType company name or Report Card ID.');
}

async function findCompanies(query: string): Promise<CompanyRow[]> {
  const exactCompany = await getCompanyByCode(query);
  if (exactCompany) {
    return [exactCompany];
  }

  return findCompaniesByName(query);
}

async function showCompanyFound(ctx: Context, company: CompanyRow, mainContact: CompanyContactRow | null): Promise<void> {
  await ctx.reply(
    [
      'Company found:',
      '',
      `Company name: ${company.company_name}`,
      `Report Card ID: ${valueOrFallback(company.company_code)}`,
      `Main contact: ${valueOrFallback(mainContact?.contact_name)}`,
    ].join('\n')
  );
}

async function askVisitStatus(ctx: Context, state: RevisitState): Promise<void> {
  state.step = 'visit_status';
  setState(ctx, state);
  await ctx.reply('Visit status?', buildVisitStatusKeyboard());
}

async function askInterestLevel(ctx: Context, state: RevisitState): Promise<void> {
  state.step = 'interest_level';
  setState(ctx, state);
  await ctx.reply('Interest level?', buildInterestLevelKeyboard());
}

async function askVisitNotes(ctx: Context, state: RevisitState): Promise<void> {
  state.step = 'visit_note';
  setState(ctx, state);
  await ctx.reply('Add visit notes.\n\nYou can send skip.');
}

async function askNextStep(ctx: Context, state: RevisitState): Promise<void> {
  state.step = 'next_step';
  setState(ctx, state);
  await ctx.reply('What is the next step?', buildNextStepKeyboard());
}

async function askNextActionDateTime(ctx: Context, state: RevisitState): Promise<void> {
  if (!state.nextStep) {
    await ctx.reply('Next step is missing. Please start again.');
    clearState(ctx);
    return;
  }

  state.step = 'next_action_datetime';
  setState(ctx, state);
  await ctx.reply(reminderPrompt(state.nextStep));
}

async function showPreview(ctx: Context, state: RevisitState): Promise<void> {
  state.step = 'preview';
  setState(ctx, state);
  await ctx.reply(
    buildPreviewMessage(state),
    Markup.inlineKeyboard([
      [Markup.button.callback('Confirm', 'revisit:confirm')],
      [Markup.button.callback('Cancel', 'revisit:cancel')],
    ])
  );
}

async function startRevisitForCompany(ctx: Context, company: CompanyRow): Promise<void> {
  const mainContact = await getMainContactForCompany(company.id);
  const state: RevisitState = {
    step: 'visit_status',
    company,
    mainContact,
  };
  setState(ctx, state);
  await showCompanyFound(ctx, company, mainContact);
  await askVisitStatus(ctx, state);
}

function validateRequiredForSave(state: RevisitState): string | null {
  if (!state.company || !state.visitStatus || !state.interestLevel || !state.nextStep) {
    return 'Revisit is missing required fields.';
  }

  if (
    state.nextStep !== 'No next action' &&
    state.nextStep !== 'Send information/deck' &&
    !state.nextActionDate
  ) {
    return 'Next step requires a date/time.';
  }

  return null;
}

async function saveRevisit(ctx: Context, state: RevisitState): Promise<void> {
  const validationError = validateRequiredForSave(state);
  if (validationError) {
    throw new Error(validationError);
  }

  const company = state.company as CompanyRow;
  await createFieldVisit({
    company_id: company.id,
    contact_id: state.mainContact?.id ?? null,
    visit_date: toDateOnly(new Date()),
    decision_maker_status: null,
    visit_status: state.visitStatus ?? null,
    interest_level: state.interestLevel ?? null,
    next_step: mapNextStepToFieldVisitStep(state.nextStep ?? null),
    next_action_date: state.nextActionDate ?? null,
    visit_note: state.visitNote ?? null,
    created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
  });

  await updateCompanyCurrentState(company.id, {
    visit_status: state.visitStatus ?? null,
    interest_level: state.interestLevel ?? null,
    latest_human_note: state.visitNote ?? null,
    current_next_action: state.nextStep === 'No next action' ? null : state.nextStep ?? null,
    next_action_date: state.nextActionDate ?? null,
  });

  let reminderResult = 'Not created';
  if (state.nextStep && state.nextStep !== 'No next action' && state.nextActionDate) {
    await createReminder({
      company_id: company.id,
      contact_id: state.mainContact?.id ?? null,
      reminder_type: 'follow_up',
      action: state.nextStep,
      due_date: state.nextActionDate,
      due_time: state.nextActionTime ?? null,
      created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
    });
    reminderResult = 'Created';
  }

  await ctx.reply(
    [
      'Existing company revisit saved.',
      '',
      `Company: ${company.company_name}`,
      `Report Card ID: ${valueOrFallback(company.company_code)}`,
      `Reminder: ${reminderResult}`,
    ].join('\n')
  );
}

export async function startExistingCompanyRevisitFromMenu(ctx: Context): Promise<void> {
  clearCompanyLookupState(ctx);
  await askCompanyQuery(ctx);
}

export function registerExistingCompanyRevisitWorkflow(bot: Telegraf): void {
  bot.command('revisit', async (ctx) => {
    clearCompanyLookupState(ctx);
    const reportCardId = ctx.message.text.replace(/^\/revisit(?:@\w+)?\s*/i, '').trim();
    if (!reportCardId) {
      await ctx.reply('Usage:\n/revisit RC-26-0002');
      return;
    }

    const company = await getCompanyByCode(reportCardId);
    if (!company) {
      await ctx.reply('No company found for that Report Card ID. Please check it and try again.');
      return;
    }

    await startRevisitForCompany(ctx, company);
  });

  bot.action(/^revisit:visit_status:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const visitStatus = mapVisitStatus((ctx.match as RegExpMatchArray | undefined)?.[1] ?? '');
    if (!state || !visitStatus) {
      await ctx.reply('Could not record visit status. Please start again.');
      clearState(ctx);
      return;
    }

    state.visitStatus = visitStatus;
    await askInterestLevel(ctx, state);
  });

  bot.action(/^revisit:interest:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const interestLevel = mapInterestLevel((ctx.match as RegExpMatchArray | undefined)?.[1] ?? '');
    if (!state || !interestLevel) {
      await ctx.reply('Could not record interest level. Please start again.');
      clearState(ctx);
      return;
    }

    state.interestLevel = interestLevel;
    await askVisitNotes(ctx, state);
  });

  bot.action(/^revisit:next:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const nextStep = mapNextStep((ctx.match as RegExpMatchArray | undefined)?.[1] ?? '');
    if (!state || !nextStep) {
      await ctx.reply('Could not record next step. Please start again.');
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

  bot.action('revisit:confirm', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state) {
      await ctx.reply('This revisit draft expired. Please start again.');
      return;
    }

    try {
      await saveRevisit(ctx, state);
      clearState(ctx);
    } catch (error) {
      clearState(ctx);
      const message = error instanceof Error ? error.message : 'Unknown error';
      await ctx.reply(`Could not save the revisit.\n\n${message}`);
    }
  });

  bot.action('revisit:cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Existing company revisit cancelled.');
  });
}

export async function handleExistingCompanyRevisitText(ctx: Context): Promise<boolean> {
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
      await startRevisitForCompany(ctx, companies[0]);
      return true;
    }

    state.step = 'company_choice';
    state.companyIds = companies.slice(0, MAX_COMPANY_CHOICES).map((company) => company.id);
    setState(ctx, state);
    const lines = companies.slice(0, MAX_COMPANY_CHOICES).map(
      (company, index) => `${index + 1}. ${company.company_name} - ${valueOrFallback(company.company_code)}`
    );
    await ctx.reply(['Multiple companies found. Reply with the number to choose:', '', ...lines].join('\n'));
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

    await startRevisitForCompany(ctx, company);
    return true;
  }

  if (state.step === 'visit_note') {
    state.visitNote = normalizeOptionalText(rawText);
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
    await ctx.reply('Please use Confirm or Cancel.');
    return true;
  }

  return false;
}

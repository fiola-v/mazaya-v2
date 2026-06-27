import { Context, Markup, Telegraf } from 'telegraf';
import { getSessionKey, clearSession } from '../../bot/session';
import { showCommandCenter } from '../../bot/commandCenter';
import { addDays, isDateOnly, toDateOnly } from '../../utils/dates';
import { buildWhatsAppLink, digitsOnly } from '../../utils/phone';
import { createCompanyWithReportCardId, generateNextReportCardId } from '../companies/companyService';
import { createCompanyContact, setMainContact } from '../contacts/contactService';
import { createFieldVisit } from './fieldVisitService';
import { startExistingCompanyRevisitFromMenu } from './existingCompanyRevisitWorkflow';
import { createReminder } from '../reminders/reminderService';
import { queueReportSync } from '../reports/reportQueueService';
import { logActivity } from '../activity/activityLogService';
import {
  DecisionMakerStatus,
  InterestLevel,
  NextStep,
  VisitStatus,
} from '../../types/mazaya';

type VisitStep =
  | 'company_name'
  | 'industry'
  | 'contact_name'
  | 'contact_role'
  | 'phone'
  | 'whatsapp_mode'
  | 'whatsapp_value'
  | 'email'
  | 'visit_status'
  | 'decision_maker_status'
  | 'interest_level'
  | 'blocker'
  | 'info_sent'
  | 'next_action'
  | 'next_action_date'
  | 'next_action_date_custom'
  | 'visit_note'
  | 'preview'
  | 'awaiting_sync_choice';

type WhitespaceText = string;

interface NewCompanyVisitState {
  step: VisitStep;
  status?: 'open' | 'saved';
  companyName?: string;
  companyCode?: string;
  industry?: string | null;
  contactName?: string;
  contactRole?: string | null;
  phone?: string;
  whatsapp?: string | null;
  email?: string | null;
  visitStatus?: VisitStatus;
  decisionMakerStatus?: DecisionMakerStatus;
  interestLevel?: InterestLevel;
  blocker?: string | null;
  infoSent?: boolean;
  nextAction?: NextStep | null;
  nextActionDate?: string | null;
  visitNote?: string | null;
  saved?: {
    companyId: string;
    contactId: string;
    fieldVisitId: string;
    reminderId?: string;
    reportQueueIds: string[];
  };
}

const sessions = new Map<string, NewCompanyVisitState>();

function getWorkflowKey(ctx: Context): string {
  return getSessionKey(ctx.chat?.id ?? 'unknown-chat', ctx.from?.id ?? 'unknown-user');
}

function getState(ctx: Context): NewCompanyVisitState | undefined {
  return sessions.get(getWorkflowKey(ctx));
}

function setState(ctx: Context, state: NewCompanyVisitState): void {
  sessions.set(getWorkflowKey(ctx), state);
}

function clearState(ctx: Context): void {
  sessions.delete(getWorkflowKey(ctx));
}

function isSavedState(state?: NewCompanyVisitState): state is NewCompanyVisitState & { status: 'saved'; saved: NonNullable<NewCompanyVisitState['saved']> } {
  return Boolean(state && state.status === 'saved' && state.saved);
}

function normalizeOptionalText(value: string): string | null {
  const text = value.trim();
  if (!text || text.toLowerCase() === 'skip') {
    return null;
  }

  return text;
}

function normalizeRequiredText(value: string): string | null {
  const text = value.trim();
  if (!text || text.toLowerCase() === 'skip') {
    return null;
  }

  return text;
}

function buildMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('New Company Visit', 'field_visit:new'),
      Markup.button.callback('Existing Company Revisit', 'field_visit:revisit_existing'),
    ],
    [Markup.button.callback('Back to Command Center', 'field_visit:back')],
  ]);
}

function buildVisitStatusKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Visited', 'field_visit:new:visit_status:visited')],
    [Markup.button.callback('Closed Wrong Location', 'field_visit:new:visit_status:closed_wrong_location')],
    [Markup.button.callback('Moved', 'field_visit:new:visit_status:moved')],
    [Markup.button.callback('Not Headquarter', 'field_visit:new:visit_status:not_headquarter')],
    [Markup.button.callback('Office Is Empty', 'field_visit:new:visit_status:office_is_empty')],
  ]);
}

function buildDecisionMakerKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Decision Maker', 'field_visit:new:decision_maker:decision_maker')],
    [Markup.button.callback('Not Decision Maker', 'field_visit:new:decision_maker:not_decision_maker')],
    [Markup.button.callback('Influencer', 'field_visit:new:decision_maker:influencer')],
    [Markup.button.callback('Unknown', 'field_visit:new:decision_maker:unknown')],
  ]);
}

function buildInterestLevelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Interested', 'field_visit:new:interest:interested')],
    [Markup.button.callback('Neutral', 'field_visit:new:interest:neutral')],
    [Markup.button.callback('Unclear', 'field_visit:new:interest:unclear')],
    [Markup.button.callback('Not Interested', 'field_visit:new:interest:not_interested')],
  ]);
}

function buildInfoSentKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Yes', 'field_visit:new:info_sent:yes')],
    [Markup.button.callback('No', 'field_visit:new:info_sent:no')],
  ]);
}

function buildNextActionKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Call', 'field_visit:new:next_action:call')],
    [Markup.button.callback('Send More Info', 'field_visit:new:next_action:send_more_info')],
    [Markup.button.callback('Schedule Meeting', 'field_visit:new:next_action:schedule_meeting')],
    [Markup.button.callback('Schedule Onboarding', 'field_visit:new:next_action:schedule_onboarding')],
    [Markup.button.callback('Wait for Client Reply', 'field_visit:new:next_action:wait_for_client_reply')],
    [Markup.button.callback('Follow Up Later', 'field_visit:new:next_action:follow_up_later')],
    [Markup.button.callback('No Further Action', 'field_visit:new:next_action:no_further_action')],
  ]);
}

function buildDateKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Today', 'field_visit:new:date:today')],
    [Markup.button.callback('Tomorrow', 'field_visit:new:date:tomorrow')],
    [Markup.button.callback('Next Week', 'field_visit:new:date:next_week')],
    [Markup.button.callback('Custom Date', 'field_visit:new:date:custom_date')],
    [Markup.button.callback('No Date', 'field_visit:new:date:no_date')],
  ]);
}

function buildPreviewMessage(state: NewCompanyVisitState): string {
  const infoSent = state.infoSent === true ? 'Yes' : 'No';

  return [
    'New Company Visit Preview',
    '',
    `Company name: ${state.companyName || 'Not captured'}`,
    `Report Card ID: ${state.companyCode || 'Not captured'}`,
    `Industry: ${state.industry || 'Not captured'}`,
    `Contact name: ${state.contactName || 'Not captured'}`,
    `Contact role: ${state.contactRole || 'Not captured'}`,
    `Phone: ${state.phone || 'Not captured'}`,
    `WhatsApp: ${state.whatsapp || 'Not captured'}`,
    `Email: ${state.email || 'Not captured'}`,
    `Visit status: ${state.visitStatus || 'Not captured'}`,
    `Decision maker status: ${state.decisionMakerStatus || 'Not captured'}`,
    `Interest level: ${state.interestLevel || 'Not captured'}`,
    `Blocker: ${state.blocker || 'Not captured'}`,
    `Info sent: ${infoSent}`,
    `Next action: ${state.nextAction || 'Not captured'}`,
    `Next action date: ${state.nextActionDate || 'Not captured'}`,
    `Visit note: ${state.visitNote || 'Not captured'}`,
  ].join('\n');
}

async function askCompanyName(ctx: Context, state?: NewCompanyVisitState) {
  setState(ctx, {
    step: 'company_name',
    ...(state ?? {}),
  });

  await ctx.reply(
    'New Company Visit\n\nWhat is the company name?'
  );
}

async function askIndustry(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'industry';
  setState(ctx, state);
  await ctx.reply('What industry is the company in?\n\nYou can type the industry name or send skip.');
}

async function askContactName(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'contact_name';
  setState(ctx, state);
  await ctx.reply('Who did you speak with?\n\nType the contact name.');
}

async function askContactRole(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'contact_role';
  setState(ctx, state);
  await ctx.reply('What is the contact role or title?\n\nYou can type skip if you do not know it.');
}

async function askPhone(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'phone';
  setState(ctx, state);
  await ctx.reply('What is the phone number?\n\nYou can type skip if needed, but the visit is better with a phone number.');
}

async function askWhatsappMode(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'whatsapp_mode';
  setState(ctx, state);

  await ctx.reply(
    'Is the WhatsApp number the same as the phone number?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Same as phone', 'field_visit:new:whatsapp_mode:same')],
      [Markup.button.callback('Enter different number', 'field_visit:new:whatsapp_mode:different')],
    ])
  );
}

async function askWhatsappValue(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'whatsapp_value';
  setState(ctx, state);
  await ctx.reply('Type the WhatsApp number now, or send skip.');
}

async function askEmail(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'email';
  setState(ctx, state);
  await ctx.reply('What is the email address?\n\nYou can send skip.');
}

async function askVisitStatus(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'visit_status';
  setState(ctx, state);
  await ctx.reply('Visit status?', buildVisitStatusKeyboard());
}

async function askDecisionMakerStatus(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'decision_maker_status';
  setState(ctx, state);
  await ctx.reply('Decision maker status?', buildDecisionMakerKeyboard());
}

async function askInterestLevel(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'interest_level';
  setState(ctx, state);
  await ctx.reply('Interest level?', buildInterestLevelKeyboard());
}

async function askBlocker(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'blocker';
  setState(ctx, state);
  await ctx.reply('What is the blocker?\n\nYou can send skip.');
}

async function askInfoSent(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'info_sent';
  setState(ctx, state);
  await ctx.reply('Was the deck or info sent?', buildInfoSentKeyboard());
}

async function askNextAction(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'next_action';
  setState(ctx, state);
  await ctx.reply('What is the next action?', buildNextActionKeyboard());
}

async function askNextActionDate(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'next_action_date';
  setState(ctx, state);
  await ctx.reply('When should this action happen, if needed?', buildDateKeyboard());
}

async function askCustomDate(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'next_action_date_custom';
  setState(ctx, state);
  await ctx.reply('Type the custom date in YYYY-MM-DD format, or send skip.');
}

async function askVisitNote(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'visit_note';
  setState(ctx, state);
  await ctx.reply('Type the visit note now, or send skip to leave it blank.');
}

async function showPreview(ctx: Context, state: NewCompanyVisitState) {
  if (!state.companyCode) {
    state.companyCode = await generateNextReportCardId();
  }

  state.step = 'preview';
  setState(ctx, state);

  await ctx.reply(
    buildPreviewMessage(state),
    Markup.inlineKeyboard([
      [Markup.button.callback('Confirm', 'field_visit:new:confirm')],
      [Markup.button.callback('Edit', 'field_visit:new:edit')],
      [Markup.button.callback('Cancel', 'field_visit:new:cancel')],
    ])
  );
}

async function stripPreviewButtons(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [],
    });
  } catch {
    // Best effort only.
  }
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

function mapDecisionMakerStatus(action: string): DecisionMakerStatus | null {
  switch (action) {
    case 'decision_maker':
      return 'Decision Maker';
    case 'not_decision_maker':
      return 'Not Decision Maker';
    case 'influencer':
      return 'Influencer';
    case 'unknown':
      return 'Unknown';
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

function mapInfoSent(action: string): boolean | null {
  switch (action) {
    case 'yes':
      return true;
    case 'no':
      return false;
    default:
      return null;
  }
}

function mapNextAction(action: string): NextStep | null {
  switch (action) {
    case 'call':
      return 'Call';
    case 'send_more_info':
      return 'Send More Info';
    case 'schedule_meeting':
      return 'Schedule Meeting';
    case 'schedule_onboarding':
      return 'Schedule Onboarding';
    case 'wait_for_client_reply':
      return 'Wait for Client Reply';
    case 'follow_up_later':
      return 'Follow Up Later';
    case 'no_further_action':
      return 'No Further Action';
    default:
      return null;
  }
}

function buildNextActionDate(choice: 'today' | 'tomorrow' | 'next_week' | 'custom_date' | 'no_date', customDate?: string | null): string | null {
  switch (choice) {
    case 'today':
      return toDateOnly(new Date());
    case 'tomorrow':
      return toDateOnly(addDays(new Date(), 1));
    case 'next_week':
      return toDateOnly(addDays(new Date(), 7));
    case 'custom_date':
      return customDate && isDateOnly(customDate) ? customDate : null;
    case 'no_date':
      return null;
    default:
      return null;
  }
}

async function saveNewCompanyVisit(ctx: Context, state: NewCompanyVisitState) {
  if (
    !state.companyName ||
    !state.companyCode ||
    !state.contactName ||
    !state.visitStatus ||
    !state.decisionMakerStatus ||
    state.infoSent === undefined
  ) {
    throw new Error('New Company Visit is missing required fields.');
  }

  const company = await createCompanyWithReportCardId({
    company_code: state.companyCode,
    company_name: state.companyName,
    industry: state.industry ?? undefined,
    visit_status: state.visitStatus,
    interest_level: state.interestLevel,
    current_blocker: state.blocker ?? undefined,
    latest_human_note: state.visitNote ?? undefined,
    current_next_action: state.nextAction ?? undefined,
    next_action_date: state.nextActionDate ?? undefined,
  });

  const contact = await createCompanyContact({
    company_id: company.id,
    contact_name: state.contactName,
    role_title: state.contactRole ?? undefined,
    phone: state.phone ?? null,
    whatsapp: state.whatsapp ?? (state.phone ? buildWhatsAppLink(state.phone) : null),
    email: state.email ?? null,
    decision_maker_status: state.decisionMakerStatus,
    is_main_contact: true,
    notes: null,
  });

  await setMainContact(company.id, contact.id);
  state.companyCode = company.company_code ?? state.companyCode;

  const fieldVisit = await createFieldVisit({
    company_id: company.id,
    contact_id: contact.id,
    visit_date: toDateOnly(new Date()),
    decision_maker_status: state.decisionMakerStatus,
    visit_status: state.visitStatus,
    interest_level: state.interestLevel,
    blocker: state.blocker ?? null,
    info_sent: state.infoSent,
    next_step: (state.nextAction as NextStep | undefined) ?? null,
    next_action_date: state.nextActionDate ?? null,
    visit_note: state.visitNote ?? null,
    created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
  });

  let reminderId: string | undefined;
  if (state.nextAction && state.nextAction !== 'No Further Action' && state.nextActionDate) {
    const reminder = await createReminder({
      company_id: company.id,
      contact_id: contact.id,
      reminder_type: 'follow_up',
      action: state.nextAction,
      due_date: state.nextActionDate,
      created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
    });
    reminderId = reminder.id;
  }

  const reportQueueIds: string[] = [];
  const companyQueue = await queueReportSync({
    entity_type: 'company',
    entity_id: company.id,
    change_type: 'created',
  });
  reportQueueIds.push(companyQueue.id);

  const fieldVisitQueue = await queueReportSync({
    entity_type: 'field_visit',
    entity_id: fieldVisit.id,
    change_type: 'created',
  });
  reportQueueIds.push(fieldVisitQueue.id);

  if (reminderId) {
    const reminderQueue = await queueReportSync({
      entity_type: 'reminder',
      entity_id: reminderId,
      change_type: 'created',
    });
    reportQueueIds.push(reminderQueue.id);
  }

  await logActivity({
    company_id: company.id,
    contact_id: contact.id,
    entity_type: 'field_visit',
    entity_id: fieldVisit.id,
    activity_type: 'new_company_visit',
    summary: `New company visit saved for ${company.company_name}`,
    details: {
      companyId: company.id,
      contactId: contact.id,
      fieldVisitId: fieldVisit.id,
      reminderId: reminderId ?? null,
      reportQueueIds,
    },
    source: 'telegram',
    source_room: 'Field Visits',
    created_by: ctx.from?.username || ctx.from?.id?.toString() || null,
  });

  return {
    companyId: company.id,
    contactId: contact.id,
    fieldVisitId: fieldVisit.id,
    reminderId,
    reportQueueIds,
  };
}

async function showPostSaveSyncPrompt(ctx: Context, state: NewCompanyVisitState) {
  state.step = 'awaiting_sync_choice';
  state.status = 'saved';
  setState(ctx, state);

  await ctx.reply(
    'Google Sheets sync will be enabled in the reporting phase. This item is queued for reporting.',
    Markup.inlineKeyboard([
      [Markup.button.callback('Sync Now', 'field_visit:new:sync_now')],
      [Markup.button.callback('Sync Later', 'field_visit:new:sync_later')],
    ])
  );
}

async function handleSavedSyncChoice(ctx: Context, choice: 'sync_now' | 'sync_later') {
  const state = getState(ctx);

  await ctx.answerCbQuery().catch(() => undefined);

  if (!isSavedState(state)) {
    clearState(ctx);
    await ctx.reply('This saved visit session is no longer available.');
    return;
  }

  const message =
    choice === 'sync_now'
      ? 'Google Sheets sync will be enabled in the reporting phase. This item is queued for reporting.'
      : 'Queued for reporting. You can sync it later from Report Room.';

  clearState(ctx);
  await ctx.reply(message);
}

async function restartFlow(ctx: Context) {
  clearState(ctx);
  await askCompanyName(ctx);
}

async function handleSaveConfirm(ctx: Context) {
  const state = getState(ctx);

  await ctx.answerCbQuery().catch(() => undefined);

  if (!state) {
    await ctx.reply('This visit draft expired. Please start again from Field Visit → New Company Visit.');
    return;
  }

  if (isSavedState(state)) {
    await stripPreviewButtons(ctx);
    await ctx.reply('This visit was already saved. Open Command Center to start a new action.');
    return;
  }

  try {
    const saved = await saveNewCompanyVisit(ctx, state);
    state.saved = saved;
    state.status = 'saved';
    setState(ctx, state);
    await stripPreviewButtons(ctx);
    await ctx.reply(
      [
        'New Company Visit saved.',
        '',
        `Company: ${state.companyName || 'Not captured'}`,
        `Report Card ID: ${state.companyCode || 'Not captured'}`,
        `Contact: ${state.contactName || 'Not captured'}`,
        `Next action: ${state.nextAction || 'Not captured'}`,
        `Next action date: ${state.nextActionDate || 'Not captured'}`,
        `Reminder: ${saved.reminderId ? 'Created' : 'Not created'}`,
      ].join('\n')
    );
    await showPostSaveSyncPrompt(ctx, state);
  } catch (error) {
    clearState(ctx);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await ctx.reply(`Could not save the New Company Visit.\n\n${message}`);
  }
}

export async function showFieldVisitMenu(ctx: Context): Promise<void> {
  await ctx.reply('Field Visits\n\nWhat do you want to do?', buildMenuKeyboard());
}

export function registerFieldVisitWorkflow(bot: Telegraf): void {
  bot.action('cc:field_visit', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showFieldVisitMenu(ctx);
  });

  bot.action('field_visit:menu', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showFieldVisitMenu(ctx);
  });

  bot.action('field_visit:new', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await askCompanyName(ctx, { step: 'company_name' });
  });

  bot.action('field_visit:revisit_existing', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await startExistingCompanyRevisitFromMenu(ctx);
  });

  bot.action('field_visit:quick_note', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Quick Field Note is coming in next phase.');
    await showFieldVisitMenu(ctx);
  });

  bot.action('field_visit:back', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    clearState(ctx);
    await ctx.reply('Back to Command Center.');
    await showCommandCenter(ctx);
  });

  bot.action('field_visit:new:edit', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (isSavedState(state)) {
      await stripPreviewButtons(ctx);
      await ctx.reply('This visit was already saved. Open Command Center to start a new action.');
      return;
    }
    await restartFlow(ctx);
  });

  bot.action('field_visit:new:cancel', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (isSavedState(state)) {
      await stripPreviewButtons(ctx);
      await ctx.reply('This visit was already saved. Open Command Center to start a new action.');
      return;
    }
    clearState(ctx);
    await ctx.reply('New Company Visit cancelled.');
    await showFieldVisitMenu(ctx);
  });

  bot.action('field_visit:new:confirm', handleSaveConfirm);

  bot.action('field_visit:new:sync_now', async (ctx) => {
    await handleSavedSyncChoice(ctx, 'sync_now');
  });

  bot.action('field_visit:new:sync_later', async (ctx) => {
    await handleSavedSyncChoice(ctx, 'sync_later');
  });

  bot.action('field_visit:new:whatsapp_mode:same', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state?.phone) {
      await ctx.reply('The phone number is missing. Please restart the visit.');
      clearState(ctx);
      return;
    }

    state.whatsapp = buildWhatsAppLink(state.phone) ?? digitsOnly(state.phone);
    await askEmail(ctx, state);
  });

  bot.action('field_visit:new:whatsapp_mode:different', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    if (!state) {
      await ctx.reply('This visit draft expired. Please start again.');
      return;
    }

    await askWhatsappValue(ctx, state);
  });

  bot.action(/^field_visit:new:visit_status:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const match = ctx.match as RegExpMatchArray | undefined;
    const action = match?.[1];
    const visitStatus = action ? mapVisitStatus(action) : null;

    if (!state || !visitStatus) {
      await ctx.reply('Could not record the visit status. Please start again.');
      return;
    }

    state.visitStatus = visitStatus;
    await askDecisionMakerStatus(ctx, state);
  });

  bot.action(/^field_visit:new:decision_maker:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const match = ctx.match as RegExpMatchArray | undefined;
    const action = match?.[1];
    const decisionMakerStatus = action ? mapDecisionMakerStatus(action) : null;

    if (!state || !decisionMakerStatus) {
      await ctx.reply('Could not record the decision maker status. Please start again.');
      return;
    }

    state.decisionMakerStatus = decisionMakerStatus;
    await askInterestLevel(ctx, state);
  });

  bot.action(/^field_visit:new:interest:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const match = ctx.match as RegExpMatchArray | undefined;
    const action = match?.[1];
    const interestLevel = action ? mapInterestLevel(action) : null;

    if (!state || !interestLevel) {
      await ctx.reply('Could not record the interest level. Please start again.');
      return;
    }

    state.interestLevel = interestLevel;
    await askBlocker(ctx, state);
  });

  bot.action(/^field_visit:new:info_sent:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const match = ctx.match as RegExpMatchArray | undefined;
    const action = match?.[1];
    const infoSent = action ? mapInfoSent(action) : null;

    if (!state || infoSent === null) {
      await ctx.reply('Could not record the info sent choice. Please start again.');
      return;
    }

    state.infoSent = infoSent;
    await askNextAction(ctx, state);
  });

  bot.action(/^field_visit:new:next_action:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const action = (ctx.match as RegExpMatchArray | undefined)?.[1];
    const nextAction = action ? mapNextAction(action) : null;

    if (!state || !nextAction) {
      await ctx.reply('Could not record the next action. Please start again.');
      return;
    }

    state.nextAction = nextAction;
    await askNextActionDate(ctx, state);
  });

  bot.action(/^field_visit:new:date:([a-z_]+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    const state = getState(ctx);
    const choice = (ctx.match as RegExpMatchArray | undefined)?.[1] as
      | 'today'
      | 'tomorrow'
      | 'next_week'
      | 'custom_date'
      | 'no_date'
      | undefined;

    if (!state || !choice) {
      await ctx.reply('Could not record the date choice. Please start again.');
      return;
    }

    if (choice === 'custom_date') {
      await askCustomDate(ctx, state);
      return;
    }

    state.nextActionDate = buildNextActionDate(choice);
    await askVisitNote(ctx, state);
  });
}

export async function handleFieldVisitText(ctx: Context): Promise<boolean> {
  const message = ctx.message;
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return false;
  }

  const rawText: WhitespaceText = message.text.trim();
  if (rawText.startsWith('/')) {
    return false;
  }

  const state = getState(ctx);
  if (!state) {
    return false;
  }

  if (state.step === 'awaiting_sync_choice') {
    await ctx.reply('Please use the Sync Now or Sync Later buttons.');
    return true;
  }

  if (state.step === 'company_name') {
    const text = normalizeRequiredText(rawText);
    if (!text) {
      await ctx.reply('Please enter a company name.');
      return true;
    }

    state.companyName = text;
    await askIndustry(ctx, state);
    return true;
  }

  if (state.step === 'industry') {
    state.industry = normalizeOptionalText(rawText);
    await askContactName(ctx, state);
    return true;
  }

  if (state.step === 'contact_name') {
    const text = normalizeRequiredText(rawText);
    if (!text) {
      await ctx.reply('Please enter a contact name.');
      return true;
    }

    state.contactName = text;
    await askContactRole(ctx, state);
    return true;
  }

  if (state.step === 'contact_role') {
    state.contactRole = normalizeOptionalText(rawText);
    await askPhone(ctx, state);
    return true;
  }

  if (state.step === 'phone') {
    const text = normalizeOptionalText(rawText);
    if (!text) {
      state.phone = undefined;
      state.whatsapp = null;
      await askEmail(ctx, state);
      return true;
    }

    state.phone = text;
    await askWhatsappMode(ctx, state);
    return true;
  }

  if (state.step === 'whatsapp_value') {
    const text = normalizeOptionalText(rawText);
    state.whatsapp = text ? buildWhatsAppLink(text) ?? text : buildWhatsAppLink(state.phone || '') ?? null;
    await askEmail(ctx, state);
    return true;
  }

  if (state.step === 'email') {
    state.email = normalizeOptionalText(rawText);
    await askVisitStatus(ctx, state);
    return true;
  }

  if (state.step === 'blocker') {
    state.blocker = normalizeOptionalText(rawText);
    await askInfoSent(ctx, state);
    return true;
  }

  if (state.step === 'next_action') {
    const normalized = normalizeOptionalText(rawText);
    if (!normalized) {
      state.nextAction = 'No Further Action';
      await askNextActionDate(ctx, state);
      return true;
    }

    const allowed = mapNextAction(
      normalized
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z_]/g, '')
    );
    if (!allowed) {
      await ctx.reply('Please choose a next action from the buttons.');
      return true;
    }

    state.nextAction = allowed;
    await askNextActionDate(ctx, state);
    return true;
  }

  if (state.step === 'next_action_date_custom') {
    const text = normalizeOptionalText(rawText);
    if (!text) {
      state.nextActionDate = null;
      await askVisitNote(ctx, state);
      return true;
    }

    if (!isDateOnly(text)) {
      await ctx.reply('Please enter a valid date in YYYY-MM-DD format.');
      return true;
    }

    state.nextActionDate = text;
    await askVisitNote(ctx, state);
    return true;
  }

  if (state.step === 'visit_note') {
    state.visitNote = normalizeOptionalText(rawText);
    await showPreview(ctx, state);
    return true;
  }

  return false;
}

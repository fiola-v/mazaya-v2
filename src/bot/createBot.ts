import { Telegraf } from 'telegraf';
import { env } from '../config/env';
import { showCommandCenter, showComingSoon } from './commandCenter';
import { getSessionKey, startCommandCenterSession } from './session';
import { CommandCenterAction } from '../types/mazaya';
import { handleFieldVisitText, registerFieldVisitWorkflow } from '../modules/fieldVisits/newCompanyVisitWorkflow';
import { handleCompanyLookupText, registerCompanyLookupWorkflow } from '../modules/companies/companyLookupWorkflow';
import { handleFollowUpLoggingText, registerFollowUpLoggingWorkflow } from '../modules/followUps/followUpLoggingWorkflow';
import { registerReminderListWorkflow } from '../modules/reminders/reminderListWorkflow';
import { registerPlaceholderRoomsWorkflow } from './placeholderRoomsWorkflow';

const commandCenterActions = new Set<CommandCenterAction>([
  'field_visit',
  'companies_database',
  'reminders',
  'tasks',
  'report_room',
  'draft_message_later',
]);

export function createBot(): Telegraf {
  const bot = new Telegraf(env.TELEGRAM_BOT_TOKEN);

  bot.command('health', async (ctx) => {
    await ctx.reply('Mazaya v2 is running.');
  });

  bot.start(async (ctx) => {
    const chatId = ctx.chat?.id ?? 'unknown-chat';
    const userId = ctx.from?.id ?? 'unknown-user';
    startCommandCenterSession(getSessionKey(chatId, userId));
    await showCommandCenter(ctx);
  });

  bot.command('command', async (ctx) => {
    const chatId = ctx.chat?.id ?? 'unknown-chat';
    const userId = ctx.from?.id ?? 'unknown-user';
    startCommandCenterSession(getSessionKey(chatId, userId));
    await showCommandCenter(ctx);
  });

  bot.command('menu', async (ctx) => {
    const chatId = ctx.chat?.id ?? 'unknown-chat';
    const userId = ctx.from?.id ?? 'unknown-user';
    startCommandCenterSession(getSessionKey(chatId, userId));
    await showCommandCenter(ctx);
  });

  registerFieldVisitWorkflow(bot);
  registerCompanyLookupWorkflow(bot);
  registerFollowUpLoggingWorkflow(bot);
  registerReminderListWorkflow(bot);
  registerPlaceholderRoomsWorkflow(bot);

  bot.action(/^cc:([a-z_]+)$/, async (ctx) => {
    const action = ctx.match[1] as CommandCenterAction;
    await ctx.answerCbQuery().catch(() => undefined);

    if (!commandCenterActions.has(action)) {
      await ctx.reply('Unknown Command Center action.');
      return;
    }

    await showComingSoon(ctx, action);
  });

  bot.on('text', async (ctx) => {
    if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/')) {
      return;
    }

    if (await handleFollowUpLoggingText(ctx)) {
      return;
    }

    if (await handleCompanyLookupText(ctx)) {
      return;
    }

    await handleFieldVisitText(ctx);
  });

  bot.catch((error) => {
    console.error('Mazaya bot error:', error);
  });

  return bot;
}

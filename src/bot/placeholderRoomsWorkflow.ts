import { Context, Markup, Telegraf } from 'telegraf';
import { showCommandCenter } from './commandCenter';

async function showReportsRoom(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Reports Room',
      '',
      'This room will be used to review, approve, and sync saved activity to reporting.',
    ].join('\n'),
    Markup.inlineKeyboard([
      [Markup.button.callback("Today's Review", 'reports:placeholder')],
      [Markup.button.callback('Unsynced Items', 'reports:placeholder')],
      [Markup.button.callback('Sync Approved to Sheets', 'reports:placeholder')],
      [Markup.button.callback('Back to Command Center', 'reports:back_command')],
    ])
  );
}

async function showDraftsRoom(ctx: Context): Promise<void> {
  await ctx.reply(
    'Drafts Room',
    Markup.inlineKeyboard([
      [Markup.button.callback('WhatsApp Draft', 'drafts:placeholder')],
      [Markup.button.callback('Email Draft', 'drafts:placeholder')],
      [Markup.button.callback('Back to Command Center', 'drafts:back_command')],
    ])
  );
}

async function showTasksRoom(ctx: Context): Promise<void> {
  await ctx.reply(
    'Tasks Room',
    Markup.inlineKeyboard([
      [Markup.button.callback('Work Tasks', 'tasks:placeholder')],
      [Markup.button.callback('Team Tasks', 'tasks:placeholder')],
      [Markup.button.callback('Personal Tasks', 'tasks:placeholder')],
      [Markup.button.callback('Back to Command Center', 'tasks:back_command')],
    ])
  );
}

export function registerPlaceholderRoomsWorkflow(bot: Telegraf): void {
  bot.command('reports', async (ctx) => {
    await showReportsRoom(ctx);
  });

  bot.command('drafts', async (ctx) => {
    await showDraftsRoom(ctx);
  });

  bot.command('tasks', async (ctx) => {
    await showTasksRoom(ctx);
  });

  bot.action('cc:report_room', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showReportsRoom(ctx);
  });

  bot.action('cc:draft_message_later', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showDraftsRoom(ctx);
  });

  bot.action('cc:tasks', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showTasksRoom(ctx);
  });

  bot.action('reports:placeholder', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Report review and Google Sheets sync are coming in the next reporting milestone.');
  });

  bot.action('drafts:placeholder', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Drafts are coming later.');
  });

  bot.action('tasks:placeholder', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Tasks are coming later.');
  });

  bot.action('reports:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
  });

  bot.action('drafts:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
  });

  bot.action('tasks:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
  });
}

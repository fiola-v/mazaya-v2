import { Context, Markup, Telegraf } from 'telegraf';
import { showCommandCenter } from './commandCenter';

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
  bot.command('tasks', async (ctx) => {
    await showTasksRoom(ctx);
  });

  bot.action('cc:tasks', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showTasksRoom(ctx);
  });

  bot.action('tasks:placeholder', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await ctx.reply('Tasks are coming later.');
  });

  bot.action('tasks:back_command', async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await showCommandCenter(ctx);
  });
}

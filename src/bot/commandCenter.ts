import { Context, Markup } from 'telegraf';
import { CommandCenterAction, CommandCenterButton } from '../types/mazaya';

const commandCenterButtons: CommandCenterButton[] = [
  { label: 'Field Visits', action: 'field_visit' },
  { label: 'Companies Database', action: 'companies_database' },
  { label: 'Reminders / Follow-Ups', action: 'reminders' },
  { label: 'Reports', action: 'report_room' },
  { label: 'Drafts', action: 'draft_message_later' },
  { label: 'Tasks', action: 'tasks' },
];

function actionLabel(action: CommandCenterAction): string {
  const button = commandCenterButtons.find((item) => item.action === action);
  return button?.label ?? 'This module';
}

export function commandCenterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Field Visits', 'cc:field_visit'),
      Markup.button.callback('Companies Database', 'cc:companies_database'),
    ],
    [
      Markup.button.callback('Reminders / Follow-Ups', 'cc:reminders'),
      Markup.button.callback('Reports', 'cc:report_room'),
    ],
    [
      Markup.button.callback('Drafts', 'cc:draft_message_later'),
      Markup.button.callback('Tasks', 'cc:tasks'),
    ],
  ]);
}

export async function showCommandCenter(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Mazaya Command Center',
      '',
      'What do you want to do?',
    ].join('\n'),
    commandCenterKeyboard()
  );
}

export async function showComingSoon(ctx: Context, action: CommandCenterAction): Promise<void> {
  const label = actionLabel(action);
  await ctx.reply(`${label}: coming in next phase.`);
}

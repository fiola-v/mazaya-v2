import { Context, Markup } from 'telegraf';
import { CommandCenterAction, CommandCenterButton } from '../types/mazaya';

const commandCenterButtons: CommandCenterButton[] = [
  { label: 'Field Visit', action: 'field_visit' },
  { label: 'Follow-Ups', action: 'follow_ups' },
  { label: 'Reminders', action: 'reminders' },
  { label: 'Tasks', action: 'tasks' },
  { label: 'Quick Note', action: 'quick_note' },
  { label: 'Start My Day', action: 'start_my_day' },
  { label: 'End-of-Day Review', action: 'end_of_day_review' },
  { label: 'Pipeline', action: 'pipeline' },
  { label: 'Report Room', action: 'report_room' },
  { label: 'Draft Message Later', action: 'draft_message_later' },
];

function actionLabel(action: CommandCenterAction): string {
  const button = commandCenterButtons.find((item) => item.action === action);
  return button?.label ?? 'This module';
}

export function commandCenterKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Field Visit', 'cc:field_visit'),
      Markup.button.callback('Follow-Ups', 'cc:follow_ups'),
    ],
    [
      Markup.button.callback('Reminders', 'cc:reminders'),
      Markup.button.callback('Tasks', 'cc:tasks'),
    ],
    [
      Markup.button.callback('Quick Note', 'cc:quick_note'),
      Markup.button.callback('Start My Day', 'cc:start_my_day'),
    ],
    [
      Markup.button.callback('End-of-Day Review', 'cc:end_of_day_review'),
      Markup.button.callback('Pipeline', 'cc:pipeline'),
    ],
    [
      Markup.button.callback('Report Room', 'cc:report_room'),
      Markup.button.callback('Draft Message Later', 'cc:draft_message_later'),
    ],
  ]);
}

export async function showCommandCenter(ctx: Context): Promise<void> {
  await ctx.reply(
    [
      'Mazaya v2 Command Center',
      '',
      'Choose what you want to open.',
    ].join('\n'),
    commandCenterKeyboard()
  );
}

export async function showComingSoon(ctx: Context, action: CommandCenterAction): Promise<void> {
  const label = actionLabel(action);
  await ctx.reply(`${label}: coming in next phase.`);
}

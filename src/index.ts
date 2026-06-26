import { createBot } from './bot/createBot';
import './db/supabase';

async function main(): Promise<void> {
  const bot = createBot();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  await bot.launch();
  console.log('Mazaya v2 bot started.');
}

main().catch((error) => {
  console.error('Mazaya v2 failed to start:', error);
  process.exit(1);
});

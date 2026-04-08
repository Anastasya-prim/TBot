import './loadEnv.js';
import { createBot, isDebugUpdates } from './bot.js';
import { connectRedis, disconnectRedis } from './db/redisClient.js';
import {
  closeStore,
  getDbPath,
  initDatabase,
  ensureDatabaseSchema,
  usePostgres,
} from './db/store.js';
import { initBusiness } from './data/business.js';

// Убираем BOM, если .env сохранён как UTF-8 with BOM в Windows
const token = process.env.BOT_TOKEN?.trim().replace(/^\uFEFF/, '');
if (!token) {
  console.error('Задайте BOT_TOKEN в файле .env в корне проекта (см. .env.example)');
  process.exit(1);
}

/** @type {import('telegraf').Telegraf | null} */
let bot = null;

async function main() {
  await connectRedis();
  await initDatabase();
  await ensureDatabaseSchema();
  console.log(
    usePostgres()
      ? `Хранилище: PostgreSQL (DATABASE_URL)${
          /supabase\.co/i.test(String(process.env.DATABASE_URL))
            ? ' — просмотр данных: Supabase → Table Editor'
            : ''
        }`
      : `Хранилище: SQLite — ${getDbPath()}`,
  );
  await initBusiness();

  bot = await createBot(token);
  bot.catch((err, ctx) => {
    console.error('Ошибка:', err);
    ctx?.reply('Произошла ошибка. Попробуйте /menu').catch(() => {});
  });

  console.log(
    'Отладка апдейтов:',
    isDebugUpdates ? 'вкл (DEBUG_UPDATES=1) — будут строки [update]' : 'выкл',
  );

  try {
    const wh = await bot.telegram.getWebhookInfo();
    const url = wh.url || '';
    console.log('Webhook у бота до запуска:', url || '(нет — ок для long polling)');
    if (url) {
      console.log(
        'Сейчас Telegram шлёт апдейты на URL выше. При launch вызовется deleteWebhook — дальше polling заберёт их сюда.',
      );
    }
  } catch (e) {
    console.warn('getWebhookInfo не удался:', e?.message || e);
  }

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log('deleteWebhook выполнен (long polling может забирать апдейты).');
  } catch (e) {
    console.warn('deleteWebhook:', e?.message || e);
  }

  await bot
    .launch({ dropPendingUpdates: true }, () => {
      const u = bot.botInfo?.username;
      console.log(
        u
          ? `Онлайн: @${u} — в Telegram откройте именно ЭТОГО бота и нажмите Start или отправьте /start`
          : 'Бот в сети.',
      );
      if (isDebugUpdates) {
        console.log('DEBUG_UPDATES: в консоли будут строки [update] при каждом действии в чате.');
      }
      console.log(
        'Каждое действие в чате с ботом → строка [poll] в консоли. Нет [poll] — пишете не тому боту, второй процесс с токеном или сеть до api.telegram.org.',
      );
      console.log('Остановка: Ctrl+C');

      setTimeout(async () => {
        try {
          const wh2 = await bot.telegram.getWebhookInfo();
          const u2 = wh2.url || '';
          console.log('Webhook после старта:', u2 || '(пусто — ок)');
          if (u2) {
            console.error(
              'Проблема: webhook снова не пустой — апдейты могут уходить не в этот процесс. Проверьте другие сервисы с тем же токеном.',
            );
          }
        } catch (e) {
          console.warn('getWebhookInfo (после старта):', e?.message || e);
        }
      }, 2500);
    })
    .catch((e) => {
      const msg = String(e?.message || e);
      console.error('Запуск не удался:', msg);
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        console.error('Токен неверный или отозван. В @BotFather: /revoke → новый токен в .env');
      }
      if (msg.includes('409') || msg.includes('Conflict')) {
        console.error(
          'Уже есть второй процесс с этим токеном (другой терминал, сервер). Остановите его.',
        );
      }
      process.exit(1);
    });
}

main().catch((e) => {
  console.error('Фатальная ошибка при запуске:', e);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
});

async function shutdown(signal) {
  try {
    if (bot) await bot.stop(signal);
  } catch (e) {
    console.warn('bot.stop:', e?.message || e);
  }
  try {
    await disconnectRedis();
  } catch (e) {
    console.warn('disconnectRedis:', e?.message || e);
  }
  try {
    await closeStore();
  } catch (e) {
    console.warn('closeStore:', e?.message || e);
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT').then(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM').then(() => process.exit(0));
});

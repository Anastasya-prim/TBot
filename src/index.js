import 'dotenv/config';
import { createBot } from './bot.js';

// Убираем BOM, если .env сохранён как UTF-8 with BOM в Windows
const token = process.env.BOT_TOKEN?.trim().replace(/^\uFEFF/, '');
if (!token) {
  console.error('Задайте BOT_TOKEN в файле .env (см. .env.example)');
  process.exit(1);
}

const bot = createBot(token);

bot.catch((err, ctx) => {
  console.error('Ошибка:', err);
  ctx?.reply('Произошла ошибка. Попробуйте /menu').catch(() => {});
});

function main() {
  // Второй аргумент вызывается после getMe, до бесконечного polling (await launch никогда не завершится)
  bot
    .launch({ dropPendingUpdates: true }, () => {
      const u = bot.botInfo?.username;
      console.log(
        u
          ? `Онлайн: @${u} — в Telegram откройте именно ЭТОГО бота и нажмите Start или отправьте /start`
          : 'Бот в сети.',
      );
      console.log('Остановка: Ctrl+C');
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

main();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

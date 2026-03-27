import { Markup, Telegraf } from 'telegraf';
import {
  appendLead,
  appendLog,
  FAQ_TOPICS,
  FURNITURE_TYPES,
  MOCK_ORDERS,
  PRIORITIES,
} from './data/business.js';
import { getSession, resetSession, truncateQuizDataFromStep } from './sessionStore.js';
import { isValidRuPhone, normalizePhone } from './utils/phone.js';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function navKb() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('◀ Назад', 'q:back'),
      Markup.button.callback('✕ Отмена', 'q:cancel'),
    ],
  ]);
}

function mainMenuKb() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📐 Рассчитать стоимость', 'main:quiz')],
    [Markup.button.callback('📦 Статус заказа', 'main:status')],
    [Markup.button.callback('❓ Частые вопросы', 'main:faq')],
  ]);
}

function faqMenuKb() {
  const rows = Object.entries(FAQ_TOPICS).map(([id, t]) => [
    Markup.button.callback(t.title, `faq:${id}`),
  ]);
  rows.push([Markup.button.callback('◀ В меню', 'main:home')]);
  return Markup.inlineKeyboard(rows);
}

/**
 * @param {import('telegraf').Context} ctx
 */
export async function sendMainMenu(ctx) {
  await ctx.reply(
    'Добро пожаловать в салон мебели на заказ.\n\nВыберите действие:',
    { ...mainMenuKb() },
  );
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function promptQuizStep(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;
  const s = getSession(userId);
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const step = s.quizStepIndex;

  if (step === 0) {
    await ctx.reply('Как к вам обращаться? (имя)', {
      ...navKb(),
    });
    return;
  }

  if (step === 1) {
    const row1 = FURNITURE_TYPES.slice(0, 2).map((f) =>
      Markup.button.callback(f.label, `q:fur:${f.id}`),
    );
    const row2 = FURNITURE_TYPES.slice(2).map((f) =>
      Markup.button.callback(f.label, `q:fur:${f.id}`),
    );
    await ctx.reply('Выберите тип мебели:', {
      ...Markup.inlineKeyboard([row1, row2, ...navKb().reply_markup.inline_keyboard]),
    });
    return;
  }

  if (step === 2) {
    await ctx.reply('Нужен ли замер?', {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('Да', 'q:meas:yes'),
          Markup.button.callback('Нет', 'q:meas:no'),
        ],
        ...navKb().reply_markup.inline_keyboard,
      ]),
    });
    return;
  }

  if (step === 3) {
    const row = PRIORITIES.map((p) =>
      Markup.button.callback(p.label, `q:pri:${p.id}`),
    );
    await ctx.reply('Что для вас в приоритете?', {
      ...Markup.inlineKeyboard([row, ...navKb().reply_markup.inline_keyboard]),
    });
    return;
  }

  if (step === 4) {
    if (s.waitingCustom === 'timeline') {
      await ctx.reply('Опишите желаемые сроки своими словами:', {
        ...navKb(),
      });
      return;
    }
    await ctx.reply('Какие сроки вам подходят?', {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('До 1 месяца', 'q:time:1m'),
          Markup.button.callback('1–2 месяца', 'q:time:2m'),
        ],
        [
          Markup.button.callback('Более 2 месяцев', 'q:time:2p'),
          Markup.button.callback('Свой вариант', 'q:time:custom'),
        ],
        ...navKb().reply_markup.inline_keyboard,
      ]),
    });
    return;
  }

  if (step === 5) {
    if (s.waitingCustom === 'budget') {
      await ctx.reply('Укажите бюджет (цифра или диапазон):', {
        ...navKb(),
      });
      return;
    }
    await ctx.reply('Ориентир по бюджету:', {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('До 150 000 ₽', 'q:bud:150'),
          Markup.button.callback('150–400 тыс. ₽', 'q:bud:400'),
        ],
        [
          Markup.button.callback('400+ тыс. ₽', 'q:bud:high'),
          Markup.button.callback('Свой вариант', 'q:bud:custom'),
        ],
        ...navKb().reply_markup.inline_keyboard,
      ]),
    });
    return;
  }

  if (step === 6) {
    await ctx.reply(
      'Оставьте номер телефона для связи (в формате +7… или 8…):',
      { ...navKb() },
    );
    return;
  }

  if (step === 7) {
    await ctx.reply(
      'Пришлите файл с эскизом или фото (документ/фото) или нажмите «Пропустить».',
      {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Пропустить', 'q:file:skip')],
          ...navKb().reply_markup.inline_keyboard,
        ]),
      },
    );
    return;
  }

  if (step === 8) {
    const d = s.quizData;
    const fileLine = d.sketchLink
      ? `<a href="${escapeHtml(d.sketchLink)}">файл (усл. ссылка)</a>`
      : 'не прикреплён';
    const text =
      '📋 Проверьте заявку:\n\n' +
      `• Имя: ${escapeHtml(d.name || '')}\n` +
      `• Тип: ${escapeHtml(d.furnitureLabel || '')}\n` +
      `• Замер: ${d.needMeasure ? 'да' : 'нет'}\n` +
      `• Приоритет: ${escapeHtml(d.priorityLabel || '')}\n` +
      `• Сроки: ${escapeHtml(d.timeline || '')}\n` +
      `• Бюджет: ${escapeHtml(d.budget || '')}\n` +
      `• Телефон: ${escapeHtml(d.phone || '')}\n` +
      `• Эскиз: ${fileLine}\n\n` +
      'Отправить менеджеру?';
    await ctx.reply(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Отправить заявку', 'q:conf:send')],
        ...navKb().reply_markup.inline_keyboard,
      ]),
    });
  }
}

/**
 * @param {import('telegraf').Context} ctx
 */
async function submitQuiz(ctx) {
  const userId = ctx.from?.id;
  if (!userId) return;
  const s = getSession(userId);
  const d = s.quizData;
  const username = ctx.from?.username ? `@${ctx.from.username}` : '—';

  const row = {
    telegramUserId: userId,
    telegramUsername: username,
    name: d.name,
    furnitureType: d.furnitureType,
    furnitureLabel: d.furnitureLabel,
    needMeasure: d.needMeasure,
    priority: d.priority,
    timeline: d.timeline,
    budget: d.budget,
    phone: d.phone,
    sketchLink: d.sketchLink || null,
    sketchFileId: d.sketchFileId || null,
    source: 'quiz',
  };

  appendLead(row);
  appendLog({
    type: 'lead_submitted',
    userId,
    success: true,
    operatorNeeded: false,
  });

  const managerId = process.env.MANAGER_CHAT_ID?.trim();
  const summary =
    `🆕 <b>Новая заявка</b>\n` +
    `Имя: ${escapeHtml(d.name || '')}\n` +
    `Тел: ${escapeHtml(d.phone || '')}\n` +
    `Тип: ${escapeHtml(d.furnitureLabel || '')}\n` +
    `Замер: ${d.needMeasure ? 'да' : 'нет'}\n` +
    `Приоритет: ${escapeHtml(d.priorityLabel || '')}\n` +
    `Сроки: ${escapeHtml(d.timeline || '')}\n` +
    `Бюджет: ${escapeHtml(d.budget || '')}\n` +
    `TG: ${escapeHtml(String(userId))} ${escapeHtml(username)}\n` +
    (d.sketchLink
      ? `Файл: ${escapeHtml(d.sketchLink)}\n`
      : '');

  if (managerId) {
    try {
      await ctx.telegram.sendMessage(managerId, summary, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (e) {
      console.error('MANAGER_CHAT_ID notify failed:', e.message);
    }
  } else {
    console.log('[manager notify skipped: MANAGER_CHAT_ID empty]\n', summary.replace(/<[^>]+>/g, ''));
  }

  await ctx.reply(
    'Спасибо! Заявка принята. Менеджер свяжется с вами в течение часа.',
  );
  resetSession(userId);
  await sendMainMenu(ctx);
}

/**
 * @param {Telegraf} bot
 */
export function registerHandlers(bot) {
  bot.start(async (ctx) => {
    resetSession(ctx.from.id);
    appendLog({ type: 'start', userId: ctx.from.id, source: 'command' });
    await sendMainMenu(ctx);
  });

  bot.command('menu', async (ctx) => {
    resetSession(ctx.from.id);
    await sendMainMenu(ctx);
  });

  bot.command('status', async (ctx) => {
    const s = getSession(ctx.from.id);
    s.flow = 'status_phone';
    s.statusPhone = undefined;
    await ctx.reply(
      'Введите номер телефона, указанный в договоре (как при оформлении заказа):',
      Markup.inlineKeyboard([[Markup.button.callback('✕ Отмена', 'st:cancel')]]),
    );
  });

  bot.action('main:home', async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx.from.id);
    await ctx.reply('Главное меню:', { ...mainMenuKb() });
  });

  bot.action('main:quiz', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    s.flow = 'quiz';
    s.quizStepIndex = 0;
    s.quizData = {};
    s.waitingCustom = null;
    appendLog({ type: 'quiz_start', userId: ctx.from.id });
    await ctx.reply('Отлично, подберём ориентир по стоимости. На любом шаге можно вернуться назад или отменить.');
    await promptQuizStep(ctx);
  });

  bot.action('main:status', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    s.flow = 'status_phone';
    s.statusPhone = undefined;
    await ctx.reply(
      'Введите номер телефона для проверки статуса:',
      Markup.inlineKeyboard([[Markup.button.callback('✕ Отмена', 'st:cancel')]]),
    );
  });

  bot.action('st:cancel', async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx.from.id);
    await ctx.reply('Проверка статуса отменена.', { ...mainMenuKb() });
  });

  const deliveryLabels = {
    morning: 'утро',
    day: 'день',
    evening: 'вечер',
    call: 'связаться со мной',
  };

  bot.action(/^st:del:(morning|day|evening|call)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'status_delivery') return;
    const key = /** @type {'morning'|'day'|'evening'|'call'} */ (ctx.match[1]);
    appendLog({
      type: 'delivery_window',
      userId: ctx.from.id,
      phone: s.statusPhone,
      contract: s.statusContract,
      window: key,
    });
    await ctx.reply(
      `Записали пожелание: ${deliveryLabels[key]}. Менеджер подтвердит время доставки.`,
      { ...mainMenuKb() },
    );
    resetSession(ctx.from.id);
  });

  bot.action('main:faq', async (ctx) => {
    await ctx.answerCbQuery();
    getSession(ctx.from.id).flow = 'faq';
    await ctx.reply('Выберите тему:', { ...faqMenuKb() });
  });

  bot.action(/^faq:(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    const topic = FAQ_TOPICS[id];
    if (!topic) {
      await ctx.reply('Раздел не найден.', { ...faqMenuKb() });
      return;
    }
    appendLog({ type: 'faq', userId: ctx.from.id, topic: id });
    await ctx.reply(topic.text, {
      parse_mode: 'Markdown',
      ...faqMenuKb(),
    });
  });

  bot.action('q:cancel', async (ctx) => {
    await ctx.answerCbQuery();
    resetSession(ctx.from.id);
    await ctx.reply('Ввод заявки отменён.', { ...mainMenuKb() });
  });

  bot.action('q:back', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const s = getSession(userId);
    if (s.flow !== 'quiz') return;

    s.waitingCustom = null;

    if (s.quizStepIndex <= 0) {
      resetSession(userId);
      await ctx.reply('Возврат в меню.', { ...mainMenuKb() });
      return;
    }

    s.quizStepIndex -= 1;
    truncateQuizDataFromStep(s.quizData, s.quizStepIndex);
    await ctx.reply('Возвращаемся к предыдущему шагу:');
    await promptQuizStep(ctx);
  });

  const furMap = Object.fromEntries(FURNITURE_TYPES.map((f) => [f.id, f]));
  bot.action(/^q:fur:(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 1) return;
    const f = furMap[ctx.match[1]];
    if (!f) return;
    s.quizData.furnitureType = f.id;
    s.quizData.furnitureLabel = f.label;
    s.quizStepIndex = 2;
    await promptQuizStep(ctx);
  });

  bot.action(/^q:meas:(yes|no)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 2) return;
    s.quizData.needMeasure = ctx.match[1] === 'yes';
    s.quizStepIndex = 3;
    await promptQuizStep(ctx);
  });

  const priMap = Object.fromEntries(PRIORITIES.map((p) => [p.id, p]));
  bot.action(/^q:pri:(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 3) return;
    const p = priMap[ctx.match[1]];
    if (!p) return;
    s.quizData.priority = p.id;
    s.quizData.priorityLabel = p.label;
    s.quizStepIndex = 4;
    s.waitingCustom = null;
    await promptQuizStep(ctx);
  });

  const timeLabels = {
    '1m': 'до 1 месяца',
    '2m': '1–2 месяца',
    '2p': 'более 2 месяцев',
  };

  bot.action('q:time:custom', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 4) return;
    s.waitingCustom = 'timeline';
    await promptQuizStep(ctx);
  });

  bot.action(/^q:time:(1m|2m|2p)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 4) return;
    s.quizData.timeline = timeLabels[ctx.match[1]];
    s.waitingCustom = null;
    s.quizStepIndex = 5;
    await promptQuizStep(ctx);
  });

  bot.action('q:bud:custom', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 5) return;
    s.waitingCustom = 'budget';
    await promptQuizStep(ctx);
  });

  const budLabels = {
    '150': 'до 150 000 ₽',
    '400': '150 000 – 400 000 ₽',
    high: 'свыше 400 000 ₽',
  };

  bot.action(/^q:bud:(150|400|high)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 5) return;
    s.quizData.budget = budLabels[ctx.match[1]];
    s.waitingCustom = null;
    s.quizStepIndex = 6;
    await promptQuizStep(ctx);
  });

  bot.action('q:file:skip', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 7) return;
    delete s.quizData.sketchFileId;
    delete s.quizData.sketchLink;
    s.quizStepIndex = 8;
    await promptQuizStep(ctx);
  });

  bot.action('q:conf:send', async (ctx) => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.from.id);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 8) return;
    await submitQuiz(ctx);
  });

  bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const s = getSession(userId);
    const text = (ctx.message.text || '').trim();
    if (!text) return;

    // Если /start пришёл без сущности bot_command (редко) или команда «провалилась» в text — не молчать
    if (text.startsWith('/')) {
      const first = text.split(/\s+/)[0];
      const [cmdWithSlash, atBot] = first.split('@');
      const cmd = cmdWithSlash.replace(/^\//i, '').toLowerCase();
      if (atBot && ctx.me && atBot.toLowerCase() !== ctx.me.toLowerCase()) {
        return;
      }
      if (cmd === 'start') {
        resetSession(userId);
        appendLog({ type: 'start', userId, source: 'text_command' });
        await sendMainMenu(ctx);
        return;
      }
      if (cmd === 'menu') {
        resetSession(userId);
        await sendMainMenu(ctx);
        return;
      }
      if (cmd === 'status') {
        s.flow = 'status_phone';
        s.statusPhone = undefined;
        await ctx.reply(
          'Введите номер телефона, указанный в договоре (как при оформлении заказа):',
          Markup.inlineKeyboard([[Markup.button.callback('✕ Отмена', 'st:cancel')]]),
        );
        return;
      }
      await ctx.reply('Неизвестная команда. Нажмите /start или /menu.');
      return;
    }

    if (s.flow === 'status_phone') {
      const norm = normalizePhone(text);
      if (!norm) {
        await ctx.reply('Не удалось распознать номер. Пример: +79001234567');
        return;
      }
      const order = MOCK_ORDERS[norm];
      appendLog({ type: 'status_check', userId, found: Boolean(order) });
      if (!order) {
        await ctx.reply(
          'Заказ с таким телефоном не найден. Уточните номер или свяжитесь с менеджером.',
          { ...mainMenuKb() },
        );
        resetSession(userId);
        return;
      }

      s.statusPhone = norm;
      s.statusContract = order.contract;
      s.flow = 'status_delivery';

      await ctx.reply(
        `Ваш заказ <b>${escapeHtml(order.contract)}</b> на этапе: <b>${escapeHtml(order.stageLabel)}</b>.`,
        { parse_mode: 'HTML' },
      );

      if (order.stage === 'ready') {
        await ctx.reply('Заказ готов. Когда удобно доставить?', {
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('Утро', 'st:del:morning'),
              Markup.button.callback('День', 'st:del:day'),
            ],
            [
              Markup.button.callback('Вечер', 'st:del:evening'),
              Markup.button.callback('Связаться со мной', 'st:del:call'),
            ],
            [Markup.button.callback('◀ В меню', 'main:home')],
          ]),
        });
      } else {
        await ctx.reply('Если нужна помощь — выберите пункт меню.', {
          ...mainMenuKb(),
        });
        resetSession(userId);
      }
      return;
    }

    if (s.flow === 'quiz') {
      if (s.quizStepIndex === 8) {
        await ctx.reply('Используйте кнопки под сообщением: «Отправить», «Назад» или «Отмена».');
        return;
      }

      if (s.waitingCustom === 'timeline') {
        if (text.length < 2) {
          await ctx.reply('Слишком коротко, опишите сроки подробнее.');
          return;
        }
        s.quizData.timeline = text.slice(0, 500);
        s.waitingCustom = null;
        s.quizStepIndex = 5;
        await promptQuizStep(ctx);
        return;
      }
      if (s.waitingCustom === 'budget') {
        if (text.length < 1) {
          await ctx.reply('Укажите бюджет.');
          return;
        }
        s.quizData.budget = text.slice(0, 200);
        s.waitingCustom = null;
        s.quizStepIndex = 6;
        await promptQuizStep(ctx);
        return;
      }

      if (s.quizStepIndex === 0) {
        if (text.length < 2) {
          await ctx.reply('Введите имя (хотя бы 2 буквы).');
          return;
        }
        s.quizData.name = text.slice(0, 100);
        s.quizStepIndex = 1;
        await promptQuizStep(ctx);
        return;
      }

      if (s.quizStepIndex === 6) {
        if (!isValidRuPhone(text)) {
          await ctx.reply('Неверный формат. Пример: +79001234567 или 89001234567');
          return;
        }
        const norm = normalizePhone(text);
        s.quizData.phone = norm || text;
        s.quizStepIndex = 7;
        await promptQuizStep(ctx);
        return;
      }
    }

    appendLog({
      type: 'free_text',
      userId,
      preview: text.slice(0, 120),
      operatorNeeded: true,
    });
    await ctx.reply(
      'Свободный текст пока обрабатывается менеджером. Откройте меню или начните расчёт стоимости.',
      { ...mainMenuKb() },
    );
  });

  bot.on(['document', 'photo'], async (ctx) => {
    const userId = ctx.from.id;
    const s = getSession(userId);
    if (s.flow !== 'quiz' || s.quizStepIndex !== 7) return;

    let fileId;
    let fileName = 'file';
    if ('document' in ctx.message && ctx.message.document) {
      fileId = ctx.message.document.file_id;
      fileName = ctx.message.document.file_name || 'document';
    } else if ('photo' in ctx.message && ctx.message.photo?.length) {
      const photos = ctx.message.photo;
      fileId = photos[photos.length - 1].file_id;
      fileName = 'photo.jpg';
    }
    if (!fileId) return;

    s.quizData.sketchFileId = fileId;
    s.quizData.sketchLink = `https://drive.google.com/file/d/mock_${fileId.slice(-12)}/view`;
    s.quizStepIndex = 8;
    await ctx.reply(`Файл «${escapeHtml(fileName)}» принят (в демо — условная ссылка на Drive).`, {
      parse_mode: 'HTML',
    });
    await promptQuizStep(ctx);
  });
}

/**
 * @param {string} token
 */
export function createBot(token) {
  const bot = new Telegraf(token);
  if (process.env.DEBUG_UPDATES === '1') {
    bot.use(async (ctx, next) => {
      const u = ctx.update.update_id;
      const msg = ctx.message?.text;
      const cb = ctx.callbackQuery?.data;
      console.log('[update]', u, msg ? `text: ${msg.slice(0, 60)}` : cb ? `cb: ${cb}` : ctx.updateType);
      return next();
    });
  }
  registerHandlers(bot);
  return bot;
}

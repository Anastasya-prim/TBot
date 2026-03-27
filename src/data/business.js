/** Типы мебели (id для callback, label для человека) */
export const FURNITURE_TYPES = [
  { id: 'kitchen', label: 'Кухня' },
  { id: 'wardrobe', label: 'Шкаф / гардероб' },
  { id: 'soft', label: 'Мягкая мебель' },
  { id: 'other', label: 'Другое' },
];

export const PRIORITIES = [
  { id: 'price', label: 'Цена' },
  { id: 'quality', label: 'Качество' },
  { id: 'deadline', label: 'Сроки' },
];

/** Темы FAQ: callback faq:* */
export const FAQ_TOPICS = {
  materials: {
    title: 'Материалы',
    text:
      '📋 *Материалы*\n\n' +
      '• *МДФ* — гладкая покраска, любые цвета по каталогу RAL/NCS.\n' +
      '• *ЛДСП* — экономичный вариант, широкий выбор декоров.\n' +
      '• *Столешницы* — постформинг, HPL, искусственный камень — по проекту.\n\n' +
      'Точный подбор — на замере с дизайнером.',
  },
  hardware: {
    title: 'Фурнитура',
    text:
      '🔩 *Фурнитура*\n\n' +
      'Рекомендуем *Blum* и аналоги премиум-класса: плавное закрывание, срок службы.\n' +
      'Возможны другие бренды по согласованию и бюджету.',
  },
  warranty: {
    title: 'Гарантия',
    text:
      '🛡 *Гарантия*\n\n' +
      'Гарантия на корпус и фурнитуру — *до 3 лет* при условии правильной эксплуатации.\n' +
      'Сервисные случаи рассматриваются индивидуально.',
  },
  timing: {
    title: 'Сроки',
    text:
      '⏱ *Сроки изготовления*\n\n' +
      'Ориентир — *от 30 рабочих дней* в зависимости от сложности и загрузки производства.\n' +
      'Точные даты фиксируются в договоре.',
  },
  payment: {
    title: 'Оплата',
    text:
      '💳 *Оплата*\n\n' +
      'Наличные, банковская карта, безнал для юрлиц.\n' +
      '*Рассрочка* — по акциям банков-партнёров (уточняйте у менеджера).',
  },
};

/**
 * Заказы по нормализованному телефону (только цифры, 11 для РФ)
 * stage: measure | production | delivery | ready
 */
export const MOCK_ORDERS = {
  '79991234567': {
    contract: 'Д-2024-001',
    stage: 'production',
    stageLabel: 'изготовление',
  },
  '79001112233': {
    contract: 'Д-2024-077',
    stage: 'ready',
    stageLabel: 'готов к доставке',
  },
  '79005556666': {
    contract: 'Д-2023-412',
    stage: 'measure',
    stageLabel: 'замер',
  },
};

/** Логи обращений (в памяти) */
export const interactionLog = [];

/** Заявки из квиза (в памяти) */
export const leads = [];

/**
 * @param {Record<string, unknown>} row
 */
export function appendLead(row) {
  leads.push({ ...row, createdAt: new Date().toISOString() });
}

/**
 * @param {Record<string, unknown>} entry
 */
export function appendLog(entry) {
  interactionLog.push({ ...entry, at: new Date().toISOString() });
}

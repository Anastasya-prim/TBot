import { normalizePhone } from '../utils/phone.js';

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
 * @typedef {Object} OrderRecord
 * @property {string} phoneKey нормализованный телефон 7XXXXXXXXXX
 * @property {string} orderId ИД заявки (например З-1001)
 * @property {string} contract номер договора или тот же orderId для новых заявок
 * @property {'measure' | 'production' | 'delivery' | 'ready' | 'application'} stage
 * @property {string} stageLabel
 */

/** Демо-заказы + записи из принятых заявок (в памяти) */
export const ORDERS_REGISTRY = [
  {
    phoneKey: '79991234567',
    orderId: 'З-1001',
    contract: 'Д-2024-001',
    stage: 'production',
    stageLabel: 'изготовление',
  },
  {
    phoneKey: '79001112233',
    orderId: 'З-1002',
    contract: 'Д-2024-077',
    stage: 'ready',
    stageLabel: 'готов к доставке',
  },
  {
    phoneKey: '79005556666',
    orderId: 'З-1003',
    contract: 'Д-2023-412',
    stage: 'measure',
    stageLabel: 'замер',
  },
];

let nextOrderSeq = 2000;

export function allocateOrderId() {
  return `З-${nextOrderSeq++}`;
}

function compactKey(s) {
  return String(s).replace(/\s/g, '').toLowerCase();
}

/**
 * Поиск заказа по телефону, ИД заявки (З-…) или номеру договора (Д-…)
 * @param {string} raw
 * @returns {OrderRecord | null}
 */
export function findOrder(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const phone = normalizePhone(trimmed);
  if (phone) {
    const byPhone = ORDERS_REGISTRY.find((o) => o.phoneKey === phone);
    if (byPhone) return byPhone;
  }

  const q = compactKey(trimmed);
  return (
    ORDERS_REGISTRY.find((o) => {
      if (compactKey(o.orderId) === q) return true;
      if (compactKey(o.contract) === q) return true;
      return false;
    }) || null
  );
}

/**
 * После принятия заявки из квиза — в реестр для поиска по статусу
 * @param {{ phone: string, orderId: string }} lead
 */
export function registerOrderFromLead(lead) {
  const phoneKey = normalizePhone(lead.phone) || lead.phone.replace(/\D/g, '');
  ORDERS_REGISTRY.push({
    phoneKey,
    orderId: lead.orderId,
    contract: lead.orderId,
    stage: 'application',
    stageLabel: 'заявка принята, ожидает обработки менеджером',
  });
}

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

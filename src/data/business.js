import { getRedis } from '../db/redisClient.js';
import * as store from '../db/store.js';
import { normalizePhone } from '../utils/phone.js';

/**
 * @typedef {Object} OrderRecord
 * @property {string} phoneKey
 * @property {string} orderId
 * @property {string} contract
 * @property {'measure' | 'production' | 'delivery' | 'ready' | 'application'} stage
 * @property {string} stageLabel
 */

const ORDERS_CACHE_MS = 30000;

/** @type {{ id: string, label: string }[]} */
let cachedFurniture = [];
/** @type {{ id: string, label: string }[]} */
let cachedPriorities = [];
/** @type {Record<string, { title: string, text: string }>} */
let cachedFaq = {};

/** @type {OrderRecord[]} */
let ordersCache = [];
let ordersCacheAt = 0;

const ORDER_SEQ_KEY = 'tbot:order_seq';

export function getFurnitureTypes() {
  return cachedFurniture;
}

export function getPriorities() {
  return cachedPriorities;
}

export function getFaqTopics() {
  return cachedFaq;
}

async function refreshOrdersCache() {
  ordersCache = await store.fetchAllOrders();
  ordersCacheAt = Date.now();
}

async function refreshListCaches() {
  const [fur, pri, faq] = await Promise.all([
    store.fetchFurnitureRows(),
    store.fetchPriorityRows(),
    store.fetchFaqRows(),
  ]);
  cachedFurniture = fur;
  cachedPriorities = pri;
  cachedFaq = faq;
}

export async function initBusiness() {
  await refreshListCaches();
  await refreshOrdersCache();

  const redis = getRedis();
  const exists = await redis.exists(ORDER_SEQ_KEY);
  if (!exists) {
    const max = await store.getMaxOrderNumberFromOrders();
    await redis.set(ORDER_SEQ_KEY, String(Math.max(max, 1999)));
  }
}

async function getOrdersForLookup() {
  if (Date.now() - ordersCacheAt > ORDERS_CACHE_MS) {
    await refreshOrdersCache();
  }
  return ordersCache;
}

export async function allocateOrderId() {
  const n = await getRedis().incr(ORDER_SEQ_KEY);
  return `З-${n}`;
}

function compactKey(s) {
  return String(s)
    .replace(/\s/g, '')
    .toLowerCase()
    // ИД «З-…» в БД — кириллическая З; часто вводят цифру 3
    .replace(/\u0437/g, '3');
}

export async function findOrder(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const list = await getOrdersForLookup();

  const phone = normalizePhone(trimmed);
  if (phone) {
    const byPhone = list.find((o) => o.phoneKey === phone);
    if (byPhone) return byPhone;
  }

  const q = compactKey(trimmed);
  return (
    list.find((o) => {
      if (compactKey(o.orderId) === q) return true;
      if (compactKey(o.contract) === q) return true;
      return false;
    }) || null
  );
}

export async function registerOrderFromLead(lead) {
  const phoneKey = normalizePhone(lead.phone) || lead.phone.replace(/\D/g, '');
  await store.appendOrderRow({
    phoneKey,
    orderId: lead.orderId,
    contract: lead.orderId,
    stage: 'application',
    stageLabel: 'заявка принята, ожидает обработки менеджером',
  });
  ordersCacheAt = 0;
}

export async function appendLead(row) {
  await store.appendLeadRow({
    ...row,
    createdAt: row.createdAt || new Date().toISOString(),
  });
}

export async function appendLog(entry) {
  await store.appendHistoryRow({
    ...entry,
    at: new Date().toISOString(),
  });
}

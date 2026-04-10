import fs from 'fs';
import { parseNumericOrderId } from '../utils/orderId.js';
import path from 'path';
import Database from 'better-sqlite3';

/** @type {import('better-sqlite3').Database | null} */
let db = null;

export function getDbPath() {
  const raw = process.env.SQLITE_PATH?.trim().replace(/^\uFEFF/, '');
  if (raw) return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  return path.join(process.cwd(), 'data', 'tbot.db');
}

export async function initDatabase() {
  await initStore();
}

export async function initStore() {
  const file = getDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

export function getDb() {
  if (!db) throw new Error('База не инициализирована (вызовите initStore)');
  return db;
}

export function closeStore() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}

function defaultFaqText(id) {
  const map = {
    materials:
      '📋 *Материалы*\n\n• *МДФ* — гладкая покраска.\n• ЛДСП — экономичный вариант.',
    hardware: '🔩 *Фурнитура*\n\nBlum и аналоги премиум-класса.',
    warranty: '🛡 *Гарантия*\n\nДо 3 лет при правильной эксплуатации.',
    timing: '⏱ *Сроки*\n\nОриентир — от 30 рабочих дней.',
    payment: '💳 *Оплата*\n\nНаличные, карта, безнал для юрлиц.',
  };
  return map[id] || '';
}

export async function ensureDatabaseSchema() {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      phone_key TEXT NOT NULL,
      order_id TEXT PRIMARY KEY,
      contract TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'application',
      stage_label TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      order_id TEXT,
      telegram_user_id TEXT,
      telegram_username TEXT,
      name TEXT,
      phone TEXT,
      furniture_type TEXT,
      furniture_label TEXT,
      need_measure TEXT,
      priority TEXT,
      priority_label TEXT,
      timeline TEXT,
      budget TEXT,
      sketch_file_id TEXT,
      sketch_link TEXT,
      source TEXT
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      user_id TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS faq (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS furniture (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS priorities (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      telegram_user_id TEXT PRIMARY KEY,
      quiz_step_index INTEGER NOT NULL DEFAULT 0,
      quiz_data TEXT NOT NULL DEFAULT '{}',
      waiting_custom TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone_key);
  `);

  seedDefaultsIfNeeded(d);
}

function seedDefaultsIfNeeded(d) {
  const nOrders = d.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  if (nOrders === 0) {
    const ins = d.prepare(
      'INSERT INTO orders (phone_key, order_id, contract, stage, stage_label) VALUES (?,?,?,?,?)',
    );
    const demo = [
      ['79991234567', '1001', 'Д-2024-001', 'production', 'изготовление'],
      ['79001112233', '1002', 'Д-2024-077', 'ready', 'готов к доставке'],
      ['79005556666', '1003', 'Д-2023-412', 'measure', 'замер'],
    ];
    for (const row of demo) ins.run(...row);
  }

  const nFaq = d.prepare('SELECT COUNT(*) AS c FROM faq').get().c;
  if (nFaq === 0) {
    const ins = d.prepare('INSERT INTO faq (id, title, text) VALUES (?,?,?)');
    const rows = [
      ['materials', 'Материалы', defaultFaqText('materials')],
      ['hardware', 'Фурнитура', defaultFaqText('hardware')],
      ['warranty', 'Гарантия', defaultFaqText('warranty')],
      ['timing', 'Сроки', defaultFaqText('timing')],
      ['payment', 'Оплата', defaultFaqText('payment')],
    ];
    for (const r of rows) ins.run(...r);
  }

  const nFur = d.prepare('SELECT COUNT(*) AS c FROM furniture').get().c;
  if (nFur === 0) {
    const ins = d.prepare('INSERT INTO furniture (id, label) VALUES (?,?)');
    for (const [id, label] of [
      ['kitchen', 'Кухня'],
      ['wardrobe', 'Шкаф / гардероб'],
      ['soft', 'Мягкая мебель'],
      ['other', 'Другое'],
    ]) {
      ins.run(id, label);
    }
  }

  const nPri = d.prepare('SELECT COUNT(*) AS c FROM priorities').get().c;
  if (nPri === 0) {
    const ins = d.prepare('INSERT INTO priorities (id, label) VALUES (?,?)');
    for (const [id, label] of [
      ['price', 'Цена'],
      ['quality', 'Качество'],
      ['deadline', 'Сроки'],
    ]) {
      ins.run(id, label);
    }
  }
}

export async function fetchAllOrders() {
  const rows = getDb()
    .prepare(
      'SELECT phone_key, order_id, contract, stage, stage_label FROM orders ORDER BY order_id',
    )
    .all();
  return rows.map((r) => ({
    phoneKey: String(r.phone_key ?? '').replace(/\D/g, ''),
    orderId: String(r.order_id).trim(),
    contract: String(r.contract ?? r.order_id).trim(),
    stage: /** @type {'measure' | 'production' | 'delivery' | 'ready' | 'application'} */ (
      String(r.stage || 'application')
    ),
    stageLabel: String(r.stage_label || ''),
  }));
}

export async function appendOrderRow(row) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO orders (phone_key, order_id, contract, stage, stage_label)
       VALUES (@phone_key, @order_id, @contract, @stage, @stage_label)`,
    )
    .run({
      phone_key: row.phoneKey,
      order_id: row.orderId,
      contract: row.contract,
      stage: row.stage,
      stage_label: row.stageLabel,
    });
}

export async function appendLeadRow(row) {
  getDb()
    .prepare(
      `INSERT INTO leads (
        created_at, order_id, telegram_user_id, telegram_username, name, phone,
        furniture_type, furniture_label, need_measure, priority, priority_label,
        timeline, budget, sketch_file_id, sketch_link, source
      ) VALUES (
        @created_at, @order_id, @telegram_user_id, @telegram_username, @name, @phone,
        @furniture_type, @furniture_label, @need_measure, @priority, @priority_label,
        @timeline, @budget, @sketch_file_id, @sketch_link, @source
      )`,
    )
    .run({
      created_at: row.createdAt || new Date().toISOString(),
      order_id: row.orderId ?? '',
      telegram_user_id: String(row.telegramUserId ?? ''),
      telegram_username: row.telegramUsername ?? '',
      name: row.name ?? '',
      phone: row.phone ?? '',
      furniture_type: row.furnitureType ?? '',
      furniture_label: row.furnitureLabel ?? '',
      need_measure: row.needMeasure != null ? String(row.needMeasure) : '',
      priority: row.priority ?? '',
      priority_label: row.priorityLabel ?? '',
      timeline: row.timeline ?? '',
      budget: row.budget ?? '',
      sketch_file_id: row.sketchFileId ?? '',
      sketch_link: row.sketchLink ?? '',
      source: row.source ?? '',
    });
}

export async function appendHistoryRow(entry) {
  const at = entry.at || new Date().toISOString();
  const type = entry.type ?? '';
  const userId = entry.userId ?? entry.user_id ?? '';
  const rest = { ...entry };
  delete rest.at;
  delete rest.type;
  delete rest.userId;
  delete rest.user_id;
  const payload = JSON.stringify(rest);
  getDb()
    .prepare('INSERT INTO history (at, type, user_id, payload_json) VALUES (?,?,?,?)')
    .run(at, type, String(userId), payload);
}

export async function fetchFurnitureRows() {
  const rows = getDb()
    .prepare('SELECT id, label FROM furniture ORDER BY id')
    .all();
  return rows
    .filter((r) => r.id && r.label)
    .map((r) => ({ id: String(r.id).trim(), label: String(r.label).trim() }));
}

export async function fetchPriorityRows() {
  const rows = getDb()
    .prepare('SELECT id, label FROM priorities ORDER BY id')
    .all();
  return rows
    .filter((r) => r.id && r.label)
    .map((r) => ({ id: String(r.id).trim(), label: String(r.label).trim() }));
}

export async function fetchFaqRows() {
  const rows = getDb().prepare('SELECT id, title, text FROM faq ORDER BY id').all();
  /** @type {Record<string, { title: string, text: string }>} */
  const topics = {};
  for (const r of rows) {
    const id = r.id && String(r.id).trim();
    if (!id) continue;
    topics[id] = {
      title: String(r.title ?? '').trim(),
      text: String(r.text ?? '').trim(),
    };
  }
  return topics;
}

export async function getMaxOrderNumberFromOrders() {
  const rows = await fetchAllOrders();
  let max = 1999;
  for (const o of rows) {
    const n = parseNumericOrderId(o.orderId);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return max;
}

/**
 * Текущий прогресс квиза (дубль Redis-сессии для просмотра в БД / Supabase).
 * @param {{ telegramUserId: string, quizStepIndex: number, quizData: object, waitingCustom: string | null }} row
 */
export async function upsertQuizSession(row) {
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify(row.quizData ?? {});
  getDb()
    .prepare(
      `INSERT INTO quiz_sessions (telegram_user_id, quiz_step_index, quiz_data, waiting_custom, updated_at)
       VALUES (@telegram_user_id, @quiz_step_index, @quiz_data, @waiting_custom, @updated_at)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         quiz_step_index = excluded.quiz_step_index,
         quiz_data = excluded.quiz_data,
         waiting_custom = excluded.waiting_custom,
         updated_at = excluded.updated_at`,
    )
    .run({
      telegram_user_id: String(row.telegramUserId),
      quiz_step_index: row.quizStepIndex ?? 0,
      quiz_data: payload,
      waiting_custom: row.waitingCustom ?? null,
      updated_at: updatedAt,
    });
}

/** @param {string | number} telegramUserId */
export async function deleteQuizSession(telegramUserId) {
  getDb().prepare('DELETE FROM quiz_sessions WHERE telegram_user_id = ?').run(String(telegramUserId));
}

export const EXPORT_TABLES = [
  'orders',
  'leads',
  'history',
  'faq',
  'furniture',
  'priorities',
  'quiz_sessions',
];

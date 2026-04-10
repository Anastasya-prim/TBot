import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { EXPORT_TABLES } from './storeSqlite.js';

/** @type {pg.Pool | null} */
let pool = null;

function buildSslOption() {
  const certPath = process.env.PGSSLROOTCERT?.trim().replace(/^\uFEFF/, '');
  if (certPath && fs.existsSync(certPath)) {
    return {
      rejectUnauthorized: true,
      ca: fs.readFileSync(certPath, 'utf8'),
    };
  }
  if (process.env.PGSSLROOTCERT) {
    console.warn('PGSSLROOTCERT задан, но файл не найден:', certPath);
  }
  return { rejectUnauthorized: true };
}

export async function initStore() {
  const conn = process.env.DATABASE_URL?.trim().replace(/^\uFEFF/, '');
  if (!conn) throw new Error('DATABASE_URL не задан для PostgreSQL');

  pool = new pg.Pool({
    connectionString: conn,
    max: 10,
    ssl: buildSslOption(),
    connectionTimeoutMillis: 20000,
  });
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err?.message || err);
  });
}

export function getPool() {
  if (!pool) throw new Error('PostgreSQL не инициализирован');
  return pool;
}

export function closeStore() {
  if (pool) {
    const p = pool;
    pool = null;
    return p.end().catch(() => {});
  }
  return Promise.resolve();
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
  const p = getPool();
  const ddl = [
    `CREATE TABLE IF NOT EXISTS orders (
      phone_key TEXT NOT NULL,
      order_id TEXT PRIMARY KEY,
      contract TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'application',
      stage_label TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
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
    )`,
    `CREATE TABLE IF NOT EXISTS history (
      id SERIAL PRIMARY KEY,
      at TEXT NOT NULL,
      type TEXT NOT NULL,
      user_id TEXT,
      payload_json TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS faq (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS furniture (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS priorities (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS quiz_sessions (
      telegram_user_id TEXT PRIMARY KEY,
      quiz_step_index INTEGER NOT NULL DEFAULT 0,
      quiz_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      waiting_custom TEXT,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone_key)`,
  ];
  for (const sql of ddl) await p.query(sql);

  await seedDefaultsIfNeeded(p);
}

async function seedDefaultsIfNeeded(/** @type {pg.Pool} */ p) {
  const { rows: c1 } = await p.query('SELECT COUNT(*)::int AS c FROM orders');
  if (c1[0]?.c === 0) {
    const demo = [
      ['79991234567', 'З-1001', 'Д-2024-001', 'production', 'изготовление'],
      ['79001112233', 'З-1002', 'Д-2024-077', 'ready', 'готов к доставке'],
      ['79005556666', 'З-1003', 'Д-2023-412', 'measure', 'замер'],
    ];
    for (const row of demo) {
      await p.query(
        `INSERT INTO orders (phone_key, order_id, contract, stage, stage_label) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (order_id) DO NOTHING`,
        row,
      );
    }
  }

  const { rows: c2 } = await p.query('SELECT COUNT(*)::int AS c FROM faq');
  if (c2[0]?.c === 0) {
    const rows = [
      ['materials', 'Материалы', defaultFaqText('materials')],
      ['hardware', 'Фурнитура', defaultFaqText('hardware')],
      ['warranty', 'Гарантия', defaultFaqText('warranty')],
      ['timing', 'Сроки', defaultFaqText('timing')],
      ['payment', 'Оплата', defaultFaqText('payment')],
    ];
    for (const r of rows) {
      await p.query(
        `INSERT INTO faq (id, title, text) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        r,
      );
    }
  }

  const { rows: c3 } = await p.query('SELECT COUNT(*)::int AS c FROM furniture');
  if (c3[0]?.c === 0) {
    for (const [id, label] of [
      ['kitchen', 'Кухня'],
      ['wardrobe', 'Шкаф / гардероб'],
      ['soft', 'Мягкая мебель'],
      ['other', 'Другое'],
    ]) {
      await p.query(
        `INSERT INTO furniture (id, label) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
        [id, label],
      );
    }
  }

  const { rows: c4 } = await p.query('SELECT COUNT(*)::int AS c FROM priorities');
  if (c4[0]?.c === 0) {
    for (const [id, label] of [
      ['price', 'Цена'],
      ['quality', 'Качество'],
      ['deadline', 'Сроки'],
    ]) {
      await p.query(
        `INSERT INTO priorities (id, label) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
        [id, label],
      );
    }
  }
}

export async function fetchAllOrders() {
  const { rows } = await getPool().query(
    'SELECT phone_key, order_id, contract, stage, stage_label FROM orders ORDER BY order_id',
  );
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
  await getPool().query(
    `INSERT INTO orders (phone_key, order_id, contract, stage, stage_label)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (order_id) DO UPDATE SET
       phone_key = EXCLUDED.phone_key,
       contract = EXCLUDED.contract,
       stage = EXCLUDED.stage,
       stage_label = EXCLUDED.stage_label`,
    [row.phoneKey, row.orderId, row.contract, row.stage, row.stageLabel],
  );
}

export async function appendLeadRow(row) {
  await getPool().query(
    `INSERT INTO leads (
      created_at, order_id, telegram_user_id, telegram_username, name, phone,
      furniture_type, furniture_label, need_measure, priority, priority_label,
      timeline, budget, sketch_file_id, sketch_link, source
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
    )`,
    [
      row.createdAt || new Date().toISOString(),
      row.orderId ?? '',
      String(row.telegramUserId ?? ''),
      row.telegramUsername ?? '',
      row.name ?? '',
      row.phone ?? '',
      row.furnitureType ?? '',
      row.furnitureLabel ?? '',
      row.needMeasure != null ? String(row.needMeasure) : '',
      row.priority ?? '',
      row.priorityLabel ?? '',
      row.timeline ?? '',
      row.budget ?? '',
      row.sketchFileId ?? '',
      row.sketchLink ?? '',
      row.source ?? '',
    ],
  );
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
  await getPool().query(
    'INSERT INTO history (at, type, user_id, payload_json) VALUES ($1,$2,$3,$4)',
    [at, type, String(userId), payload],
  );
}

export async function fetchFurnitureRows() {
  const { rows } = await getPool().query('SELECT id, label FROM furniture ORDER BY id');
  return rows
    .filter((r) => r.id && r.label)
    .map((r) => ({ id: String(r.id).trim(), label: String(r.label).trim() }));
}

export async function fetchPriorityRows() {
  const { rows } = await getPool().query('SELECT id, label FROM priorities ORDER BY id');
  return rows
    .filter((r) => r.id && r.label)
    .map((r) => ({ id: String(r.id).trim(), label: String(r.label).trim() }));
}

export async function fetchFaqRows() {
  const { rows } = await getPool().query('SELECT id, title, text FROM faq ORDER BY id');
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
    const m = /^З-(\d+)$/i.exec(o.orderId);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/**
 * @param {{ telegramUserId: string, quizStepIndex: number, quizData: object, waitingCustom: string | null }} row
 */
export async function upsertQuizSession(row) {
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify(row.quizData ?? {});
  await getPool().query(
    `INSERT INTO quiz_sessions (telegram_user_id, quiz_step_index, quiz_data, waiting_custom, updated_at)
     VALUES ($1,$2,$3::jsonb,$4,$5)
     ON CONFLICT (telegram_user_id) DO UPDATE SET
       quiz_step_index = EXCLUDED.quiz_step_index,
       quiz_data = EXCLUDED.quiz_data,
       waiting_custom = EXCLUDED.waiting_custom,
       updated_at = EXCLUDED.updated_at`,
    [String(row.telegramUserId), row.quizStepIndex ?? 0, payload, row.waitingCustom ?? null, updatedAt],
  );
}

/** @param {string | number} telegramUserId */
export async function deleteQuizSession(telegramUserId) {
  await getPool().query('DELETE FROM quiz_sessions WHERE telegram_user_id = $1', [String(telegramUserId)]);
}

/**
 * Экспорт CSV при использовании PostgreSQL (тот же формат, что и для SQLite).
 */
export async function exportTablesToCsvFiles() {
  const outDir = process.env.EXPORT_DIR?.trim()
    ? path.isAbsolute(process.env.EXPORT_DIR.trim())
      ? process.env.EXPORT_DIR.trim()
      : path.join(process.cwd(), process.env.EXPORT_DIR.trim())
    : path.join(process.cwd(), 'exports');

  fs.mkdirSync(outDir, { recursive: true });
  const p = getPool();

  function csvEscape(v) {
    const s = String(v ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function rowsToCsv(rows) {
    if (!rows.length) return '\uFEFF';
    const cols = Object.keys(rows[0]);
    const header = cols.map(csvEscape).join(';');
    const lines = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(';'));
    return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n';
  }

  for (const table of EXPORT_TABLES) {
    const { rows } = await p.query(`SELECT * FROM ${table}`);
    const file = path.join(outDir, `${table}.csv`);
    fs.writeFileSync(file, rowsToCsv(rows), 'utf8');
    console.log('Записано:', file, `(${rows.length} строк)`);
  }
  console.log('Готово (PostgreSQL).');
}

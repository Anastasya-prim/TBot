import dns from 'node:dns';
import fs from 'fs';
import path from 'path';
import tls from 'node:tls';
import pg from 'pg';
import { EXPORT_TABLES } from './storeSqlite.js';

/** @type {pg.Pool | null} */
let pool = null;

function buildSslOption() {
  const insecure =
    String(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? '')
      .trim()
      .replace(/^\uFEFF/, '') === '0';
  if (insecure) {
    console.warn(
      'ВНИМАНИЕ: DATABASE_SSL_REJECT_UNAUTHORIZED=0 — проверка TLS-сертификата сервера отключена (только отладка).',
    );
    return { rejectUnauthorized: false };
  }

  const certPath = process.env.PGSSLROOTCERT?.trim().replace(/^\uFEFF/, '');
  const useSystemCa =
    String(process.env.DATABASE_SSL_USE_SYSTEM_CA ?? '')
      .trim()
      .replace(/^\uFEFF/, '') === '1';

  const extraPems = [];
  if (certPath) {
    if (fs.existsSync(certPath)) {
      extraPems.push(fs.readFileSync(certPath, 'utf8'));
    } else {
      console.warn('PGSSLROOTCERT задан, но файл не найден:', certPath);
    }
  }
  if (useSystemCa) {
    const sys = process.platform === 'linux' ? '/etc/ssl/certs/ca-certificates.crt' : null;
    if (sys && fs.existsSync(sys)) {
      extraPems.push(fs.readFileSync(sys, 'utf8'));
    } else {
      console.warn(
        'DATABASE_SSL_USE_SYSTEM_CA=1: ожидается /etc/ssl/certs/ca-certificates.crt (apt install ca-certificates).',
      );
    }
  }

  if (extraPems.length) {
    const ca = [...tls.rootCertificates];
    for (const pem of extraPems) {
      if (pem && pem.trim()) ca.push(pem);
    }
    return { rejectUnauthorized: true, ca };
  }
  return { rejectUnauthorized: true };
}

/**
 * TCP на IP, TLS — по имени хоста из URI (SNI + проверка сертификата).
 * @param {string} logicalHost
 * @param {object | boolean} baseSsl
 */
function sslForRemoteHost(logicalHost, baseSsl) {
  if (typeof baseSsl === 'object' && baseSsl !== null) {
    return { ...baseSsl, servername: logicalHost };
  }
  return { rejectUnauthorized: true, servername: logicalHost };
}

function invalidUrlHelp() {
  return new Error(
    'DATABASE_URL: неверный формат URI (Invalid URL). Частая причина — пароль с символами @ # % : / ? & + или пробел. ' +
      'Решение: в Supabase → Database → Reset database password и задайте пароль только буквами и цифрами, ' +
      'либо вставьте в URI пароль в виде URL-encoded (например @ → %40). ' +
      'Строка DATABASE_URL в .env — одна строка без переноса посередине и без лишних кавычек.',
  );
}

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** @param {string} hostname */
async function tryResolveIpv4(hostname) {
  try {
    const addrs = await dns.promises.resolve4(hostname);
    if (addrs.length) return addrs[0];
  } catch {
    /* нет A-записей */
  }
  try {
    const r = await dns.promises.lookup(hostname, { family: 4 });
    return r.address;
  } catch {
    return null;
  }
}

/**
 * DNS-over-HTTPS (обход «битого» резолвера на VPS; видим ту же A-запись, что и 1.1.1.1).
 * @param {string} hostname
 */
async function resolveIpv4ViaDoh(hostname) {
  try {
    const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
    const res = await fetch(url, { headers: { Accept: 'application/dns-json' } });
    if (!res.ok) return null;
    const data = await res.json();
    for (const a of data.Answer ?? []) {
      if (a.type !== 1 || typeof a.data !== 'string') continue;
      const ip = a.data.replace(/^"|"$/g, '').trim();
      if (IPV4_RE.test(ip)) return ip;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Сначала системный DNS; затем 8.8.8.8/1.1.1.1; затем DoH (на VPS часто только AAAA для pg).
 * @param {string} hostname
 */
async function resolveFirstIpv4(hostname) {
  let ip = await tryResolveIpv4(hostname);
  if (ip) return ip;

  const prev = dns.getServers();
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    ip = await tryResolveIpv4(hostname);
    if (ip) return ip;
  } finally {
    try {
      dns.setServers(prev);
    } catch {
      /* ignore */
    }
  }

  ip = await resolveIpv4ViaDoh(hostname);
  return ip || null;
}

function manualIpv4FromEnv() {
  const raw = process.env.DATABASE_HOST_IPV4?.trim().replace(/^\uFEFF/, '');
  if (!raw || !IPV4_RE.test(raw)) return null;
  return raw;
}

/**
 * Обход ENETUNREACH IPv6: TCP на IPv4; `ssl.servername` = хост из URI (node-pg 8.x не использует `hostaddr` для сокета).
 * @param {string} connString
 */
async function buildPoolConfig(connString) {
  let u;
  try {
    u = new URL(connString);
  } catch {
    throw invalidUrlHelp();
  }
  if (!u.hostname) throw invalidUrlHelp();

  const host = u.hostname;
  const port = parseInt(u.port || '5432', 10);
  const user = decodeURIComponent(u.username || '');
  const password = decodeURIComponent(u.password || '');
  let database = u.pathname.replace(/^\//, '') || 'postgres';

  const baseSsl = buildSslOption();
  const poolBase = {
    max: 10,
    connectionTimeoutMillis: 20000,
  };

  const manualIp = manualIpv4FromEnv();
  if (manualIp) {
    console.log(`PostgreSQL: TCP=${manualIp}, TLS servername=${host} (DATABASE_HOST_IPV4)`);
    return {
      ...poolBase,
      host: manualIp,
      port,
      user,
      password,
      database,
      ssl: sslForRemoteHost(host, baseSsl),
    };
  }

  const ipv4 = await resolveFirstIpv4(host);
  if (ipv4) {
    console.log(`PostgreSQL: TCP=${ipv4}, TLS servername=${host} (IPv4 из DNS/DoH)`);
    return {
      ...poolBase,
      host: ipv4,
      port,
      user,
      password,
      database,
      ssl: sslForRemoteHost(host, baseSsl),
    };
  }

  const isSupabaseDirect = /^db\.[^.]+\.supabase\.co$/i.test(host);
  const allowIpv6Conn =
    String(process.env.DATABASE_ALLOW_IPV6 ?? '')
      .trim()
      .replace(/^\uFEFF/, '') === '1';

  if (isSupabaseDirect && !allowIpv6Conn) {
    throw new Error(
      'Supabase: для хоста db.*.supabase.co не найден IPv4 (Direct часто только в IPv6-DNS). ' +
        'На VPS без IPv6 замените DATABASE_URL на строку «Session pooler» в Supabase → Project → Connect ' +
        '(вкладка с pooler, режим Session, порт 5432 или как в UI). ' +
        'Либо задайте DATABASE_HOST_IPV4=… Либо, если на сервере есть рабочий IPv6, добавьте DATABASE_ALLOW_IPV6=1.',
    );
  }

  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
  return {
    ...poolBase,
    connectionString: connString,
    ssl: baseSsl,
  };
}

export async function initStore() {
  const conn = process.env.DATABASE_URL?.trim().replace(/^\uFEFF/, '');
  if (!conn) throw new Error('DATABASE_URL не задан для PostgreSQL');

  const poolConfig = await buildPoolConfig(conn);

  pool = new pg.Pool(poolConfig);
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err?.message || err);
  });

  try {
    await pool.query('SELECT 1');
  } catch (e) {
    const code = e?.code ?? e?.cause?.code;
    const msg = String(e?.message ?? e);
    if (code === 'ERR_INVALID_URL' || msg.includes('Invalid URL')) {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      pool = null;
      throw invalidUrlHelp();
    }
    if (code === 'ENETUNREACH' || msg.includes('ENETUNREACH')) {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      pool = null;
      console.error('PostgreSQL ENETUNREACH:', msg);
      throw new Error(
        'PostgreSQL: хост недоступен (ENETUNREACH). Частые причины: только IPv6 в DNS, нет IPv6-маршрута, ' +
          'или фаервол режет исходящий порт 5432. В .env можно задать IPv4: DATABASE_HOST_IPV4=1.2.3.4 ' +
          '(команда: dig +short db.xxxxx.supabase.co @8.8.8.8). Либо возьмите URI Session pooler в Supabase → Connect.',
      );
    }
    if (
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      msg.includes('self-signed certificate') ||
      msg.includes('SELF_SIGNED_CERT')
    ) {
      console.error('PostgreSQL TLS (исходная ошибка):', code || '(no code)', msg);
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
      pool = null;
      const caHint = process.env.PGSSLROOTCERT
        ? ' Проверьте PGSSLROOTCERT (доп. CA суммируется с корнями Node).'
        : '';
      throw new Error(
        'PostgreSQL: ошибка TLS (сертификат). Обновите CA: sudo apt install ca-certificates.' +
          ' Либо DATABASE_SSL_USE_SYSTEM_CA=1.' +
          caHint +
          ' Временный обход (небезопасно): DATABASE_SSL_REJECT_UNAUTHORIZED=0 в .env',
      );
    }
    throw e;
  }
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
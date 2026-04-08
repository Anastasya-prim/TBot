/**
 * Экспорт данных БД в CSV (UTF-8 с BOM, разделитель `;`).
 * SQLite: база из SQLITE_PATH. PostgreSQL: при заданном DATABASE_URL.
 * Запуск: npm run export:csv
 */
import '../loadEnv.js';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { EXPORT_TABLES, getDbPath, usePostgres } from '../db/store.js';

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

async function exportSqlite() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error('Файл базы не найден:', dbPath);
    console.error('Сначала запустите бота хотя бы раз, чтобы создать data/tbot.db');
    process.exit(1);
  }

  const outDir = process.env.EXPORT_DIR?.trim()
    ? path.isAbsolute(process.env.EXPORT_DIR.trim())
      ? process.env.EXPORT_DIR.trim()
      : path.join(process.cwd(), process.env.EXPORT_DIR.trim())
    : path.join(process.cwd(), 'exports');

  fs.mkdirSync(outDir, { recursive: true });
  const db = new Database(dbPath, { readonly: true });

  for (const table of EXPORT_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    const file = path.join(outDir, `${table}.csv`);
    fs.writeFileSync(file, rowsToCsv(rows), 'utf8');
    console.log('Записано:', file, `(${rows.length} строк)`);
  }

  db.close();
  console.log('Готово. Откройте CSV в Excel или в другом редакторе.');
}

async function main() {
  if (usePostgres()) {
    const { initStore, exportTablesToCsvFiles, closeStore } = await import('../db/storePg.js');
    await initStore();
    try {
      await exportTablesToCsvFiles();
    } finally {
      await closeStore();
    }
    return;
  }
  await exportSqlite();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

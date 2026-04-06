/**
 * Экспорт таблиц SQLite в CSV (UTF-8 с BOM — удобно открывать в Excel).
 * Запуск: node src/scripts/exportCsv.js
 * Папка: EXPORT_DIR (по умолчанию ./exports), база: SQLITE_PATH (как у бота).
 */
import '../loadEnv.js';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { EXPORT_TABLES, getDbPath } from '../db/store.js';

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

const outDir = process.env.EXPORT_DIR?.trim()
  ? path.isAbsolute(process.env.EXPORT_DIR.trim())
    ? process.env.EXPORT_DIR.trim()
    : path.join(process.cwd(), process.env.EXPORT_DIR.trim())
  : path.join(process.cwd(), 'exports');

const dbPath = getDbPath();
if (!fs.existsSync(dbPath)) {
  console.error('Файл базы не найден:', dbPath);
  console.error('Сначала запустите бота хотя бы раз, чтобы создать data/tbot.db');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const db = new Database(dbPath, { readonly: true });

for (const table of EXPORT_TABLES) {
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  const file = path.join(outDir, `${table}.csv`);
  fs.writeFileSync(file, rowsToCsv(rows), 'utf8');
  console.log('Записано:', file, `(${rows.length} строк)`);
}

db.close();
console.log('Готово. Откройте CSV в Excel или загрузите на Яндекс Диск вручную.');

import * as sqlite from './storeSqlite.js';
import * as pg from './storePg.js';

/**
 * Если задан DATABASE_URL (postgresql://…), используется PostgreSQL (в т.ч. Yandex Managed PostgreSQL).
 * Иначе — локальный SQLite (data/tbot.db).
 */
export function usePostgres() {
  const raw = process.env.DATABASE_URL?.trim().replace(/^\uFEFF/, '');
  return Boolean(raw && /^postgres(ql)?:\/\//i.test(raw));
}

export async function initSheetsClient() {
  if (usePostgres()) return pg.initStore();
  return sqlite.initSheetsClient();
}

export async function ensureSpreadsheetStructure() {
  if (usePostgres()) return pg.ensureSpreadsheetStructure();
  return sqlite.ensureSpreadsheetStructure();
}

export async function fetchAllOrders() {
  if (usePostgres()) return pg.fetchAllOrders();
  return sqlite.fetchAllOrders();
}

export async function appendOrderRow(row) {
  if (usePostgres()) return pg.appendOrderRow(row);
  return sqlite.appendOrderRow(row);
}

export async function appendLeadRow(row) {
  if (usePostgres()) return pg.appendLeadRow(row);
  return sqlite.appendLeadRow(row);
}

export async function appendHistoryRow(entry) {
  if (usePostgres()) return pg.appendHistoryRow(entry);
  return sqlite.appendHistoryRow(entry);
}

export async function fetchFurnitureRows() {
  if (usePostgres()) return pg.fetchFurnitureRows();
  return sqlite.fetchFurnitureRows();
}

export async function fetchPriorityRows() {
  if (usePostgres()) return pg.fetchPriorityRows();
  return sqlite.fetchPriorityRows();
}

export async function fetchFaqRows() {
  if (usePostgres()) return pg.fetchFaqRows();
  return sqlite.fetchFaqRows();
}

export async function getMaxOrderNumberFromOrders() {
  if (usePostgres()) return pg.getMaxOrderNumberFromOrders();
  return sqlite.getMaxOrderNumberFromOrders();
}

export async function closeStore() {
  if (usePostgres()) return pg.closeStore();
  sqlite.closeStore();
}

/** Путь к SQLite; для режима PostgreSQL не используется. */
export function getDbPath() {
  return sqlite.getDbPath();
}

export { EXPORT_TABLES } from './storeSqlite.js';

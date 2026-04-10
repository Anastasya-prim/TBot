/**
 * Числовой номер из order_id: новый формат «2003» или старый «З-2003».
 * @param {string} orderId
 * @returns {number}
 */
export function parseNumericOrderId(orderId) {
  const s = String(orderId ?? '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /^(\u0417|\u0437)-(\d+)$/.exec(s);
  return m ? parseInt(m[2], 10) : NaN;
}

/**
 * Ключ для поиска заявки: «2003», «З-2003», «з-2003», «3-2003» → «2003».
 * @param {string} raw
 * @returns {string} пустая строка если не похоже на номер заявки
 */
export function normalizeOrderIdLookupKey(raw) {
  const t = String(raw ?? '').trim().replace(/\s/g, '').toLowerCase();
  if (/^\d+$/.test(t)) return t;
  const legacy = /^(\u0437|3)-(\d+)$/.exec(t);
  if (legacy) return legacy[2];
  return '';
}

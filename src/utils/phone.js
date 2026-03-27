/**
 * Нормализация телефона для поиска: оставляем цифры, 8XXXXXXXXXX -> 7XXXXXXXXXX
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let d = raw.replace(/\D/g, '');
  if (d.length === 10) d = '7' + d;
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  if (d.length === 11 && d.startsWith('7')) return d;
  return null;
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
export function isValidRuPhone(raw) {
  return normalizePhone(raw) !== null;
}

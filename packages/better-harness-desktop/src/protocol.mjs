export const VERSION = 1;
export const HEADER = 'x-harness-studio-token';
export const message = (type, fields = {}) => ({ ...fields, version: VERSION, type });
export function isMessage(value, type) {
  return value !== null && typeof value === 'object' && value.version === VERSION && value.type === type;
}
export function isStudioUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0
      && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === '';
  } catch { return false; }
}
export function isSameOrigin(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}
export function isExternalUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

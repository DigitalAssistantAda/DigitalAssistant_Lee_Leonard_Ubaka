import { apiFetch } from './apiClient';

const debounceTimers = new Map();
const lastSent = new Map();

/**
 * Debounced audit log for client-side filter boxes (Documents, AI Assistant).
 * Min query length 2; dedupes identical workspace+context+query within 15s.
 */
export function scheduleClientFilterSearchLog(workspaceId, query, context) {
  const wid = Number(workspaceId);
  if (!Number.isFinite(wid) || wid <= 0) return;

  const trimmed = (query || '').trim();
  if (trimmed.length < 2) return;

  const key = `${wid}:${context}`;
  const prevTimer = debounceTimers.get(key);
  if (prevTimer) clearTimeout(prevTimer);

  const t = setTimeout(async () => {
    debounceTimers.delete(key);
    const q = trimmed.slice(0, 500);
    const now = Date.now();
    const prev = lastSent.get(key);
    if (prev && prev.query === q && now - prev.t < 15000) return;
    lastSent.set(key, { query: q, t: now });

    try {
      await apiFetch('/api/v1/search/log-client-filter', {
        method: 'POST',
        body: { workspace_id: wid, query: q, context },
      });
      window.dispatchEvent(new CustomEvent('client-search-logged'));
    } catch {
      // Logging must not affect UX
    }
  }, 750);

  debounceTimers.set(key, t);
}

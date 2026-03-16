/**
 * Normalize API list responses to a single array.
 * Handles both { items: [...] } and raw array responses.
 * @param {unknown} data - API response (object with items or array)
 * @returns {unknown[]}
 */
export function normalizeItems(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

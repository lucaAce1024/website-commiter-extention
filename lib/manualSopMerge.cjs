/**
 * Upsert a manual SOP mapping entry into an existing mappings array.
 * Rule: per standardField, keep only one entry (new wins).
 */
function upsertMapping(existing, entry) {
  const list = Array.isArray(existing) ? existing.filter(Boolean) : [];
  if (!entry || !entry.standardField) return list;
  const out = list.filter((m) => m && m.standardField !== entry.standardField);
  out.push(entry);
  return out;
}

module.exports = { upsertMapping };


function sanitizeRelPathPart(part) {
  return String(part || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'x';
}

function guessImageExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('svg')) return 'svg';
  return 'jpg';
}

function sanitizeRelPath(relPath) {
  const clean = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\0/g, '');
  const parts = clean.split('/').filter(Boolean);
  const safe = [];
  for (const p of parts) {
    if (p === '.' || p === '..') continue;
    safe.push(p);
  }
  return safe.join('/');
}

module.exports = { sanitizeRelPathPart, guessImageExt, sanitizeRelPath };


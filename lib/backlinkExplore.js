/**
 * 外链采集：批次 ID 生成与 URL/域名标准化、去重（FR-8, FR-11）
 */

const BATCH_ID_PREFIX = 'batch_';
const STORAGE_KEY_BATCHES = 'backlinkExplorationBatches';
const STORAGE_KEY_LAST_BATCH_SEC = 'backlinkExploreLastBatchSec';
const STORAGE_KEY_LAST_BATCH_INDEX = 'backlinkExploreLastBatchIndex';

/**
 * 生成唯一任务批次 ID，格式 batch_YYYYMMDD_HHmmss，同秒内追加序号
 * @returns {Promise<string>}
 */
async function generateBatchId() {
  const now = new Date();
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const D = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const base = `${BATCH_ID_PREFIX}${Y}${M}${D}_${h}${m}${s}`;
  const secKey = `${Y}${M}${D}_${h}${m}${s}`;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get([STORAGE_KEY_LAST_BATCH_SEC, STORAGE_KEY_LAST_BATCH_INDEX]);
      const lastSec = stored[STORAGE_KEY_LAST_BATCH_SEC];
      let index = stored[STORAGE_KEY_LAST_BATCH_INDEX] ?? 0;
      if (lastSec === secKey) {
        index += 1;
      } else {
        index = 0;
      }
      await chrome.storage.local.set({
        [STORAGE_KEY_LAST_BATCH_SEC]: secKey,
        [STORAGE_KEY_LAST_BATCH_INDEX]: index
      });
      return index > 0 ? `${base}_${index}` : base;
    } catch {
      return base;
    }
  }
  return base;
}

/**
 * URL 标准化：小写、去末尾斜杠、去 fragment、去默认端口
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  let u = url.trim().toLowerCase();
  try {
    const parsed = new URL(u);
    if (parsed.port === '80' && parsed.protocol === 'http:') parsed.port = '';
    if (parsed.port === '443' && parsed.protocol === 'https:') parsed.port = '';
    u = parsed.origin + parsed.pathname;
    if (u.endsWith('/') && parsed.pathname !== '/') u = u.slice(0, -1);
    return u;
  } catch {
    if (u.endsWith('/')) u = u.slice(0, -1);
    const hash = u.indexOf('#');
    if (hash !== -1) u = u.slice(0, hash);
    return u;
  }
}

/**
 * 从 URL 或域名字符串提取 hostname 并标准化（小写）
 * @param {string} urlOrDomain
 * @returns {string}
 */
function normalizeDomain(urlOrDomain) {
  if (typeof urlOrDomain !== 'string' || !urlOrDomain.trim()) return '';
  const s = urlOrDomain.trim().toLowerCase();
  try {
    const u = s.startsWith('http') ? new URL(s) : new URL('https://' + s);
    return u.hostname || s;
  } catch {
    const host = s.replace(/^https?:\/\//, '').split('/')[0].split('#')[0];
    return host || s;
  }
}

/**
 * URL 列表去重（标准化后按集合去重，保留顺序）
 * @param {string[]} urls
 * @returns {string[]}
 */
function dedupeUrls(urls) {
  if (!Array.isArray(urls)) return [];
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    const n = normalizeUrl(u);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 域名列表去重（标准化 hostname 后按集合去重，保留顺序）
 * @param {string[]} domains
 * @returns {string[]}
 */
function dedupeDomains(domains) {
  if (!Array.isArray(domains)) return [];
  const seen = new Set();
  const out = [];
  for (const d of domains) {
    const n = normalizeDomain(d);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/**
 * 将排除域名配置转为标准化 hostname 集合（支持逗号分隔字符串或数组）
 * @param {string|string[]} excludeDomains
 * @returns {Set<string>}
 */
function getExcludeDomainSet(excludeDomains) {
  const set = new Set();
  if (excludeDomains == null) return set;
  const arr = typeof excludeDomains === 'string'
    ? excludeDomains.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
    : Array.isArray(excludeDomains) ? excludeDomains : [];
  for (const d of arr) {
    const n = normalizeDomain(d);
    if (n) set.add(n);
  }
  return set;
}

/**
 * 从 URL 列表中排除属于指定域名的 URL（用于过滤本站等）
 * @param {string[]} urls
 * @param {string|string[]} excludeDomains 要排除的域名，逗号分隔或数组
 * @returns {string[]}
 */
function filterUrlsExcludingDomains(urls, excludeDomains) {
  if (!Array.isArray(urls)) return [];
  const excludeSet = getExcludeDomainSet(excludeDomains);
  if (excludeSet.size === 0) return urls;
  const out = [];
  for (const u of urls) {
    const host = normalizeDomain(u);
    if (host && !excludeSet.has(host)) out.push(u);
  }
  return out;
}

/**
 * 从域名列表中排除指定域名（用于过滤本站等）
 * @param {string[]} domains
 * @param {string|string[]} excludeDomains 要排除的域名，逗号分隔或数组
 * @returns {string[]}
 */
function filterDomainsExcludingDomains(domains, excludeDomains) {
  if (!Array.isArray(domains)) return [];
  const excludeSet = getExcludeDomainSet(excludeDomains);
  if (excludeSet.size === 0) return domains;
  const out = [];
  for (const d of domains) {
    const n = normalizeDomain(d);
    if (n && !excludeSet.has(n)) out.push(n);
  }
  return out;
}

/**
 * 默认批次进度结构（PRD 5.4）
 * @param {string} batchId
 * @param {object} [sourceInput]
 * @returns {object}
 */
function createBatch(batchId, sourceInput = {}) {
  return {
    batchId,
    createdAt: new Date().toISOString(),
    status: 'running',
    phase: 'idle',
    sourceInput,
    urlList: [],
    urlProgress: {},
    lastProcessedIndex: 0,
    discoveredSites: [],
    dugDomains: [],
    updatedAt: new Date().toISOString()
  };
}

/**
 * 持久化前对批次中的 urlList、dugDomains、discoveredSites 去重（FR-11）
 * @param {object} batch
 * @returns {object}
 */
function dedupeBatchBeforeSave(batch) {
  const b = { ...batch };
  if (Array.isArray(b.urlList)) b.urlList = dedupeUrls(b.urlList);
  if (Array.isArray(b.dugDomains)) b.dugDomains = dedupeDomains(b.dugDomains);
  if (Array.isArray(b.discoveredSites)) {
    const byUrl = new Map();
    for (const site of b.discoveredSites) {
      const url = normalizeUrl(site.url || site);
      if (url && !byUrl.has(url)) byUrl.set(url, typeof site === 'object' ? site : { url: site });
    }
    b.discoveredSites = Array.from(byUrl.values());
  }
  b.updatedAt = new Date().toISOString();
  return b;
}

/**
 * 保存批次到 storage（会先执行去重）
 * @param {object} batch
 * @returns {Promise<void>}
 */
async function saveBatch(batch) {
  const b = dedupeBatchBeforeSave(batch);
  const stored = await chrome.storage.local.get([STORAGE_KEY_BATCHES]);
  const batches = stored[STORAGE_KEY_BATCHES] || {};
  batches[b.batchId] = b;
  await chrome.storage.local.set({ [STORAGE_KEY_BATCHES]: batches });
}

/**
 * 读取单个批次
 * @param {string} batchId
 * @returns {Promise<object|null>}
 */
async function loadBatch(batchId) {
  const stored = await chrome.storage.local.get([STORAGE_KEY_BATCHES]);
  const batches = stored[STORAGE_KEY_BATCHES] || {};
  return batches[batchId] || null;
}

/**
 * 列出所有批次（按 updatedAt 倒序）
 * @returns {Promise<object[]>}
 */
async function listBatches() {
  const stored = await chrome.storage.local.get([STORAGE_KEY_BATCHES]);
  const batches = stored[STORAGE_KEY_BATCHES] || {};
  return Object.values(batches).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateBatchId,
    normalizeUrl,
    normalizeDomain,
    dedupeUrls,
    dedupeDomains,
    getExcludeDomainSet,
    filterUrlsExcludingDomains,
    filterDomainsExcludingDomains,
    createBatch,
    dedupeBatchBeforeSave,
    saveBatch,
    loadBatch,
    listBatches,
    STORAGE_KEY_BATCHES
  };
}

/**
 * 外链采集：批次 ID 生成与 URL/域名标准化、去重（FR-8, FR-11）
 */

const BATCH_ID_PREFIX = 'batch_';
const STORAGE_KEY_BATCHES = 'backlinkExplorationBatches';
const STORAGE_KEY_LAST_BATCH_SEC = 'backlinkExploreLastBatchSec';
const STORAGE_KEY_LAST_BATCH_INDEX = 'backlinkExploreLastBatchIndex';
const STORAGE_KEY_AHREFS_CACHE = 'ahrefs_domain_cache';
const AHREFS_CACHE_EXPIRY_DAYS = 15;

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

  // 写入 / 覆盖当前批次
  batches[b.batchId] = b;

  // 只保留最近 10 个「有 URL 的批次」（按 updatedAt 倒序）
  const allBatches = Object.values(batches);
  const batchesWithUrls = allBatches
    .filter((item) => Array.isArray(item.urlList) && item.urlList.length > 0)
    .sort((a, c) => (c.updatedAt || '').localeCompare(a.updatedAt || ''));

  if (batchesWithUrls.length > 10) {
    const toRemove = new Set(
      batchesWithUrls.slice(10).map((item) => item.batchId),
    );
    for (const [id, value] of Object.entries(batches)) {
      if (value && toRemove.has(value.batchId)) {
        delete batches[id];
      }
    }
  }

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

// ========== Ahrefs 域名缓存 ==========

/**
 * 获取 Ahrefs 域名缓存
 * @returns {Promise<Object>} { domain: { domain, cachedAt, urlFromList, backlinks, overview } }
 */
async function getAhrefsCache() {
  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY_AHREFS_CACHE]);
    return stored[STORAGE_KEY_AHREFS_CACHE] || {};
  } catch (e) {
    console.warn('[Ahrefs Cache] Failed to load cache:', e);
    return {};
  }
}

/**
 * 保存 Ahrefs 域名缓存
 * @param {Object} cache - 缓存对象 { domain: { domain, cachedAt, urlFromList, backlinks, overview } }
 * @returns {Promise<void>}
 */
async function saveAhrefsCache(cache) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_AHREFS_CACHE]: cache });
  } catch (e) {
    console.warn('[Ahrefs Cache] Failed to save cache:', e);
  }
}

/**
 * 检查缓存是否过期（超过15天）
 * @param {string} cachedDate - 缓存日期 (ISO 8601 格式)
 * @returns {boolean}
 */
function isAhrefsCacheExpired(cachedDate) {
  if (!cachedDate) return true;
  const cacheDate = new Date(cachedDate);
  const now = new Date();
  const diffDays = Math.floor((now - cacheDate) / (1000 * 60 * 60 * 24));
  return diffDays >= AHREFS_CACHE_EXPIRY_DAYS;
}

/**
 * 获取域名的 Ahrefs 反链缓存（如果存在且未过期）
 * @param {string} domain - 域名
 * @returns {Promise<Object|null>} 返回缓存数据或 null
 */
async function getAhrefsCacheForDomain(domain) {
  const cache = await getAhrefsCache();
  const cached = cache[domain];
  if (!cached) return null;
  if (isAhrefsCacheExpired(cached.cachedAt)) {
    // 缓存过期，删除
    delete cache[domain];
    await saveAhrefsCache(cache);
    return null;
  }
  return cached;
}

/**
 * 保存域名的 Ahrefs 反链缓存
 * @param {string} domain - 域名
 * @param {Object} result - Ahrefs 查询结果 { urlFromList, backlinks, overview }
 * @returns {Promise<void>}
 */
async function saveAhrefsCacheForDomain(domain, result) {
  const cache = await getAhrefsCache();

  // 每个域名的 urlFromList / backlinks 做上限裁剪，避免单域缓存过大
  const MAX_URLS_PER_DOMAIN = 1000;
  const MAX_BACKLINKS_PER_DOMAIN = 1000;
  const safeUrlFromList = Array.isArray(result.urlFromList)
    ? result.urlFromList.slice(0, MAX_URLS_PER_DOMAIN)
    : [];
  const safeBacklinks = Array.isArray(result.backlinks)
    ? result.backlinks.slice(0, MAX_BACKLINKS_PER_DOMAIN)
    : [];

  cache[domain] = {
    domain,
    cachedAt: new Date().toISOString().split('T')[0], // 只保存日期部分 YYYY-MM-DD
    urlFromList: safeUrlFromList,
    backlinks: safeBacklinks,
    overview: result.overview || {}
  };

  // 整体缓存做滚动清理：只保留最近 20 个域名（按 cachedAt 倒序）
  const entries = Object.entries(cache);
  if (entries.length > 20) {
    entries.sort(([, a], [, b]) =>
      (b.cachedAt || '').localeCompare(a.cachedAt || '')
    );
    const keepDomains = new Set(entries.slice(0, 20).map(([k]) => k));
    for (const key of Object.keys(cache)) {
      if (!keepDomains.has(key)) {
        delete cache[key];
      }
    }
  }

  await saveAhrefsCache(cache);
}

/**
 * 清除指定域名的 Ahrefs 缓存
 * @param {string} domain - 域名
 * @returns {Promise<void>}
 */
async function clearAhrefsCacheForDomain(domain) {
  const cache = await getAhrefsCache();
  if (cache[domain]) {
    delete cache[domain];
    await saveAhrefsCache(cache);
  }
}

/**
 * 清除所有 Ahrefs 缓存
 * @returns {Promise<void>}
 */
async function clearAllAhrefsCache() {
  await chrome.storage.local.remove([STORAGE_KEY_AHREFS_CACHE]);
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
    // Ahrefs 缓存相关
    getAhrefsCache,
    saveAhrefsCache,
    isAhrefsCacheExpired,
    getAhrefsCacheForDomain,
    saveAhrefsCacheForDomain,
    clearAhrefsCacheForDomain,
    clearAllAhrefsCache,
    STORAGE_KEY_BATCHES,
    STORAGE_KEY_AHREFS_CACHE,
    AHREFS_CACHE_EXPIRY_DAYS
  };
}

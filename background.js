// Background service worker for Navigation Site Auto Submitter
// Handles extension lifecycle and cross-tab communication

importScripts('lib/fullAiAgent.js');

// ========== Local Asset Cache (read-only helpers for content/options) ==========
const ASSET_CACHE_IDB_NAME = 'local_asset_cache_idb_v1';
const ASSET_CACHE_IDB_STORE = 'handles';
const ASSET_CACHE_ROOT_KEY = 'asset_cache_root_dir';
const ASSET_CACHE_SUBDIR = 'backlink-collector-cache';

function openAssetCacheIDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(ASSET_CACHE_IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(ASSET_CACHE_IDB_STORE)) {
          db.createObjectStore(ASSET_CACHE_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function assetCacheGetRootHandle() {
  const db = await openAssetCacheIDB();
  return await new Promise((resolve) => {
    const tx = db.transaction(ASSET_CACHE_IDB_STORE, 'readonly');
    const req = tx.objectStore(ASSET_CACHE_IDB_STORE).get(ASSET_CACHE_ROOT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function resolveRelPathFileHandle(rootHandle, relPath) {
  const clean = String(relPath || '').replace(/^\/+/, '').replace(/\.\.+/g, '.');
  const parts = clean.split('/').filter(Boolean);
  if (!parts.length) throw new Error('relPath 为空');

  const baseDir = await rootHandle.getDirectoryHandle(ASSET_CACHE_SUBDIR, { create: false });
  let dir = baseDir;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i], { create: false });
  }
  const fileName = parts[parts.length - 1];
  return await dir.getFileHandle(fileName, { create: false });
}

async function assetCacheReadFileAsArrayBuffer(relPath) {
  const root = await assetCacheGetRootHandle();
  if (!root) throw new Error('未设置图片缓存文件夹');
  const perm = await root.requestPermission?.({ mode: 'read' });
  if (perm && perm !== 'granted') throw new Error('未授予缓存目录读取权限');
  const fileHandle = await resolveRelPathFileHandle(root, relPath);
  const file = await fileHandle.getFile();
  const buf = await file.arrayBuffer();
  return { name: file.name, mime: file.type || 'application/octet-stream', byteSize: file.size, arrayBuffer: buf };
}

function arrayBufferToDataUrl(arrayBuffer, mime) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${mime || 'application/octet-stream'};base64,${base64}`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;
  if (action === 'assetCache_readFile') {
    (async () => {
      try {
        const out = await assetCacheReadFileAsArrayBuffer(message.relPath);
        sendResponse({ success: true, ...out });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }
  if (action === 'assetCache_readAsDataUrl') {
    (async () => {
      try {
        const out = await assetCacheReadFileAsArrayBuffer(message.relPath);
        const dataUrl = arrayBufferToDataUrl(out.arrayBuffer, out.mime);
        sendResponse({ success: true, dataUrl });
      } catch (e) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }
});

const FILL_FIELD_MENU_ID = 'nav-submitter-fill-single';
/** 提交后自动验证：tabId -> { siteUrl }，该 tab 下次 load complete 时触发验证 */
let pendingVerifyByTab = {};
const VERIFY_AFTER_LOAD_DELAY_MS = 2500;
/** 与 popup 一致的 Blog 面板状态 key 前缀（per-URL） */
const BLOG_POPUP_STATE_PREFIX = 'blog_popup_state_';

function getBlogPopupStateCacheKey(url) {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
  try {
    const u = new URL(url);
    return 'blog_' + u.hostname + u.pathname;
  } catch {
    return null;
  }
}

/**
 * 根据 blogCommentGenerateAndFill 的响应构建与 popup 一致的 statusLine + message（popup 关闭后由 background 写入 storage）
 */
function buildBlogPopupStateFromResponse(response) {
  if (!response || typeof response !== 'object') return null;
  const elapsedMs = response.elapsedMs ?? response.result?.elapsedMs ?? 0;
  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  if (response.success && response.result) {
    const r = response.result;
    const totalFields = r.fieldCount ?? r.filledCount ?? 0;
    const allFilled = totalFields > 0 && r.filledCount >= totalFields;
    let checkText = '';
    if (allFilled && !r.hasSpamVerification && r.clickedSubmit) {
      checkText = '完整检查：已填充全部字段并已自动提交。';
    } else if (allFilled && r.hasSpamVerification) {
      checkText = '完整检查：已填充全部字段，因检测到验证项未自动提交。';
    } else if (allFilled) {
      checkText = '完整检查：已填充全部字段，可手动提交。';
    } else {
      checkText = `完整检查：已填充 ${r.filledCount}/${totalFields} 个字段，未完全填充。`;
    }
    const methodHint = r.method === 'oneShot' ? '一发' : r.method === 'cache' ? '缓存' : '关键词';
    const statusLineText = `耗时 ${elapsedSec}s (${methodHint}) · 已填充 ${r.filledCount} 个字段${r.consentCheckboxesChecked > 0 ? `，已勾选 ${r.consentCheckboxesChecked} 个选项` : ''} · ${checkText}`;
    let statusMessageText = `已填充 ${r.filledCount} 个字段。`;
    if (r.consentCheckboxesChecked > 0) statusMessageText += ` 已勾选 ${r.consentCheckboxesChecked} 个选项。`;
    if (r.hasSpamVerification) {
      statusMessageText += ' 检测到验证项，请手动完成验证后点击提交。';
    } else if (r.clickedSubmit) {
      statusMessageText += ' 已自动点击提交。页面刷新后将自动验证本站链接是否出现，再次打开 popup 可查看验证结果。';
    }
    return { statusLineText, statusMessageText, statusMessageType: 'success' };
  }
  const statusLineText = `失败 · 已耗时 ${elapsedSec}s`;
  const statusMessageText = response.error || '操作失败';
  return { statusLineText, statusMessageText, statusMessageType: 'error' };
}
const FILL_FIELD_ITEMS = [
  { id: 'siteUrl', title: '网站 URL' },
  { id: 'siteName', title: '网站名称' },
  { id: 'email', title: '联系邮箱' },
  { id: 'category', title: '分类 (Categories)' },
  { id: 'tags', title: '标签 (Tags)' },
  { id: 'pricing', title: '定价 (Pricing)' },
  { id: 'tagline', title: '标语/口号' },
  { id: 'shortDescription', title: '简短描述' },
  { id: 'longDescription', title: '详细描述 / Introduction' },
  { id: 'logo', title: 'Logo' },
  { id: 'screenshot', title: '界面截图' }
];

function buildContextMenu() {
  const contexts = ['page', 'editable'];
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: FILL_FIELD_MENU_ID,
      title: '填充单个字段 (外链提交助手)',
      contexts
    });
    FILL_FIELD_ITEMS.forEach((item) => {
      chrome.contextMenus.create({
        id: `fill_${item.id}`,
        parentId: FILL_FIELD_MENU_ID,
        title: item.title,
        contexts
      });
    });
  });
}

// Initialize default storage on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Initialize default storage structure
    await chrome.storage.local.set({
      sites: [],
      navSites: [],
      fieldMappings: {},
      submissionRecords: {},
      blogCommentSites: [],         // Blog 评论站点列表（目标 URL）
      blogCommentFieldMappings: {}, // 评论表单字段映射缓存
      blogCommentRecords: {},       // 评论提交记录（可选）
      settings: {
        currentSiteId: null,
        llmConfig: {
          enabled: false,
          endpoint: '',
          apiKey: '',
          model: 'gpt-3.5-turbo'
        },
        autoSubmit: false
      }
    });
    console.log('[Background] Extension installed, default storage initialized');
  }
  buildContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  buildContextMenu();
});

// 脚本加载时也创建一次（重载扩展后右键菜单会立即出现）
buildContextMenu();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!info.menuItemId || String(info.menuItemId).indexOf('fill_') !== 0) return;
  const standardField = String(info.menuItemId).replace(/^fill_/, '');
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'fillSingleField', standardField }).catch(() => {});
  }
});

// ========== Ahrefs 直接 API 调用（通过 CapSolver 绕过 Turnstile） ==========
const AHREFS_TURNSTILE_SITE_KEY = '0x4AAAAAAAAzi9ITzSN9xKMi';
const CAPSOLVER_CREATE_TASK = 'https://api.capsolver.com/createTask';
const CAPSOLVER_GET_RESULT = 'https://api.capsolver.com/getTaskResult';
const AHREFS_OVERVIEW_URL = 'https://ahrefs.com/v4/stGetFreeBacklinksOverview';
const AHREFS_BACKLINKS_URL = 'https://ahrefs.com/v4/stGetFreeBacklinksList';
const AHREFS_CACHE_KEY = 'ahrefsCheckedDomains';
const AHREFS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天缓存有效期
const AHREFS_CACHE_IDB_DB_NAME = 'ahrefs_cache_idb_v1';
const AHREFS_CACHE_IDB_STORE_NAME = 'ahrefs_cache_entries';
const AHREFS_CACHE_IDB_MAX_DOMAINS = 20; // 与原 chrome.storage.local 行为保持一致

/**
 * 标准化域名（用于缓存 key）
 * @param {string} domain
 * @returns {string}
 */
function ahrefsNormalizeDomainForCache(domain) {
  if (!domain || typeof domain !== 'string') return '';
  return domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
}

/**
 * 从缓存获取 Ahrefs 数据
 * @param {string} domain
 * @returns {Promise<{urlFromList: string[], backlinks: object[], overview: object}|null>}
 */
function openAhrefsCacheIDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(AHREFS_CACHE_IDB_DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(AHREFS_CACHE_IDB_STORE_NAME)) {
          const store = db.createObjectStore(AHREFS_CACHE_IDB_STORE_NAME, { keyPath: 'normalized' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      reject(e);
    }
  });
}

async function pruneAhrefsCacheIDB(db, maxDomains = AHREFS_CACHE_IDB_MAX_DOMAINS) {
  try {
    await new Promise((resolve) => {
      const tx = db.transaction(AHREFS_CACHE_IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(AHREFS_CACHE_IDB_STORE_NAME);
      const index = store.index('timestamp');

      let kept = 0;
      const cursorReq = index.openCursor(null, 'prev'); // timestamp desc
      cursorReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const key = cursor.primaryKey;
        if (kept < maxDomains) {
          kept += 1;
          cursor.continue();
        } else {
          store.delete(key);
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // best-effort
    });
  } catch (_) {
    // ignore
  }
}

async function ahrefsGetFromCache(domain) {
  const normalized = ahrefsNormalizeDomainForCache(domain);
  if (!normalized) return null;
  try {
    const db = await openAhrefsCacheIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(AHREFS_CACHE_IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(AHREFS_CACHE_IDB_STORE_NAME);
      const req = store.get(normalized);

      req.onsuccess = () => {
        const cached = req.result;
        if (!cached) return resolve(null);
        const now = Date.now();
        if (cached.timestamp && (now - cached.timestamp) < AHREFS_CACHE_TTL_MS) {
          console.log('[Ahrefs Cache] 命中缓存:', normalized, '缓存时间:', new Date(cached.timestamp).toISOString());
          resolve({
            urlFromList: cached.urlFromList || [],
            backlinks: cached.backlinks || [],
            overview: cached.overview || {}
          });
        } else {
          console.log('[Ahrefs Cache] 缓存已过期:', normalized);
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
      tx.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('[Ahrefs Cache] 读取缓存失败:', e?.message);
    return null;
  }
}

/**
 * 将 Ahrefs 数据写入缓存
 * @param {string} domain
 * @param {string[]} urlFromList
 * @param {object[]} backlinks
 * @param {object} overview
 */
/**
 * 清空 Ahrefs 反链 IndexedDB（与设置页 / clearAllAhrefsCache 联动）
 */
async function ahrefsClearAllCacheIDB() {
  try {
    const db = await openAhrefsCacheIDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AHREFS_CACHE_IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(AHREFS_CACHE_IDB_STORE_NAME);
      const req = store.clear();
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    console.log('[Ahrefs Cache] IndexedDB 已清空');
  } catch (e) {
    console.warn('[Ahrefs Cache] 清空 IndexedDB 失败:', e?.message);
    throw e;
  }
}

async function ahrefsSaveToCache(domain, urlFromList, backlinks, overview) {
  const normalized = ahrefsNormalizeDomainForCache(domain);
  if (!normalized) return;
  try {
    // 每个域名的 urlFromList / backlinks 做上限裁剪，避免单域缓存过大
    const MAX_URLS_PER_DOMAIN = 1000;
    const MAX_BACKLINKS_PER_DOMAIN = 1000;
    const safeUrlFromList = Array.isArray(urlFromList)
      ? urlFromList.slice(0, MAX_URLS_PER_DOMAIN)
      : [];
    const safeBacklinks = Array.isArray(backlinks)
      ? backlinks.slice(0, MAX_BACKLINKS_PER_DOMAIN)
      : [];
    const db = await openAhrefsCacheIDB();
    const record = {
      normalized,
      urlFromList: safeUrlFromList,
      backlinks: safeBacklinks,
      overview,
      timestamp: Date.now()
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction(AHREFS_CACHE_IDB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(AHREFS_CACHE_IDB_STORE_NAME);
      const req = store.put(record);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    await pruneAhrefsCacheIDB(db, AHREFS_CACHE_IDB_MAX_DOMAINS);
    console.log('[Ahrefs Cache] 已缓存:', normalized, '反链数:', urlFromList?.length);
  } catch (e) {
    console.warn('[Ahrefs Cache] 写入缓存失败:', e?.message);
  }
}

async function ahrefsSolveTurnstile(capsolverKey, domain) {
  const siteUrl = `https://ahrefs.com/backlink-checker/?input=${encodeURIComponent(domain)}&mode=subdomains`;
  const createRes = await fetch(CAPSOLVER_CREATE_TASK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: capsolverKey,
      task: {
        type: 'AntiTurnstileTaskProxyLess',
        websiteKey: AHREFS_TURNSTILE_SITE_KEY,
        websiteURL: siteUrl,
        metadata: { action: '' }
      }
    })
  });
  const createData = await createRes.json();
  const taskId = createData.taskId;
  if (!taskId) throw new Error('CapSolver createTask 失败: ' + (createData.errorDescription || JSON.stringify(createData)));
  console.log('[Ahrefs API] CapSolver taskId:', taskId);

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(CAPSOLVER_GET_RESULT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: capsolverKey, taskId })
    });
    const pollData = await pollRes.json();
    if (pollData.status === 'ready') {
      const token = pollData.solution?.token;
      if (!token) throw new Error('CapSolver 返回 ready 但无 token');
      console.log('[Ahrefs API] Step 1 完成, token 长度:', token.length);
      return token;
    }
    if (pollData.status === 'failed' || pollData.errorId) {
      throw new Error('CapSolver 解题失败: ' + (pollData.errorDescription || JSON.stringify(pollData)));
    }
  }
  throw new Error('CapSolver 解题超时（120s）');
}

async function ahrefsGetSignature(token, domain) {
  const reqBody = { captcha: token, mode: 'subdomains', url: domain };
  console.log('[Ahrefs API] ========== Step 2 请求明细 ==========');
  console.log('[Ahrefs API] 请求 URL:', AHREFS_OVERVIEW_URL);
  console.log('[Ahrefs API] 请求 Body:', JSON.stringify(reqBody, null, 2));
  const res = await fetch(AHREFS_OVERVIEW_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody)
  });
  const resText = await res.text();
  console.log('[Ahrefs API] 响应状态:', res.status);
  console.log('[Ahrefs API] 响应原文 (前 2000 字符):', resText.slice(0, 2000));
  if (!res.ok) {
    console.error('[Ahrefs API] Step 2 失败:', res.status, resText.slice(0, 500));
    throw new Error(`stGetFreeBacklinksOverview 失败: HTTP ${res.status} — ${resText.slice(0, 500)}`);
  }
  const data = JSON.parse(resText);
  console.log('[Ahrefs API] 响应 JSON 结构:');
  console.log('  - data 类型:', Array.isArray(data) ? `Array[${data.length}]` : typeof data);
  if (Array.isArray(data)) {
    data.forEach((item, idx) => {
      console.log(`  - data[${idx}] keys:`, item ? Object.keys(item) : 'null');
    });
  }
  console.log('[Ahrefs API] data[1] 完整内容:', JSON.stringify(data[1], null, 2));
  if (!Array.isArray(data) || data.length < 2 || !data[1]?.signedInput) {
    throw new Error('stGetFreeBacklinksOverview 响应格式异常: ' + resText.slice(0, 500));
  }
  const overview = data[1].data || {};
  const signedInput = data[1].signedInput;
  console.log('[Ahrefs API] ========== Step 2 解析结果 ==========');
  console.log('[Ahrefs API] overview 对象:', JSON.stringify(overview, null, 2));
  console.log('[Ahrefs API] DR:', overview.domainRating, '总反链:', overview.backlinks, '引用域名:', overview.refdomains);
  return {
    signature: signedInput.signature,
    validUntil: signedInput.input?.validUntil,
    domain,
    overview: overview  // 修复：返回 data[1].data 而不是 data[1]
  };
}

async function ahrefsGetBacklinks({ signature, validUntil, domain }) {
  const urlWithSlash = domain.endsWith('/') ? domain : domain + '/';
  const payload = {
    reportType: ['TopBacklinks'],
    signedInput: {
      signature,
      input: { validUntil, mode: 'subdomains', url: urlWithSlash }
    }
  };
  console.log('[Ahrefs API] ========== Step 3 请求明细 ==========');
  console.log('[Ahrefs API] 请求 URL:', AHREFS_BACKLINKS_URL);
  console.log('[Ahrefs API] 请求 Body:', JSON.stringify(payload, null, 2));
  const res = await fetch(AHREFS_BACKLINKS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const resText = await res.text();
  console.log('[Ahrefs API] 响应状态:', res.status);
  console.log('[Ahrefs API] 响应原文 (前 2000 字符):', resText.slice(0, 2000));
  if (!res.ok) {
    console.error('[Ahrefs API] Step 3 失败:', res.status, resText.slice(0, 500));
    throw new Error(`stGetFreeBacklinksList 失败: HTTP ${res.status} — ${resText.slice(0, 500)}`);
  }
  const data = JSON.parse(resText);
  console.log('[Ahrefs API] 响应 JSON 结构:');
  console.log('  - data 类型:', Array.isArray(data) ? `Array[${data.length}]` : typeof data);
  if (Array.isArray(data) && data.length >= 2) {
    console.log('  - data[1] keys:', data[1] ? Object.keys(data[1]) : 'null');
    console.log('[Ahrefs API] data[1] 完整内容 (前 3000 字符):', JSON.stringify(data[1], null, 2).slice(0, 3000));
  }

  let backlinks = [];
  if (Array.isArray(data) && data.length >= 2) {
    const obj = data[1];
    if (obj?.topBacklinks?.backlinks) {
      backlinks = obj.topBacklinks.backlinks;
    } else if (obj?.backlinks) {
      backlinks = obj.backlinks;
    }
  }
  console.log('[Ahrefs API] ========== Step 3 解析结果 ==========');
  console.log('[Ahrefs API] 反链数量:', backlinks.length);
  if (backlinks.length > 0) {
    console.log('[Ahrefs API] 第一条反链示例:', JSON.stringify(backlinks[0], null, 2));
  }
  return backlinks;
}

function ahrefsSendProgress(msg, type = 'info') {
  chrome.runtime.sendMessage({ action: 'ahrefsProgress', message: msg, type }).catch(() => {});
}

async function handleAhrefsDirectBacklinks(domain, forceRefresh = false) {
  console.log('[Ahrefs API] ========== handleAhrefsDirectBacklinks 入口 ==========');
  console.log('[Ahrefs API] 请求域名:', domain, '强制刷新:', forceRefresh);
  const normalized = ahrefsNormalizeDomainForCache(domain);
  console.log('[Ahrefs API] 标准化域名:', normalized);

  // 1. 检查缓存（非强制刷新时）
  if (!forceRefresh && normalized) {
    const cached = await ahrefsGetFromCache(domain);
    console.log('[Ahrefs API] 缓存查询结果:', cached ? '命中' : '未命中');
    if (cached) {
      console.log('[Ahrefs API] ========== 缓存命中，返回缓存数据 ==========');
      console.log('[Ahrefs API] 缓存内容 overview:', JSON.stringify(cached.overview, null, 2));
      console.log('[Ahrefs API] 缓存 urlFromList 数量:', cached.urlFromList?.length || 0);
      console.log('[Ahrefs API] 缓存 backlinks:', cached.backlinks || []);
      ahrefsSendProgress(`命中缓存：${normalized}（${cached.urlFromList?.length || 0} 条反链）`, 'success');
      return {
        urlFromList: cached.urlFromList || [],
        backlinks: cached.backlinks || [],
        overview: cached.overview || {},
        fromCache: true
      };
    }
  }

  const storage = await chrome.storage.local.get(['settings']);
  const capsolverKey = storage.settings?.capsolverApiKey;
  if (!capsolverKey) throw new Error('未配置 CapSolver API Key，请在设置页面配置后重试');

  console.log('[Ahrefs API] 开始获取反链:', domain, forceRefresh ? '(强制刷新)' : '');

  ahrefsSendProgress(`步骤 1/3: 正在通过 CapSolver 解决 Turnstile 验证（约 3-10 秒）…`);
  const token = await ahrefsSolveTurnstile(capsolverKey, domain);

  ahrefsSendProgress('步骤 2/3: 正在获取签名…');
  const sigData = await ahrefsGetSignature(token, domain);

  ahrefsSendProgress('步骤 3/3: 正在获取反链数据…');
  const backlinks = await ahrefsGetBacklinks(sigData);

  const overview = sigData.overview || {};
  ahrefsSendProgress(`成功获取 ${backlinks.length} 条反链 (DR ${overview.domainRating || '?'})`, 'success');
  console.log('[Ahrefs API] 完成:', domain, '反链', backlinks.length, 'DR', overview.domainRating);

  const urlFromList = backlinks.map(b => b.urlFrom).filter(Boolean);

  // 2. 写入缓存
  if (normalized) {
    await ahrefsSaveToCache(domain, urlFromList, backlinks, overview);
  }

  return { urlFromList, backlinks, overview, fromCache: false };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Background] 收到消息:', request.action, request.domain || '');
  if (request.action === 'clearAhrefsCacheIDB') {
    ahrefsClearAllCacheIDB()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
    return true;
  }
  if (request.action === 'ahrefsDirectBacklinks') {
    console.log('[Background] 开始处理 ahrefsDirectBacklinks, domain:', request.domain);
    handleAhrefsDirectBacklinks(request.domain)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => {
        let errMsg = error?.message;
        if (!errMsg) {
          try {
            if (typeof error === 'string') errMsg = error;
            else errMsg = JSON.stringify(error);
          } catch {
            errMsg = String(error);
          }
        }
        console.error('[Ahrefs API] 失败:', errMsg);
        sendResponse({ success: false, error: errMsg || '拉取反链失败' });
      });
    return true;
  }
  if (request.action === 'fillForm') {
    // Forward to content script if needed
    sendResponse({ success: true });
  } else if (request.action === 'getStorageData') {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ success: true, data });
    });
    return true; // Keep message channel open for async response
  } else if (request.action === 'aiRecognizeForm') {
    const tabId = sender.tab?.id;
    let responded = false;
    const safeSend = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (e) {
        console.warn('[Background] sendResponse 已关闭:', e.message);
      }
    };
    handleAIRecognizeForm(request.formMetadata, tabId)
      .then(result => safeSend({ success: true, result }))
      .catch(error => safeSend({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'generateBlogComment') {
    // 根据页面 title/description 生成约 200 字英文评论
    let responded = false;
    const safeSend = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (e) {
        console.warn('[Background] sendResponse 已关闭:', e.message);
      }
    };
    handleGenerateBlogComment(request.title, request.description, request.h1, request.siteUrl)
      .then(text => safeSend({ success: true, comment: text }))
      .catch(error => {
        console.error('[Background][BlogComment] 流程失败:', error?.message);
        safeSend({ success: false, error: error.message });
      });
    return true;
  } else if (request.action === 'aiRecognizeCommentForm') {
    // 评论表单 AI 识别：4 个标准字段 + 提交按钮
    const tabId = sender.tab?.id;
    let responded = false;
    const safeSend = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (e) {
        console.warn('[Background] sendResponse 已关闭:', e.message);
      }
    };
    handleAIRecognizeCommentForm(request.formMetadata, tabId)
      .then(result => safeSend({ success: true, result }))
      .catch(error => safeSend({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'blogCommentOneShot') {
    // 一发请求：表单字段映射 + 评论生成，一次 LLM 返回 mappings + submitButton + comment
    const tabId = sender.tab?.id;
    let responded = false;
    const safeSend = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (e) {
        console.warn('[Background] sendResponse 已关闭:', e.message);
      }
    };
    handleBlogCommentOneShot(request.formMetadata, request.title, request.description, request.h1, tabId)
      .then(result => safeSend({ success: true, result }))
      .catch(error => safeSend({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'scheduleVerifyAfterLoad') {
    // 评论提交后：在「该 tab 下一次加载完成」时自动执行验证（用于提交后页面刷新的场景）
    const { tabId, siteUrl } = request;
    if (tabId != null && siteUrl) {
      pendingVerifyByTab[tabId] = { siteUrl };
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return false;
  } else if (request.action === 'fullAiRunTask') {
    const { tabId, siteUrl, generatedComment, siteId } = request;
    if (!tabId || !siteUrl || !generatedComment) {
      sendResponse({ success: false, error: '缺少 tabId、siteUrl 或 generatedComment' });
      return false;
    }
    let responded = false;
    const safeSend = (payload) => {
      if (responded) return;
      responded = true;
      try {
        sendResponse(payload);
      } catch (e) {
        console.warn('[Background] sendResponse 已关闭:', e.message);
      }
    };
    const logFn = (msg) => {
      console.log('[完全AI识别模式]', msg);
      aiLogToPage(tabId, 'log', '[完全AI识别模式]', msg);
    };
    const runTask = async () => {
      let profileData = null;
      if (siteId) {
        const storage = await chrome.storage.local.get(['sites']);
        const sites = storage.sites || [];
        const site = sites.find((s) => s.id === siteId);
        if (site) {
          profileData = {
            commentName: site.siteName || '',
            commentEmail: site.email || '',
            commentWebsite: site.siteUrl || ''
          };
        }
      }
      return fullAiAgent.runFullAiTask(tabId, siteUrl, generatedComment, fetchLlmWithRetry, logFn, profileData);
    };
    runTask()
      .then(result => safeSend(result))
      .catch(err => {
        console.error('[完全AI识别模式] 任务结束（异常）:', err?.message);
        safeSend({ success: false, error: err?.message || '完全 AI 识别任务异常' });
      });
    return true;
  } else if (request.action === 'blogCommentFlowComplete') {
    // 流程在 content 结束时同步状态到 storage，popup 关闭后再打开也能看到最终状态
    const tabId = sender.tab?.id;
    const response = request.response;
    if (tabId != null && response) {
      chrome.tabs.get(tabId).then((tab) => {
        const cacheKey = getBlogPopupStateCacheKey(tab?.url);
        if (!cacheKey) return;
        const state = buildBlogPopupStateFromResponse(response);
        if (state) chrome.storage.local.set({ [BLOG_POPUP_STATE_PREFIX + cacheKey]: state }).catch(() => {});
      }).catch(() => {});
    }
    return false;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const pending = pendingVerifyByTab[tabId];
  if (!pending) return;
  delete pendingVerifyByTab[tabId];
  const siteUrl = pending.siteUrl;
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, { action: 'verifyCommentSubmission', siteUrl })
      .then((response) => {
        if (response?.success && response.result) {
          chrome.storage.session.set({ ['lastVerifyResult_' + tabId]: response.result });
        }
      })
      .catch(() => {});
  }, VERIFY_AFTER_LOAD_DELAY_MS);
});

/**
 * 将 AI 过程日志同时打到页面 Console（用户在看的是页面 DevTools）
 * @param {number|undefined} tabId - 发起 AI 识别的标签页 id
 * @param {'log'|'warn'|'error'} level
 * @param {...*} args - 同 console.log
 */
function aiLogToPage(tabId, level, ...args) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn('[Background]', ...args);
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, { action: 'aiLog', level, args }).catch(() => {});
  }
}

/** AI 请求超时上限（单次） */
const AI_REQUEST_TIMEOUT_MS = 30000;
/** AI 请求最大重试次数（不含首次） */
const AI_REQUEST_MAX_RETRIES = 2;
/** 重试前等待时长（避免 429 等限流），毫秒 */
const AI_RETRY_DELAY_MS = 30000;

/**
 * 将 OpenAI 格式的 LLM 请求参数自动适配为 Anthropic 格式（当 endpoint 含 /anthropic 时）
 * 返回 { url, init }，可直接传给 fetchLlmWithRetry
 */
function adaptLlmRequest(endpoint, apiKey, requestBody) {
  if (!endpoint.includes('/anthropic')) {
    return {
      url: endpoint,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      }
    };
  }
  // Anthropic 兼容格式
  const messages = requestBody.messages || [];
  const systemMsg = messages.find(m => m.role === 'system');
  const userMessages = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));
  const anthropicBody = {
    model: requestBody.model,
    max_tokens: requestBody.max_tokens || 4096,
    messages: userMessages
  };
  if (systemMsg) anthropicBody.system = systemMsg.content;
  if (requestBody.temperature != null) anthropicBody.temperature = requestBody.temperature;
  return {
    url: endpoint + '/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicBody)
    }
  };
}

/**
 * 从 LLM 响应 JSON 中提取 content 文本（兼容 OpenAI 与 Anthropic 格式）
 */
function extractLlmContent(data) {
  if (data?.choices?.[0]?.message?.content != null) {
    return data.choices[0].message.content;
  }
  // Anthropic 格式: content 是 array of blocks
  if (Array.isArray(data?.content)) {
    return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  }
  return '';
}

/**
 * 带超时与重试的 fetch：单次 30s 超时，失败或 429 时等待 30s 再重试，全部失败则抛出提示用户检查接口
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ timeoutMs?: number, maxRetries?: number, retryDelayMs?: number, onRetry?: (attempt: number, totalAttempts: number, reason: string) => void|Promise<void> }} opts
 * @returns {Promise<Response>}
 */
async function fetchLlmWithRetry(url, init, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? AI_REQUEST_MAX_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? AI_RETRY_DELAY_MS;
  const onRetry = opts.onRetry;
  const totalAttempts = maxRetries + 1;
  let lastError;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) return response;
      if (response.status === 429 && attempt <= maxRetries) {
        await response.text();
        if (onRetry) {
          try {
            await Promise.resolve(onRetry(attempt, totalAttempts, '429'));
          } catch (_) {}
        }
        await new Promise(r => setTimeout(r, retryDelayMs));
        continue;
      }
      const errText = await response.text();
      lastError = new Error(`API 错误 ${response.status}: ${errText.slice(0, 200)}`);
      if (attempt <= maxRetries) {
        if (onRetry) {
          try {
            await Promise.resolve(onRetry(attempt, totalAttempts, 'error'));
          } catch (_) {}
        }
        await new Promise(r => setTimeout(r, retryDelayMs));
        continue;
      }
      console.error('[Background] AI API 请求失败:', response?.status, errText?.slice(0, 300));
      throw lastError;
    } catch (e) {
      clearTimeout(timeoutId);
      lastError = e;
      if (e?.name === 'AbortError') {
        console.error('[Background] AI API 请求超时');
      } else {
        console.error('[Background] AI API 请求异常:', e?.message);
      }
      if (attempt <= maxRetries) {
        if (onRetry) {
          try {
            await Promise.resolve(onRetry(attempt, totalAttempts, e?.name === 'AbortError' ? 'timeout' : 'error'));
          } catch (_) {}
        }
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }
  }
  const isTimeout = lastError?.name === 'AbortError';
  const msg = isTimeout
    ? `AI 请求超时（${timeoutMs / 1000} 秒），已重试 ${maxRetries} 次均失败，请检查 AI 接口是否正常`
    : `AI 请求失败，已重试 ${maxRetries} 次：${lastError?.message || lastError}。请检查 AI 接口是否正常`;
  console.error('[Background] AI API 最终失败（已用尽重试）:', msg);
  throw new Error(msg);
}

/**
 * 调用 GLM API 进行表单字段识别
 * @param {Object} formMetadata - 表单元数据
 * @param {number} [tabId] - 发起请求的标签页 id，用于把日志打到页面 Console
 * @returns {Promise<Array>} 字段映射数组
 */
async function handleAIRecognizeForm(formMetadata, tabId) {
  const log = (...a) => aiLogToPage(tabId, 'log', ...a);
  const logErr = (...a) => aiLogToPage(tabId, 'error', ...a);

  // 获取 LLM 配置
  const storage = await chrome.storage.local.get(['settings']);
  const llmConfig = storage.settings?.llmConfig;

  if (!llmConfig?.enabled || !llmConfig?.apiKey) {
    throw new Error('LLM 未启用或 API Key 未配置');
  }

  // 构建精简的表单描述
  const formDescription = buildCompactFormDescription(formMetadata);

  // 构建 Prompt
  const prompt = buildAIPrompt(formDescription, formMetadata);

  // 调用 GLM API
  const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
  const model = llmConfig.model || 'glm-4.7';

  log('AI 识别请求开始:', { endpoint, model, fieldCount: formMetadata.fields?.length });
  log('AI 请求 user message 长度:', prompt.length, '字符');

  const requestBody = {
    model,
    messages: [
      { role: 'system', content: '你是一个有用的AI助手。' },
      { role: 'user', content: prompt }
    ],
    stream: false,
    temperature: 1.0,
    max_tokens: 4096
  };
  if (llmConfig.disableThinking !== false) {
    requestBody.thinking = { type: 'disabled' };
  }
  // 完整请求 JSON：同时输出到扩展 SW 控制台与当前页面控制台（便于在页面 DevTools 查看）
  const navReqJson = JSON.stringify(requestBody, null, 2);
  console.log('[AI Form 识别-导航站] 请求完整 JSON:', navReqJson);
  log('[AI Form 识别-导航站] 请求完整 JSON:', navReqJson);

  try {
    const _adapted = adaptLlmRequest(endpoint, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(
      _adapted.url,
      _adapted.init,
      { timeoutMs: AI_REQUEST_TIMEOUT_MS, maxRetries: AI_REQUEST_MAX_RETRIES }
    );

    log('AI 收到响应:', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      logErr('AI API 错误响应 body:', errorText);
      throw new Error(`API 错误 ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const navResJson = JSON.stringify(data, null, 2);
    console.log('[AI Form 识别-导航站] 响应完整 JSON:', navResJson);
    log('[AI Form 识别-导航站] 响应完整 JSON:', navResJson);

    const msg = (data?.choices?.[0]?.message) || null;
    const contentText = extractLlmContent(data);
    log('AI 原始返回:', {
      hasChoices: !!data?.choices,
      choicesLength: data?.choices?.length,
      usage: data.usage || null,
      hasReasoningContent: !!msg.reasoning_content
    });

    if (!data.choices?.length && !Array.isArray(data?.content)) {
      logErr('AI 返回格式无效, 完整 data:', data);
      throw new Error('API 返回格式无效');
    }

    // GLM 思考模型：最终答案在 content，推理过程在 reasoning_content；若 content 为空则从 reasoning_content 提取
    let content = contentText.trim();
    const reasoningContent = (msg?.reasoning_content && String(msg.reasoning_content)) || ((data?.content || []).filter(b => b.type === 'thinking').map(b => b.thinking || '').join(''));
    if (!content && reasoningContent) {
      log('AI content 为空，从 reasoning_content 提取映射');
      content = extractMappingsFromReasoning(reasoningContent);
      log('AI 从 reasoning 提取的文本:', content);
    }
    log('AI 返回内容 (content):', content);

    // 解析 AI 返回的 JSON 或「Index N -> standardField」文本（空或无效时返回 []，不抛错）
    const mappings = parseAIResponse(content, formMetadata);
    if (mappings.length === 0 && content.trim()) {
      logErr('解析 AI 响应失败或未得到有效映射, 原始 content:', content);
    }
    log('AI 解析后的映射:', mappings);
    log('AI 识别完成:', { mappingCount: mappings.length });

    return mappings;

  } catch (error) {
    logErr('AI 识别失败:', error);
    throw error;
  }
}

/**
 * 构建精简的表单描述（减少 token 消耗）
 */
function buildCompactFormDescription(formMetadata) {
  if (!formMetadata?.fields) return '';

  const fieldDescs = formMetadata.fields.map((field, index) => {
    const parts = [`[${index}] type=${field.type || 'text'}`];

    if (field.name) parts.push(`name="${field.name}"`);
    if (field.id) parts.push(`id="${field.id}"`);
    if (field.label) parts.push(`label="${field.label.slice(0, 50)}"`); // 限制标签长度
    if (field.placeholder) parts.push(`placeholder="${field.placeholder.slice(0, 50)}"`);
    if (field.ariaLabel) parts.push(`aria-label="${field.ariaLabel.slice(0, 50)}"`);

    // 对于 select，只列出前 10 个选项
    if (field.options && field.options.length > 0) {
      const opts = field.options.slice(0, 10).map(o => o.text).join(', ');
      parts.push(`options=[${opts}${field.options.length > 10 ? '...' : ''}]`);
    }

    return parts.join(' ');
  });

  return fieldDescs.join('\n');
}

/**
 * 构建 AI Prompt。若 formMetadata.formHtml 存在则优先用 HTML 片段，便于模型直接理解结构。
 * 输出要求：仅一个 JSON 数组，便于解析、减少空响应。
 * 多语言：标签可能为任意语言，先理解为英文再映射。
 */
function buildAIPrompt(formDescription, formMetadata) {
  const standardList = `siteName,email,siteUrl,category,tags,tagline,shortDescription,longDescription,logo,screenshot,unknown`;
  const formHtml = formMetadata?.formHtml;
  const multiLangHint = `Labels/placeholders may be in any language (e.g. Chinese, Slovenian, Czech). First interpret the meaning in English (e.g. 网站名称→site name, 邮箱→email, Spletišče→website, Ime→name, E-pošta→email), then map to the standard type below.`;
  const body = formHtml
    ? `以下是一段表单的 HTML 片段，请识别其中的可填写字段（input/textarea/select，按在 HTML 中出现的顺序），并映射到标准类型。\n\n多语言说明：${multiLangHint}\n\n标准类型（任选其一）: ${standardList}\n\nHTML:\n${formHtml}`
    : `以下为表单字段列表（每行 [索引] 类型与属性），请将每项映射到标准类型。\n\n多语言说明：${multiLangHint}\n\n标准类型: ${standardList}\n\n字段列表:\n${formDescription}`;

  const indexHint = formHtml
    ? 'fieldIndex 按 HTML 中 input/textarea/select 出现顺序从 0 开始编号。'
    : 'fieldIndex 与上面字段列表的索引一致（从 0 开始）。';

  return `${body}

请只输出一个 JSON 数组，不要任何 markdown、解释或多余文字。每项格式: {"fieldIndex": 0, "standardField": "siteName", "confidence": 0.9}
${indexHint} 无法识别的用 "standardField": "unknown"。`;
}

/**
 * 从 GLM reasoning_content 中提取映射：先尝试找 JSON 数组，否则解析 "Index N -> standardField" 行
 * @returns {string} 可被 parseAIResponse 解析的 JSON 数组字符串
 */
function extractMappingsFromReasoning(reasoningContent) {
  if (!reasoningContent || typeof reasoningContent !== 'string') return '';

  const text = reasoningContent.trim();
  const validFields = ['siteName', 'email', 'siteUrl', 'category', 'tags', 'tagline', 'shortDescription', 'longDescription', 'logo', 'screenshot', 'unknown'];

  // 1. 尝试直接找到 JSON 数组
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr) && arr.length > 0 && arr.some(x => x.fieldIndex != null && x.standardField)) {
        return jsonMatch[0];
      }
    } catch (_) {}
  }

  // 2. 解析 "Index N : ... -> standardField" 或 "*Index N*: ... -> `siteName`"（中间可能含 HTML 与 >）
  const indexFieldRe = /\*?\s*Index\s*(\d+)\s*\*?[\s\S]*?->\s*[`']?(\w+)[`']?/gi;
  const pairs = [];
  let m;
  while ((m = indexFieldRe.exec(text)) !== null) {
    const fieldIndex = parseInt(m[1], 10);
    const standardField = m[2];
    if (!validFields.includes(standardField)) continue;
    pairs.push({ fieldIndex, standardField, confidence: 0.9 });
  }
  if (pairs.length > 0) {
    return JSON.stringify(pairs);
  }

  return '';
}

/**
 * 解析 AI 返回的 JSON。空内容或无效 JSON 时返回 []，由调用方回退到关键词匹配。
 */
function parseAIResponse(content, formMetadata) {
  if (content == null || typeof content !== 'string') return [];
  let jsonStr = content.trim();
  if (!jsonStr) return [];

  try {
    // 移除可能的 markdown 代码块标记
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    jsonStr = jsonStr.replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    if (!jsonStr) return [];

    // 尝试找到 JSON 数组
    const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    } else {
      return [];
    }

    const aiMappings = JSON.parse(jsonStr);
    if (!Array.isArray(aiMappings)) return [];
    const result = [];

    for (const mapping of aiMappings) {
      const fieldIndex = mapping.fieldIndex;
      const field = formMetadata.fields[fieldIndex];

      if (!field) continue;

      // 跳过 unknown 类型
      if (mapping.standardField === 'unknown') continue;

      // 验证标准字段类型
      const validFields = ['siteName', 'email', 'siteUrl', 'category', 'tags', 'tagline', 'shortDescription', 'longDescription', 'logo', 'screenshot'];
      if (!validFields.includes(mapping.standardField)) continue;

      result.push({
        locator: field.locator,
        standardField: mapping.standardField,
        confidence: mapping.confidence || 0.8,
        method: 'ai',
        xpath: field.xpath,
        locatorDesc: field.locatorDesc
      });
    }

    return result;
  } catch (e) {
    console.warn('[Background] 解析 AI 响应失败，将回退关键词匹配:', e.message, '原始内容长度:', content.length);
    return [];
  }
}

// ---------- Blog Comment: 评论内容生成 ----------
const BLOG_COMMENT_SYSTEM = 'You write natural blog comments. Use the SAME language as the page content (title, description, H1): if they are in English, write in English; if in Slovenian, write in Slovenian; if in Chinese, write in Chinese; etc. Reply with exactly one line: the comment text only. No quotes, no markdown, no explanation. Comment length: at least 200 characters, at most 300 characters (strict).';
const BLOG_COMMENT_USER_PREFIX = 'Write one natural, friendly comment in the SAME language as the Title, Description, and H1 below (match their language). Comment length: at least 200 characters, at most 300 characters (strict). Only output the single line of comment.\n\nTitle: ';
const BLOG_COMMENT_USER_SUFFIX = '\n\nDescription: ';

/**
 * 从 GLM reasoning_content 中提取评论文本（当 content 为空时使用）
 * 兼容多种格式：带 (N characters) 的引号、纯引号、无引号的末尾结论等
 */
function extractCommentFromReasoning(reasoningContent) {
  if (!reasoningContent || typeof reasoningContent !== 'string') return '';
  const text = reasoningContent.trim();
  if (!text) return '';

  // 1. 匹配 "…" (N characters) 形式（允许中间有单引号如 I've），评论长度约 200–300 字符
  const withLen = text.match(/"\s*([^"]{150,400}?)\s*"\s*\(\d+\s*characters?\)/i);
  if (withLen && withLen[1]) return withLen[1].trim();

  // 2. 匹配任意双引号内 150~400 字（取最长的一段作为评论）
  const allQuoted = text.match(/"([^"]{150,400})"/g);
  if (allQuoted && allQuoted.length > 0) {
    let best = '';
    for (const m of allQuoted) {
      const inner = m.slice(1, -1).trim();
      if (inner.length > best.length && inner.length >= 150) best = inner;
    }
    if (best) return best;
  }

  // 3. 取末尾连续一段"像评论"的文本（GLM 常把最终结论放在 reasoning 末尾，可能无引号或被截断）
  const noStructure = text.replace(/\*\*[^*]+\*\*/g, '').replace(/^\s*\d+\.\s+/gm, '');
  const tail = noStructure.slice(-500).trim();
  const tailLines = tail.split(/\n/).map(s => s.trim()).filter(Boolean);
  const lastChunk = tailLines.slice(-5).join(' ').trim();
  if (lastChunk.length >= 150 && lastChunk.length <= 400 && !/^[\*#\d]/.test(lastChunk)) {
    return lastChunk;
  }
  if (tailLines.length > 0) {
    for (let i = tailLines.length - 1; i >= 0; i--) {
      const line = tailLines[i];
      if (line.length >= 150 && line.length <= 400 && !/^[\*#\d\s]/.test(line) && !/^(Analyze|Topic|Constraints|Drafting|Refining|Idea\s*\d)/i.test(line)) {
        return line;
      }
    }
  }

  // 4. 任意非空行 150~400 字且不像标题/列表
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length >= 150 && line.length <= 400 && !/^\s*[\*#\d]/.test(line) && !/^(Analyze|Topic|Constraints|Idea\s*\d)/i.test(line)) {
      return line;
    }
  }

  return '';
}

/**
 * 统一从 API 返回中解析出评论文本：优先 content，为空时从 reasoning_content 提取
 */
function parseBlogCommentResponse(data) {
  // OpenAI 格式
  const msg = data?.choices?.[0]?.message;
  if (msg) {
    let rawContent = (msg.content && String(msg.content).trim()) || '';
    const reasoningContent = (msg.reasoning_content && String(msg.reasoning_content)) || '';

    if (rawContent) {
      return rawContent.replace(/^["']|["']$/g, '').trim();
    }
    if (reasoningContent) {
      const extracted = extractCommentFromReasoning(reasoningContent);
      if (extracted) return extracted;
    }
    return '';
  }
  // Anthropic 格式: data.content 是 array of blocks
  const textBlocks = (data?.content || []).filter(b => b.type === 'text');
  const thinkingBlocks = (data?.content || []).filter(b => b.type === 'thinking');
  const rawContent = textBlocks.map(b => b.text).join('').trim();
  if (rawContent) {
    return rawContent.replace(/^["']|["']$/g, '').trim();
  }
  const reasoningContent = thinkingBlocks.map(b => b.thinking || b.text || '').join('');
  if (reasoningContent) {
    const extracted = extractCommentFromReasoning(reasoningContent);
    if (extracted) return extracted;
  }
  return '';
}

  if (rawContent) {
    return rawContent.replace(/^["']|["']$/g, '').trim();
  }
  if (reasoningContent) {
    const extracted = extractCommentFromReasoning(reasoningContent);
    if (extracted) return extracted;
  }
  return '';
}

/**
 * 根据页面 title、description、h1 调用 LLM 生成 200–300 字符评论
 * 控制台会打印请求/响应日志，便于调试（扩展 Service Worker 控制台）
 * @param {string} title - document.title
 * @param {string} description - meta description
 * @param {string} [h1] - 本页第一个 h1 标签的文本
 * @param {string} [siteUrl] - 当前站点 URL，用于在评论末尾追加
 * @returns {Promise<string>} 评论文本
 */
async function handleGenerateBlogComment(title, description, h1 = '', siteUrl = '') {
  const log = (...a) => console.log('[Background][BlogComment]', ...a);
  const logWarn = (...a) => console.warn('[Background][BlogComment]', ...a);
  const logErr = (...a) => console.error('[Background][BlogComment]', ...a);

  const storage = await chrome.storage.local.get(['settings']);
  const llmConfig = storage.settings?.llmConfig;

  if (!llmConfig?.enabled || !llmConfig?.apiKey) {
    throw new Error('LLM 未启用或 API Key 未配置，请在设置中配置后重试');
  }

  const userContent =
    BLOG_COMMENT_USER_PREFIX + (title || '(no title)') + BLOG_COMMENT_USER_SUFFIX + (description || '(no description)') +
    '\n\nH1 (page heading): ' + (h1 && h1.trim() ? h1.trim() : '(no h1)');

  const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
  const requestBody = {
    model: llmConfig.model || 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: BLOG_COMMENT_SYSTEM },
      { role: 'user', content: userContent }
    ],
    stream: false,
    temperature: 0.7,
    max_tokens: 500
  };
  if (llmConfig.disableThinking !== false) {
    requestBody.thinking = { type: 'disabled' };
  }
  const genReqJson = JSON.stringify(requestBody, null, 2);
  log('请求开始（发请求前）:', { endpoint, model: requestBody.model, userMessageLength: userContent.length });
  log('[generateBlogComment] 请求 body:', genReqJson);
  log('请求 user 内容:', userContent);

  try {
    const _adapted = adaptLlmRequest(endpoint, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(
      _adapted.url,
      _adapted.init,
      { timeoutMs: AI_REQUEST_TIMEOUT_MS, maxRetries: AI_REQUEST_MAX_RETRIES }
    );

    log('响应:', { status: response.status, ok: response.ok });

    if (!response.ok) {
      const errorText = await response.text();
      const errMsg = `API 错误 ${response.status}: ${errorText.slice(0, 500)}`;
      console.error('[Background][BlogComment] API 返回错误:', response.status, errorText.slice(0, 500));
      logErr('API 错误:', errMsg);
      throw new Error(errMsg);
    }

    const data = await response.json();
    const contentLen = data?.choices?.[0]?.message?.content?.length ?? 0;
    const reasoningLen = data?.choices?.[0]?.message?.reasoning_content?.length ?? 0;
    log('响应结构:', {
      hasChoices: !!data?.choices,
      contentLength: contentLen,
      reasoningContentLength: reasoningLen,
      usage: data?.usage || null
    });

    let comment = parseBlogCommentResponse(data);
    if (!comment) {
      logErr('解析结果为空. content 长度:', contentLen, 'reasoning_content 长度:', reasoningLen);
      const rc = data?.choices?.[0]?.message?.reasoning_content || '';
      logErr('reasoning_content 前 500 字:', rc.slice(0, 500));
      logErr('reasoning_content 后 300 字:', rc.slice(-300));
      throw new Error('API 返回内容为空或无法从响应中解析出评论');
    }

    // 如果提供了 siteUrl，在评论末尾追加网站 URL
    if (siteUrl && siteUrl.trim()) {
      comment = comment + '\n\n' + siteUrl.trim();
      log('已追加网站 URL 到评论末尾，最终评论长度:', comment.length);
    }

    log('解析得到评论长度:', comment.length, '预览:', comment.slice(0, 80) + (comment.length > 80 ? '…' : ''));
    return comment;
  } catch (error) {
    console.error('[Background][BlogComment] 异常:', error?.message, error);
    logErr('异常:', error?.message);
    throw error;
  }
}

// ---------- Blog Comment: 评论表单 AI 识别 ----------
const BLOG_COMMENT_STANDARD_FIELDS = ['comment', 'commentName', 'commentEmail', 'commentWebsite'];

/**
 * 构建评论表单 AI Prompt，输出字段映射 + 提交按钮索引。
 * 多语言：标签可能为任意语言，先理解为英文再映射到标准字段。
 */
function buildCommentFormAIPrompt(formDescription, formMetadata) {
  const standardList = BLOG_COMMENT_STANDARD_FIELDS.join(', ');
  const multiLangInstruction = `The form labels/placeholders may be in ANY language (e.g. Slovenian, Czech, Chinese, German). Before mapping, interpret each label in English: e.g. "Spletišče" = website → commentWebsite; "Ime" / "Jméno" = name → commentName; "E-pošta" / "Notif. e-mail" = email → commentEmail; "Komentar" / "Komentář" = comment body → comment. Then map to exactly one of the standard types below.`;
  const formHtml = formMetadata?.formHtml;
  const body = formHtml
    ? `Below is HTML of a blog comment form. Identify each fillable field (input/textarea) and map to standard types. Also identify the submit button (type="submit" or button that posts the comment).\n\nMultilingual: ${multiLangInstruction}\n\nStandard types (use exactly): ${standardList}\n  - comment: the main comment/feedback text (usually a textarea)\n  - commentName: commenter's name (e.g. Name, Ime, Jméno)\n  - commentEmail: commenter's email (e.g. Email, E-pošta)\n  - commentWebsite: commenter's website URL (e.g. Website, Spletišče, Spletna stran)\n\nHTML:\n${formHtml}`
    : `Form fields (index, type, name, label, placeholder):\n${formDescription}\n\nMultilingual: ${multiLangInstruction}\n\nMap each to one of: ${standardList}. Also identify which field index is the submit button (e.g. "Post comment", "Objavi komentar", "Komentovat", "Submit").`;

  return `${body}

Respond with ONLY a JSON object: { "mappings": [ {"fieldIndex": 0, "standardField": "comment"}, ... ], "submitButtonFieldIndex": 3 }
Use standardField "unknown" for unmapped. submitButtonFieldIndex is the 0-based index of the submit button in the same field list, or -1 if not found. No markdown, no explanation.`;
}

/**
 * 解析评论表单 AI 返回，得到 mappings + submitButton
 */
function parseCommentFormAIResponse(content, formMetadata) {
  if (content == null || typeof content !== 'string') return { mappings: [], submitButton: null };
  let jsonStr = content.trim();
  jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = typeof jsonStr === 'string' && jsonStr.startsWith('{') ? JSON.parse(jsonStr) : null;
    if (!obj || !obj.mappings) return { mappings: [], submitButton: null };

    const result = [];
    for (const m of obj.mappings) {
      const field = formMetadata.fields[m.fieldIndex];
      if (!field) continue;
      if (m.standardField === 'unknown') continue;
      if (!BLOG_COMMENT_STANDARD_FIELDS.includes(m.standardField)) continue;
      result.push({
        locator: field.locator,
        standardField: m.standardField,
        confidence: m.confidence || 0.8,
        method: 'ai',
        xpath: field.xpath,
        locatorDesc: field.locatorDesc
      });
    }

    let submitButton = null;
    const submitIndex = obj.submitButtonFieldIndex;
    if (typeof submitIndex === 'number' && submitIndex >= 0 && formMetadata.fields[submitIndex]) {
      const btn = formMetadata.fields[submitIndex];
      submitButton = { locator: btn.locator, xpath: btn.xpath, locatorDesc: btn.locatorDesc };
    }

    return { mappings: result, submitButton };
  } catch (e) {
    console.warn('[Background] 解析评论表单 AI 响应失败:', e.message);
    return { mappings: [], submitButton: null };
  }
}

/**
 * 一发请求：构建「字段映射 + 评论生成」统一 prompt，要求返回 JSON 含 mappings、submitButtonFieldIndex、comment
 */
function buildBlogCommentOneShotPrompt(formDescription, formMetadata, title, description, h1 = '') {
  const standardList = BLOG_COMMENT_STANDARD_FIELDS.join(', ');
  const multiLangInstruction = `The form labels/placeholders may be in ANY language (e.g. Japanese, Slovenian, Czech, Chinese, German). Before mapping, interpret each label: e.g. "名前"/"Namae" = name → commentName; "URL" = website → commentWebsite; "コメント" = comment body → comment; "E-pošta" = email → commentEmail. Then map to exactly one of the standard types below.`;
  const formHtml = formMetadata?.formHtml;
  const formPart = formHtml
    ? `Below is HTML of a blog comment form. Identify each fillable field (input/textarea) and map to standard types. Also identify the submit button (type="submit" or button that posts the comment).\n\nMultilingual: ${multiLangInstruction}\n\nStandard types (use exactly): ${standardList}\n  - comment: the main comment/feedback text (usually a textarea)\n  - commentName: commenter's name\n  - commentEmail: commenter's email\n  - commentWebsite: commenter's website URL\n\nHTML:\n${formHtml}`
    : `Form fields (index, type, name, label, placeholder):\n${formDescription}\n\nMultilingual: ${multiLangInstruction}\n\nMap each to one of: ${standardList}. Also identify which field index is the submit button (e.g. "Post comment", "Objavi komentar", "Submit").`;

  const h1Text = h1 && h1.trim() ? h1.trim() : '(no h1)';
  const commentPart = `Also, based on the following page title, description, and H1 heading, write one natural, friendly comment. Comment length: at least 200 characters, at most 300 characters (strict). Use the SAME language as the title/description/H1: if they are in English, write in English; if in another language (e.g. Slovenian, Czech, Chinese), write in that language. Only the comment text, no quotes or explanation.

Title: ${title || '(no title)'}
Description: ${description || '(no description)'}
H1 (page heading): ${h1Text}`;

  return `${formPart}

${commentPart}

Respond with ONLY one JSON object (no markdown, no code block). Example:
{ "mappings": [ {"fieldIndex": 0, "standardField": "comment"}, {"fieldIndex": 1, "standardField": "commentName"}, ... ], "submitButtonFieldIndex": 8, "comment": "Your generated comment text here." }
Use standardField "unknown" for unmapped. submitButtonFieldIndex is the 0-based index of the submit button in the same field list, or -1 if not found.`;
}

/**
 * 解析一发请求 LLM 返回：mappings + submitButton（复用 parseCommentFormAIResponse）+ comment
 */
function parseBlogCommentOneShotResponse(content, formMetadata) {
  if (content == null || typeof content !== 'string') return { mappings: [], submitButton: null, comment: '' };
  let jsonStr = content.trim();
  jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = typeof jsonStr === 'string' && jsonStr.startsWith('{') ? JSON.parse(jsonStr) : null;
    if (!obj) return { mappings: [], submitButton: null, comment: '' };
    const { mappings, submitButton } = parseCommentFormAIResponse(content, formMetadata);
    const comment = (obj.comment && String(obj.comment).trim()) || '';
    return { mappings, submitButton, comment };
  } catch (e) {
    console.warn('[Background] 解析一发请求响应失败:', e.message);
    return { mappings: [], submitButton: null, comment: '' };
  }
}

/**
 * 一发请求：一次 LLM 调用同时返回字段映射 + 提交按钮 + 评论文本
 * @returns {Promise<{ mappings: Array, submitButton: object|null, comment: string }>}
 */
async function handleBlogCommentOneShot(formMetadata, title, description, h1 = '', tabId) {
  const log = (...a) => console.log('[Background][BlogComment OneShot]', ...a);
  const logErr = (...a) => console.error('[Background][BlogComment OneShot]', ...a);
  const pageLog = (tabId != null) ? (...a) => aiLogToPage(tabId, 'log', ...a) : () => {};

  const storage = await chrome.storage.local.get(['settings']);
  const llmConfig = storage.settings?.llmConfig;

  if (!llmConfig?.enabled || !llmConfig?.apiKey) {
    throw new Error('LLM 未启用或 API Key 未配置，请在设置中配置后重试');
  }

  const formDescription = buildCompactFormDescription(formMetadata);
  const userContent = buildBlogCommentOneShotPrompt(formDescription, formMetadata, title || '', description || '', h1 || '');

  let popupStateKey = null;
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const ck = getBlogPopupStateCacheKey(tab?.url);
      if (ck) popupStateKey = BLOG_POPUP_STATE_PREFIX + ck;
    } catch (_) {}
  }

  const endpoint = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
  const requestBody = {
    model: llmConfig.model || 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a helpful assistant. You understand form labels in any language. Map form fields to standard types (comment, commentName, commentEmail, commentWebsite), identify the submit button index, and generate one blog comment in the SAME language as the page title/description/H1. The comment in your JSON must be at least 200 characters and at most 300 characters (strict). Respond only with a single JSON object.' },
      { role: 'user', content: userContent }
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: 2048
  };
  if (llmConfig.disableThinking !== false) {
    requestBody.thinking = { type: 'disabled' };
  }

  const oneShotReqJson = JSON.stringify(requestBody, null, 2);
  log('请求开始（发请求前）:', { endpoint, model: requestBody.model, userMessageLength: userContent.length });
  log('[BlogComment OneShot] 请求 body:', oneShotReqJson);
  pageLog('[BlogComment OneShot] 请求开始');

  try {
    const _adapted = adaptLlmRequest(endpoint, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(
      _adapted.url,
      _adapted.init,
      {
        timeoutMs: AI_REQUEST_TIMEOUT_MS,
        maxRetries: AI_REQUEST_MAX_RETRIES,
        onRetry: popupStateKey
          ? async (attempt, totalAttempts) => {
              const retryMsg = `AI 请求失败，正在重试 ${attempt}/${totalAttempts - 1}（约 30 秒后重试）`;
              const stored = await chrome.storage.local.get(popupStateKey);
              const existing = stored[popupStateKey] || {};
              await chrome.storage.local.set({
                [popupStateKey]: {
                  statusLineText: retryMsg,
                  statusMessageText: existing.statusMessageText || '',
                  statusMessageType: existing.statusMessageType || 'info'
                }
              });
            }
          : undefined
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logErr('API 错误:', response.status, errorText);
      throw new Error(`API 错误 ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    let content = extractLlmContent(data).trim();
    if (!content) throw new Error('API 返回内容为空');

    log('API 返回原始 content 长度:', content.length);
    log('API 返回原始 content 前 800 字:', content.slice(0, 800));

    let mappings;
    let submitButton;
    let comment;
    try {
      const parsed = parseBlogCommentOneShotResponse(content, formMetadata);
      mappings = parsed.mappings;
      submitButton = parsed.submitButton;
      comment = parsed.comment;
    } catch (parseErr) {
      logOneShotParseFailure(content, formMetadata);
      throw parseErr;
    }
    if (!comment) {
      logErr('解析得到 comment 为空，原始 content 前 500 字:', content.slice(0, 500));
      logOneShotParseFailure(content, formMetadata);
      throw new Error('API 返回中缺少有效 comment 字段');
    }

    log('解析得到 mappings:', mappings?.length, 'submitButton:', !!submitButton, 'comment 长度:', comment?.length);
    pageLog('[BlogComment OneShot] 完成');
    return { mappings, submitButton, comment };
  } catch (error) {
    logErr('异常:', error.message);
    throw error;
  }
}

/**
 * 解析失败时在控制台输出原始 content，便于排查日语等多语言表单
 */
function logOneShotParseFailure(content, formMetadata) {
  try {
    console.warn('[Background][BlogComment OneShot] 解析失败，原始 API content 长度:', content?.length);
    console.warn('[Background][BlogComment OneShot] 原始 content 前 1200 字:', typeof content === 'string' ? content.slice(0, 1200) : content);
    console.warn('[Background][BlogComment OneShot] formMetadata.fields 数量:', formMetadata?.fields?.length);
  } catch (_) {}
}

async function handleAIRecognizeCommentForm(formMetadata, tabId) {
  const log = (...a) => aiLogToPage(tabId, 'log', ...a);
  const logErr = (...a) => aiLogToPage(tabId, 'error', ...a);

  const storage = await chrome.storage.local.get(['settings']);
  const llmConfig = storage.settings?.llmConfig;

  if (!llmConfig?.enabled || !llmConfig?.apiKey) {
    throw new Error('LLM 未启用或 API Key 未配置');
  }

  const formDescription = buildCompactFormDescription(formMetadata);
  const prompt = buildCommentFormAIPrompt(formDescription, formMetadata);

  const requestBody = {
    model: llmConfig.model || 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are a helpful assistant. You understand form labels in any language. Map each field to the correct standard type by first interpreting the label (e.g. translate to English mentally), then choose the matching standard field. Respond only with valid JSON.' },
      { role: 'user', content: prompt }
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: 2048
  };
  const endpointComment = llmConfig.endpoint || 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';
  if (llmConfig.disableThinking !== false) {
    requestBody.thinking = { type: 'disabled' };
  }

  const commentReqJson = JSON.stringify(requestBody, null, 2);
  console.log('[AI Form 识别-评论] 请求完整 JSON:', commentReqJson);
  log('[AI Form 识别-评论] 请求完整 JSON:', commentReqJson);

  try {
    const _adapted = adaptLlmRequest(endpointComment, llmConfig.apiKey, requestBody);
    const response = await fetchLlmWithRetry(
      _adapted.url,
      _adapted.init,
      { timeoutMs: AI_REQUEST_TIMEOUT_MS, maxRetries: AI_REQUEST_MAX_RETRIES }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logErr('Comment form AI API error:', errorText);
      throw new Error(`API 错误 ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const commentResJson = JSON.stringify(data, null, 2);
    console.log('[AI Form 识别-评论] 响应完整 JSON:', commentResJson);
    log('[AI Form 识别-评论] 响应完整 JSON:', commentResJson);

    let content = extractLlmContent(data).trim();
    if (!content) throw new Error('API 返回内容为空');

    const { mappings, submitButton } = parseCommentFormAIResponse(content, formMetadata);
    log('Comment form AI mappings:', mappings.length, 'submitButton:', submitButton);
    return { mappings, submitButton };
  } catch (error) {
    throw error;
  }
}

// Handle extension icon click - Open Side Panel
chrome.action.onClicked.addListener(async (tab) => {
  // 如果有 popup，这个监听器不会被触发
  // 当移除 popup 后，点击图标会打开 Side Panel
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    console.error('[Background] Failed to open side panel:', e);
  }
});

// 允许在所有页面使用 Side Panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ========== 批量提交：Background 驱动的自动化流程 ==========

/**
 * 批量提交任务状态
 */
let batchTaskState = {
  running: false,
  paused: false,
  currentIndex: 0,
  total: 0,
  urls: [],
  results: []
};

/**
 * 开始批量提交任务
 * @param {Array} urls - 要提交的 URL 列表
 * @param {Object} options - 配置选项
 */
async function startBatchTask(urls, options = {}) {
  if (batchTaskState.running) {
    return { success: false, error: '已有任务在运行' };
  }

  batchTaskState = {
    running: true,
    paused: false,
    currentIndex: 0,
    total: urls.length,
    urls: urls,
    results: [],
    options: {
      siteId: options.siteId,
      autoSubmit: options.autoSubmit ?? false,
      interval: options.interval ?? 2000,
      timeout: options.timeout ?? 30000,
      onProgress: options.onProgress,
      onComplete: options.onComplete
    }
  };

  // 通知 Side Panel 更新 UI
  notifyBatchProgress();

  // 异步执行批量任务
  executeBatchTask();

  return { success: true, total: urls.length };
}

/**
 * 执行批量提交任务
 */
async function executeBatchTask() {
  const { urls, options } = batchTaskState;

  // 获取站点信息
  const storage = await chrome.storage.local.get(['sites', 'settings']);
  const sites = storage.sites || [];
  const site = sites.find(s => s.id === options.siteId);

  if (!site) {
    batchTaskState.running = false;
    notifyBatchComplete({ error: '未找到站点配置' });
    return;
  }

  for (let i = batchTaskState.currentIndex; i < urls.length; i++) {
    // 检查是否暂停或停止
    while (batchTaskState.paused && batchTaskState.running) {
      await sleep(500);
    }
    if (!batchTaskState.running) break;

    batchTaskState.currentIndex = i;
    const urlItem = urls[i];

    // 通知进度
    notifyBatchProgress({
      url: urlItem.url,
      index: i,
      status: 'running'
    });

    try {
      // 打开新标签页
      const tab = await chrome.tabs.create({ url: urlItem.url, active: false });

      // 等待页面加载完成
      await waitForTabComplete(tab.id, options.timeout);

      // 获取 LLM 配置
      const llmConfig = storage.settings?.llmConfig;
      const llmEnabled = !!(llmConfig?.enabled && llmConfig?.apiKey);

      // 获取页面元数据
      const metaRes = await chrome.tabs.sendMessage(tab.id, { action: 'getPageMetadata' }).catch(() => null);
      const title = metaRes?.title ?? '';
      const description = metaRes?.description ?? '';
      const h1 = metaRes?.h1 ?? '';

      // 执行评论生成和填充
      const fillRes = await chrome.tabs.sendMessage(tab.id, {
        action: 'blogCommentGenerateAndFill',
        title,
        description,
        h1,
        siteId: options.siteId,
        autoSubmit: options.autoSubmit,
        llmEnabled,
        tabId: tab.id,
        siteUrl: site.siteUrl
      }).catch(() => null);

      let result = {
        url: urlItem.url,
        record_id: urlItem.record_id,
        success: false,
        status: '识别失败',
        message: '无法与页面通信'
      };

      if (fillRes?.success) {
        const r = fillRes.result;

        // 等待页面刷新后验证
        if (r.clickedSubmit) {
          await sleep(3000);
          const verifyRes = await chrome.tabs.sendMessage(tab.id, {
            action: 'verifyCommentSubmission',
            siteUrl: site.siteUrl
          }).catch(() => null);

          if (verifyRes?.success && verifyRes.result?.success) {
            result = {
              url: urlItem.url,
              record_id: urlItem.record_id,
              success: true,
              status: '检测成功',
              message: verifyRes.result.message
            };
          } else {
            result = {
              url: urlItem.url,
              record_id: urlItem.record_id,
              success: false,
              status: '检测失败',
              message: verifyRes?.result?.message || '未在页面中找到站点链接'
            };
          }
        } else if (r.hasSpamVerification) {
          result = {
            url: urlItem.url,
            record_id: urlItem.record_id,
            success: false,
            status: '需人工验证',
            message: '检测到验证项'
          };
        } else {
          result = {
            url: urlItem.url,
            record_id: urlItem.record_id,
            success: false,
            status: '未提交',
            message: `已填充 ${r.filledCount} 个字段`
          };
        }
      } else {
        // 标准流程失败 → 尝试 Agent Loop 路径作为 fallback
        const llmFallback = !!(llmConfig?.enabled && llmConfig?.apiKey);
        if (llmFallback && fillRes?.error !== '评论生成失败') {
          const logFn = (msg) => console.log(`[批量-AgentLoop][${urlItem.url}]`, msg);
          logFn('标准流程失败，尝试 Agent Loop fallback...');
          try {
            const generatedComment = await handleGenerateBlogComment(title, description, h1, site.siteUrl);
            const profileData = {
              commentName: site.siteName || '',
              commentEmail: site.email || '',
              commentWebsite: site.siteUrl || ''
            };
            const agentRes = await fullAiAgent.runFullAiTask(
              tab.id, site.siteUrl, generatedComment, fetchLlmWithRetry, logFn, profileData
            );
            if (agentRes?.success) {
              await sleep(3000);
              const verifyRes = await chrome.tabs.sendMessage(tab.id, {
                action: 'verifyCommentSubmission',
                siteUrl: site.siteUrl
              }).catch(() => null);
              result = {
                url: urlItem.url,
                record_id: urlItem.record_id,
                success: !!(verifyRes?.success && verifyRes?.result?.success),
                status: verifyRes?.result?.success ? '检测成功' : 'Agent完成-待验证',
                message: verifyRes?.result?.message || agentRes.reason || 'Agent Loop 完成',
                agentRounds: agentRes.agentRounds || 0
              };
            } else {
              result = {
                url: urlItem.url,
                record_id: urlItem.record_id,
                success: false,
                status: 'Agent失败',
                message: agentRes?.error || 'Agent Loop 失败',
                agentRounds: agentRes?.agentRounds || 0
              };
            }
          } catch (agentErr) {
            result = {
              url: urlItem.url,
              record_id: urlItem.record_id,
              success: false,
              status: 'Agent异常',
              message: agentErr?.message || 'Agent Loop 异常'
            };
          }
        } else {
          result = {
            url: urlItem.url,
            record_id: urlItem.record_id,
            success: false,
            status: '识别失败',
            message: fillRes?.error || '评论生成失败'
          };
        }
      }

      batchTaskState.results.push(result);

      // 通知进度
      notifyBatchProgress({
        url: urlItem.url,
        index: i,
        status: result.success ? 'success' : 'failed',
        result
      });

      // 关闭标签页
      await chrome.tabs.remove(tab.id).catch(() => {});

      // 间隔等待
      if (i < urls.length - 1 && batchTaskState.running) {
        await sleep(options.interval);
      }

    } catch (error) {
      const result = {
        url: urlItem.url,
        record_id: urlItem.record_id,
        success: false,
        status: '超时',
        message: error.message
      };
      batchTaskState.results.push(result);

      notifyBatchProgress({
        url: urlItem.url,
        index: i,
        status: 'failed',
        result
      });
    }
  }

  // 任务完成
  batchTaskState.running = false;
  notifyBatchComplete({
    total: urls.length,
    results: batchTaskState.results
  });
}

/**
 * 暂停/继续批量任务
 */
function pauseBatchTask(pause) {
  batchTaskState.paused = pause;
}

/**
 * 停止批量任务
 */
function stopBatchTask() {
  batchTaskState.running = false;
  batchTaskState.paused = false;
}

/**
 * 获取批量任务状态
 */
function getBatchTaskState() {
  return {
    running: batchTaskState.running,
    paused: batchTaskState.paused,
    currentIndex: batchTaskState.currentIndex,
    total: batchTaskState.total,
    progress: batchTaskState.total > 0 ? (batchTaskState.currentIndex / batchTaskState.total) : 0
  };
}

/**
 * 通知 Side Panel 批量任务进度
 */
function notifyBatchProgress(data) {
  chrome.runtime.sendMessage({
    action: 'batchProgress',
    data: {
      ...getBatchTaskState(),
      ...data
    }
  }).catch(() => {});
}

/**
 * 通知 Side Panel 批量任务完成
 */
function notifyBatchComplete(data) {
  chrome.runtime.sendMessage({
    action: 'batchComplete',
    data
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForTabComplete(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('页面加载超时'));
    }, timeout);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// 监听来自 Side Panel 的批量任务消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startBatchTask') {
    startBatchTask(request.urls, request.options)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'pauseBatchTask') {
    pauseBatchTask(request.paused);
    sendResponse({ success: true });
  } else if (request.action === 'stopBatchTask') {
    stopBatchTask();
    sendResponse({ success: true });
  } else if (request.action === 'getBatchTaskState') {
    sendResponse(getBatchTaskState());
  }
});

/**
 * 凭据缓存模块 — 从 chrome.storage.local 读写 siteCredentials，按域名匹配凭据
 * 数据源：飞书电子表格「媒体账号统计」，通过 Options 页同步
 */
(function (global) {
  'use strict';

  function extractDomain(urlString) {
    try {
      const u = new URL(urlString.startsWith('http') ? urlString : 'https://' + urlString);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return urlString.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
  }

  async function loadCredentials() {
    const data = await chrome.storage.local.get(['siteCredentials']);
    return data.siteCredentials || [];
  }

  async function saveCredentials(list) {
    await chrome.storage.local.set({ siteCredentials: list });
  }

  /**
   * 按域名查找凭据。优先精确匹配，其次后缀匹配。
   * @param {string} currentUrl - 当前页面 URL
   * @returns {Promise<object|null>} SiteCredential 或 null
   */
  async function findCredentialByDomain(currentUrl) {
    const credentials = await loadCredentials();
    if (!credentials.length) return null;

    const pageDomain = extractDomain(currentUrl);
    if (!pageDomain) return null;

    let exact = null;
    let suffix = null;

    for (const cred of credentials) {
      const credDomain = cred.domain || extractDomain(cred.url || '');
      if (!credDomain) continue;
      if (pageDomain === credDomain) {
        exact = cred;
        break;
      }
      if (!suffix && pageDomain.endsWith('.' + credDomain)) {
        suffix = cred;
      }
    }

    return exact || suffix || null;
  }

  /**
   * 从飞书 Sheets API 同步凭据到 chrome.storage.local
   * 复用飞书配置的 App ID / App Secret
   */
  async function syncCredentialsFromFeishu(log) {
    const storage = await chrome.storage.local.get(['feishuConfig', 'credConfig']);
    const feishu = storage.feishuConfig || {};
    const cred = storage.credConfig || {};

    const appId = feishu.appId;
    const appSecret = feishu.appSecret;
    const spreadsheetToken = cred.spreadsheetToken || 'FgWhsDQdNhWfVot4787ceNMXnDd';
    const sheetName = cred.sheetName || '媒体账号统计';

    if (!appId || !appSecret) {
      log?.('凭据同步跳过：飞书 App ID / Secret 未配置');
      return { success: false, error: '飞书凭证未配置' };
    }
    if (!spreadsheetToken) {
      log?.('凭据同步跳过：电子表格 Token 未配置');
      return { success: false, error: '电子表格 Token 未配置' };
    }

    try {
      // 1. tenant_access_token（尝试复用缓存）
      let token = null;
      const session = await chrome.storage.session?.get?.(['feishuToken', 'feishuTokenExpiry']).catch(() => ({})) || {};
      if (session.feishuToken && session.feishuTokenExpiry > Date.now()) {
        token = session.feishuToken;
      } else {
        const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: appId, app_secret: appSecret })
        });
        const tokenData = await tokenResp.json();
        if (tokenData.code !== 0) {
          return { success: false, error: '飞书认证失败: ' + (tokenData.msg || '') };
        }
        token = tokenData.tenant_access_token;
        const expiry = Date.now() + (tokenData.expire || 7200) * 1000 - 60000;
        await chrome.storage.session?.set?.({ feishuToken: token, feishuTokenExpiry: expiry }).catch(() => {});
      }

      // 2. 查询工作表列表
      const sheetsResp = await fetch(
        `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const sheetsData = await sheetsResp.json();
      if (sheetsData.code !== 0) {
        return { success: false, error: '获取工作表失败: ' + (sheetsData.msg || '') };
      }
      const sheets = sheetsData.data?.sheets || [];
      const targetSheet = sheetName
        ? sheets.find(s => s.title === sheetName)
        : sheets[0];
      if (!targetSheet) {
        return { success: false, error: `未找到名为「${sheetName}」的工作表` };
      }
      const sheetId = targetSheet.sheet_id;
      const rowCount = targetSheet.grid_properties?.row_count || 500;

      // 3. 读取全部数据
      const range = `${sheetId}!A1:Z${rowCount}`;
      const dataResp = await fetch(
        `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const sheetResult = await dataResp.json();
      if (sheetResult.code !== 0) {
        return { success: false, error: '读取数据失败: ' + (sheetResult.msg || '') };
      }
      const rows = sheetResult.data?.valueRange?.values || [];
      if (rows.length < 2) {
        return { success: false, error: '表格无数据行' };
      }

      // 4. 解析（飞书单元格可能返回富文本对象，需递归提取文本）
      const cellToString = (val) => {
        if (val == null) return '';
        if (typeof val === 'string') return val.trim();
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        if (Array.isArray(val)) return val.map(cellToString).join('');
        if (typeof val === 'object') {
          if (val.text != null) return String(val.text).trim();
          if (val.link?.url) return String(val.link.url).trim();
          if (val.value != null) return String(val.value).trim();
          return Object.values(val).map(cellToString).join('');
        }
        return String(val).trim();
      };
      const headerRow = rows[0].map(h => cellToString(h));
      const COL_ALIASES = {
        platform: ['平台'],
        username: ['账号名'],
        password: ['登录密码'],
        email: ['登录邮箱'],
        url: ['网址']
      };
      const colIndex = {};
      for (const [field, aliases] of Object.entries(COL_ALIASES)) {
        const idx = headerRow.findIndex(h => aliases.some(a => h.includes(a)));
        if (idx >= 0) colIndex[field] = idx;
      }

      const credentials = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(c => !c)) continue;
        const cell = (idx) => (idx != null && row[idx] != null) ? cellToString(row[idx]) : '';
        const platform = cell(colIndex.platform);
        const username = cell(colIndex.username);
        const password = cell(colIndex.password);
        const email = cell(colIndex.email);
        const rawUrl = cell(colIndex.url);
        if (!rawUrl && !platform) continue;
        credentials.push({
          platform, username, password, email,
          url: rawUrl,
          domain: rawUrl ? extractDomain(rawUrl) : platform.toLowerCase()
        });
      }

      await saveCredentials(credentials);
      const now = new Date().toLocaleString('zh-CN');
      await chrome.storage.local.set({ credConfig: { ...cred, lastSyncTime: now } });

      log?.(`凭据同步完成，共 ${credentials.length} 条`);
      return { success: true, count: credentials.length };
    } catch (e) {
      return { success: false, error: '同步异常: ' + (e?.message || '') };
    }
  }

  global.credentialCache = {
    extractDomain,
    loadCredentials,
    saveCredentials,
    findCredentialByDomain,
    syncCredentialsFromFeishu
  };
})(typeof self !== 'undefined' ? self : this);

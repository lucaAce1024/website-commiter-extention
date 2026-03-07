/**
 * Side Panel Script - Main logic for the extension side panel
 * 阶段一：复刻 Popup 的 Blog 评论功能
 * 阶段二：批量提交与飞书集成
 */

// ========== 常量 ==========
const BLOG_POPUP_STATE_PREFIX = 'blog_popup_state_';

// ========== DOM Elements ==========
const elements = {
  // Header
  refreshTabBtn: document.getElementById('refreshTabBtn'),

  // Mode tabs
  modeTabs: document.querySelectorAll('.mode-tab'),
  panelBlog: document.getElementById('panel-blog'),
  panelBatch: document.getElementById('panel-batch'),

  // Blog 评论模式
  blogSiteSelect: document.getElementById('blogSiteSelect'),
  blogCurrentSiteUrl: document.getElementById('blogCurrentSiteUrl'),
  blogManageSitesBtn: document.getElementById('blogManageSitesBtn'),
  blogAddSiteLink: document.getElementById('blogAddSiteLink'),
  blogNoSitesHint: document.getElementById('blogNoSitesHint'),
  blogPageDomain: document.getElementById('blogPageDomain'),
  blogFormStatus: document.getElementById('blogFormStatus'),
  blogRecognitionStatus: document.getElementById('blogRecognitionStatus'),
  blogFieldCountRow: document.getElementById('blogFieldCountRow'),
  blogFieldCount: document.getElementById('blogFieldCount'),
  blogFieldPrevBtn: document.getElementById('blogFieldPrevBtn'),
  blogFieldNextBtn: document.getElementById('blogFieldNextBtn'),
  blogSpamHint: document.getElementById('blogSpamHint'),
  blogNoFormHint: document.getElementById('blogNoFormHint'),
  blogCacheHint: document.getElementById('blogCacheHint'),
  blogClearCacheBtn: document.getElementById('blogClearCacheBtn'),
  blogStatusMessage: document.getElementById('blogStatusMessage'),
  blogStatusText: document.getElementById('blogStatusText'),
  blogCloseStatusBtn: document.getElementById('blogCloseStatusBtn'),
  blogStatusLine: document.getElementById('blogStatusLine'),
  blogGenerateAndFillBtn: document.getElementById('blogGenerateAndFillBtn'),
  blogVerifySubmitBtn: document.getElementById('blogVerifySubmitBtn'),
  openBlogSitesBtn: document.getElementById('openBlogSitesBtn'),
  blogOpenOptionsBtn: document.getElementById('blogOpenOptionsBtn'),
  autoSubmit: document.getElementById('autoSubmit'),

  // 批量提交模式 - 飞书同步
  syncFromFeishuBtn: document.getElementById('syncFromFeishuBtn'),
  feishuLastSyncTime: document.getElementById('feishuLastSyncTime'),

  // 批量提交模式 - 任务控制
  batchProgress: document.getElementById('batchProgress'),
  batchStatusMessage: document.getElementById('batchStatusMessage'),
  batchStatusText: document.getElementById('batchStatusText'),
  batchUrlList: document.getElementById('batchUrlList'),
  batchTypeFilter: document.getElementById('batchTypeFilter'),
  batchStatusFilter: document.getElementById('batchStatusFilter'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  deselectAllBtn: document.getElementById('deselectAllBtn'),
  startBatchBtn: document.getElementById('startBatchBtn'),
  pauseBatchBtn: document.getElementById('pauseBatchBtn'),
  stopBatchBtn: document.getElementById('stopBatchBtn'),
  clearBatchLogBtn: document.getElementById('clearBatchLogBtn'),
  batchLogContainer: document.getElementById('batchLogContainer')
};

// ========== State ==========
let currentTab = null;
let sites = [];
let currentSiteId = null;
let llmEnabled = false;
let currentMode = 'blog';
let commentPageState = null;
let batchUrls = [];
let batchRunning = false;
let batchPaused = false;

// ========== 初始化 ==========
async function init() {
  // 获取当前活动标签页
  await updateCurrentTab();

  // 加载站点
  await loadSites();

  // 获取评论表单状态
  await getCommentPageState();

  // 设置事件监听
  setupEventListeners();

  // 同步 Blog 面板的站点下拉
  syncBlogSiteSelect();
  showModePanel(currentMode);

  // 恢复当前 URL 的 Blog 面板状态
  if (currentMode === 'blog') await restoreBlogPopupState();
  await tryShowLastVerifyResult();

  // 监听标签页变化
  setupTabChangeListener();

  // 加载飞书凭证
  await loadFeishuCredentials();
}

/**
 * 更新当前活动标签页
 */
async function updateCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];

    if (currentTab) {
      let hostname = '';
      try {
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
          hostname = new URL(currentTab.url).hostname;
        } else {
          hostname = currentTab.url || '—';
        }
      } catch (_) {
        hostname = currentTab.url || '—';
      }
      if (elements.blogPageDomain) elements.blogPageDomain.textContent = hostname;
    }
  } catch (error) {
    console.error('[SidePanel] Failed to get current tab:', error);
  }
}

/**
 * 设置标签页变化监听
 */
function setupTabChangeListener() {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // 仅当 Side Panel 可见时更新
    if (currentMode === 'blog') {
      await updateCurrentTab();
      await getCommentPageState();
      await restoreBlogPopupState();
      await tryShowLastVerifyResult();
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (currentMode === 'blog' && tab.active && changeInfo.status === 'complete') {
      await updateCurrentTab();
      await getCommentPageState();
    }
  });
}

// ========== 站点管理 ==========

async function loadSites() {
  try {
    const result = await chrome.storage.local.get(['sites', 'settings', 'sidePanelMode']);
    sites = result.sites || [];
    currentSiteId = result.settings?.currentSiteId;

    if (result.sidePanelMode === 'blog' || result.sidePanelMode === 'batch') {
      currentMode = result.sidePanelMode;
    }

    if (elements.autoSubmit) {
      elements.autoSubmit.checked = result.settings?.autoSubmit ?? false;
    }

    // 检查 LLM 是否启用
    const llmConfig = result.settings?.llmConfig;
    llmEnabled = !!(llmConfig?.enabled && llmConfig?.apiKey);

    // 更新站点下拉框
    syncBlogSiteSelect();

    // 显示/隐藏无站点提示
    if (sites.length === 0) {
      elements.blogNoSitesHint?.classList.remove('hidden');
      elements.blogSiteSelect?.classList.add('hidden');
    } else {
      elements.blogNoSitesHint?.classList.add('hidden');
      elements.blogSiteSelect?.classList.remove('hidden');
    }

    updateCurrentSiteUrlDisplay();
  } catch (error) {
    console.error('[SidePanel] Failed to load sites:', error);
  }
}

function syncBlogSiteSelect() {
  if (!elements.blogSiteSelect) return;
  elements.blogSiteSelect.innerHTML = '<option value="">-- 请选择站点 --</option>';
  sites.forEach((site) => {
    const opt = document.createElement('option');
    opt.value = site.id;
    opt.textContent = site.siteName || site.siteUrl || 'Unnamed';
    elements.blogSiteSelect.appendChild(opt);
  });
  if (currentSiteId) elements.blogSiteSelect.value = currentSiteId;
}

function updateCurrentSiteUrlDisplay() {
  const site = currentSiteId ? sites.find(s => s.id === currentSiteId) : null;
  const url = site?.siteUrl?.trim() || '';
  if (elements.blogCurrentSiteUrl) {
    if (url) {
      elements.blogCurrentSiteUrl.textContent = url;
      elements.blogCurrentSiteUrl.classList.remove('hidden');
    } else {
      elements.blogCurrentSiteUrl.textContent = '';
      elements.blogCurrentSiteUrl.classList.add('hidden');
    }
  }
}

// ========== 模式切换 ==========

function showModePanel(mode) {
  currentMode = mode;
  chrome.storage.local.set({ sidePanelMode: currentMode });
  elements.modeTabs?.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  if (elements.panelBlog) elements.panelBlog.classList.toggle('hidden', mode !== 'blog');
  if (elements.panelBatch) elements.panelBatch.classList.toggle('hidden', mode !== 'batch');

  if (mode === 'blog') {
    getCommentPageState();
    restoreBlogPopupState();
    tryShowLastVerifyResult();
  }
}

// ========== Blog 评论功能 ==========

function getCommentCacheKeyForTab(tab) {
  if (!tab?.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return null;
  try {
    const u = new URL(tab.url);
    return 'blog_' + u.hostname + u.pathname;
  } catch {
    return null;
  }
}

async function getCommentPageState() {
  if (!currentTab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getCommentPageState' });
    if (response?.success) {
      commentPageState = response.state;
      updateBlogFormStatus();
    } else {
      const rec = await chrome.tabs.sendMessage(currentTab.id, { action: 'recognizeCommentForm', useLlm: false });
      if (rec?.success && rec.result?.status === 'success') {
        commentPageState = {
          hasForm: true,
          fieldMappings: rec.result.mappings,
          recognitionStatus: 'done',
          hasSpamVerification: rec.result.hasSpamVerification
        };
        updateBlogFormStatusFromRec(rec.result);
      } else {
        setBlogNoForm();
      }
    }
  } catch (e) {
    if (e?.message?.includes('Receiving end')) setBlogNoForm();
    else setBlogNoForm();
  }
  await updateBlogClearCacheState();
}

function updateBlogFormStatus() {
  if (!commentPageState) {
    setBlogNoForm();
    return;
  }
  if (elements.blogFormStatus) elements.blogFormStatus.classList.remove('hidden');
  if (elements.blogNoFormHint) elements.blogNoFormHint.classList.add('hidden');
  if (elements.blogRecognitionStatus) {
    const s = commentPageState.recognitionStatus;
    elements.blogRecognitionStatus.textContent = s === 'done' ? '已识别' : s === 'recognizing' ? '识别中...' : s === 'failed' ? '失败' : '未识别';
    if (commentPageState.recognitionMethod) {
      elements.blogRecognitionStatus.textContent += ` (${commentPageState.recognitionMethod === 'ai' ? 'AI' : commentPageState.recognitionMethod === 'cache' ? '缓存' : '关键词'})`;
    }
  }
  const count = commentPageState.fieldMappings?.length ?? 0;
  if (elements.blogFieldCount) elements.blogFieldCount.textContent = count + ' 个字段';
  if (elements.blogSpamHint) elements.blogSpamHint.classList.toggle('hidden', !commentPageState.hasSpamVerification);
  if (elements.blogGenerateAndFillBtn) elements.blogGenerateAndFillBtn.disabled = !currentSiteId;
  if (elements.blogVerifySubmitBtn) elements.blogVerifySubmitBtn.disabled = !currentSiteId;
}

function updateBlogFormStatusFromRec(rec) {
  commentPageState = {
    hasForm: true,
    fieldMappings: rec.mappings,
    recognitionStatus: 'done',
    hasSpamVerification: false,
    recognitionMethod: rec.method
  };
  updateBlogFormStatus();
  if (elements.blogSpamHint) elements.blogSpamHint.classList.add('hidden');
}

function setBlogNoForm() {
  commentPageState = null;
  if (elements.blogFormStatus) elements.blogFormStatus.classList.add('hidden');
  if (elements.blogNoFormHint) elements.blogNoFormHint.classList.remove('hidden');
  if (elements.blogGenerateAndFillBtn) elements.blogGenerateAndFillBtn.disabled = true;
  if (elements.blogVerifySubmitBtn) elements.blogVerifySubmitBtn.disabled = true;
  updateBlogClearCacheState();
}

async function updateBlogClearCacheState() {
  if (!elements.blogClearCacheBtn) return;
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) {
    elements.blogClearCacheBtn.disabled = true;
    elements.blogClearCacheBtn.classList.remove('blog-cache-has');
    elements.blogFieldCount?.classList.remove('blog-field-count-has-cache');
    if (elements.blogFieldPrevBtn) elements.blogFieldPrevBtn.disabled = true;
    if (elements.blogFieldNextBtn) elements.blogFieldNextBtn.disabled = true;
    if (elements.blogCacheHint) elements.blogCacheHint.classList.add('hidden');
    return;
  }
  const result = await chrome.storage.local.get(['blogCommentFieldMappings']);
  const mappings = result.blogCommentFieldMappings || {};
  const cached = mappings[cacheKey];
  const hasCache = !!(cached && (cached.mappings?.length || (Array.isArray(cached) && cached.length)));
  const cacheFieldCount = hasCache && cached ? (cached.mappings?.length ?? (Array.isArray(cached) ? cached.length : 0)) : 0;
  elements.blogClearCacheBtn.disabled = !hasCache;
  elements.blogClearCacheBtn.classList.toggle('blog-cache-has', hasCache);
  elements.blogFieldCount?.classList.toggle('blog-field-count-has-cache', hasCache);
  if (elements.blogFieldPrevBtn) elements.blogFieldPrevBtn.disabled = !hasCache;
  if (elements.blogFieldNextBtn) elements.blogFieldNextBtn.disabled = !hasCache;
  if (hasCache && elements.blogFieldCount) {
    elements.blogFieldCount.textContent = cacheFieldCount + ' 个字段';
  }
  if (elements.blogCacheHint) {
    if (hasCache) {
      elements.blogCacheHint.textContent = '当前页已有缓存';
      elements.blogCacheHint.classList.remove('hidden');
    } else {
      elements.blogCacheHint.classList.add('hidden');
    }
  }
}

// ========== 状态持久化 ==========

function saveBlogPopupState() {
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) return;
  const statusLineText = elements.blogStatusLine?.textContent?.trim() || '';
  const statusMessageVisible = elements.blogStatusMessage && !elements.blogStatusMessage.classList.contains('hidden');
  const statusMessageText = statusMessageVisible ? (elements.blogStatusText?.textContent?.trim() || '') : '';
  let statusMessageType = 'info';
  if (statusMessageVisible && elements.blogStatusMessage?.className) {
    if (elements.blogStatusMessage.className.includes('success')) statusMessageType = 'success';
    else if (elements.blogStatusMessage.className.includes('warning')) statusMessageType = 'warning';
    else if (elements.blogStatusMessage.className.includes('error')) statusMessageType = 'error';
  }
  const payload = { statusLineText, statusMessageText, statusMessageType };
  chrome.storage.local.set({ [BLOG_POPUP_STATE_PREFIX + cacheKey]: payload }).catch(() => {});
}

function applyBlogPopupStateToDom(state) {
  if (!state || typeof state !== 'object') return;
  if (state.statusLineText !== undefined && elements.blogStatusLine) {
    elements.blogStatusLine.textContent = state.statusLineText || '';
    elements.blogStatusLine.classList.toggle('hidden', !state.statusLineText);
    if (state.statusLineText) elements.blogStatusLine.scrollLeft = 0;
  }
  if (state.statusMessageText !== undefined && elements.blogStatusText && elements.blogStatusMessage) {
    elements.blogStatusText.textContent = state.statusMessageText || '';
    elements.blogStatusMessage.className = 'status-message status-message-above-actions ' + (state.statusMessageType || 'info');
    elements.blogStatusMessage.classList.toggle('hidden', !state.statusMessageText);
  }
}

async function restoreBlogPopupState() {
  if (currentMode !== 'blog') return;
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) return;
  try {
    const key = BLOG_POPUP_STATE_PREFIX + cacheKey;
    const stored = await chrome.storage.local.get(key);
    applyBlogPopupStateToDom(stored[key]);
  } catch (_) {}
}

async function tryShowLastVerifyResult() {
  if (!currentTab?.id || currentMode !== 'blog') return;
  try {
    const key = 'lastVerifyResult_' + currentTab.id;
    const stored = await chrome.storage.session.get(key);
    const result = stored[key];
    if (result && (result.message || result.success !== undefined)) {
      showBlogMessage(result.message || (result.success ? '已在页面中找到您的站点链接' : '未在页面中检测到您的站点链接'), result.success ? 'success' : 'warning');
      await chrome.storage.session.remove(key);
    }
  } catch (_) {}
}

// ========== 消息展示 ==========

function showBlogMessage(message, type = 'info') {
  if (!elements.blogStatusText || !elements.blogStatusMessage) return;
  elements.blogStatusText.textContent = message;
  elements.blogStatusMessage.className = 'status-message status-message-above-actions ' + type;
  elements.blogStatusMessage.classList.remove('hidden');
  if (type === 'success' || type === 'warning') {
    setTimeout(hideBlogMessage, 5000);
  }
  saveBlogPopupState();
}

function hideBlogMessage() {
  if (elements.blogStatusMessage) elements.blogStatusMessage.classList.add('hidden');
  saveBlogPopupState();
}

function setBlogStatusLine(text) {
  if (!elements.blogStatusLine) return;
  elements.blogStatusLine.textContent = text || '';
  elements.blogStatusLine.classList.toggle('hidden', !text);
  if (text) elements.blogStatusLine.scrollLeft = 0;
  saveBlogPopupState();
}

// ========== 事件监听设置 ==========

function setupEventListeners() {
  // 模式切换
  elements.modeTabs?.forEach((tab) => {
    tab.addEventListener('click', async () => {
      showModePanel(tab.dataset.mode);
    });
  });

  // 刷新当前页面
  elements.refreshTabBtn?.addEventListener('click', async () => {
    if (!currentTab?.id) return;
    try {
      await chrome.tabs.reload(currentTab.id);
      showBlogMessage('页面刷新中…', 'info');
    } catch (e) {
      showBlogMessage('无法刷新该页面', 'error');
    }
  });

  // Blog 站点选择
  elements.blogSiteSelect?.addEventListener('change', async () => {
    const newId = elements.blogSiteSelect?.value || null;
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.currentSiteId = newId;
    await chrome.storage.local.set({ settings });
    currentSiteId = newId;
    updateCurrentSiteUrlDisplay();
    updateBlogFormStatus();
  });

  // 管理站点按钮
  elements.blogManageSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 添加站点链接
  elements.blogAddSiteLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // 自动提交复选框
  elements.autoSubmit?.addEventListener('change', async () => {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.autoSubmit = elements.autoSubmit.checked;
    await chrome.storage.local.set({ settings });
  });

  // 生成评论并填充
  elements.blogGenerateAndFillBtn?.addEventListener('click', async () => {
    if (!currentSiteId || !currentTab?.id) {
      showBlogMessage('请先选择当前站点', 'warning');
      return;
    }
    elements.blogGenerateAndFillBtn.disabled = true;
    elements.blogGenerateAndFillBtn.innerHTML = '<span class="btn-icon">⏳</span> 生成中...';
    setBlogStatusLine('');
    const t0 = Date.now();
    try {
      const metaRes = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageMetadata' });
      const title = metaRes?.title ?? '';
      const description = metaRes?.description ?? '';
      const h1 = metaRes?.h1 ?? '';

      const statusHint = llmEnabled ? 'AI 评论生成与表单识别中...' : '评论生成与表单识别中...';
      setBlogStatusLine(statusHint);

      const site = sites.find((s) => s.id === currentSiteId);
      const res = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'blogCommentGenerateAndFill',
        title,
        description,
        h1,
        siteId: currentSiteId,
        autoSubmit: elements.autoSubmit?.checked ?? false,
        llmEnabled,
        tabId: currentTab.id,
        siteUrl: site?.siteUrl
      });

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      if (!res?.success) {
        showBlogMessage(res?.error || '操作失败', 'error');
        setBlogStatusLine(`失败 · 已耗时 ${elapsed}s`);
        return;
      }

      const r = res.result;
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
      setBlogStatusLine(
        `耗时 ${elapsed}s (${methodHint}) · 已填充 ${r.filledCount} 个字段${r.consentCheckboxesChecked > 0 ? `，已勾选 ${r.consentCheckboxesChecked} 个选项` : ''} · ${checkText}`
      );

      let msg = `已填充 ${r.filledCount} 个字段。`;
      if (r.consentCheckboxesChecked > 0) msg += ` 已勾选 ${r.consentCheckboxesChecked} 个选项。`;
      if (r.hasSpamVerification) {
        msg += ' 检测到验证项，请手动完成验证后点击提交。';
      } else if (r.clickedSubmit) {
        msg += ' 已自动点击提交。页面刷新后将自动验证本站链接是否出现。';
      }
      showBlogMessage(msg, 'success');
    } catch (err) {
      showBlogMessage(err?.message?.includes('Receiving end') ? '请刷新页面后再试' : (err?.message || '操作失败'), 'error');
      setBlogStatusLine(`出错 · 已耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } finally {
      elements.blogGenerateAndFillBtn.disabled = false;
      elements.blogGenerateAndFillBtn.innerHTML = '<span class="btn-icon">💬</span> 生成评论并填充';
    }
  });

  // 验证本次提交
  elements.blogVerifySubmitBtn?.addEventListener('click', async () => {
    if (!currentSiteId || !currentTab?.id) return;
    const site = sites.find((s) => s.id === currentSiteId);
    if (!site?.siteUrl) {
      showBlogMessage('当前站点未设置网站 URL', 'warning');
      return;
    }
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'verifyCommentSubmission', siteUrl: site.siteUrl });
      if (res?.success && res.result?.success) showBlogMessage(res.result.message, 'success');
      else showBlogMessage(res?.result?.message || '未在页面中检测到您的站点链接', 'warning');
    } catch (e) {
      showBlogMessage(e?.message || '验证失败', 'error');
    }
  });

  // 关闭状态消息
  elements.blogCloseStatusBtn?.addEventListener('click', hideBlogMessage);

  // 清除缓存
  elements.blogClearCacheBtn?.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(currentTab.id, { action: 'clearCommentMapping' });
      showBlogMessage('已清除本页评论缓存', 'success');
      await getCommentPageState();
      await updateBlogClearCacheState();
    } catch (e) {
      showBlogMessage('清除失败', 'error');
    }
  });

  // 点击可填字段行高亮
  elements.blogFieldCountRow?.addEventListener('click', async (e) => {
    if (e.target.closest('.blog-field-nav-btns')) return;
    if (!currentTab?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'highlightCommentFieldsFromCache' });
      if (res?.success) {
        if (res.cleared) {
          showBlogMessage('已取消高亮', 'info');
        } else if (res.highlightedCount != null && res.highlightedCount > 0) {
          showBlogMessage(`已在页面用蓝色虚线框标出 ${res.highlightedCount} 个可填字段`, 'success');
        } else {
          showBlogMessage('已在页面标出可填字段', 'success');
        }
      } else {
        showBlogMessage(res?.error || '高亮失败', 'warning');
      }
    } catch (e) {
      const msg = e?.message?.includes('Receiving end') ? '请打开目标网页后再试' : (e?.message || '高亮失败');
      showBlogMessage(msg, 'warning');
    }
  });

  // 上/下箭头跳转
  elements.blogFieldPrevBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentTab?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'highlightCommentFieldPrev' });
      if (res?.success) {
        showBlogMessage(`第 ${(res.index ?? 0) + 1}/${res.total ?? 0} 个字段`, 'info');
      } else {
        showBlogMessage(res?.error || '跳转失败', 'warning');
      }
    } catch (err) {
      showBlogMessage(err?.message?.includes('Receiving end') ? '请打开目标网页后再试' : '跳转失败', 'warning');
    }
  });

  elements.blogFieldNextBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!currentTab?.id) return;
    try {
      const res = await chrome.tabs.sendMessage(currentTab.id, { action: 'highlightCommentFieldNext' });
      if (res?.success) {
        showBlogMessage(`第 ${(res.index ?? 0) + 1}/${res.total ?? 0} 个字段`, 'info');
      } else {
        showBlogMessage(res?.error || '跳转失败', 'warning');
      }
    } catch (err) {
      showBlogMessage(err?.message?.includes('Receiving end') ? '请打开目标网页后再试' : '跳转失败', 'warning');
    }
  });

  // 快捷操作
  elements.openBlogSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?tab=blogSites') });
  });

  elements.blogOpenOptionsBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });

  // ========== 批量提交模式事件 ==========

  // 保存飞书凭证
  elements.saveFeishuCredentialsBtn?.addEventListener('click', async () => {
    const credentials = {
      feishuAppId: elements.feishuAppId?.value?.trim() || '',
      feishuAppSecret: elements.feishuAppSecret?.value?.trim() || '',
      feishuAppToken: elements.feishuAppToken?.value?.trim() || '',
      feishuTableId: elements.feishuTableId?.value?.trim() || ''
    };

    if (!credentials.feishuAppId || !credentials.feishuAppSecret || !credentials.feishuAppToken || !credentials.feishuTableId) {
      showBatchMessage('请填写所有飞书凭证字段', 'warning');
      return;
    }

    await chrome.storage.local.set({ feishuCredentials: credentials });
    showBatchMessage('飞书凭证已保存', 'success');
    elements.syncFromFeishuBtn.disabled = false;
  });

  // 从飞书同步
  elements.syncFromFeishuBtn?.addEventListener('click', async () => {
    await syncFromFeishu();
  });

  // 筛选器变化
  elements.batchTypeFilter?.addEventListener('change', () => renderBatchUrlList());
  elements.batchStatusFilter?.addEventListener('change', () => renderBatchUrlList());

  // 全选/取消全选
  elements.selectAllBtn?.addEventListener('click', () => {
    const checkboxes = elements.batchUrlList?.querySelectorAll('input[type="checkbox"]');
    checkboxes?.forEach(cb => cb.checked = true);
    updateBatchStartButton();
  });

  elements.deselectAllBtn?.addEventListener('click', () => {
    const checkboxes = elements.batchUrlList?.querySelectorAll('input[type="checkbox"]');
    checkboxes?.forEach(cb => cb.checked = false);
    updateBatchStartButton();
  });

  // 开始批量提交
  elements.startBatchBtn?.addEventListener('click', async () => {
    await startBatchSubmit();
  });

  // 暂停
  elements.pauseBatchBtn?.addEventListener('click', () => {
    batchPaused = !batchPaused;
    if (elements.pauseBatchBtn) {
      elements.pauseBatchBtn.innerHTML = batchPaused ? '<span class="btn-icon">▶️</span>继续' : '<span class="btn-icon">⏸️</span>暂停';
    }
  });

  // 停止
  elements.stopBatchBtn?.addEventListener('click', () => {
    batchRunning = false;
    batchPaused = false;
    updateBatchControls(false);
    addBatchLog('批量任务已停止', 'warning');
  });

  // 清除日志
  elements.clearBatchLogBtn?.addEventListener('click', () => {
    if (elements.batchLogContainer) {
      elements.batchLogContainer.innerHTML = '<div class="empty-log-hint">暂无日志</div>';
    }
  });

  // 监听 storage 变更
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (currentMode !== 'blog' || !currentTab) return;
    const cacheKey = getCommentCacheKeyForTab(currentTab);
    if (!cacheKey) return;
    const key = BLOG_POPUP_STATE_PREFIX + cacheKey;
    if (changes[key] && changes[key].newValue) {
      applyBlogPopupStateToDom(changes[key].newValue);
    }
  });
}

// ========== 飞书集成 ==========

async function loadFeishuCredentials() {
  try {
    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    // 更新同步按钮状态
    if (config.appId && config.appSecret && config.appToken && config.tableId) {
      if (elements.syncFromFeishuBtn) elements.syncFromFeishuBtn.disabled = false;
      if (elements.feishuLastSyncTime) {
        elements.feishuLastSyncTime.textContent = config.lastSyncTime || '';
        elements.feishuLastSyncTime.classList.remove('hidden');
      } else {
        elements.feishuLastSyncTime.classList.add('hidden');
      }
    } else {
      if (elements.syncFromFeishuBtn) elements.syncFromFeishuBtn.disabled = true;
      showToast('请先在设置页面配置飞书凭证', 'warning');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to load Feishu config:', error);
  }
}

async function getFeishuAccessToken() {
  const result = await chrome.storage.local.get(['feishuConfig']);
  const config = result.feishuConfig || {};

  if (!config.appId || !config.appSecret) {
    throw new Error('请先配置飞书凭证');
  }

  // 获取 tenant_access_token
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  });

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(data.msg || '获取飞书 Token 失败');
  }

  return data.tenant_access_token;
}

async function syncFromFeishu() {
  try {
    if (elements.syncFromFeishuBtn) {
      elements.syncFromFeishuBtn.disabled = true;
      elements.syncFromFeishuBtn.innerHTML = '同步中...';
    }

    const result = await chrome.storage.local.get(['feishuConfig']);
    const config = result.feishuConfig || {};

    if (!config.appToken || !config.tableId) {
      showBatchMessage('请先配置飞书 App Token 和 Table ID', 'warning');
      return;
    }

    const accessToken = await getFeishuAccessToken();

    // 获取表格记录
    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(data.msg || '获取飞书表格数据失败');
    }

    // 解析数据
    batchUrls = (data.data?.items || []).map((item, index) => {
      const fields = item.fields || {};
      return {
        record_id: item.record_id,
        url: fields['外链 URL'] || fields.url || fields.link_url || '',
        type: fields['类型'] || fields.type || '其他',
        status: fields['提交状态'] || fields.status || fields.submit_status || '待提交',
        remark: fields['备注'] || fields.remark || fields.note || '',
        index: index,
        selected: false
      };
    }).filter(item => item.url);

    // 保存到本地
    await chrome.storage.local.set({
      batchUrls: batchUrls,
      feishuLastSyncTime: new Date().toISOString()
    });

    updateSyncStatus('synced', new Date().toISOString());
    renderBatchUrlList();
    showBatchMessage(`已从飞书同步 ${batchUrls.length} 条记录`, 'success');
    addBatchLog(`从飞书同步 ${batchUrls.length} 条记录`, 'info');

  } catch (error) {
    console.error('[SidePanel] Failed to sync from Feishu:', error);
    updateSyncStatus('failed');
    showBatchMessage(error.message || '同步失败', 'error');
    addBatchLog(`同步失败: ${error.message}`, 'error');
  } finally {
    if (elements.syncFromFeishuBtn) {
      elements.syncFromFeishuBtn.disabled = false;
      elements.syncFromFeishuBtn.innerHTML = '从飞书同步';
    }
  }
}

function updateSyncStatus(status, lastSyncTime) {
  if (elements.feishuSyncStatus) {
    if (status === 'synced') {
      elements.feishuSyncStatus.textContent = '已同步';
      elements.feishuSyncStatus.className = 'sync-status synced';
    } else if (status === 'failed') {
      elements.feishuSyncStatus.textContent = '同步失败';
      elements.feishuSyncStatus.className = 'sync-status failed';
    } else {
      elements.feishuSyncStatus.textContent = '未同步';
      elements.feishuSyncStatus.className = 'sync-status';
    }
  }

  if (lastSyncTime && elements.feishuLastSyncTime) {
    const date = new Date(lastSyncTime);
    elements.feishuLastSyncTime.textContent = `最近同步: ${formatDateTime(date)}`;
    elements.feishuLastSyncTime.classList.remove('hidden');
  }
}

function formatDateTime(date) {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ========== 批量提交 UI ==========

function renderBatchUrlList() {
  if (!elements.batchUrlList) return;

  const typeFilter = elements.batchTypeFilter?.value || '';
  const statusFilter = elements.batchStatusFilter?.value || '';

  const filteredUrls = batchUrls.filter(item => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    return true;
  });

  if (filteredUrls.length === 0) {
    elements.batchUrlList.innerHTML = '<div class="empty-list-hint">没有符合条件的记录</div>';
    return;
  }

  elements.batchUrlList.innerHTML = filteredUrls.map((item, i) => `
    <div class="batch-url-item ${getItemStatusClass(item.status)}" data-index="${item.index}">
      <input type="checkbox" data-record-id="${item.record_id}" ${item.selected ? 'checked' : ''}>
      <div class="url-info">
        <span class="url-text" title="${escapeHtml(item.url)}">${escapeHtml(truncateUrl(item.url, 50))}</span>
        <div class="url-meta">
          <span class="url-type">${escapeHtml(item.type)}</span>
          <span class="url-status status-${getStatusKey(item.status)}">${escapeHtml(item.status)}</span>
        </div>
      </div>
    </div>
  `).join('');

  // 绑定复选框事件
  elements.batchUrlList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const recordId = e.target.dataset.recordId;
      const item = batchUrls.find(u => u.record_id === recordId);
      if (item) {
        item.selected = e.target.checked;
      }
      updateBatchStartButton();
    });
  });

  updateBatchProgress();
}

function getItemStatusClass(status) {
  switch (status) {
    case '检测成功': return 'success';
    case '检测失败': return 'failed';
    case '提交中': return 'running';
    default: return '';
  }
}

function getStatusKey(status) {
  switch (status) {
    case '待提交': return 'pending';
    case '提交中': return 'running';
    case '检测成功': return 'success';
    case '检测失败': return 'failed';
    default: return 'pending';
  }
}

function truncateUrl(url, maxLen) {
  if (!url || url.length <= maxLen) return url || '';
  return url.slice(0, maxLen - 3) + '...';
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function updateBatchProgress() {
  const selected = batchUrls.filter(u => u.selected).length;
  const total = batchUrls.length;
  if (elements.batchProgress) {
    if (total > 0) {
      elements.batchProgress.textContent = `${selected}/${total}`;
      elements.batchProgress.classList.remove('hidden');
    } else {
      elements.batchProgress.classList.add('hidden');
    }
  }
}

function updateBatchStartButton() {
  const selectedCount = batchUrls.filter(u => u.selected).length;
  if (elements.startBatchBtn) {
    elements.startBatchBtn.disabled = selectedCount === 0 || batchRunning;
  }
  updateBatchProgress();
}

function updateBatchControls(running) {
  if (elements.startBatchBtn) {
    elements.startBatchBtn.classList.toggle('hidden', running);
    elements.startBatchBtn.disabled = running;
  }
  if (elements.pauseBatchBtn) {
    elements.pauseBatchBtn.classList.toggle('hidden', !running);
    elements.pauseBatchBtn.disabled = !running;
  }
  if (elements.stopBatchBtn) {
    elements.stopBatchBtn.classList.toggle('hidden', !running);
    elements.stopBatchBtn.disabled = !running;
  }
}

function showBatchMessage(message, type = 'info') {
  if (!elements.batchStatusMessage || !elements.batchStatusText) return;
  elements.batchStatusText.textContent = message;
  elements.batchStatusMessage.className = `status-message ${type}`;
  elements.batchStatusMessage.classList.remove('hidden');
  setTimeout(() => {
    elements.batchStatusMessage.classList.add('hidden');
  }, 5000);
}

function addBatchLog(message, type = 'info') {
  if (!elements.batchLogContainer) return;

  // 移除空提示
  const emptyHint = elements.batchLogContainer.querySelector('.empty-log-hint');
  if (emptyHint) emptyHint.remove();

  const time = new Date();
  const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;

  const logItem = document.createElement('div');
  logItem.className = `batch-log-item log-${type}`;
  logItem.innerHTML = `<span class="log-time">[${timeStr}]</span>${escapeHtml(message)}`;

  elements.batchLogContainer.appendChild(logItem);
  elements.batchLogContainer.scrollTop = elements.batchLogContainer.scrollHeight;
}

// ========== 批量提交执行 ==========

async function startBatchSubmit() {
  const selectedUrls = batchUrls.filter(u => u.selected);
  if (selectedUrls.length === 0) {
    showBatchMessage('请先选择要提交的 URL', 'warning');
    return;
  }

  if (!currentSiteId) {
    showBatchMessage('请先选择当前站点', 'warning');
    return;
  }

  batchRunning = true;
  batchPaused = false;
  updateBatchControls(true);
  addBatchLog(`开始批量提交，共 ${selectedUrls.length} 条`, 'info');

  const site = sites.find(s => s.id === currentSiteId);

  for (let i = 0; i < selectedUrls.length; i++) {
    if (!batchRunning) break;

    // 等待暂停解除
    while (batchPaused && batchRunning) {
      await sleep(500);
    }
    if (!batchRunning) break;

    const item = selectedUrls[i];
    addBatchLog(`处理 ${i + 1}/${selectedUrls.length}: ${truncateUrl(item.url, 40)}`, 'info');

    // 更新状态为提交中
    item.status = '提交中';
    renderBatchUrlList();

    try {
      // 打开新标签页
      const tab = await chrome.tabs.create({ url: item.url, active: false });

      // 等待页面加载完成
      await waitForTabComplete(tab.id, 30000);

      // 执行评论生成和填充
      const result = await executeBlogComment(tab.id, site);

      if (result.success) {
        // 等待页面刷新后验证
        await sleep(3000);
        const verifyResult = await verifySubmission(tab.id, site.siteUrl);

        if (verifyResult.success) {
          item.status = '检测成功';
          addBatchLog(`✓ 成功: ${truncateUrl(item.url, 40)}`, 'success');
        } else {
          item.status = '检测失败';
          addBatchLog(`✗ 验证失败: ${truncateUrl(item.url, 40)}`, 'warning');
        }
      } else {
        item.status = result.error?.includes('验证项') ? '需人工验证' : '识别失败';
        addBatchLog(`⚠ ${item.status}: ${truncateUrl(item.url, 40)} - ${result.error}`, 'warning');
      }

      // 关闭标签页
      await chrome.tabs.remove(tab.id);

    } catch (error) {
      item.status = '超时';
      addBatchLog(`✗ 超时: ${truncateUrl(item.url, 40)} - ${error.message}`, 'error');
    }

    // 回写到飞书
    await updateFeishuRecord(item);

    // 更新 UI
    renderBatchUrlList();

    // 间隔
    if (i < selectedUrls.length - 1) {
      await sleep(2000);
    }
  }

  batchRunning = false;
  batchPaused = false;
  updateBatchControls(false);
  addBatchLog('批量提交完成', 'info');

  // 统计结果
  const successCount = selectedUrls.filter(u => u.status === '检测成功').length;
  const failCount = selectedUrls.filter(u => u.status === '检测失败' || u.status === '超时' || u.status === '识别失败').length;
  showBatchMessage(`批量提交完成：成功 ${successCount}，失败 ${failCount}`, successCount > failCount ? 'success' : 'warning');
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

async function executeBlogComment(tabId, site) {
  try {
    // 获取页面元数据
    const metaRes = await chrome.tabs.sendMessage(tabId, { action: 'getPageMetadata' });
    const title = metaRes?.title ?? '';
    const description = metaRes?.description ?? '';
    const h1 = metaRes?.h1 ?? '';

    // 执行评论生成和填充
    const res = await chrome.tabs.sendMessage(tabId, {
      action: 'blogCommentGenerateAndFill',
      title,
      description,
      h1,
      siteId: currentSiteId,
      autoSubmit: elements.autoSubmit?.checked ?? false,
      llmEnabled,
      tabId: tabId,
      siteUrl: site?.siteUrl
    });

    return {
      success: res?.success,
      error: res?.error,
      result: res?.result
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifySubmission(tabId, siteUrl) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: 'verifyCommentSubmission', siteUrl });
    return {
      success: res?.success && res.result?.success,
      message: res?.result?.message
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function updateFeishuRecord(item) {
  try {
    const accessToken = await getFeishuAccessToken();
    const result = await chrome.storage.local.get(['feishuCredentials']);
    const credentials = result.feishuCredentials || {};

    const now = new Date();
    const updatedAt = `${now.getFullYear()}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    const response = await fetch(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${credentials.feishuAppToken}/tables/${credentials.feishuTableId}/records/${item.record_id}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            '提交状态': item.status,
            '最后更新时间': updatedAt
          }
        })
      }
    );

    const data = await response.json();
    if (data.code !== 0) {
      console.error('[SidePanel] Failed to update Feishu record:', data.msg);
      addBatchLog(`飞书写入失败: ${data.msg}`, 'warning');
    }
  } catch (error) {
    console.error('[SidePanel] Failed to update Feishu record:', error);
    addBatchLog(`飞书写入失败: ${error.message}`, 'warning');
  }
}

// ========== 监听 Background 消息 ==========
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'batchProgress') {
    handleBatchProgress(request.data);
  } else if (request.action === 'batchComplete') {
    handleBatchComplete(request.data);
  }
});

/**
 * 处理批量任务进度更新
 */
function handleBatchProgress(data) {
  if (!data) return;

  // 更新进度显示
  if (elements.batchProgress) {
    const progress = data.total > 0 ? `${data.currentIndex + 1}/${data.total}` : '';
    elements.batchProgress.textContent = progress;
    elements.batchProgress.classList.toggle('hidden', !progress);
  }

  // 更新状态消息
  if (data.url && data.status) {
    const statusText = data.status === 'running'
      ? `正在处理: ${truncateUrl(data.url, 40)}`
      : data.status === 'success'
        ? `✓ 成功: ${truncateUrl(data.url, 40)}`
        : `✗ ${data.result?.status || '失败'}: ${truncateUrl(data.url, 40)}`;

    showBatchMessage(statusText, data.status === 'success' ? 'success' : data.status === 'running' ? 'info' : 'warning');
  }

  // 添加日志
  if (data.url) {
    const logType = data.status === 'success' ? 'success' : data.status === 'failed' ? 'error' : 'info';
    const logMsg = data.status === 'running'
      ? `开始处理: ${truncateUrl(data.url, 50)}`
      : data.status === 'success'
        ? `✓ 成功: ${truncateUrl(data.url, 50)}`
        : `✗ ${data.result?.status || '失败'}: ${truncateUrl(data.url, 50)}${data.result?.message ? ` - ${data.result.message}` : ''}`;
    addBatchLog(logMsg, logType);
  }

  // 更新 URL 列表中的状态
  if (data.url && data.status) {
    const item = batchUrls.find(u => u.url === data.url);
    if (item) {
      item.status = data.status === 'success' ? '检测成功' : data.status === 'failed' ? (data.result?.status || '检测失败') : '提交中';
      renderBatchUrlList();
    }
  }
}

/**
 * 处理批量任务完成
 */
function handleBatchComplete(data) {
  batchRunning = false;
  batchPaused = false;
  updateBatchControls(false);

  if (data.error) {
    showBatchMessage(`批量任务失败: ${data.error}`, 'error');
    addBatchLog(`批量任务失败: ${data.error}`, 'error');
  } else {
    const successCount = data.results?.filter(r => r.success).length || 0;
    const failCount = (data.total || 0) - successCount;
    showBatchMessage(`批量任务完成: 成功 ${successCount}，失败 ${failCount}`, successCount > failCount ? 'success' : 'warning');
    addBatchLog(`批量任务完成: 共 ${data.total} 条，成功 ${successCount}，失败 ${failCount}`, successCount > 0 ? 'success' : 'warning');
  }
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', init);

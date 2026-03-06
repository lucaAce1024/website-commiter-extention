/**
 * Popup Script - Main logic for the extension popup
 */

// 标准字段 → 展示名称（按字段填充列表用）
const FIELD_LABELS = {
  siteUrl: '网站 URL',
  siteName: '网站名称',
  email: '联系邮箱',
  category: '分类',
  tags: '标签',
  pricing: '定价 (Pricing)',
  tagline: '标语',
  shortDescription: '简短描述',
  longDescription: '详细描述',
  logo: 'Logo',
  screenshot: '界面截图'
};

// DOM elements
const elements = {
  siteSelect: document.getElementById('siteSelect'),
  manageSitesBtn: document.getElementById('manageSitesBtn'),
  addSiteLink: document.getElementById('addSiteLink'),
  noSitesHint: document.getElementById('noSitesHint'),
  currentSiteUrl: document.getElementById('currentSiteUrl'),
  pageDomain: document.getElementById('pageDomain'),
  recognitionStatus: document.getElementById('recognitionStatus'),
  fieldCount: document.getElementById('fieldCount'),
  formStatus: document.getElementById('formStatus'),
  noFormHint: document.getElementById('noFormHint'),
  fieldFillSection: document.getElementById('fieldFillSection'),
  fieldFillList: document.getElementById('fieldFillList'),
  fieldFillNoData: document.getElementById('fieldFillNoData'),
  fillFormBtn: document.getElementById('fillFormBtn'),
  aiFillFormBtn: document.getElementById('aiFillFormBtn'),
  clearCacheBtn: document.getElementById('clearCacheBtn'),
  openNavSitesBtn: document.getElementById('openNavSitesBtn'),
  openOptionsBtn: document.getElementById('openOptionsBtn'),
  statusMessage: document.getElementById('statusMessage'),
  statusText: document.getElementById('statusText'),
  closeStatusBtn: document.getElementById('closeStatusBtn'),
  refreshTabBtn: document.getElementById('refreshTabBtn'),
  // Blog 评论模式
  panelNav: document.getElementById('panel-nav'),
  panelBlog: document.getElementById('panel-blog'),
  modeTabs: document.querySelectorAll('.mode-tab'),
  blogSiteSelect: document.getElementById('blogSiteSelect'),
  blogCurrentSiteUrl: document.getElementById('blogCurrentSiteUrl'),
  blogManageSitesBtn: document.getElementById('blogManageSitesBtn'),
  blogAddSiteLink: document.getElementById('blogAddSiteLink'),
  blogNoSitesHint: document.getElementById('blogNoSitesHint'),
  blogPageDomain: document.getElementById('blogPageDomain'),
  blogFormStatus: document.getElementById('blogFormStatus'),
  blogRecognitionStatus: document.getElementById('blogRecognitionStatus'),
  blogFieldCount: document.getElementById('blogFieldCount'),
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
  autoSubmit: document.getElementById('autoSubmit')
};

// State
let currentTab = null;
let pageState = null;
let sites = [];
let currentSiteId = null;
let llmEnabled = false;
let currentMode = 'nav'; // 'nav' | 'blog'
let commentPageState = null;

/**
 * Initialize popup
 */
async function init() {
  // Get current active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  if (!currentTab) {
    showError('无法获取当前页面信息');
    return;
  }

  // Display page domain (only http(s) pages have content script; avoid Invalid URL on chrome:// etc.)
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
  elements.pageDomain.textContent = hostname;
  if (elements.blogPageDomain) elements.blogPageDomain.textContent = hostname;

  // Load sites
  await loadSites();

  // Get page state from content script
  await getPageState();

  // Blog 评论模式：获取评论表单状态
  await getCommentPageState();

  // Setup event listeners
  setupEventListeners();

  // 同步 Blog 面板的站点下拉与当前模式显示
  syncBlogSiteSelect();
  showModePanel(currentMode);
}

/**
 * Load sites from storage
 */
async function loadSites() {
  try {
    const result = await chrome.storage.local.get(['sites', 'settings', 'popupMode']);
    sites = result.sites || [];
    currentSiteId = result.settings?.currentSiteId;
    if (result.popupMode === 'blog' || result.popupMode === 'nav') {
      currentMode = result.popupMode;
    }
    if (elements.autoSubmit) {
      elements.autoSubmit.checked = result.settings?.autoSubmit ?? false;
    }

    // 检查 LLM 是否启用
    const llmConfig = result.settings?.llmConfig;
    llmEnabled = !!(llmConfig?.enabled && llmConfig?.apiKey);

    // Populate site select
    populateSiteSelect();

    // Show/hide no sites hint
    if (sites.length === 0) {
      elements.noSitesHint.classList.remove('hidden');
      elements.siteSelect.classList.add('hidden');
    } else {
      elements.noSitesHint.classList.add('hidden');
      elements.siteSelect.classList.remove('hidden');
    }

    updateCurrentSiteUrlDisplay();
  } catch (error) {
    console.error('[Popup] Failed to load sites:', error);
  }
}

/**
 * 在下拉框下方小字展示当前选中站点的 URL（导航站 / Blog 评论两处都更新）
 */
function updateCurrentSiteUrlDisplay() {
  const site = currentSiteId ? sites.find(s => s.id === currentSiteId) : null;
  const url = site?.siteUrl?.trim() || '';
  if (elements.currentSiteUrl) {
    if (url) {
      elements.currentSiteUrl.textContent = url;
      elements.currentSiteUrl.classList.remove('hidden');
    } else {
      elements.currentSiteUrl.textContent = '';
      elements.currentSiteUrl.classList.add('hidden');
    }
  }
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

/**
 * Populate site select dropdown
 */
function populateSiteSelect() {
  // Clear existing options
  elements.siteSelect.innerHTML = '<option value="">-- 请选择站点 --</option>';

  // Add sites
  sites.forEach(site => {
    const option = document.createElement('option');
    option.value = site.id;
    option.textContent = site.siteName || site.siteUrl || 'Unnamed Site';
    elements.siteSelect.appendChild(option);
  });

  // Set current site
  if (currentSiteId) {
    elements.siteSelect.value = currentSiteId;
  }
}

/**
 * Get page state from content script
 */
async function getPageState() {
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'getPageState' });

    if (response && response.success) {
      pageState = response.state;
      updateFormStatus();
    } else {
      // Content script might not be ready, try to detect form
      const detectResponse = await chrome.tabs.sendMessage(currentTab.id, { action: 'detectForm' });
      if (detectResponse && detectResponse.success) {
        updateFormStatusFromDetect(detectResponse.result);
      } else {
        showNoForm();
      }
    }
  } catch (error) {
    console.error('[Popup] Failed to get page state:', error);
    // Receiving end does not exist = content script not loaded (e.g. chrome://, new tab, extension page)
    if (error?.message?.includes('Receiving end does not exist') || error?.message?.includes('Could not establish connection')) {
      showError('无法在此页面使用（请打开普通网页，如 https://... 的提交页）');
    } else {
      showNoForm();
    }
  }
}

/**
 * Update form status display
 */
function updateFormStatus() {
  if (!pageState) {
    showNoForm();
    return;
  }

  elements.formStatus.classList.remove('hidden');
  elements.noFormHint.classList.add('hidden');

  // Recognition status
  const statusTexts = {
    idle: '未识别',
    recognizing: '识别中...',
    done: '已完成',
    failed: '失败'
  };
  elements.recognitionStatus.textContent = statusTexts[pageState.recognitionStatus] || pageState.recognitionStatus;

  // 如果使用了 AI 识别，显示标识
  if (pageState.recognitionMethod === 'ai') {
    elements.recognitionStatus.textContent += ' (AI)';
  } else if (pageState.recognitionMethod === 'cache') {
    elements.recognitionStatus.textContent += ' (缓存)';
  }

  // Field count
  if (pageState.fieldMappings) {
    elements.fieldCount.textContent = pageState.fieldMappings.length + ' 个字段';
  } else {
    elements.fieldCount.textContent = '-';
  }
  // 主按钮「自动识别并填充」：有选中站点即可用，点击后会先识别再填充
  elements.fillFormBtn.disabled = !currentSiteId;

  // AI 按钮：需要配置 LLM 且有选中站点
  elements.aiFillFormBtn.disabled = !currentSiteId || !llmEnabled;
  if (!llmEnabled) {
    elements.aiFillFormBtn.title = '请在设置中启用 LLM 并配置 GLM API Key';
  }

  // If has form but not recognized
  if (pageState.hasForm && !pageState.fieldMappings) {
    elements.recognitionStatus.textContent = '待识别';
  }

  updateFieldFillList();
}

/**
 * 更新「按字段填充」列表：展示已识别字段 + 当前站点预览，点击可只填该字段
 */
function updateFieldFillList() {
  const list = elements.fieldFillList;
  const section = elements.fieldFillSection;
  const noData = elements.fieldFillNoData;
  if (!list || !section || !noData) return;

  const mappings = pageState?.fieldMappings;
  const hasMappings = mappings && mappings.length > 0 && currentSiteId;
  const currentSite = sites.find(s => s.id === currentSiteId);

  if (!hasMappings || !currentSite) {
    section.classList.add('hidden');
    noData.classList.remove('hidden');
    list.innerHTML = '';
    return;
  }

  noData.classList.add('hidden');
  section.classList.remove('hidden');

  const seen = new Set();
  const rows = [];
  for (const m of mappings) {
    if (seen.has(m.standardField)) continue;
    seen.add(m.standardField);
    const label = FIELD_LABELS[m.standardField] || m.standardField;
    let preview = currentSite[m.standardField];
    if (preview == null) preview = '';
    if (m.standardField === 'logo' && (currentSite.logoDataUrl || preview)) preview = '(图片)';
    else if (m.standardField === 'screenshot' && (currentSite.screenshotDataUrl || preview)) preview = '(图片)';
    else preview = String(preview).trim();
    if (preview.length > 22) preview = preview.slice(0, 20) + '…';
    rows.push({ standardField: m.standardField, label, preview });
  }

  list.innerHTML = rows.map(({ standardField, label, preview }) => {
    const previewEsc = escapeHtml(preview || '—');
    return `<li data-field="${escapeHtml(standardField)}" title="点击填充：${escapeHtml(label)}">
      <span class="field-name">${escapeHtml(label)}</span>
      <span class="field-preview">${previewEsc}</span>
      <span class="field-action">填充</span>
    </li>`;
  }).join('');

  list.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => onFieldFillClick(li.dataset.field));
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function onFieldFillClick(standardField) {
  if (!currentTab?.id || !standardField) return;
  try {
    const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'fillSingleField', standardField });
    if (response?.success) {
      const n = response.result?.filledCount ?? 0;
      showSuccess(n > 0 ? `已填充「${FIELD_LABELS[standardField] || standardField}」` : '该字段无内容或未找到对应控件');
    } else {
      showError(response?.error || '填充失败');
    }
  } catch (e) {
    showError(e?.message?.includes('Receiving end') ? '请刷新页面后再试' : (e?.message || '填充失败'));
  }
}

/**
 * Update form status from detect response
 */
function updateFormStatusFromDetect(detectResult) {
  if (detectResult.hasForm) {
    elements.formStatus.classList.remove('hidden');
    elements.noFormHint.classList.add('hidden');
    elements.recognitionStatus.textContent = '待识别';
    elements.fieldCount.textContent = detectResult.inputCount + ' 个输入项';
    elements.fillFormBtn.disabled = !currentSiteId;
  } else {
    showNoForm();
  }
}

/**
 * Show no form message
 */
function showNoForm() {
  elements.formStatus.classList.add('hidden');
  elements.noFormHint.classList.remove('hidden');
  elements.fillFormBtn.disabled = true;
  updateFieldFillList();
}

// ---------- Blog 评论模式 ----------
function showModePanel(mode) {
  currentMode = mode;
  chrome.storage.local.set({ popupMode: currentMode });
  elements.modeTabs?.forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  if (elements.panelNav) elements.panelNav.classList.toggle('hidden', mode !== 'nav');
  if (elements.panelBlog) elements.panelBlog.classList.toggle('hidden', mode !== 'blog');
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

function getCommentCacheKeyForTab(tab) {
  if (!tab?.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) return null;
  try {
    const u = new URL(tab.url);
    return 'blog_' + u.hostname + u.pathname;
  } catch {
    return null;
  }
}

async function updateBlogClearCacheState() {
  if (!elements.blogClearCacheBtn) return;
  const cacheKey = getCommentCacheKeyForTab(currentTab);
  if (!cacheKey) {
    elements.blogClearCacheBtn.disabled = true;
    elements.blogClearCacheBtn.classList.remove('blog-cache-has');
    if (elements.blogCacheHint) {
      elements.blogCacheHint.classList.add('hidden');
    }
    return;
  }
  const result = await chrome.storage.local.get(['blogCommentFieldMappings']);
  const mappings = result.blogCommentFieldMappings || {};
  const cached = mappings[cacheKey];
  const hasCache = !!(cached && (cached.mappings?.length || (Array.isArray(cached) && cached.length)));
  elements.blogClearCacheBtn.disabled = !hasCache;
  elements.blogClearCacheBtn.classList.toggle('blog-cache-has', hasCache);
  if (elements.blogCacheHint) {
    if (hasCache) {
      elements.blogCacheHint.textContent = '当前页已有缓存';
      elements.blogCacheHint.classList.remove('hidden');
    } else {
      elements.blogCacheHint.classList.add('hidden');
    }
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
        commentPageState = { hasForm: true, fieldMappings: rec.result.mappings, recognitionStatus: 'done', hasSpamVerification: rec.result.hasSpamVerification };
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
    if (commentPageState.recognitionMethod) elements.blogRecognitionStatus.textContent += ` (${commentPageState.recognitionMethod === 'ai' ? 'AI' : commentPageState.recognitionMethod === 'cache' ? '缓存' : '关键词'})`;
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

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Site select change
  elements.siteSelect.addEventListener('change', async () => {
    const newSiteId = elements.siteSelect.value;
    await chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || {};
      settings.currentSiteId = newSiteId || null;
      chrome.storage.local.set({ settings });
    });
    currentSiteId = newSiteId;
    updateCurrentSiteUrlDisplay();
    updateFormStatus();
  });

  // Manage sites button
  elements.manageSitesBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    window.close();
  });

  // Add site link
  elements.addSiteLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    window.close();
  });

  // 主按钮：自动识别并填充（先识别再填充）
  elements.fillFormBtn.addEventListener('click', async () => {
    if (!currentSiteId) {
      showWarning('请先选择一个站点');
      return;
    }

    elements.fillFormBtn.disabled = true;

    try {
      // 1. 先识别表单（无缓存或需刷新时）
      elements.fillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 识别中...';
      const recognizeResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'recognizeForm',
        useLlm: false
      });

      const result = recognizeResponse.result || {};
      if (!recognizeResponse.success || result.status !== 'success') {
        const errMsg = result.status === 'no_form' ? (result.message || '当前页面未检测到可填表单') : (recognizeResponse.error || result.error || '识别失败');
        showError(errMsg);
        return;
      }

      const count = result.fieldCount ?? (Array.isArray(result.mappings) ? result.mappings.length : 0);
      let domain = pageState?.domain;
      try {
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
          domain = domain || new URL(currentTab.url).hostname;
        }
      } catch (_) {}
      pageState = {
        hasForm: true,
        fieldMappings: result.mappings || [],
        recognitionStatus: 'done',
        recognitionMethod: result.method,
        domain
      };
      updateFormStatus();

      if (count === 0) {
        showWarning('未匹配到可填字段，请检查页面或尝试在其它提交页使用');
        return;
      }

      // 2. 再填充
      elements.fillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 填充中...';
      const fillResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'fillForm',
        siteId: currentSiteId
      });

      if (fillResponse.success) {
        const fillResult = fillResponse.result;
        let message = `已填充 ${fillResult.filledCount} 个字段`;
        if (fillResult.hasCaptcha) {
          message += '\n\n检测到验证码，请手动完成验证后提交。';
        }
        if (fillResult.errors && fillResult.errors.length > 0) {
          message += `\n\n部分字段填充失败:\n${fillResult.errors.join('\n')}`;
        }
        showSuccess(message);
      } else {
        showError(fillResponse.error || '填充失败');
      }
    } catch (error) {
      console.error('[Popup] Recognize or fill error:', error);
      showError(error?.message?.includes('Receiving end') ? '无法在此页面使用（请打开普通网页）' : '操作失败: ' + error.message);
    } finally {
      elements.fillFormBtn.disabled = false;
      elements.fillFormBtn.innerHTML = '<span class="btn-icon">✏️</span> 自动识别并填充';
    }
  });

  // 清除当前页识别缓存（识别不准或漏填时使用，下次「自动识别并填充」会重新识别）
  elements.clearCacheBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, { action: 'clearMapping' });
      if (response?.success) {
        showSuccess('已清除本页缓存，请再次点击「自动识别并填充」');
        await getPageState();
      } else {
        showError('清除失败');
      }
    } catch (error) {
      if (error?.message?.includes('Receiving end')) {
        showError('无法在此页面使用（请打开普通网页）');
      } else {
        showError('清除失败: ' + error.message);
      }
    }
  });

  // AI 智能识别按钮
  elements.aiFillFormBtn.addEventListener('click', async () => {
    if (!currentSiteId) {
      showWarning('请先选择一个站点');
      return;
    }

    if (!llmEnabled) {
      showWarning('请先在设置中启用 LLM 并配置 GLM API Key');
      return;
    }

    elements.aiFillFormBtn.disabled = true;

    try {
      // 1. 先使用 AI 识别表单
      elements.aiFillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> AI 识别中...';
      const recognizeResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'recognizeForm',
        useLlm: true  // 启用 AI 识别
      });

      const result = recognizeResponse.result || {};
      if (!recognizeResponse.success || result.status !== 'success') {
        const errMsg = result.status === 'no_form' ? (result.message || '当前页面未检测到可填表单') : (recognizeResponse.error || result.error || 'AI 识别失败');
        showError(errMsg);
        return;
      }

      const count = result.fieldCount ?? (Array.isArray(result.mappings) ? result.mappings.length : 0);
      let domain = pageState?.domain;
      try {
        if (currentTab.url && (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://'))) {
          domain = domain || new URL(currentTab.url).hostname;
        }
      } catch (_) {}
      pageState = {
        hasForm: true,
        fieldMappings: result.mappings || [],
        recognitionStatus: 'done',
        recognitionMethod: result.method,
        domain
      };
      updateFormStatus();

      if (count === 0) {
        showWarning('AI 未识别到可填字段，请检查页面或尝试使用「自动识别并填充」');
        return;
      }

      // 2. 再填充
      elements.aiFillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 填充中...';
      const fillResponse = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'fillForm',
        siteId: currentSiteId
      });

      if (fillResponse.success) {
        const fillResult = fillResponse.result;
        let message = `AI 识别 + 已填充 ${fillResult.filledCount} 个字段`;
        if (fillResult.hasCaptcha) {
          message += '\n\n检测到验证码，请手动完成验证后提交。';
        }
        if (fillResult.errors && fillResult.errors.length > 0) {
          message += `\n\n部分字段填充失败:\n${fillResult.errors.join('\n')}`;
        }
        showSuccess(message);
      } else {
        showError(fillResponse.error || '填充失败');
      }
    } catch (error) {
      console.error('[Popup] AI recognize or fill error:', error);
      showError(error?.message?.includes('Receiving end') ? '无法在此页面使用（请打开普通网页）' : '操作失败: ' + error.message);
    } finally {
      elements.aiFillFormBtn.disabled = false;
      elements.aiFillFormBtn.innerHTML = '<span class="btn-icon">🤖</span> AI 智能识别';
    }
  });

  // Open nav sites button
  elements.openNavSitesBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?tab=navSites') });
    window.close();
  });

  // Open options button
  elements.openOptionsBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    window.close();
  });

  // Close status button
  elements.closeStatusBtn.addEventListener('click', () => {
    hideMessage();
  });

  // 刷新当前活动标签页
  elements.refreshTabBtn?.addEventListener('click', async () => {
    if (!currentTab?.id) return;
    try {
      await chrome.tabs.reload(currentTab.id);
      showSuccess('页面刷新中…');
      window.close();
    } catch (e) {
      showError('无法刷新该页面');
    }
  });

  // Mode tabs
  elements.modeTabs?.forEach((tab) => {
    tab.addEventListener('click', () => {
      showModePanel(tab.dataset.mode);
      if (tab.dataset.mode === 'blog') {
        syncBlogSiteSelect();
        getCommentPageState();
      }
    });
  });

  // Blog 评论：站点选择（与主站点同步）
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

  elements.blogManageSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    window.close();
  });

  // 其他设置：允许自动提交（变更时立即写入 storage）
  elements.autoSubmit?.addEventListener('change', async () => {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings || {};
    settings.autoSubmit = elements.autoSubmit.checked;
    await chrome.storage.local.set({ settings });
  });

  elements.blogAddSiteLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    window.close();
  });

  // 生成评论并填充（一发流程：有缓存仅评论生成，无缓存且 LLM 开启时一发请求）
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

      const statusHint = llmEnabled ? 'AI 评论生成与表单识别中...' : '评论生成与表单识别中...';
      setBlogStatusLine(statusHint);

      const res = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'blogCommentGenerateAndFill',
        title,
        description,
        siteId: currentSiteId,
        autoSubmit: elements.autoSubmit?.checked ?? false,
        llmEnabled
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
        msg += ' 已自动点击提交。';
        const site = sites.find((s) => s.id === currentSiteId);
        if (site?.siteUrl) {
          setTimeout(async () => {
            const verifyRes = await chrome.tabs.sendMessage(currentTab.id, { action: 'verifyCommentSubmission', siteUrl: site.siteUrl });
            if (verifyRes?.success && verifyRes.result?.success) showBlogMessage(verifyRes.result.message, 'success');
            else showBlogMessage(verifyRes?.result?.message || '未检测到本站链接', 'warning');
          }, 6000);
        }
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

  elements.blogCloseStatusBtn?.addEventListener('click', hideBlogMessage);

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

  elements.openBlogSitesBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?tab=blogSites') });
    window.close();
  });
  elements.blogOpenOptionsBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    window.close();
  });
}

/**
 * Show success message
 */
function showSuccess(message) {
  showMessage(message, 'success');
}

/**
 * Show error message
 */
function showError(message) {
  showMessage(message, 'error');
}

/**
 * Show warning message
 */
function showWarning(message) {
  showMessage(message, 'warning');
}

/**
 * Show status message
 */
function showMessage(message, type = 'info') {
  elements.statusText.textContent = message;
  elements.statusMessage.className = 'status-message ' + type;
  elements.statusMessage.classList.remove('hidden');

  // Auto hide after 5 seconds for success/warning
  if (type === 'success' || type === 'warning') {
    setTimeout(hideMessage, 5000);
  }
}

/**
 * Hide status message
 */
function hideMessage() {
  elements.statusMessage.classList.add('hidden');
}

/**
 * 评论流程专用：在「生成评论并填充」按钮上方展示成功/失败/警告
 */
function showBlogMessage(message, type = 'info') {
  if (!elements.blogStatusText || !elements.blogStatusMessage) return;
  elements.blogStatusText.textContent = message;
  elements.blogStatusMessage.className = 'status-message status-message-above-actions ' + type;
  elements.blogStatusMessage.classList.remove('hidden');
  if (type === 'success' || type === 'warning') {
    setTimeout(hideBlogMessage, 5000);
  }
}

function hideBlogMessage() {
  if (elements.blogStatusMessage) elements.blogStatusMessage.classList.add('hidden');
}

/**
 * 评论流程运行状态栏（消息通知栏下方）：一行滚动文字
 * @param {string} text - 状态文案，空则隐藏
 */
function setBlogStatusLine(text) {
  if (!elements.blogStatusLine) return;
  elements.blogStatusLine.textContent = text || '';
  elements.blogStatusLine.classList.toggle('hidden', !text);
  if (text) elements.blogStatusLine.scrollLeft = 0;
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

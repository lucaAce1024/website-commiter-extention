/**
 * Options Page Script
 * Main logic for the settings/management page
 */

// State
let currentTab = 'sites';
let sites = [];
let navSites = [];
let blogCommentSites = [];
let fieldMappings = {};
let settings = {};
let feishuConfig = {};
let credConfig = {};
let siteCredentials = [];
/** 当前编辑中待保存的 Logo 图片（data URL），用于文件上传类表单项 */
let pendingLogoDataUrl = null;
/** 当前编辑中待保存的界面截图（data URL），对应 App Image 等上传框 */
let pendingScreenshotDataUrl = null;

const MAX_IMAGE_BYTES = 1024 * 1024; // 1MB

/**
 * 将图片文件压缩到 < 1MB，返回 data URL（使用 Canvas 缩放 + JPEG 质量）
 */
function compressImageToUnder1MB(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxSide = 1920;
      let w = img.width;
      let h = img.height;
      if (w > maxSide || h > maxSide) {
        if (w > h) {
          h = Math.round((h * maxSide) / w);
          w = maxSide;
        } else {
          w = Math.round((w * maxSide) / h);
          h = maxSide;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      function tryQuality(quality) {
        return new Promise((res) => {
          canvas.toBlob(
            (blob) => {
              if (blob && blob.size <= MAX_IMAGE_BYTES) {
                const reader = new FileReader();
                reader.onload = () => res(reader.result);
                reader.onerror = () => res(null);
                reader.readAsDataURL(blob);
              } else {
                res(null);
              }
            },
            'image/jpeg',
            quality
          );
        });
      }

      (async () => {
        for (const q of [0.85, 0.7, 0.55, 0.4, 0.25]) {
          const dataUrl = await tryQuality(q);
          if (dataUrl) {
            resolve(dataUrl);
            return;
          }
        }
        const dataUrl = await tryQuality(0.15);
        resolve(dataUrl || canvas.toDataURL('image/jpeg', 0.15));
      })();
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

// DOM elements cache
const elements = {};

/**
 * Initialize options page
 */
async function init() {
  // Get initial tab from URL query
  const urlParams = new URLSearchParams(window.location.search);
  const tabFromUrl = urlParams.get('tab');
  if (tabFromUrl) {
    currentTab = tabFromUrl;
  }

  // Cache DOM elements
  cacheElements();

  // Setup event listeners
  setupEventListeners();

  // Load data
  await loadData();

  // Initialize UI
  initTabs();
  renderCurrentTab();
}

/**
 * Cache DOM elements
 */
function cacheElements() {
  // Tabs
  elements.tabs = document.querySelectorAll('.tab');
  elements.tabContents = document.querySelectorAll('.tab-content');

  // Sites
  elements.sitesList = document.getElementById('sitesList');
  elements.noSitesHint = document.getElementById('noSitesHint');
  elements.addSiteBtn = document.getElementById('addSiteBtn');
  elements.addFirstSiteBtn = document.getElementById('addFirstSiteBtn');

  // Nav Sites
  elements.navSitesList = document.getElementById('navSitesList');
  elements.noNavSitesHint = document.getElementById('noNavSitesHint');
  elements.addNavSiteBtn = document.getElementById('addNavSiteBtn');
  elements.addFirstNavSiteBtn = document.getElementById('addFirstNavSiteBtn');
  elements.importNavSitesBtn = document.getElementById('importNavSitesBtn');

  elements.blogSitesList = document.getElementById('blogSitesList');
  elements.noBlogSitesHint = document.getElementById('noBlogSitesHint');
  elements.addBlogSiteBtn = document.getElementById('addBlogSiteBtn');
  elements.addFirstBlogSiteBtn = document.getElementById('addFirstBlogSiteBtn');
  elements.importBlogSitesBtn = document.getElementById('importBlogSitesBtn');

  // Mappings
  elements.mappingsList = document.getElementById('mappingsList');
  elements.noMappingsHint = document.getElementById('noMappingsHint');
  elements.clearAllMappingsBtn = document.getElementById('clearAllMappingsBtn');

  // Backup
  elements.includeRecords = document.getElementById('includeRecords');
  elements.includeMappings = document.getElementById('includeMappings');
  elements.createBackupBtn = document.getElementById('createBackupBtn');
  elements.restoreMode = document.getElementById('restoreMode');
  elements.backupFileInput = document.getElementById('backupFileInput');
  elements.restoreBackupBtn = document.getElementById('restoreBackupBtn');
  elements.summarySites = document.getElementById('summarySites');
  elements.summaryNavSites = document.getElementById('summaryNavSites');
  elements.summaryRecords = document.getElementById('summaryRecords');
  elements.summaryMappings = document.getElementById('summaryMappings');

  // Settings
  elements.llmEnabled = document.getElementById('llmEnabled');
  elements.llmConfigFields = document.getElementById('llmConfigFields');
  elements.llmProvider = document.getElementById('llmProvider');
  elements.llmEndpoint = document.getElementById('llmEndpoint');
  elements.llmApiKey = document.getElementById('llmApiKey');
  elements.toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
  elements.llmModel = document.getElementById('llmModel');
  elements.llmModelCustomWrap = document.getElementById('llmModelCustomWrap');
  elements.llmModelCustom = document.getElementById('llmModelCustom');
  elements.llmDisableThinking = document.getElementById('llmDisableThinking');
  elements.testLlmBtn = document.getElementById('testLlmBtn');
  elements.saveSettingsBtn = document.getElementById('saveSettingsBtn');

  // Modal
  elements.modal = document.getElementById('modal');
  elements.modalTitle = document.getElementById('modalTitle');
  elements.modalBody = document.getElementById('modalBody');
  elements.modalCloseBtn = document.getElementById('modalCloseBtn');
  elements.modalOverlay = document.querySelector('.modal-overlay');

  // Toast
  elements.toast = document.getElementById('toast');
  elements.toastMessage = document.getElementById('toastMessage');

  // Feishu Config
  elements.feishuAppId = document.getElementById('feishuAppId');
  elements.feishuAppSecret = document.getElementById('feishuAppSecret');
  elements.feishuAppToken = document.getElementById('feishuAppToken');
  elements.feishuTableId = document.getElementById('feishuTableId');
  elements.feishuSyncStatusText = document.getElementById('feishuSyncStatusText');
  elements.feishuLastSyncTimeText = document.getElementById('feishuLastSyncTimeText');
  elements.toggleFeishuSecretBtn = document.getElementById('toggleFeishuSecretBtn');
  elements.saveFeishuBtn = document.getElementById('saveFeishuBtn');
  elements.testFeishuBtn = document.getElementById('testFeishuBtn');

  // Credential Sync
  elements.credSpreadsheetToken = document.getElementById('credSpreadsheetToken');
  elements.credSheetName = document.getElementById('credSheetName');
  elements.credCountText = document.getElementById('credCountText');
  elements.credLastSyncText = document.getElementById('credLastSyncText');
  elements.saveCredConfigBtn = document.getElementById('saveCredConfigBtn');
  elements.syncCredBtn = document.getElementById('syncCredBtn');
  elements.clearCredBtn = document.getElementById('clearCredBtn');
  elements.credPreviewCard = document.getElementById('credPreviewCard');
  elements.credPreviewBody = document.getElementById('credPreviewBody');
  elements.credTogglePwdBtn = document.getElementById('credTogglePwdBtn');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tab switching
  elements.tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });

  // Sites
  elements.addSiteBtn?.addEventListener('click', () => openSiteModal());
  elements.addFirstSiteBtn?.addEventListener('click', () => openSiteModal());

  // Nav Sites
  elements.addNavSiteBtn?.addEventListener('click', () => openNavSiteModal());
  elements.addFirstNavSiteBtn?.addEventListener('click', () => openNavSiteModal());
  elements.importNavSitesBtn?.addEventListener('click', importNavSites);

  // Blog Comment Sites
  elements.addBlogSiteBtn?.addEventListener('click', () => openBlogSiteModal());
  elements.addFirstBlogSiteBtn?.addEventListener('click', () => openBlogSiteModal());
  elements.importBlogSitesBtn?.addEventListener('click', importBlogSites);

  // Mappings
  elements.clearAllMappingsBtn?.addEventListener('click', clearAllMappings);

  // Backup
  elements.createBackupBtn?.addEventListener('click', createBackup);
  elements.backupFileInput?.addEventListener('change', onBackupFileSelected);
  elements.restoreBackupBtn?.addEventListener('click', restoreBackup);

  // Settings
  elements.llmEnabled?.addEventListener('change', (e) => {
    elements.llmConfigFields.classList.toggle('hidden', !e.target.checked);
  });
  elements.llmProvider?.addEventListener('change', onLlmProviderChange);
  elements.llmModel?.addEventListener('change', () => {
    elements.llmModelCustomWrap?.classList.toggle('hidden', elements.llmModel?.value !== '__custom__');
  });
  elements.testLlmBtn?.addEventListener('click', testLlmConnection);
  elements.saveSettingsBtn?.addEventListener('click', saveSettings);

  elements.toggleApiKeyBtn?.addEventListener('click', () => {
    const input = elements.llmApiKey;
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    elements.toggleApiKeyBtn.textContent = isPassword ? '🙈' : '👁';
    elements.toggleApiKeyBtn.title = isPassword ? '隐藏 API Key' : '显示 API Key';
    elements.toggleApiKeyBtn.setAttribute('aria-label', elements.toggleApiKeyBtn.title);
  });

  // Feishu Config
  elements.toggleFeishuSecretBtn?.addEventListener('click', () => {
    const input = elements.feishuAppSecret;
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    elements.toggleFeishuSecretBtn.textContent = isPassword ? '🙈' : '👁';
    elements.toggleFeishuSecretBtn.title = isPassword ? '隐藏 Secret' : '显示 Secret';
    elements.toggleFeishuSecretBtn.setAttribute('aria-label', elements.toggleFeishuSecretBtn.title);
  });
  elements.saveFeishuBtn?.addEventListener('click', saveFeishuConfig);
  elements.testFeishuBtn?.addEventListener('click', testFeishuConnection);

  // Credential Sync
  elements.saveCredConfigBtn?.addEventListener('click', saveCredConfig);
  elements.syncCredBtn?.addEventListener('click', syncCredentials);
  elements.clearCredBtn?.addEventListener('click', clearCredentials);
  elements.credTogglePwdBtn?.addEventListener('click', toggleCredPasswords);

  // Modal
  elements.modalCloseBtn?.addEventListener('click', closeModal);
  elements.modalOverlay?.addEventListener('click', closeModal);
}

/**
 * Load data from storage
 */
async function loadData() {
  const result = await chrome.storage.local.get(null);

  sites = result.sites || [];
  navSites = result.navSites || [];
  blogCommentSites = result.blogCommentSites || [];
  fieldMappings = result.fieldMappings || {};
  settings = result.settings || {
    llmConfig: { enabled: false, endpoint: '', apiKey: '', model: '' },
    autoSubmit: false
  };
  feishuConfig = result.feishuConfig || {};
  credConfig = result.credConfig || { spreadsheetToken: 'FgWhsDQdNhWfVot4787ceNMXnDd', sheetName: '媒体账号统计' };
  siteCredentials = result.siteCredentials || [];

  // Update backup summary
  elements.summarySites.textContent = sites.length;
  elements.summaryNavSites.textContent = navSites.length;
  elements.summaryRecords.textContent = Object.keys(result.submissionRecords || {}).length;
  elements.summaryMappings.textContent = Object.keys(fieldMappings).length;
}

/**
 * Initialize tabs
 */
function initTabs() {
  // Activate current tab
  elements.tabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === currentTab);
  });

  elements.tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `tab-${currentTab}`);
  });
}

/**
 * Switch tab
 */
function switchTab(tabName) {
  currentTab = tabName;
  initTabs();
  renderCurrentTab();
}

/**
 * Render current tab content
 */
function renderCurrentTab() {
  switch (currentTab) {
    case 'sites':
      renderSitesTab();
      break;
    case 'navSites':
      renderNavSitesTab();
      break;
    case 'blogSites':
      renderBlogSitesTab();
      break;
    case 'mappings':
      renderMappingsTab();
      break;
    case 'backup':
      // Backup tab is mostly static
      break;
    case 'settings':
      renderSettingsTab();
      break;
    case 'feishu':
      renderFeishuTab();
      break;
  }
}

/**
 * Render sites tab
 */
function renderSitesTab() {
  if (sites.length === 0) {
    elements.sitesList.classList.add('hidden');
    elements.noSitesHint.classList.remove('hidden');
    return;
  }

  elements.sitesList.classList.remove('hidden');
  elements.noSitesHint.classList.add('hidden');

  elements.sitesList.innerHTML = sites.map(site => `
    <div class="item-card" data-site-id="${site.id}">
      <div class="item-card-logo-wrap" data-site-id="${site.id}" title="${site.logoDataUrl ? '已上传 Logo' : '未上传 Logo'}">
        ${site.logoDataUrl ? '' : '<span class="item-card-logo-placeholder">无</span>'}
      </div>
      <div class="item-card-body">
        <div class="item-header">
          <h3 class="item-title">${escapeHtml(site.siteName || 'Unnamed')}</h3>
          <div class="item-actions">
            <button class="btn-icon" data-action="edit" data-id="${site.id}" title="编辑">✏️</button>
            <button class="btn-icon" data-action="delete" data-id="${site.id}" title="删除">🗑️</button>
          </div>
        </div>
        <div class="item-details">
          <div class="detail-row">
            <span class="detail-label">URL:</span>
            <span class="detail-value">${escapeHtml(site.siteUrl || '-')}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">分类:</span>
            <span class="detail-value">${escapeHtml(site.category || '-')}</span>
          </div>
        </div>
      </div>
    </div>
  `).join('');

  // 为有 logoDataUrl 的站点填入 Logo 预览图（避免在 HTML 中嵌入超长 data URL）
  sites.forEach(site => {
    if (!site.logoDataUrl) return;
    const wrap = elements.sitesList.querySelector(`.item-card-logo-wrap[data-site-id="${site.id}"]`);
    if (wrap) {
      const img = document.createElement('img');
      img.src = site.logoDataUrl;
      img.alt = site.siteName || 'Logo';
      img.className = 'item-card-logo';
      wrap.innerHTML = '';
      wrap.appendChild(img);
    }
  });

  // Add event listeners to item actions
  elements.sitesList.querySelectorAll('.btn-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      if (action === 'edit') {
        openSiteModal(id);
      } else if (action === 'delete') {
        deleteSite(id);
      }
    });
  });
}

/**
 * Render nav sites tab
 */
function renderNavSitesTab() {
  if (navSites.length === 0) {
    elements.navSitesList.classList.add('hidden');
    elements.noNavSitesHint.classList.remove('hidden');
    return;
  }

  elements.navSitesList.classList.remove('hidden');
  elements.noNavSitesHint.classList.add('hidden');

  elements.navSitesList.innerHTML = navSites.map(navSite => `
    <div class="item-card">
      <div class="item-header">
        <h3 class="item-title">${escapeHtml(navSite.name || 'Unnamed')}</h3>
        <div class="item-actions">
          <button class="btn-icon" data-action="open" data-url="${escapeHtml(navSite.submitUrl || '')}" title="打开">🔗</button>
          <button class="btn-icon" data-action="edit" data-id="${navSite.id}" title="编辑">✏️</button>
          <button class="btn-icon" data-action="delete" data-id="${navSite.id}" title="删除">🗑️</button>
        </div>
      </div>
      <div class="item-details">
        <div class="detail-row">
          <span class="detail-label">提交页面:</span>
          <span class="detail-value text-truncate">${escapeHtml(navSite.submitUrl || '-')}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">分类:</span>
          <span class="detail-value">${escapeHtml(navSite.category || '-')}</span>
        </div>
      </div>
    </div>
  `).join('');

  // Add event listeners to item actions
  elements.navSitesList.querySelectorAll('.btn-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      const url = e.target.dataset.url;

      if (action === 'open' && url) {
        chrome.tabs.create({ url });
      } else if (action === 'edit') {
        openNavSiteModal(id);
      } else if (action === 'delete') {
        deleteNavSite(id);
      }
    });
  });
}

/**
 * Render Blog 评论站点列表
 */
function renderBlogSitesTab() {
  if (blogCommentSites.length === 0) {
    elements.blogSitesList?.classList.add('hidden');
    elements.noBlogSitesHint?.classList.remove('hidden');
    return;
  }
  elements.blogSitesList?.classList.remove('hidden');
  elements.noBlogSitesHint?.classList.add('hidden');
  elements.blogSitesList.innerHTML = blogCommentSites.map(item => `
    <div class="item-card">
      <div class="item-header">
        <h3 class="item-title">${escapeHtml(item.name || 'Unnamed')}</h3>
        <div class="item-actions">
          <button class="btn-icon" data-action="open" data-url="${escapeHtml(item.url || '')}" title="打开">🔗</button>
          <button class="btn-icon" data-action="edit" data-id="${item.id}" title="编辑">✏️</button>
          <button class="btn-icon" data-action="delete" data-id="${item.id}" title="删除">🗑️</button>
        </div>
      </div>
      <div class="item-details">
        <div class="detail-row">
          <span class="detail-label">评论页 URL:</span>
          <span class="detail-value text-truncate">${escapeHtml(item.url || '-')}</span>
        </div>
      </div>
    </div>
  `).join('');

  elements.blogSitesList?.querySelectorAll('.btn-icon').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const id = e.target.dataset.id;
      const url = e.target.dataset.url;
      if (action === 'open' && url) chrome.tabs.create({ url });
      else if (action === 'edit') openBlogSiteModal(id);
      else if (action === 'delete') deleteBlogSite(id);
    });
  });
}

/**
 * Render mappings tab
 */
function renderMappingsTab() {
  const domains = Object.keys(fieldMappings);

  if (domains.length === 0) {
    elements.mappingsList.classList.add('hidden');
    elements.noMappingsHint.classList.remove('hidden');
    return;
  }

  elements.mappingsList.classList.remove('hidden');
  elements.noMappingsHint.classList.add('hidden');

  elements.mappingsList.innerHTML = domains.map(domain => {
    const mapping = fieldMappings[domain];
    const mappingCount = mapping.mappings?.length || 0;

    return `
      <div class="mapping-card">
        <div class="mapping-header">
          <h4 class="mapping-title">${escapeHtml(domain)}</h4>
          <div class="mapping-actions">
            <button class="btn-icon" data-action="clear" data-domain="${escapeHtml(domain)}" title="清除缓存">🗑️</button>
          </div>
        </div>
        <div class="mapping-info">
          <span class="mapping-count">${mappingCount} 个字段映射</span>
          <span class="mapping-date">${mapping.cachedAt ? new Date(mapping.cachedAt).toLocaleString() : '-'}</span>
        </div>
        <div class="mapping-fields">
          ${mapping.mappings?.map(m => `
            <div class="mapping-field">
              <span class="field-name">${escapeHtml(m.standardField || 'unknown')}</span>
              <span class="field-confidence">${Math.round((m.confidence || 0) * 100)}%</span>
            </div>
          `).join('') || ''}
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners
  elements.mappingsList.querySelectorAll('[data-action="clear"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      clearMapping(e.target.dataset.domain);
    });
  });
}

/**
 * Render settings tab
 */
function renderSettingsTab() {
  // LLM Config
  elements.llmEnabled.checked = settings.llmConfig?.enabled || false;
  elements.llmConfigFields.classList.toggle('hidden', !settings.llmConfig?.enabled);

  const llmConfig = settings.llmConfig || {};
  const provider = getProviderFromEndpoint(llmConfig.endpoint);
  elements.llmProvider.value = provider;
  elements.llmEndpoint.value = llmConfig.endpoint || (PROVIDER_CONFIG[provider]?.endpoint || '');
  elements.llmApiKey.value = llmConfig.apiKey || '';
  updateModelSelect(provider, (llmConfig.model || '').trim());
  if ((llmConfig.model || '').trim() && (elements.llmModel.value === '__custom__' || provider === 'custom')) {
    elements.llmModelCustom.value = (llmConfig.model || '').trim();
  }
  elements.llmDisableThinking.checked = llmConfig.disableThinking !== false;

  // Auto submit
}

/**
 * API 提供商与对应端点、模型列表（选定提供商后只展示该提供商的模型）
 */
const PROVIDER_CONFIG = {
  glm: {
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions',
    models: [
      { value: 'glm-4.7-flash', label: 'glm-4.7-flash' },
      { value: 'glm-4.7', label: 'glm-4.7' },
      { value: 'glm-5', label: 'glm-5' }
    ],
    defaultModel: 'glm-4.7-flash'
  },
  google: {
    name: 'Google (Gemini)',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    models: [
      { value: 'gemini-2.0-flash-001', label: 'gemini-2.0-flash-001' },
      { value: 'gemini-3-flash', label: 'gemini-3-flash' },
      { value: 'gemini-3-pro', label: 'gemini-3-pro' }
    ],
    defaultModel: 'gemini-2.0-flash-001'
  },
  moonshot: {
    name: 'MoonshotAI (Kimi)',
    endpoint: 'https://api.moonshot.ai/v1/chat/completions',
    models: [
      { value: 'kimi-k2.5-instant', label: 'kimi-k2.5-instant' },
      { value: 'kimi-k2.5-thinking', label: 'kimi-k2.5-thinking' }
    ],
    defaultModel: 'kimi-k2.5-instant'
  },
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
      { value: 'gpt-4', label: 'gpt-4' },
      { value: 'gpt-4o', label: 'gpt-4o' }
    ],
    defaultModel: 'gpt-3.5-turbo'
  },
  groq: {
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { value: 'llama3-8b-8192', label: 'llama3-8b-8192' },
      { value: 'llama3-70b-8192', label: 'llama3-70b-8192' }
    ],
    defaultModel: 'llama3-8b-8192'
  },
  custom: {
    name: '自定义',
    endpoint: '',
    models: [],
    defaultModel: ''
  }
};

/**
 * 根据当前选中的 API 提供商填充模型下拉框，并可选保留当前已选模型
 */
function updateModelSelect(provider, currentModel) {
  const config = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.custom;
  const select = elements.llmModel;
  if (!select) return;

  select.innerHTML = '';
  if (provider === 'custom') {
    elements.llmModelCustomWrap?.classList.remove('hidden');
    return;
  }

  const models = config.models || [];
  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    if (currentModel && m.value === currentModel) opt.selected = true;
    select.appendChild(opt);
  });
  const opt = document.createElement('option');
  opt.value = '__custom__';
  opt.textContent = '其他（手动输入）';
  if (currentModel && !models.some((m) => m.value === currentModel)) opt.selected = true;
  select.appendChild(opt);

  elements.llmModelCustomWrap?.classList.toggle('hidden', select.value !== '__custom__');
  if (select.value !== '__custom__') {
    elements.llmModelCustom.value = '';
  } else if (currentModel && !models.some((m) => m.value === currentModel)) {
    elements.llmModelCustom.value = currentModel;
  }
  if (!currentModel || (!models.some((m) => m.value === currentModel) && select.value !== '__custom__')) {
    select.value = config.defaultModel || (models[0]?.value ?? '');
  }
}

/**
 * Get provider from endpoint
 */
function getProviderFromEndpoint(endpoint) {
  if (!endpoint) return 'glm';

  if (endpoint.includes('bigmodel.cn')) return 'glm';
  if (endpoint.includes('generativelanguage.googleapis.com') || endpoint.includes('ai.google.dev')) return 'google';
  if (endpoint.includes('moonshot.ai')) return 'moonshot';
  if (endpoint.includes('openai.com')) return 'openai';
  if (endpoint.includes('groq.com')) return 'groq';
  return 'custom';
}

/**
 * Open site modal
 */
function openSiteModal(siteId = null) {
  const site = siteId ? sites.find(s => s.id === siteId) : null;
  const isEdit = !!site;

  elements.modalTitle.textContent = isEdit ? '编辑站点' : '添加站点';

  elements.modalBody.innerHTML = `
    <form id="siteForm" class="form">
      <div class="form-group">
        <label for="siteName" class="form-label required">网站名称</label>
        <input type="text" id="siteName" class="input" value="${escapeHtml(site?.siteName || '')}" required>
      </div>

      <div class="form-group">
        <label for="siteUrl" class="form-label required">网站 URL</label>
        <input type="url" id="siteUrl" class="input" value="${escapeHtml(site?.siteUrl || '')}" required>
      </div>

      <div class="form-group">
        <label for="email" class="form-label">联系邮箱</label>
        <input type="email" id="email" class="input" value="${escapeHtml(site?.email || '')}">
      </div>

      <div class="form-group">
        <label for="category" class="form-label">分类</label>
        <input type="text" id="category" class="input" value="${escapeHtml(site?.category || '')}" placeholder="如: AI工具, 图片, 音乐">
      </div>

      <div class="form-group">
        <label for="tags" class="form-label">标签 Tags</label>
        <input type="text" id="tags" class="input" value="${escapeHtml(site?.tags || '')}" placeholder="逗号分隔，如: ai, tools, productivity">
      </div>

      <div class="form-group">
        <label for="pricing" class="form-label">定价 (Pricing)</label>
        <select id="pricing" class="select">
          <option value="">-- 请选择 --</option>
          <option value="Free" ${(site?.pricing || '') === 'Free' ? 'selected' : ''}>Free</option>
          <option value="Free Trial" ${(site?.pricing || 'Free Trial') === 'Free Trial' ? 'selected' : ''}>Free Trial</option>
          <option value="Freemium" ${(site?.pricing || '') === 'Freemium' ? 'selected' : ''}>Freemium</option>
          <option value="Paid" ${(site?.pricing || '') === 'Paid' ? 'selected' : ''}>Paid</option>
        </select>
      </div>

      <div class="form-group">
        <label for="tagline" class="form-label">标语/口号</label>
        <input type="text" id="tagline" class="input" value="${escapeHtml(site?.tagline || '')}">
      </div>

      <div class="form-group">
        <label for="shortDescription" class="form-label">简短描述</label>
        <textarea id="shortDescription" class="textarea" rows="2">${escapeHtml(site?.shortDescription || '')}</textarea>
      </div>

      <div class="form-group">
        <label for="longDescription" class="form-label">详细描述</label>
        <textarea id="longDescription" class="textarea" rows="4">${escapeHtml(site?.longDescription || '')}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label">Logo（用于自动填充上传框）</label>
        <input type="url" id="logo" class="input" value="${escapeHtml(site?.logo || '')}" placeholder="Logo 图片 URL（可选）">
        <div class="form-hint">或上传图片，&lt; 1MB（findly 等站点为文件上传框时使用）</div>
        <input type="file" id="logoFile" class="input" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" style="margin-top:4px">
        <div id="logoPreview" class="logo-preview hidden"></div>
      </div>

      <div class="form-group">
        <label class="form-label">界面截图（App Image 等上传框）</label>
        <input type="url" id="screenshot" class="input" value="${escapeHtml(site?.screenshot || '')}" placeholder="截图 URL（可选）">
        <div class="form-hint">或上传一张图片，&lt; 1MB</div>
        <input type="file" id="screenshotFile" class="input" accept="image/png,image/jpeg,image/jpg,image/gif,image/webp" style="margin-top:4px">
        <div id="screenshotPreview" class="logo-preview hidden"></div>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancelSiteBtn">取消</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '保存' : '添加'}</button>
      </div>
    </form>
  `;

  openModal();

  // 编辑时保留已有 Logo / 界面截图 数据；新建时清空
  pendingLogoDataUrl = site?.logoDataUrl || null;
  pendingScreenshotDataUrl = site?.screenshotDataUrl || null;
  const logoPreviewEl = document.getElementById('logoPreview');
  const logoFileEl = document.getElementById('logoFile');
  const screenshotPreviewEl = document.getElementById('screenshotPreview');
  const screenshotFileEl = document.getElementById('screenshotFile');

  function renderLogoPreview(dataUrl) {
    if (!dataUrl) {
      logoPreviewEl.classList.add('hidden');
      logoPreviewEl.innerHTML = '';
      return;
    }
    logoPreviewEl.classList.remove('hidden');
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = 'Logo 预览';
    img.className = 'logo-preview-img';
    logoPreviewEl.innerHTML = '';
    logoPreviewEl.appendChild(img);
  }
  renderLogoPreview(site?.logoDataUrl || null);
  if (logoFileEl) logoFileEl.value = '';

  function renderScreenshotPreview(dataUrl) {
    if (!dataUrl) {
      screenshotPreviewEl.classList.add('hidden');
      screenshotPreviewEl.innerHTML = '';
      return;
    }
    screenshotPreviewEl.classList.remove('hidden');
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '界面截图预览';
    img.className = 'logo-preview-img';
    screenshotPreviewEl.innerHTML = '';
    screenshotPreviewEl.appendChild(img);
  }
  renderScreenshotPreview(site?.screenshotDataUrl || null);
  if (screenshotFileEl) screenshotFileEl.value = '';

  // Logo 文件选择：转为 data URL；超过 1MB 时自动压缩到 < 1MB
  logoFileEl.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
      pendingLogoDataUrl = null;
      renderLogoPreview(null);
      return;
    }
    try {
      if (file.size <= MAX_IMAGE_BYTES) {
        const reader = new FileReader();
        reader.onload = () => {
          pendingLogoDataUrl = reader.result;
          renderLogoPreview(pendingLogoDataUrl);
        };
        reader.readAsDataURL(file);
      } else {
        showToast('图片超过 1MB，正在压缩…', 'info');
        const dataUrl = await compressImageToUnder1MB(file);
        pendingLogoDataUrl = dataUrl;
        renderLogoPreview(dataUrl);
        showToast('已压缩到 < 1MB', 'success');
      }
    } catch (err) {
      showToast('处理失败: ' + (err.message || '未知错误'), 'error');
      e.target.value = '';
    }
  });

  // 界面截图文件选择：超过 1MB 时自动压缩到 < 1MB
  screenshotFileEl.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
      pendingScreenshotDataUrl = null;
      renderScreenshotPreview(null);
      return;
    }
    try {
      if (file.size <= MAX_IMAGE_BYTES) {
        const reader = new FileReader();
        reader.onload = () => {
          pendingScreenshotDataUrl = reader.result;
          renderScreenshotPreview(pendingScreenshotDataUrl);
        };
        reader.readAsDataURL(file);
      } else {
        showToast('图片超过 1MB，正在压缩…', 'info');
        const dataUrl = await compressImageToUnder1MB(file);
        pendingScreenshotDataUrl = dataUrl;
        renderScreenshotPreview(dataUrl);
        showToast('已压缩到 < 1MB', 'success');
      }
    } catch (err) {
      showToast('处理失败: ' + (err.message || '未知错误'), 'error');
      e.target.value = '';
    }
  });

  // Form submission
  document.getElementById('siteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveSite(siteId);
  });

  document.getElementById('cancelSiteBtn').addEventListener('click', closeModal);
}

/**
 * Save site
 */
async function saveSite(siteId) {
  const siteData = {
    siteName: document.getElementById('siteName').value.trim(),
    siteUrl: document.getElementById('siteUrl').value.trim(),
    email: document.getElementById('email').value.trim(),
    category: document.getElementById('category').value.trim(),
    tags: document.getElementById('tags').value.trim(),
    pricing: (document.getElementById('pricing')?.value || '').trim(),
    tagline: document.getElementById('tagline').value.trim(),
    shortDescription: document.getElementById('shortDescription').value.trim(),
    longDescription: document.getElementById('longDescription').value.trim(),
    logo: document.getElementById('logo').value.trim(),
    logoDataUrl: pendingLogoDataUrl ?? (siteId ? (sites.find(s => s.id === siteId)?.logoDataUrl) : null) ?? '',
    screenshot: document.getElementById('screenshot').value.trim(),
    screenshotDataUrl: pendingScreenshotDataUrl ?? (siteId ? (sites.find(s => s.id === siteId)?.screenshotDataUrl) : null) ?? ''
  };
  pendingLogoDataUrl = null;
  pendingScreenshotDataUrl = null;

  try {
    if (siteId) {
      // Update existing site
      const index = sites.findIndex(s => s.id === siteId);
      sites[index] = { ...sites[index], ...siteData };
    } else {
      // Add new site
      siteData.id = 'site_' + Date.now();
      siteData.createdAt = new Date().toISOString();
      sites.push(siteData);
    }

    await chrome.storage.local.set({ sites });
    closeModal();
    await loadData();
    renderSitesTab();
    showToast(siteId ? '站点已更新' : '站点已添加', 'success');
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}

/**
 * Delete site
 */
async function deleteSite(siteId) {
  if (!confirm('确定要删除这个站点吗？')) return;

  try {
    sites = sites.filter(s => s.id !== siteId);
    await chrome.storage.local.set({ sites });
    await loadData();
    renderSitesTab();
    showToast('站点已删除', 'success');
  } catch (error) {
    showToast('删除失败: ' + error.message, 'error');
  }
}

/**
 * Open nav site modal
 */
function openNavSiteModal(navSiteId = null) {
  const navSite = navSiteId ? navSites.find(ns => ns.id === navSiteId) : null;
  const isEdit = !!navSite;

  elements.modalTitle.textContent = isEdit ? '编辑导航站' : '添加导航站';

  elements.modalBody.innerHTML = `
    <form id="navSiteForm" class="form">
      <div class="form-group">
        <label for="navSiteName" class="form-label required">导航站名称</label>
        <input type="text" id="navSiteName" class="input" value="${escapeHtml(navSite?.name || '')}" required>
      </div>

      <div class="form-group">
        <label for="submitUrl" class="form-label required">提交页面 URL</label>
        <input type="url" id="submitUrl" class="input" value="${escapeHtml(navSite?.submitUrl || '')}" required>
      </div>

      <div class="form-group">
        <label for="navSiteCategory" class="form-label">分类</label>
        <input type="text" id="navSiteCategory" class="input" value="${escapeHtml(navSite?.category || '')}" placeholder="如: 中文导航, 国外导航">
      </div>

      <div class="form-group">
        <label for="notes" class="form-label">备注</label>
        <textarea id="notes" class="textarea" rows="2">${escapeHtml(navSite?.notes || '')}</textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancelNavSiteBtn">取消</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '保存' : '添加'}</button>
      </div>
    </form>
  `;

  openModal();

  // Form submission
  document.getElementById('navSiteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveNavSite(navSiteId);
  });

  document.getElementById('cancelNavSiteBtn').addEventListener('click', closeModal);
}

/**
 * Save nav site
 */
async function saveNavSite(navSiteId) {
  const navSiteData = {
    name: document.getElementById('navSiteName').value.trim(),
    submitUrl: document.getElementById('submitUrl').value.trim(),
    category: document.getElementById('navSiteCategory').value.trim(),
    notes: document.getElementById('notes').value.trim()
  };

  try {
    if (navSiteId) {
      const index = navSites.findIndex(ns => ns.id === navSiteId);
      navSites[index] = { ...navSites[index], ...navSiteData };
    } else {
      navSiteData.id = 'nav_' + Date.now();
      navSiteData.createdAt = new Date().toISOString();
      navSites.push(navSiteData);
    }

    await chrome.storage.local.set({ navSites: navSites });
    closeModal();
    await loadData();
    renderNavSitesTab();
    showToast(navSiteId ? '导航站已更新' : '导航站已添加', 'success');
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}

/**
 * Delete nav site
 */
async function deleteNavSite(navSiteId) {
  if (!confirm('确定要删除这个导航站吗？')) return;

  try {
    navSites = navSites.filter(ns => ns.id !== navSiteId);
    await chrome.storage.local.set({ navSites });
    await loadData();
    renderNavSitesTab();
    showToast('导航站已删除', 'success');
  } catch (error) {
    showToast('删除失败: ' + error.message, 'error');
  }
}

/**
 * Import nav sites
 */
async function importNavSites() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : data.navSites || [];

      let added = 0;
      for (const item of items) {
        if (item.name && item.submitUrl) {
          item.id = 'nav_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          item.createdAt = new Date().toISOString();
          navSites.push(item);
          added++;
        }
      }

      await chrome.storage.local.set({ navSites });
      await loadData();
      renderNavSitesTab();
      showToast(`已导入 ${added} 个导航站`, 'success');
    } catch (error) {
      showToast('导入失败: ' + error.message, 'error');
    }
  };

  input.click();
}

/**
 * Open Blog 评论站点编辑弹窗
 */
function openBlogSiteModal(blogSiteId = null) {
  const item = blogSiteId ? blogCommentSites.find(b => b.id === blogSiteId) : null;
  const isEdit = !!item;

  elements.modalTitle.textContent = isEdit ? '编辑评论页' : '添加评论页';
  elements.modalBody.innerHTML = `
    <form id="blogSiteForm">
      <div class="form-group">
        <label for="blogSiteName" class="form-label required">名称</label>
        <input type="text" id="blogSiteName" class="input" value="${escapeHtml(item?.name || '')}" placeholder="便于区分的展示名" required>
      </div>
      <div class="form-group">
        <label for="blogSiteUrl" class="form-label required">评论页 URL</label>
        <input type="url" id="blogSiteUrl" class="input" value="${escapeHtml(item?.url || '')}" placeholder="https://..." required>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancelBlogSiteBtn">取消</button>
        <button type="submit" class="btn btn-primary">${isEdit ? '保存' : '添加'}</button>
      </div>
    </form>
  `;

  openModal();
  document.getElementById('blogSiteForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveBlogSite(blogSiteId);
  });
  document.getElementById('cancelBlogSiteBtn').addEventListener('click', closeModal);
}

async function saveBlogSite(blogSiteId) {
  const name = document.getElementById('blogSiteName').value.trim();
  const url = document.getElementById('blogSiteUrl').value.trim();
  if (!name || !url) {
    showToast('请填写名称和 URL', 'error');
    return;
  }
  try {
    if (blogSiteId) {
      const index = blogCommentSites.findIndex(b => b.id === blogSiteId);
      blogCommentSites[index] = { ...blogCommentSites[index], name, url, updatedAt: new Date().toISOString() };
    } else {
      blogCommentSites.push({
        id: 'blog_' + Date.now(),
        name,
        url,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    await chrome.storage.local.set({ blogCommentSites });
    closeModal();
    await loadData();
    renderBlogSitesTab();
    showToast(blogSiteId ? '已更新' : '已添加', 'success');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

async function deleteBlogSite(id) {
  if (!confirm('确定删除这条评论页？')) return;
  try {
    blogCommentSites = blogCommentSites.filter(b => b.id !== id);
    await chrome.storage.local.set({ blogCommentSites });
    await loadData();
    renderBlogSitesTab();
    showToast('已删除', 'success');
  } catch (e) {
    showToast('删除失败: ' + e.message, 'error');
  }
}

async function importBlogSites() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : (data.blogCommentSites || data.items || []);
      let added = 0;
      for (const it of items) {
        const url = (it.url || '').trim();
        const name = (it.name || '').trim() || url;
        if (url) {
          blogCommentSites.push({
            id: 'blog_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: name || url,
            url,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          added++;
        }
      }
      await chrome.storage.local.set({ blogCommentSites });
      await loadData();
      renderBlogSitesTab();
      showToast(`已导入 ${added} 条`, 'success');
    } catch (err) {
      showToast('导入失败: ' + err.message, 'error');
    }
  };
  input.click();
}

/**
 * Clear all mappings
 */
async function clearAllMappings() {
  if (!confirm('确定要清除所有识别缓存吗？')) return;

  try {
    await chrome.storage.local.set({ fieldMappings: {} });
    fieldMappings = {};
    renderMappingsTab();
    elements.summaryMappings.textContent = '0';
    showToast('缓存已清除', 'success');
  } catch (error) {
    showToast('清除失败: ' + error.message, 'error');
  }
}

/**
 * Clear single mapping
 */
async function clearMapping(domain) {
  if (!confirm(`确定要清除 ${domain} 的识别缓存吗？`)) return;

  try {
    delete fieldMappings[domain];
    await chrome.storage.local.set({ fieldMappings });
    renderMappingsTab();
    elements.summaryMappings.textContent = Object.keys(fieldMappings).length;
    showToast('缓存已清除', 'success');
  } catch (error) {
    showToast('清除失败: ' + error.message, 'error');
  }
}

/**
 * Create backup
 */
async function createBackup() {
  try {
    const data = {
      version: '1.0.0',
      backupDate: new Date().toISOString(),
      sites,
      navSites,
      blogCommentSites,
      fieldMappings: elements.includeMappings.checked ? fieldMappings : {},
      blogCommentFieldMappings: elements.includeMappings.checked ? (await chrome.storage.local.get(['blogCommentFieldMappings'])).blogCommentFieldMappings || {} : {},
      settings
    };

    if (elements.includeRecords.checked) {
      const result = await chrome.storage.local.get(['submissionRecords', 'blogCommentRecords']);
      data.submissionRecords = result.submissionRecords || {};
      data.blogCommentRecords = result.blogCommentRecords || {};
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `nav-submitter-backup-${date}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
    showToast('备份已创建', 'success');
  } catch (error) {
    showToast('创建备份失败: ' + error.message, 'error');
  }
}

/**
 * Backup file selected
 */
function onBackupFileSelected(e) {
  elements.restoreBackupBtn.disabled = !e.target.files.length;
}

/**
 * Restore backup
 */
async function restoreBackup() {
  const file = elements.backupFileInput.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (elements.restoreMode.value === 'replace') {
      // Replace all data
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        sites: data.sites || [],
        navSites: data.navSites || [],
        blogCommentSites: data.blogCommentSites || [],
        fieldMappings: data.fieldMappings || {},
        blogCommentFieldMappings: data.blogCommentFieldMappings || {},
        settings: data.settings || {},
        submissionRecords: data.submissionRecords || {},
        blogCommentRecords: data.blogCommentRecords || {}
      });
    } else {
      // Merge data
      const existing = await chrome.storage.local.get(null);

      const mergedSites = mergeById(existing.sites || [], data.sites || []);
      const mergedNavSites = mergeById(existing.navSites || [], data.navSites || []);
      const mergedBlogSites = mergeById(existing.blogCommentSites || [], data.blogCommentSites || []);

      await chrome.storage.local.set({
        sites: mergedSites,
        navSites: mergedNavSites,
        blogCommentSites: mergedBlogSites,
        fieldMappings: { ...existing.fieldMappings, ...data.fieldMappings },
        blogCommentFieldMappings: { ...existing.blogCommentFieldMappings, ...(data.blogCommentFieldMappings || {}) },
        submissionRecords: { ...existing.submissionRecords, ...(data.submissionRecords || {}) },
        blogCommentRecords: { ...existing.blogCommentRecords, ...(data.blogCommentRecords || {}) }
      });
    }

    await loadData();
    renderCurrentTab();
    showToast('备份已恢复', 'success');
    elements.backupFileInput.value = '';
    elements.restoreBackupBtn.disabled = true;
  } catch (error) {
    showToast('恢复备份失败: ' + error.message, 'error');
  }
}

/**
 * Merge arrays by id
 */
function mergeById(existing, incoming) {
  const map = new Map(existing.map(item => [item.id, item]));
  incoming.forEach(item => map.set(item.id, item));
  return Array.from(map.values());
}

/**
 * LLM provider change：切换提供商时更新端点并只展示该提供商的模型列表
 */
function onLlmProviderChange(e) {
  const provider = e.target.value;
  const config = PROVIDER_CONFIG[provider];
  if (config && config.endpoint) {
    elements.llmEndpoint.value = config.endpoint;
  }
  updateModelSelect(provider);
}

/**
 * Test LLM connection
 */
function getDefaultModelForEndpoint(endpoint) {
  const provider = getProviderFromEndpoint(endpoint);
  return PROVIDER_CONFIG[provider]?.defaultModel || 'glm-4.7-flash';
}

async function testLlmConnection() {
  const endpoint = elements.llmEndpoint.value.trim();
  const apiKey = elements.llmApiKey.value.trim();
  const provider = getProviderFromEndpoint(endpoint);
  const model = (provider === 'custom' || elements.llmModel.value === '__custom__' ? elements.llmModelCustom.value.trim() : elements.llmModel.value) || getDefaultModelForEndpoint(endpoint);

  if (!endpoint || !apiKey) {
    showToast('请先填写 API 端点和 API Key', 'warning');
    return;
  }

  elements.testLlmBtn.disabled = true;
  elements.testLlmBtn.innerHTML = '<span class="btn-icon">⏳</span> 测试中...';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Respond with: {"status": "ok"}' }],
        max_tokens: 50
      })
    });

    if (response.ok) {
      showToast('连接成功！', 'success');
    } else {
      const error = await response.text();
      showToast('连接失败: ' + error, 'error');
    }
  } catch (error) {
    showToast('连接失败: ' + error.message, 'error');
  } finally {
    elements.testLlmBtn.disabled = false;
    elements.testLlmBtn.innerHTML = '<span class="btn-icon">🔧</span> 测试连接';
  }
}

/**
 * Save settings
 */
async function saveSettings() {
  try {
    const newSettings = {
      llmConfig: {
        enabled: elements.llmEnabled.checked,
        endpoint: elements.llmEndpoint.value.trim(),
        apiKey: elements.llmApiKey.value.trim(),
        model: (getProviderFromEndpoint(elements.llmEndpoint?.value?.trim()) === 'custom' || elements.llmModel.value === '__custom__' ? elements.llmModelCustom.value.trim() : elements.llmModel.value) || getDefaultModelForEndpoint(elements.llmEndpoint?.value?.trim()),
        disableThinking: elements.llmDisableThinking.checked
      },
      autoSubmit: (await chrome.storage.local.get(['settings'])).settings?.autoSubmit ?? false
    };

    await chrome.storage.local.set({ settings: newSettings });
    settings = newSettings;
    showToast('设置已保存', 'success');
  } catch (error) {
    showToast('保存设置失败: ' + error.message, 'error');
  }
}

/**
 * Open modal
 */
function openModal() {
  elements.modal.classList.remove('hidden');
}

/**
 * Close modal
 */
function closeModal() {
  elements.modal.classList.add('hidden');
}

/**
 * Show toast
 */
function showToast(message, type = 'info') {
  elements.toastMessage.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.classList.remove('hidden');

  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3000);
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Render Feishu tab
 */
function renderFeishuTab() {
  if (!feishuConfig) feishuConfig = {};

  if (elements.feishuAppId) elements.feishuAppId.value = feishuConfig.appId || '';
  if (elements.feishuAppSecret) elements.feishuAppSecret.value = feishuConfig.appSecret || '';
  if (elements.feishuAppToken) elements.feishuAppToken.value = feishuConfig.appToken || '';
  if (elements.feishuTableId) elements.feishuTableId.value = feishuConfig.tableId || '';

  updateFeishuSyncStatus();

  if (elements.credSpreadsheetToken) elements.credSpreadsheetToken.value = credConfig.spreadsheetToken || 'FgWhsDQdNhWfVot4787ceNMXnDd';
  if (elements.credSheetName) elements.credSheetName.value = credConfig.sheetName || '媒体账号统计';

  renderCredPreview();
}

/**
 * Update Feishu sync status display
 */
function updateFeishuSyncStatus() {
  const hasConfig = feishuConfig?.appId && feishuConfig?.appSecret && feishuConfig?.appToken && feishuConfig?.tableId;

  if (elements.feishuSyncStatusText) {
    if (hasConfig) {
      elements.feishuSyncStatusText.textContent = '已配置';
      elements.feishuSyncStatusText.className = 'sync-status-badge synced';
    } else {
      elements.feishuSyncStatusText.textContent = '未配置';
      elements.feishuSyncStatusText.className = 'sync-status-badge';
    }
  }

  // Enable/disable test button
  if (elements.testFeishuBtn) {
    elements.testFeishuBtn.disabled = !hasConfig;
  }

  // Update last sync time
  if (elements.feishuLastSyncTimeText && feishuConfig?.lastSyncTime) {
    elements.feishuLastSyncTimeText.textContent = feishuConfig.lastSyncTime;
  } else if (elements.feishuLastSyncTimeText) {
    elements.feishuLastSyncTimeText.textContent = '-';
  }
}

/**
 * Save Feishu config
 */
async function saveFeishuConfig() {
  try {
    const newConfig = {
      appId: elements.feishuAppId?.value?.trim() || '',
      appSecret: elements.feishuAppSecret?.value?.trim() || '',
      appToken: elements.feishuAppToken?.value?.trim() || '',
      tableId: elements.feishuTableId?.value?.trim() || '',
      lastSyncTime: feishuConfig?.lastSyncTime || null
    };

    await chrome.storage.local.set({ feishuConfig: newConfig });
    feishuConfig = newConfig;
    updateFeishuSyncStatus();
    showToast('飞书配置已保存', 'success');
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}

/**
 * Test Feishu connection
 */
async function testFeishuConnection() {
  const appId = elements.feishuAppId?.value?.trim();
  const appSecret = elements.feishuAppSecret?.value?.trim();
  const appToken = elements.feishuAppToken?.value?.trim();
  const tableId = elements.feishuTableId?.value?.trim();

  if (!appId || !appSecret || !appToken || !tableId) {
    showToast('请先填写完整的飞书配置', 'warning');
    return;
  }

  elements.testFeishuBtn.disabled = true;
  elements.testFeishuBtn.innerHTML = '<span class="btn-icon">⏳</span> 测试中...';

  try {
    // Get tenant access token
    const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_id: appId,
        app_secret: appSecret
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.code !== 0) {
      showToast('认证失败: ' + (tokenData.msg || '未知错误'), 'error');
      return;
    }

    const tenantAccessToken = tokenData.tenant_access_token;

    // Test access to bitable
    const bitableResponse = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=1`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tenantAccessToken}`
      }
    });

    const bitableData = await bitableResponse.json();

    if (bitableResponse.ok && (bitableData.code === 0 || bitableData.code === 99991663)) {
      showToast('连接成功！', 'success');
    } else {
      showToast('访问多维表格失败: ' + (bitableData.msg || '请检查 App Token 和 Table ID'), 'error');
    }
  } catch (error) {
    showToast('连接失败: ' + error.message, 'error');
  } finally {
    elements.testFeishuBtn.disabled = false;
    elements.testFeishuBtn.innerHTML = '<span class="btn-icon">🔗</span> 测试连接';
  }
}

/**
 * 从 URL 中提取去 www 的域名
 */
function extractDomain(urlString) {
  try {
    const u = new URL(urlString.startsWith('http') ? urlString : 'https://' + urlString);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return urlString.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * 保存凭据配置
 */
async function saveCredConfig() {
  try {
    const newConfig = {
      spreadsheetToken: elements.credSpreadsheetToken?.value?.trim() || '',
      sheetName: elements.credSheetName?.value?.trim() || '媒体账号统计',
      lastSyncTime: credConfig.lastSyncTime || null
    };
    await chrome.storage.local.set({ credConfig: newConfig });
    credConfig = newConfig;
    showToast('凭据配置已保存', 'success');
  } catch (error) {
    showToast('保存失败: ' + error.message, 'error');
  }
}

/**
 * 从飞书电子表格同步凭据：复用飞书配置中的 App ID / App Secret
 * API 链路：tenant_access_token → 查询工作表列表 → 按名称找 sheetId → 读取全部数据
 */
async function syncCredentials() {
  const appId = elements.feishuAppId?.value?.trim() || feishuConfig.appId;
  const appSecret = elements.feishuAppSecret?.value?.trim() || feishuConfig.appSecret;
  const spreadsheetToken = elements.credSpreadsheetToken?.value?.trim();
  const sheetName = elements.credSheetName?.value?.trim();

  if (!appId || !appSecret) {
    showToast('请先在上方配置飞书 App ID 和 App Secret', 'warning');
    return;
  }
  if (!spreadsheetToken) {
    showToast('请填写电子表格 Token', 'warning');
    return;
  }

  elements.syncCredBtn.disabled = true;
  elements.syncCredBtn.innerHTML = '<span class="btn-icon">⏳</span> 同步中...';

  try {
    // 1. 获取 tenant_access_token
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const tokenData = await tokenResp.json();
    if (tokenData.code !== 0) {
      showToast('飞书认证失败: ' + (tokenData.msg || '请检查 App ID / Secret'), 'error');
      return;
    }
    const token = tokenData.tenant_access_token;

    // 2. 查询工作表列表，按名称找到目标 sheetId
    const sheetsResp = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const sheetsData = await sheetsResp.json();
    if (sheetsData.code !== 0) {
      showToast('获取工作表失败: ' + (sheetsData.msg || '请检查表格 Token 和权限'), 'error');
      return;
    }
    const sheets = sheetsData.data?.sheets || [];
    const targetSheet = sheetName
      ? sheets.find(s => s.title === sheetName)
      : sheets[0];
    if (!targetSheet) {
      showToast(`未找到名为「${sheetName}」的工作表，现有: ${sheets.map(s => s.title).join(', ')}`, 'error');
      return;
    }
    const sheetId = targetSheet.sheet_id;
    const rowCount = targetSheet.grid_properties?.row_count || 500;

    // 3. 读取全部数据（range = sheetId，读取整个工作表）
    const range = `${sheetId}!A1:Z${rowCount}`;
    const dataResp = await fetch(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values/${encodeURIComponent(range)}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const sheetResult = await dataResp.json();
    if (sheetResult.code !== 0) {
      showToast('读取数据失败: ' + (sheetResult.msg || ''), 'error');
      return;
    }
    const rows = sheetResult.data?.valueRange?.values || [];
    if (rows.length < 2) {
      showToast('表格无数据行（仅有表头或为空）', 'warning');
      return;
    }

    // 飞书单元格可能返回富文本对象，需递归提取纯文本
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

    // 4. 解析表头，建立列名→索引映射
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

    if (colIndex.url == null && colIndex.platform == null) {
      showToast('表头中未找到「平台」或「网址」列，请检查列名', 'error');
      return;
    }

    // 5. 逐行解析
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
        platform,
        username,
        password,
        email,
        url: rawUrl,
        domain: rawUrl ? extractDomain(rawUrl) : platform.toLowerCase()
      });
    }

    siteCredentials = credentials;
    const now = new Date().toLocaleString('zh-CN');
    credConfig.lastSyncTime = now;
    credConfig.spreadsheetToken = spreadsheetToken;
    credConfig.sheetName = sheetName;
    await chrome.storage.local.set({ siteCredentials: credentials, credConfig });

    renderCredPreview();
    showToast(`同步成功，共 ${credentials.length} 条凭据`, 'success');
  } catch (error) {
    showToast('同步失败: ' + error.message, 'error');
  } finally {
    elements.syncCredBtn.disabled = false;
    elements.syncCredBtn.innerHTML = '<span class="btn-icon">🔄</span> 从飞书同步';
  }
}

/**
 * 清空已同步凭据
 */
async function clearCredentials() {
  if (!confirm('确定要清空所有已同步的登录凭据吗？')) return;
  try {
    siteCredentials = [];
    await chrome.storage.local.set({ siteCredentials: [] });
    renderCredPreview();
    showToast('凭据已清空', 'success');
  } catch (error) {
    showToast('清空失败: ' + error.message, 'error');
  }
}

let credPwdVisible = false;

/**
 * 切换凭据预览表格中密码的显示/隐藏
 */
function toggleCredPasswords() {
  credPwdVisible = !credPwdVisible;
  if (elements.credTogglePwdBtn) {
    elements.credTogglePwdBtn.textContent = credPwdVisible ? '🙈' : '👁';
    elements.credTogglePwdBtn.title = credPwdVisible ? '隐藏密码' : '显示密码';
  }
  renderCredPreview();
}

function maskPassword(pwd) {
  if (!pwd) return '-';
  if (pwd.length <= 3) return '*'.repeat(pwd.length);
  return pwd[0] + '*'.repeat(pwd.length - 2) + pwd[pwd.length - 1];
}

/**
 * 渲染凭据预览表格
 */
function renderCredPreview() {
  if (elements.credCountText) {
    elements.credCountText.textContent = siteCredentials.length;
  }
  if (elements.credLastSyncText) {
    elements.credLastSyncText.textContent = credConfig.lastSyncTime || '-';
  }

  if (!elements.credPreviewCard || !elements.credPreviewBody) return;

  if (siteCredentials.length === 0) {
    elements.credPreviewCard.style.display = 'none';
    return;
  }

  elements.credPreviewCard.style.display = '';
  elements.credPreviewBody.innerHTML = siteCredentials.map(c => `
    <tr>
      <td>${escapeHtml(c.platform)}</td>
      <td><code>${escapeHtml(c.domain)}</code></td>
      <td>${escapeHtml(c.email)}</td>
      <td>${escapeHtml(c.username)}</td>
      <td class="cred-pwd-cell">${credPwdVisible ? escapeHtml(c.password) : maskPassword(c.password)}</td>
    </tr>
  `).join('');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

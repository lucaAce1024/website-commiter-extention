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
  elements.capsolverApiKey = document.getElementById('capsolverApiKey');
  elements.toggleCapsolverKeyBtn = document.getElementById('toggleCapsolverKeyBtn');

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
  elements.feishuSyncLimit = document.getElementById('feishuSyncLimit');
  elements.feishuExploreSheetToken = document.getElementById('feishuExploreSheetToken');
  elements.feishuExploreSheetId = document.getElementById('feishuExploreSheetId');
  elements.blogCommentSiteThreshold = document.getElementById('blogCommentSiteThreshold');
  elements.feishuAhrefsSheetToken = document.getElementById('feishuAhrefsSheetToken');
  elements.feishuAhrefsSheetId = document.getElementById('feishuAhrefsSheetId');
  elements.feishuSyncStatusText = document.getElementById('feishuSyncStatusText');
  elements.feishuLastSyncTimeText = document.getElementById('feishuLastSyncTimeText');
  elements.toggleFeishuSecretBtn = document.getElementById('toggleFeishuSecretBtn');
  elements.saveFeishuBtn = document.getElementById('saveFeishuBtn');
  elements.testFeishuBtn = document.getElementById('testFeishuBtn');
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
  elements.toggleCapsolverKeyBtn?.addEventListener('click', () => {
    const input = elements.capsolverApiKey;
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    elements.toggleCapsolverKeyBtn.textContent = isPassword ? '🙈' : '👁';
    elements.toggleCapsolverKeyBtn.title = isPassword ? '隐藏 Key' : '显示 Key';
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

  // Cache Management
  setupCacheTabListeners();

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
    case 'cache':
      renderCacheTab();
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

  if (elements.capsolverApiKey) {
    elements.capsolverApiKey.value = settings.capsolverApiKey || '';
  }
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
    const feishuResult = await chrome.storage.local.get([
      'feishuConfig',
      'feishuCredentials',
      'feishuSyncLimit',
      'feishuLastSyncTime',
      'exploreExcludeFromBlogSites',
      'blogCommentSiteThreshold'
    ]);

    const data = {
      version: '1.0.0',
      backupDate: new Date().toISOString(),
      sites,
      navSites,
      blogCommentSites,
      fieldMappings: elements.includeMappings.checked ? fieldMappings : {},
      blogCommentFieldMappings: elements.includeMappings.checked ? (await chrome.storage.local.get(['blogCommentFieldMappings'])).blogCommentFieldMappings || {} : {},
      settings,
      feishuConfig: feishuResult.feishuConfig || null,
      feishuCredentials: feishuResult.feishuCredentials || null,
      feishuSyncLimit: feishuResult.feishuSyncLimit ?? null,
      feishuLastSyncTime: feishuResult.feishuLastSyncTime || null,
      exploreExcludeFromBlogSites: feishuResult.exploreExcludeFromBlogSites,
      blogCommentSiteThreshold: feishuResult.blogCommentSiteThreshold
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
      const replacePayload = {
        sites: data.sites || [],
        navSites: data.navSites || [],
        blogCommentSites: data.blogCommentSites || [],
        fieldMappings: data.fieldMappings || {},
        blogCommentFieldMappings: data.blogCommentFieldMappings || {},
        settings: data.settings || {},
        submissionRecords: data.submissionRecords || {},
        blogCommentRecords: data.blogCommentRecords || {}
      };
      if (data.feishuConfig != null) replacePayload.feishuConfig = data.feishuConfig;
      if (data.feishuCredentials != null) replacePayload.feishuCredentials = data.feishuCredentials;
      if (data.feishuSyncLimit != null) replacePayload.feishuSyncLimit = data.feishuSyncLimit;
      if (data.feishuLastSyncTime != null) replacePayload.feishuLastSyncTime = data.feishuLastSyncTime;
      if (data.exploreExcludeFromBlogSites !== undefined) replacePayload.exploreExcludeFromBlogSites = data.exploreExcludeFromBlogSites;
      if (data.blogCommentSiteThreshold !== undefined) replacePayload.blogCommentSiteThreshold = data.blogCommentSiteThreshold;
      await chrome.storage.local.set(replacePayload);
    } else {
      // Merge data
      const existing = await chrome.storage.local.get(null);

      const mergedSites = mergeById(existing.sites || [], data.sites || []);
      const mergedNavSites = mergeById(existing.navSites || [], data.navSites || []);
      const mergedBlogSites = mergeById(existing.blogCommentSites || [], data.blogCommentSites || []);

      const mergePayload = {
        sites: mergedSites,
        navSites: mergedNavSites,
        blogCommentSites: mergedBlogSites,
        fieldMappings: { ...existing.fieldMappings, ...(data.fieldMappings || {}) },
        blogCommentFieldMappings: { ...existing.blogCommentFieldMappings, ...(data.blogCommentFieldMappings || {}) },
        submissionRecords: { ...existing.submissionRecords, ...(data.submissionRecords || {}) },
        blogCommentRecords: { ...existing.blogCommentRecords, ...(data.blogCommentRecords || {}) }
      };
      if (data.feishuConfig != null) mergePayload.feishuConfig = data.feishuConfig;
      if (data.feishuCredentials != null) mergePayload.feishuCredentials = data.feishuCredentials;
      if (data.feishuSyncLimit != null) mergePayload.feishuSyncLimit = data.feishuSyncLimit;
      if (data.feishuLastSyncTime != null) mergePayload.feishuLastSyncTime = data.feishuLastSyncTime;
      if (data.exploreExcludeFromBlogSites !== undefined) mergePayload.exploreExcludeFromBlogSites = data.exploreExcludeFromBlogSites;
      if (data.blogCommentSiteThreshold !== undefined) mergePayload.blogCommentSiteThreshold = data.blogCommentSiteThreshold;
      await chrome.storage.local.set(mergePayload);
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
      autoSubmit: (await chrome.storage.local.get(['settings'])).settings?.autoSubmit ?? false,
      capsolverApiKey: (elements.capsolverApiKey?.value || '').trim()
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
async function renderFeishuTab() {
  // Load feishu config from storage if not already loaded
  if (!feishuConfig) {
    feishuConfig = {};
  }

  // Fill in form fields
  if (elements.feishuAppId) {
    elements.feishuAppId.value = feishuConfig.appId || '';
  }
  if (elements.feishuAppSecret) {
    elements.feishuAppSecret.value = feishuConfig.appSecret || '';
  }
  if (elements.feishuAppToken) {
    elements.feishuAppToken.value = feishuConfig.appToken || '';
  }
  if (elements.feishuTableId) {
    elements.feishuTableId.value = feishuConfig.tableId || '';
  }
  if (elements.feishuSyncLimit) {
    elements.feishuSyncLimit.value = feishuConfig.syncLimit || '';
  }
  // 外链采集 - 遍历检测结果表格
  if (elements.feishuExploreSheetToken) {
    elements.feishuExploreSheetToken.value = feishuConfig.exploreSheetToken || '';
  }
  if (elements.feishuExploreSheetId) {
    elements.feishuExploreSheetId.value = feishuConfig.exploreSheetId || '';
  }
  const blogCommentThreshold = (await chrome.storage.local.get(['blogCommentSiteThreshold'])).blogCommentSiteThreshold;
  if (elements.blogCommentSiteThreshold) {
    elements.blogCommentSiteThreshold.value = typeof blogCommentThreshold === 'number' && blogCommentThreshold >= 0 ? String(blogCommentThreshold) : '3';
  }
  // 外链采集 - Ahrefs 反链表格
  if (elements.feishuAhrefsSheetToken) {
    elements.feishuAhrefsSheetToken.value = feishuConfig.ahrefsSheetToken || '';
  }
  if (elements.feishuAhrefsSheetId) {
    elements.feishuAhrefsSheetId.value = feishuConfig.ahrefsSheetId || '';
  }

  // Update sync status
  updateFeishuSyncStatus();

  // Update sheet links
  updateFeishuSheetLinks();
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
      // 批量提交 - 多维表格
      appToken: elements.feishuAppToken?.value?.trim() || '',
      tableId: elements.feishuTableId?.value?.trim() || '',
      syncLimit: parseInt(elements.feishuSyncLimit?.value) || 10,
      // 外链采集 - 遍历检测结果表格（普通电子表格）
      exploreSheetToken: elements.feishuExploreSheetToken?.value?.trim() || '',
      exploreSheetId: elements.feishuExploreSheetId?.value?.trim() || '',
      // 外链采集 - Ahrefs 反链表格（普通电子表格）
      ahrefsSheetToken: elements.feishuAhrefsSheetToken?.value?.trim() || '',
      ahrefsSheetId: elements.feishuAhrefsSheetId?.value?.trim() || '',
      // 其他
      lastSyncTime: feishuConfig?.lastSyncTime || null
    };

    const thRaw = parseInt(elements.blogCommentSiteThreshold?.value, 10);
    const blogCommentSiteThreshold = (typeof thRaw === 'number' && !isNaN(thRaw) && thRaw >= 0) ? thRaw : 3;
    await chrome.storage.local.set({ feishuConfig: newConfig, blogCommentSiteThreshold });
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

// ========== Cache Management Tab ==========

const WHOIS_CACHE_KEY = 'domain_whois_cache';
const BACKLINK_BATCHES_KEY = 'backlinkExplorationBatches';
const AHERFS_CACHE_KEY = 'ahrefs_domain_cache';

/**
 * Render Cache Management Tab
 */
async function renderCacheTab() {
  // Load WHOIS cache
  await renderWhoisCache();

  // Load Ahrefs cache
  await renderAhrefsCache();

  // Load backlink batches
  await renderBacklinkBatches();
}

/**
 * Render WHOIS cache list
 */
async function renderWhoisCache() {
  const whoisCacheList = document.getElementById('whoisCacheList');
  const whoisCacheCount = document.getElementById('whoisCacheCount');

  if (!whoisCacheList) return;

  try {
    const result = await chrome.storage.local.get([WHOIS_CACHE_KEY]);
    const cache = result[WHOIS_CACHE_KEY] || {};
    const entries = Object.entries(cache).filter(([_, v]) => v !== null);

    if (whoisCacheCount) {
      whoisCacheCount.textContent = `${entries.length} 个`;
    }

    if (entries.length === 0) {
      whoisCacheList.innerHTML = '<div class="empty-cache-hint">暂无缓存数据</div>';
      return;
    }

    // Sort by creation date (newest first)
    entries.sort((a, b) => (b[1] || '').localeCompare(a[1] || ''));

    whoisCacheList.innerHTML = entries.map(([domain, date]) => `
      <div class="cache-item">
        <div class="cache-item-main">
          <span class="cache-item-domain">${escapeHtml(domain)}</span>
          <span class="cache-item-date">${escapeHtml(date || '未知')}</span>
        </div>
      </div>
    `).join('');
  } catch (e) {
    whoisCacheList.innerHTML = '<div class="empty-cache-hint">加载失败</div>';
    console.error('[Cache] Failed to load WHOIS cache:', e);
  }
}

/**
 * Render Ahrefs cache list
 */
async function renderAhrefsCache() {
  const ahrefsCacheList = document.getElementById('ahrefsCacheList');
  const ahrefsCacheCount = document.getElementById('ahrefsCacheCount');

  if (!ahrefsCacheList) return;

  try {
    const result = await chrome.storage.local.get([AHERFS_CACHE_KEY]);
    const cache = result[AHERFS_CACHE_KEY] || {};
    const entries = Object.entries(cache);

    if (ahrefsCacheCount) {
      ahrefsCacheCount.textContent = `${entries.length} 个域名`;
    }

    if (entries.length === 0) {
      ahrefsCacheList.innerHTML = '<div class="empty-cache-hint">暂无缓存数据</div>';
      return;
    }

    // Sort by cached date (newest first)
    entries.sort((a, b) => (b[1].cachedAt || '').localeCompare(a[1].cachedAt || ''));

    ahrefsCacheList.innerHTML = entries.map(([domain, data]) => {
      const cachedAt = data.cachedAt || '未知';
      const urlCount = (data.urlFromList || []).length;
      const backlinkCount = (data.backlinks || []).length;
      const dr = data.overview?.domainRating || data.overview?.dr || '-';

      // 计算缓存是否过期
      const now = new Date();
      const cacheDate = data.cachedAt ? new Date(data.cachedAt) : null;
      const daysOld = cacheDate ? Math.floor((now - cacheDate) / (1000 * 60 * 60 * 24)) : -1;
      const isExpired = daysOld >= 15;
      const daysLabel = daysOld >= 0 ? `${daysOld} 天前` : '未知';

      return `
        <div class="cache-item ${isExpired ? 'cache-item-expired' : ''}">
          <div class="cache-item-main">
            <a href="https://${domain}" target="_blank" class="cache-item-domain">${escapeHtml(domain)}</a>
            <div class="cache-item-info">
              <span class="cache-item-date" title="缓存日期">${escapeHtml(cachedAt)}</span>
              <span class="cache-item-meta">${urlCount} 条反链</span>
              ${dr !== '-' ? `<span class="cache-item-dr" title="域名评分">DR: ${dr}</span>` : ''}
              <span class="cache-item-age ${isExpired ? 'expired' : ''}">${daysLabel}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    ahrefsCacheList.innerHTML = '<div class="empty-cache-hint">加载失败</div>';
    console.error('[Cache] Failed to load Ahrefs cache:', e);
  }
}

/**
 * Render backlink batches dropdown and details
 */
async function renderBacklinkBatches() {
  const batchSelect = document.getElementById('backlinkBatchSelect');
  const batchCount = document.getElementById('backlinkBatchCount');

  if (!batchSelect) return;

  try {
    const result = await chrome.storage.local.get([BACKLINK_BATCHES_KEY]);
    const batches = result[BACKLINK_BATCHES_KEY] || {};
    const batchList = Object.values(batches).sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    );

    if (batchCount) {
      batchCount.textContent = `${batchList.length} 个批次`;
    }

    // Populate dropdown
    const currentSelection = batchSelect.value;
    batchSelect.innerHTML = '<option value="">-- 请选择批次 --</option>' +
      batchList.map(batch => `
        <option value="${batch.batchId}">
          ${batch.batchId} (${(batch.urlList || []).length} URLs, ${batch.status || 'unknown'})
        </option>
      `).join('');

    // Restore selection if still valid
    if (currentSelection && batches[currentSelection]) {
      batchSelect.value = currentSelection;
    }

    // Load selected batch details
    await loadSelectedBatchDetails();
  } catch (e) {
    console.error('[Cache] Failed to load backlink batches:', e);
  }
}

/**
 * Load selected batch details
 */
async function loadSelectedBatchDetails() {
  const batchSelect = document.getElementById('backlinkBatchSelect');
  const filteredDomainList = document.getElementById('filteredDomainList');
  const filteredDomainCount = document.getElementById('filteredDomainCount');
  const backlinkDetailsList = document.getElementById('backlinkDetailsList');
  const backlinkDetailsCount = document.getElementById('backlinkDetailsCount');

  const selectedBatchId = batchSelect?.value;

  if (!selectedBatchId) {
    if (filteredDomainList) {
      filteredDomainList.innerHTML = '<div class="empty-cache-hint">请先选择批次</div>';
    }
    if (filteredDomainCount) {
      filteredDomainCount.textContent = '0 个域名';
    }
    if (backlinkDetailsList) {
      backlinkDetailsList.innerHTML = '<div class="empty-cache-hint">请先选择批次</div>';
    }
    if (backlinkDetailsCount) {
      backlinkDetailsCount.textContent = '0 条';
    }
    return;
  }

  try {
    const result = await chrome.storage.local.get([BACKLINK_BATCHES_KEY]);
    const batches = result[BACKLINK_BATCHES_KEY] || {};
    const batch = batches[selectedBatchId];

    if (!batch) {
      return;
    }

    // Render filtered domains (from Ahrefs domain list with creation dates)
    await renderFilteredDomains(batch);

    // Render backlink details
    renderBacklinkDetails(batch);

  } catch (e) {
    console.error('[Cache] Failed to load batch details:', e);
  }
}

/**
 * Render filtered domains with WHOIS dates
 */
async function renderFilteredDomains(batch) {
  const filteredDomainList = document.getElementById('filteredDomainList');
  const filteredDomainCount = document.getElementById('filteredDomainCount');

  if (!filteredDomainList) return;

  // Get WHOIS cache for domain dates
  const whoisResult = await chrome.storage.local.get([WHOIS_CACHE_KEY]);
  const whoisCache = whoisResult[WHOIS_CACHE_KEY] || {};

  // Get domains from batch's Ahrefs domain list (exploreAhrefsDomains in sidepanel)
  // These are stored in the batch's ahrefsDomains or we can extract from backlinkDetails
  const backlinkDetails = batch.backlinkDetails || [];
  const domainMap = new Map();

  // Extract unique domains from backlinks
  for (const bl of backlinkDetails) {
    const urlFrom = bl.urlFrom || '';
    try {
      const url = new URL(urlFrom.startsWith('http') ? urlFrom : 'https://' + urlFrom);
      const domain = url.hostname;
      if (domain && !domainMap.has(domain)) {
        domainMap.set(domain, {
          domain,
          creationDate: whoisCache[domain] || null
        });
      }
    } catch (e) {
      // Skip invalid URLs
    }
  }

  const domains = Array.from(domainMap.values());

  if (filteredDomainCount) {
    filteredDomainCount.textContent = `${domains.length} 个域名`;
  }

  if (domains.length === 0) {
    filteredDomainList.innerHTML = '<div class="empty-cache-hint">暂无域名数据</div>';
    return;
  }

  // Sort: with creation date first, then by domain name
  domains.sort((a, b) => {
    if (a.creationDate && !b.creationDate) return -1;
    if (!a.creationDate && b.creationDate) return 1;
    if (a.creationDate && b.creationDate) {
      return b.creationDate.localeCompare(a.creationDate);
    }
    return a.domain.localeCompare(b.domain);
  });

  filteredDomainList.innerHTML = domains.map(d => `
    <div class="cache-item">
      <div class="cache-item-main">
        <a href="https://${d.domain}" target="_blank" class="cache-item-domain">${escapeHtml(d.domain)}</a>
        <span class="cache-item-date ${d.creationDate ? '' : 'unknown'}">${escapeHtml(d.creationDate || '未知')}</span>
      </div>
    </div>
  `).join('');
}

/**
 * Render backlink details with site type indicators
 */
function renderBacklinkDetails(batch) {
  const backlinkDetailsList = document.getElementById('backlinkDetailsList');
  const backlinkDetailsCount = document.getElementById('backlinkDetailsCount');

  if (!backlinkDetailsList) return;

  const backlinks = batch.backlinkDetails || [];
  const urlProgress = batch.urlProgress || {};
  const discoveredSites = batch.discoveredSites || [];

  // Get query domains and fetch time
  const queryDomains = batch.sourceInput?.domains || [];
  const fetchTime = batch.createdAt || batch.updatedAt || '';

  // Format fetch time to yyyy-MM-dd HH:mm:ss
  const formatDateTime = (isoString) => {
    if (!isoString) return '未知';
    try {
      const date = new Date(isoString);
      const Y = date.getFullYear();
      const M = String(date.getMonth() + 1).padStart(2, '0');
      const D = String(date.getDate()).padStart(2, '0');
      const h = String(date.getHours()).padStart(2, '0');
      const m = String(date.getMinutes()).padStart(2, '0');
      const s = String(date.getSeconds()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    } catch {
      return '未知';
    }
  };

  // Create a set of discovered URLs for quick lookup
  const discoveredUrls = new Set(discoveredSites.map(s => {
    try {
      const url = s.url || s;
      return url.startsWith('http') ? url : 'https://' + url;
    } catch {
      return '';
    }
  }).filter(Boolean));

  if (backlinkDetailsCount) {
    backlinkDetailsCount.textContent = `${backlinks.length} 条`;
  }

  if (backlinks.length === 0) {
    backlinkDetailsList.innerHTML = '<div class="empty-cache-hint">暂无反链数据</div>';
    return;
  }

  // Sort by domain rating (if available) or by URL
  backlinks.sort((a, b) => {
    const drA = a.domainRating || a.dr || 0;
    const drB = b.domainRating || b.dr || 0;
    return drB - drA;
  });

  backlinkDetailsList.innerHTML = backlinks.map(bl => {
    const urlFrom = bl.urlFrom || '';
    let siteType = 'unknown';
    let siteTypeLabel = '未知';

    // Check if this URL is in discovered sites (commentable)
    const normalizedUrl = urlFrom.startsWith('http') ? urlFrom : 'https://' + urlFrom;
    if (discoveredUrls.has(normalizedUrl)) {
      siteType = 'commentable';
      siteTypeLabel = '可评论站';
    }

    // Check urlProgress for more info
    const progress = urlProgress[normalizedUrl] || urlProgress[urlFrom];
    if (progress) {
      if (progress.commentable) {
        siteType = 'commentable';
        siteTypeLabel = '可评论站';
      } else if (progress.error) {
        siteType = 'error';
        siteTypeLabel = '检测失败';
      }
    }

    const domainRating = bl.domainRating || bl.dr || '-';
    const anchorText = bl.anchor || bl.anchorText || '';

    return `
      <div class="cache-item cache-item-backlink">
        <div class="cache-item-main">
          <a href="${escapeHtml(normalizedUrl)}" target="_blank" class="cache-item-url">${escapeHtml(urlFrom)}</a>
          <div class="cache-item-info">
            <span class="cache-item-type ${siteType}">${siteTypeLabel}</span>
            ${domainRating !== '-' ? `<span class="cache-item-dr" title="域名评分">DR: ${domainRating}</span>` : ''}
          </div>
        </div>
        <div class="cache-item-meta-row">
          <span class="cache-item-meta" title="查询域名">查询: ${escapeHtml(queryDomains.join(', ') || '未知')}</span>
          <span class="cache-item-meta" title="爬取时间">${formatDateTime(fetchTime)}</span>
        </div>
        ${anchorText ? `<div class="cache-item-anchor" title="锚文本">${escapeHtml(anchorText.substring(0, 50))}${anchorText.length > 50 ? '...' : ''}</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Clear WHOIS cache
 */
async function clearWhoisCache() {
  if (!confirm('确定要清除所有 WHOIS 缓存吗？')) return;

  try {
    await chrome.storage.local.remove([WHOIS_CACHE_KEY]);
    await renderWhoisCache();
    showToast('WHOIS 缓存已清除', 'success');
  } catch (e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}

/**
 * Clear Ahrefs cache
 */
async function clearAhrefsCache() {
  if (!confirm('确定要清除所有 Ahrefs 域名缓存吗？')) return;

  try {
    await chrome.storage.local.remove([AHERFS_CACHE_KEY]);
    await renderAhrefsCache();
    showToast('Ahrefs 缓存已清除', 'success');
  } catch (e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}

/**
 * Clear all backlink batches
 */
async function clearBacklinkBatches() {
  if (!confirm('确定要清除所有反链批次数据吗？此操作不可恢复。')) return;

  try {
    await chrome.storage.local.remove([BACKLINK_BATCHES_KEY]);
    await renderBacklinkBatches();
    showToast('所有批次已清除', 'success');
  } catch (e) {
    showToast('清除失败: ' + e.message, 'error');
  }
}

/**
 * Setup cache tab event listeners
 */
function setupCacheTabListeners() {
  // Refresh button
  const refreshBtn = document.getElementById('refreshCacheBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', renderCacheTab);
  }

  // Batch selector
  const batchSelect = document.getElementById('backlinkBatchSelect');
  if (batchSelect) {
    batchSelect.addEventListener('change', loadSelectedBatchDetails);
  }

  // Clear WHOIS cache button
  const clearWhoisBtn = document.getElementById('clearWhoisCacheBtn');
  if (clearWhoisBtn) {
    clearWhoisBtn.addEventListener('click', clearWhoisCache);
  }

  // Clear Ahrefs cache button
  const clearAhrefsBtn = document.getElementById('clearAhrefsCacheBtn');
  if (clearAhrefsBtn) {
    clearAhrefsBtn.addEventListener('click', clearAhrefsCache);
  }

  // Clear backlink batches button
  const clearBatchesBtn = document.getElementById('clearBacklinkBatchesBtn');
  if (clearBatchesBtn) {
    clearBatchesBtn.addEventListener('click', clearBacklinkBatches);
  }

  // Feishu sheet input change listeners
  const feishuSheetInputs = [
    'feishuExploreSheetToken',
    'feishuExploreSheetId',
    'feishuAhrefsSheetToken',
    'feishuAhrefsSheetId'
  ];
  feishuSheetInputs.forEach(id => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', updateFeishuSheetLinks);
    }
  });
}

/**
 * Update Feishu sheet links based on current config values
 */
function updateFeishuSheetLinks() {
  const exploreToken = document.getElementById('feishuExploreSheetToken')?.value?.trim() || feishuConfig?.exploreSheetToken || '';
  const exploreSheetId = document.getElementById('feishuExploreSheetId')?.value?.trim() || feishuConfig?.exploreSheetId || '';
  const ahrefsToken = document.getElementById('feishuAhrefsSheetToken')?.value?.trim() || feishuConfig?.ahrefsSheetToken || '';
  const ahrefsSheetId = document.getElementById('feishuAhrefsSheetId')?.value?.trim() || feishuConfig?.ahrefsSheetId || '';

  // Update explore sheet link
  const exploreLinkBtn = document.getElementById('openExploreSheetLink');
  if (exploreLinkBtn) {
    if (exploreToken && exploreSheetId) {
      exploreLinkBtn.href = `https://feishu.cn/sheets/${exploreToken}?sheet=${exploreSheetId}`;
      exploreLinkBtn.classList.remove('disabled');
      exploreLinkBtn.removeAttribute('aria-disabled');
    } else {
      exploreLinkBtn.href = '#';
      exploreLinkBtn.classList.add('disabled');
      exploreLinkBtn.setAttribute('aria-disabled', 'true');
    }
  }

  // Update Ahrefs sheet link
  const ahrefsLinkBtn = document.getElementById('openAhrefsSheetLink');
  if (ahrefsLinkBtn) {
    if (ahrefsToken && ahrefsSheetId) {
      ahrefsLinkBtn.href = `https://feishu.cn/sheets/${ahrefsToken}?sheet=${ahrefsSheetId}`;
      ahrefsLinkBtn.classList.remove('disabled');
      ahrefsLinkBtn.removeAttribute('aria-disabled');
    } else {
      ahrefsLinkBtn.href = '#';
      ahrefsLinkBtn.classList.add('disabled');
      ahrefsLinkBtn.setAttribute('aria-disabled', 'true');
    }
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

/**
 * Options Page Script
 * Main logic for the settings/management page
 */

// State
let currentTab = 'sites';
let sites = [];
let navSites = [];
let fieldMappings = {};
let settings = {};
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
  elements.llmModel = document.getElementById('llmModel');
  elements.testLlmBtn = document.getElementById('testLlmBtn');
  elements.autoSubmit = document.getElementById('autoSubmit');
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
  elements.testLlmBtn?.addEventListener('click', testLlmConnection);
  elements.saveSettingsBtn?.addEventListener('click', saveSettings);

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
  fieldMappings = result.fieldMappings || {};
  settings = result.settings || {
    llmConfig: { enabled: false, endpoint: '', apiKey: '', model: '' },
    autoSubmit: false
  };

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
    case 'mappings':
      renderMappingsTab();
      break;
    case 'backup':
      // Backup tab is mostly static
      break;
    case 'settings':
      renderSettingsTab();
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
  elements.llmProvider.value = getProviderFromEndpoint(llmConfig.endpoint);
  elements.llmEndpoint.value = llmConfig.endpoint || '';
  elements.llmApiKey.value = llmConfig.apiKey || '';
  elements.llmModel.value = llmConfig.model || '';

  // Auto submit
  elements.autoSubmit.checked = settings.autoSubmit || false;
}

/**
 * Get provider from endpoint
 */
function getProviderFromEndpoint(endpoint) {
  if (!endpoint) return 'openai';

  if (endpoint.includes('openai.com')) return 'openai';
  if (endpoint.includes('bigmodel.cn')) return 'glm';
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
      fieldMappings: elements.includeMappings.checked ? fieldMappings : {},
      settings
    };

    if (elements.includeRecords.checked) {
      const result = await chrome.storage.local.get(['submissionRecords']);
      data.submissionRecords = result.submissionRecords || {};
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
        fieldMappings: data.fieldMappings || {},
        settings: data.settings || {},
        submissionRecords: data.submissionRecords || {}
      });
    } else {
      // Merge data
      const existing = await chrome.storage.local.get(null);

      const mergedSites = mergeById(existing.sites || [], data.sites || []);
      const mergedNavSites = mergeById(existing.navSites || [], data.navSites || []);

      await chrome.storage.local.set({
        sites: mergedSites,
        navSites: mergedNavSites,
        fieldMappings: { ...existing.fieldMappings, ...data.fieldMappings },
        submissionRecords: { ...existing.submissionRecords, ...data.submissionRecords }
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
 * LLM provider change
 */
function onLlmProviderChange(e) {
  const provider = e.target.value;
  const endpoints = {
    openai: 'https://api.openai.com/v1/chat/completions',
    glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    groq: 'https://api.groq.com/openai/v1/chat/completions',
    custom: ''
  };

  if (provider !== 'custom' && !elements.llmEndpoint.value) {
    elements.llmEndpoint.value = endpoints[provider];
  }
}

/**
 * Test LLM connection
 */
async function testLlmConnection() {
  const endpoint = elements.llmEndpoint.value.trim();
  const apiKey = elements.llmApiKey.value.trim();
  const model = elements.llmModel.value.trim() || 'gpt-3.5-turbo';

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
        model: elements.llmModel.value.trim()
      },
      autoSubmit: elements.autoSubmit.checked
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

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

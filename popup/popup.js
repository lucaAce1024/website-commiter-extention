/**
 * Popup Script - Main logic for the extension popup
 */

// DOM elements
const elements = {
  siteSelect: document.getElementById('siteSelect'),
  manageSitesBtn: document.getElementById('manageSitesBtn'),
  addSiteLink: document.getElementById('addSiteLink'),
  noSitesHint: document.getElementById('noSitesHint'),
  pageDomain: document.getElementById('pageDomain'),
  recognitionStatus: document.getElementById('recognitionStatus'),
  fieldCount: document.getElementById('fieldCount'),
  formStatus: document.getElementById('formStatus'),
  noFormHint: document.getElementById('noFormHint'),
  fillFormBtn: document.getElementById('fillFormBtn'),
  recognizeBtn: document.getElementById('recognizeBtn'),
  openNavSitesBtn: document.getElementById('openNavSitesBtn'),
  openOptionsBtn: document.getElementById('openOptionsBtn'),
  statusMessage: document.getElementById('statusMessage'),
  statusText: document.getElementById('statusText'),
  closeStatusBtn: document.getElementById('closeStatusBtn')
};

// State
let currentTab = null;
let pageState = null;
let sites = [];
let currentSiteId = null;

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

  // Display page domain
  const url = new URL(currentTab.url);
  elements.pageDomain.textContent = url.hostname;

  // Load sites
  await loadSites();

  // Get page state from content script
  await getPageState();

  // Setup event listeners
  setupEventListeners();
}

/**
 * Load sites from storage
 */
async function loadSites() {
  try {
    const result = await chrome.storage.local.get(['sites', 'settings']);
    sites = result.sites || [];
    currentSiteId = result.settings?.currentSiteId;

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
  } catch (error) {
    console.error('[Popup] Failed to load sites:', error);
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
    showNoForm();
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

  // Field count
  if (pageState.fieldMappings) {
    elements.fieldCount.textContent = pageState.fieldMappings.length + ' 个字段';
    elements.fillFormBtn.disabled = !currentSiteId || pageState.fieldMappings.length === 0;
  } else {
    elements.fieldCount.textContent = '-';
    elements.fillFormBtn.disabled = true;
  }

  // If has form but not recognized
  if (pageState.hasForm && !pageState.fieldMappings) {
    elements.recognitionStatus.textContent = '待识别';
    elements.fillFormBtn.disabled = true;
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
    elements.fillFormBtn.disabled = true;
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

  // Fill form button
  elements.fillFormBtn.addEventListener('click', async () => {
    if (!currentSiteId) {
      showWarning('请先选择一个站点');
      return;
    }

    elements.fillFormBtn.disabled = true;
    elements.fillFormBtn.innerHTML = '<span class="btn-icon">⏳</span> 填充中...';

    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'fillForm',
        siteId: currentSiteId
      });

      if (response.success) {
        const result = response.result;
        let message = `已填充 ${result.filledCount} 个字段`;

        if (result.hasCaptcha) {
          message += '\n\n检测到验证码，请手动完成验证后提交。';
        }

        if (result.errors && result.errors.length > 0) {
          message += `\n\n部分字段填充失败:\n${result.errors.join('\n')}`;
        }

        showSuccess(message);
      } else {
        showError(response.error || '填充失败');
      }
    } catch (error) {
      console.error('[Popup] Fill form error:', error);
      showError('填充失败: ' + error.message);
    } finally {
      elements.fillFormBtn.disabled = false;
      elements.fillFormBtn.innerHTML = '<span class="btn-icon">✏️</span> 自动填充当前页面';
    }
  });

  // Recognize button
  elements.recognizeBtn.addEventListener('click', async () => {
    elements.recognizeBtn.disabled = true;
    elements.recognizeBtn.innerHTML = '<span class="btn-icon">⏳</span> 识别中...';

    try {
      const response = await chrome.tabs.sendMessage(currentTab.id, {
        action: 'recognizeForm',
        useLlm: false
      });

      if (response.success) {
        pageState = {
          hasForm: true,
          fieldMappings: response.result.mappings,
          recognitionStatus: 'done',
          recognitionMethod: response.result.method,
          domain: pageState?.domain || new URL(currentTab.url).hostname
        };
        updateFormStatus();
        showSuccess(`识别成功，找到 ${response.result.fieldCount} 个可填字段`);
      } else {
        showError(response.error || '识别失败');
      }
    } catch (error) {
      console.error('[Popup] Recognize error:', error);
      showError('识别失败: ' + error.message);
    } finally {
      elements.recognizeBtn.disabled = false;
      elements.recognizeBtn.innerHTML = '<span class="btn-icon">🔍</span> 重新识别';
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

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

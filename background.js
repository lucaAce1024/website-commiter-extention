// Background service worker for Navigation Site Auto Submitter
// Handles extension lifecycle and cross-tab communication

const FILL_FIELD_MENU_ID = 'nav-submitter-fill-single';
const FILL_FIELD_ITEMS = [
  { id: 'siteUrl', title: '网站 URL' },
  { id: 'siteName', title: '网站名称' },
  { id: 'email', title: '联系邮箱' },
  { id: 'category', title: '分类 (Categories)' },
  { id: 'tags', title: '标签 (Tags)' },
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
      sites: [],              // Site profiles
      navSites: [],           // Navigation sites list
      fieldMappings: {},      // Cached field mappings by domain
      submissionRecords: {},  // Submission records: { siteId_navSiteId: { ... } }
      settings: {
        currentSiteId: null,  // Currently selected site
        llmConfig: {
          enabled: false,
          endpoint: '',
          apiKey: '',
          model: 'gpt-3.5-turbo'
        },
        autoSubmit: false     // Global auto-submit toggle
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

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillForm') {
    // Forward to content script if needed
    sendResponse({ success: true });
  } else if (request.action === 'getStorageData') {
    chrome.storage.local.get(null, (data) => {
      sendResponse({ success: true, data });
    });
    return true; // Keep message channel open for async response
  }
});

// Handle extension icon click (already handled by popup)
// chrome.action.onClicked.addListener((tab) => { ... });

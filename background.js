// Background service worker for Navigation Site Auto Submitter
// Handles extension lifecycle and cross-tab communication

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

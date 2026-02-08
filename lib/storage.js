/**
 * Storage Service - Wrapper for chrome.storage.local
 * Provides typed APIs for all data operations
 */

// Standard field names used across the extension
export const STANDARD_FIELDS = {
  SITE_NAME: 'siteName',
  EMAIL: 'email',
  SITE_URL: 'siteUrl',
  CATEGORY: 'category',
  TAGLINE: 'tagline',
  SHORT_DESCRIPTION: 'shortDescription',
  LONG_DESCRIPTION: 'longDescription',
  LOGO: 'logo',
  SCREENSHOT: 'screenshot'
};

// Storage keys
const STORAGE_KEYS = {
  SITES: 'sites',
  NAV_SITES: 'navSites',
  FIELD_MAPPINGS: 'fieldMappings',
  SUBMISSION_RECORDS: 'submissionRecords',
  SETTINGS: 'settings'
};

/**
 * Generic get operation
 */
async function get(keys = null) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

/**
 * Generic set operation
 */
async function set(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, () => {
      resolve();
    });
  });
}

/**
 * Generic remove operation
 */
async function remove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => {
      resolve();
    });
  });
}

/**
 * Clear all storage
 */
async function clear() {
  return new Promise((resolve) => {
    chrome.storage.local.clear(() => {
      resolve();
    });
  });
}

// ============ Site Profiles Management ============

/**
 * Get all site profiles
 */
async function getAllSites() {
  const data = await get(STORAGE_KEYS.SITES);
  return data[STORAGE_KEYS.SITES] || [];
}

/**
 * Get a site by ID
 */
async function getSiteById(siteId) {
  const sites = await getAllSites();
  return sites.find(s => s.id === siteId) || null;
}

/**
 * Get current selected site
 */
async function getCurrentSite() {
  const settings = await getSettings();
  if (!settings.currentSiteId) return null;
  return getSiteById(settings.currentSiteId);
}

/**
 * Add a new site profile
 */
async function addSite(siteData) {
  const sites = await getAllSites();
  const newSite = {
    id: 'site_' + Date.now(),
    createdAt: new Date().toISOString(),
    ...siteData
  };
  sites.push(newSite);
  await set({ [STORAGE_KEYS.SITES]: sites });
  return newSite;
}

/**
 * Update a site profile
 */
async function updateSite(siteId, updates) {
  const sites = await getAllSites();
  const index = sites.findIndex(s => s.id === siteId);
  if (index === -1) throw new Error('Site not found');

  sites[index] = {
    ...sites[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  await set({ [STORAGE_KEYS.SITES]: sites });
  return sites[index];
}

/**
 * Delete a site profile
 */
async function deleteSite(siteId) {
  const sites = await getAllSites();
  const filtered = sites.filter(s => s.id !== siteId);
  await set({ [STORAGE_KEYS.SITES]: filtered });

  // Update current site if deleted
  const settings = await getSettings();
  if (settings.currentSiteId === siteId) {
    await updateSettings({ currentSiteId: null });
  }
}

/**
 * Set current site
 */
async function setCurrentSite(siteId) {
  await updateSettings({ currentSiteId: siteId });
}

// ============ Navigation Sites Management ============

/**
 * Get all navigation sites
 */
async function getAllNavSites() {
  const data = await get(STORAGE_KEYS.NAV_SITES);
  return data[STORAGE_KEYS.NAV_SITES] || [];
}

/**
 * Add a navigation site
 */
async function addNavSite(navSiteData) {
  const navSites = await getAllNavSites();
  const newNavSite = {
    id: 'nav_' + Date.now(),
    createdAt: new Date().toISOString(),
    ...navSiteData
  };
  navSites.push(newNavSite);
  await set({ [STORAGE_KEYS.NAV_SITES]: navSites });
  return newNavSite;
}

/**
 * Update a navigation site
 */
async function updateNavSite(navSiteId, updates) {
  const navSites = await getAllNavSites();
  const index = navSites.findIndex(ns => ns.id === navSiteId);
  if (index === -1) throw new Error('Navigation site not found');

  navSites[index] = {
    ...navSites[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  await set({ [STORAGE_KEYS.NAV_SITES]: navSites });
  return navSites[index];
}

/**
 * Delete a navigation site
 */
async function deleteNavSite(navSiteId) {
  const navSites = await getAllNavSites();
  const filtered = navSites.filter(ns => ns.id !== navSiteId);
  await set({ [STORAGE_KEYS.NAV_SITES]: filtered });
}

// ============ Field Mappings Cache ============

/**
 * Get field mapping for a domain
 */
async function getFieldMapping(domain) {
  const data = await get(STORAGE_KEYS.FIELD_MAPPINGS);
  return data[STORAGE_KEYS.FIELD_MAPPINGS]?.[domain] || null;
}

/**
 * Save field mapping for a domain
 */
async function saveFieldMapping(domain, mapping) {
  const data = await get(STORAGE_KEYS.FIELD_MAPPINGS);
  const mappings = data[STORAGE_KEYS.FIELD_MAPPINGS] || {};
  mappings[domain] = {
    ...mapping,
    cachedAt: new Date().toISOString()
  };
  await set({ [STORAGE_KEYS.FIELD_MAPPINGS]: mappings });
}

/**
 * Clear field mapping for a domain
 */
async function clearFieldMapping(domain) {
  const data = await get(STORAGE_KEYS.FIELD_MAPPINGS);
  const mappings = data[STORAGE_KEYS.FIELD_MAPPINGS] || {};
  delete mappings[domain];
  await set({ [STORAGE_KEYS.FIELD_MAPPINGS]: mappings });
}

/**
 * Get all field mappings
 */
async function getAllFieldMappings() {
  const data = await get(STORAGE_KEYS.FIELD_MAPPINGS);
  return data[STORAGE_KEYS.FIELD_MAPPINGS] || {};
}

// ============ Submission Records ============

/**
 * Get submission record for a site + nav site pair
 */
async function getSubmissionRecord(siteId, navSiteId) {
  const data = await get(STORAGE_KEYS.SUBMISSION_RECORDS);
  const key = `${siteId}_${navSiteId}`;
  return data[STORAGE_KEYS.SUBMISSION_RECORDS]?.[key] || null;
}

/**
 * Get all submission records for a site
 */
async function getSubmissionRecordsForSite(siteId) {
  const data = await get(STORAGE_KEYS.SUBMISSION_RECORDS);
  const records = data[STORAGE_KEYS.SUBMISSION_RECORDS] || {};
  return Object.entries(records)
    .filter(([key]) => key.startsWith(siteId + '_'))
    .map(([key, record]) => ({ key, ...record }));
}

/**
 * Create or update submission record
 */
async function upsertSubmissionRecord(siteId, navSiteId, recordData) {
  const data = await get(STORAGE_KEYS.SUBMISSION_RECORDS);
  const records = data[STORAGE_KEYS.SUBMISSION_RECORDS] || {};
  const key = `${siteId}_${navSiteId}`;

  records[key] = {
    ...records[key],
    ...recordData,
    updatedAt: new Date().toISOString()
  };

  if (!records[key].createdAt) {
    records[key].createdAt = new Date().toISOString();
  }

  await set({ [STORAGE_KEYS.SUBMISSION_RECORDS]: records });
  return records[key];
}

// ============ Settings ============

/**
 * Get all settings
 */
async function getSettings() {
  const data = await get(STORAGE_KEYS.SETTINGS);
  return data[STORAGE_KEYS.SETTINGS] || {
    currentSiteId: null,
    llmConfig: {
      enabled: false,
      endpoint: '',
      apiKey: '',
      model: 'gpt-3.5-turbo'
    },
    autoSubmit: false
  };
}

/**
 * Update settings
 */
async function updateSettings(updates) {
  const current = await getSettings();
  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  await set({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

// ============ Export / Import ============

/**
 * Export all data as JSON object
 */
async function exportAllData() {
  const data = await get(null);
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    data
  };
}

/**
 * Import data from JSON object (merge or replace)
 */
async function importData(importData, mode = 'merge') {
  if (mode === 'replace') {
    await clear();
    await set(importData.data);
  } else {
    // Merge mode: merge arrays, replace objects
    const current = await get(null);

    const merged = {
      // Arrays: merge with deduplication by id
      sites: mergeById(current.sites || [], importData.data.sites || []),
      navSites: mergeById(current.navSites || [], importData.data.navSites || []),
      // Objects: deep merge
      fieldMappings: { ...current.fieldMappings, ...importData.data.fieldMappings },
      submissionRecords: { ...current.submissionRecords, ...importData.data.submissionRecords },
      settings: { ...current.settings, ...importData.data.settings }
    };

    await set(merged);
  }
}

/**
 * Helper: Merge arrays by id
 */
function mergeById(existing, incoming) {
  const map = new Map();

  // Add existing items
  existing.forEach(item => map.set(item.id, item));

  // Override/add incoming items
  incoming.forEach(item => map.set(item.id, item));

  return Array.from(map.values());
}

// Export all functions
export default {
  // Generic
  get,
  set,
  remove,
  clear,

  // Site profiles
  getAllSites,
  getSiteById,
  getCurrentSite,
  addSite,
  updateSite,
  deleteSite,
  setCurrentSite,

  // Navigation sites
  getAllNavSites,
  addNavSite,
  updateNavSite,
  deleteNavSite,

  // Field mappings
  getFieldMapping,
  saveFieldMapping,
  clearFieldMapping,
  getAllFieldMappings,

  // Submission records
  getSubmissionRecord,
  getSubmissionRecordsForSite,
  upsertSubmissionRecord,

  // Settings
  getSettings,
  updateSettings,

  // Export/Import
  exportAllData,
  importData,

  // Constants
  STANDARD_FIELDS,
  STORAGE_KEYS
};

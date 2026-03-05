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
  PRICING: 'pricing',
  TAGLINE: 'tagline',
  SHORT_DESCRIPTION: 'shortDescription',
  LONG_DESCRIPTION: 'longDescription',
  LOGO: 'logo',
  SCREENSHOT: 'screenshot'
};

// Blog 评论专用标准字段（与导航站区分）
export const BLOG_COMMENT_FIELDS = {
  COMMENT: 'comment',
  COMMENT_NAME: 'commentName',
  COMMENT_EMAIL: 'commentEmail',
  COMMENT_WEBSITE: 'commentWebsite'
};

// Storage keys
const STORAGE_KEYS = {
  SITES: 'sites',
  NAV_SITES: 'navSites',
  FIELD_MAPPINGS: 'fieldMappings',
  SUBMISSION_RECORDS: 'submissionRecords',
  SETTINGS: 'settings',
  BLOG_COMMENT_SITES: 'blogCommentSites',
  BLOG_COMMENT_FIELD_MAPPINGS: 'blogCommentFieldMappings',
  BLOG_COMMENT_RECORDS: 'blogCommentRecords'
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

// ============ Blog Comment Sites ============

/**
 * Get all blog comment sites (target URLs for comment submission)
 */
async function getAllBlogCommentSites() {
  const data = await get(STORAGE_KEYS.BLOG_COMMENT_SITES);
  return data[STORAGE_KEYS.BLOG_COMMENT_SITES] || [];
}

/**
 * Add a blog comment site
 */
async function addBlogCommentSite(item) {
  const list = await getAllBlogCommentSites();
  const newItem = {
    id: 'blog_' + Date.now(),
    name: item.name || '',
    url: item.url || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  list.push(newItem);
  await set({ [STORAGE_KEYS.BLOG_COMMENT_SITES]: list });
  return newItem;
}

/**
 * Update a blog comment site
 */
async function updateBlogCommentSite(id, updates) {
  const list = await getAllBlogCommentSites();
  const index = list.findIndex((x) => x.id === id);
  if (index === -1) throw new Error('Blog comment site not found');
  list[index] = {
    ...list[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  await set({ [STORAGE_KEYS.BLOG_COMMENT_SITES]: list });
  return list[index];
}

/**
 * Delete a blog comment site
 */
async function deleteBlogCommentSite(id) {
  const list = await getAllBlogCommentSites();
  const filtered = list.filter((x) => x.id !== id);
  await set({ [STORAGE_KEYS.BLOG_COMMENT_SITES]: filtered });
}

// ============ Blog Comment Field Mappings Cache ============

/**
 * Get blog comment field mapping for a domain (key: blog_${domain} or blog_${domain+path})
 * Returns { mappings: Array, submitButton?: Object, cachedAt?: string } or null
 */
async function getBlogCommentFieldMapping(cacheKey) {
  const data = await get(STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS);
  const mappings = data[STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS] || {};
  const entry = mappings[cacheKey];
  if (!entry) return null;
  if (Array.isArray(entry)) return { mappings: entry };
  return { mappings: entry.mappings || [], submitButton: entry.submitButton, cachedAt: entry.cachedAt };
}

/**
 * Save blog comment field mapping for a cache key
 */
async function saveBlogCommentFieldMapping(cacheKey, mapping) {
  const data = await get(STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS);
  const mappings = data[STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS] || {};
  mappings[cacheKey] = {
    mappings: mapping.mappings || mapping,
    submitButton: mapping.submitButton,
    cachedAt: new Date().toISOString()
  };
  await set({ [STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS]: mappings });
}

/**
 * Clear blog comment field mapping for a cache key
 */
async function clearBlogCommentFieldMapping(cacheKey) {
  const data = await get(STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS);
  const mappings = data[STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS] || {};
  delete mappings[cacheKey];
  await set({ [STORAGE_KEYS.BLOG_COMMENT_FIELD_MAPPINGS]: mappings });
}

// ============ Blog Comment Records (optional) ============

/**
 * Get blog comment records for a site (optional, for stats)
 */
async function getBlogCommentRecords(siteId) {
  const data = await get(STORAGE_KEYS.BLOG_COMMENT_RECORDS);
  const records = data[STORAGE_KEYS.BLOG_COMMENT_RECORDS] || {};
  return Object.entries(records)
    .filter(([key]) => key.startsWith(siteId + '_'))
    .map(([, record]) => record);
}

/**
 * Upsert a blog comment submission record
 */
async function upsertBlogCommentRecord(siteId, targetUrl, recordData) {
  const data = await get(STORAGE_KEYS.BLOG_COMMENT_RECORDS);
  const records = data[STORAGE_KEYS.BLOG_COMMENT_RECORDS] || {};
  const key = `${siteId}_${targetUrl}`;
  records[key] = {
    ...records[key],
    ...recordData,
    siteId,
    targetUrl,
    updatedAt: new Date().toISOString()
  };
  if (!records[key].createdAt) records[key].createdAt = new Date().toISOString();
  await set({ [STORAGE_KEYS.BLOG_COMMENT_RECORDS]: records });
  return records[key];
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
      sites: mergeById(current.sites || [], importData.data.sites || []),
      navSites: mergeById(current.navSites || [], importData.data.navSites || []),
      blogCommentSites: mergeById(current.blogCommentSites || [], importData.data.blogCommentSites || []),
      fieldMappings: { ...current.fieldMappings, ...importData.data.fieldMappings },
      blogCommentFieldMappings: { ...current.blogCommentFieldMappings, ...importData.data.blogCommentFieldMappings },
      submissionRecords: { ...current.submissionRecords, ...importData.data.submissionRecords },
      blogCommentRecords: { ...current.blogCommentRecords, ...importData.data.blogCommentRecords },
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

  // Blog comment
  getAllBlogCommentSites,
  addBlogCommentSite,
  updateBlogCommentSite,
  deleteBlogCommentSite,
  getBlogCommentFieldMapping,
  saveBlogCommentFieldMapping,
  clearBlogCommentFieldMapping,
  getBlogCommentRecords,
  upsertBlogCommentRecord,

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
  BLOG_COMMENT_FIELDS,
  STORAGE_KEYS
};

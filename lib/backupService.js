/**
 * Backup Service - Export and import extension data
 * Handles backup creation, restoration, and file operations
 */

import storage from './storage.js';

const BACKUP_VERSION = '1.0.0';
const BACKUP_FILE_PREFIX = 'nav-submitter-backup';

/**
 * Create a backup of all extension data
 * Returns a JSON string representing the complete backup
 */
export async function createBackup(options = {}) {
  const {
    includeRecords = true,    // Include submission records
    includeMappings = true,    // Include cached field mappings
    compress = false          // Future: support compression
  } = options;

  // Export all data from storage
  const allData = await storage.get(null);

  // Filter data based on options
  const backupData = {
    version: BACKUP_VERSION,
    backupDate: new Date().toISOString(),
    options: {
      includeRecords,
      includeMappings
    },
    data: {}
  };

  // Always include sites and navSites
  backupData.data.sites = allData.sites || [];
  backupData.data.navSites = allData.navSites || [];

  // Always include settings (but sensitive data handling)
  backupData.data.settings = allData.settings || {};

  // Optional: submission records
  if (includeRecords) {
    backupData.data.submissionRecords = allData.submissionRecords || {};
  }

  // Optional: field mappings
  if (includeMappings) {
    backupData.data.fieldMappings = allData.fieldMappings || {};
  }

  return backupData;
}

/**
 * Download backup as JSON file
 */
export function downloadBackup(backupData, filename = null) {
  const json = JSON.stringify(backupData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Generate filename if not provided
  if (!filename) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    filename = `${BACKUP_FILE_PREFIX}-${date}.json`;
  }

  // Create download link and trigger download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Read backup file
 */
export function readBackupFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        validateBackupData(data);
        resolve(data);
      } catch (error) {
        reject(new Error(`Invalid backup file: ${error.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read backup file'));
    };

    reader.readAsText(file);
  });
}

/**
 * Validate backup data structure
 */
function validateBackupData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Backup data must be an object');
  }

  if (!data.version) {
    throw new Error('Backup version is missing');
  }

  if (!data.data || typeof data.data !== 'object') {
    throw new Error('Backup data.content is missing or invalid');
  }

  // Validate version compatibility
  const [major] = data.version.split('.');
  const [currentMajor] = BACKUP_VERSION.split('.');

  if (major !== currentMajor) {
    console.warn(`[BackupService] Version mismatch: backup v${data.version}, current v${BACKUP_VERSION}`);
  }
}

/**
 * Restore from backup (replace mode)
 * Replaces all existing data with backup data
 */
export async function restoreBackupReplace(backupData) {
  validateBackupData(backupData);

  // Clear existing data
  await storage.clear();

  // Restore all data from backup
  await storage.set(backupData.data);

  // Return summary
  return {
    mode: 'replace',
    sitesRestored: backupData.data.sites?.length || 0,
    navSitesRestored: backupData.data.navSites?.length || 0,
    recordsRestored: Object.keys(backupData.data.submissionRecords || {}).length,
    mappingsRestored: Object.keys(backupData.data.fieldMappings || {}).length
  };
}

/**
 * Restore from backup (merge mode)
 * Merges backup data with existing data
 */
export async function restoreBackupMerge(backupData, options = {}) {
  validateBackupData(backupData);

  const {
    mergeStrategy = 'backup',  // 'backup' (backup wins) or 'existing' (keep existing)
    confirmMerge = false       // Show confirmation dialog for conflicts
  } = options;

  const summary = {
    mode: 'merge',
    mergeStrategy,
    sitesAdded: 0,
    sitesUpdated: 0,
    navSitesAdded: 0,
    navSitesUpdated: 0,
    conflictsResolved: 0
  };

  // Get existing data
  const existingData = await storage.get(null);

  // Merge sites
  if (backupData.data.sites) {
    const existingSites = existingData.sites || [];
    const existingMap = new Map(existingSites.map(s => [s.id, s]));

    for (const site of backupData.data.sites) {
      if (existingMap.has(site.id)) {
        // Conflict - exists in both
        if (mergeStrategy === 'backup') {
          const existing = existingMap.get(site.id);
          // Keep backup version but preserve createdAt
          site.createdAt = existing.createdAt;
          site.updatedAt = new Date().toISOString();
          summary.sitesUpdated++;
          summary.conflictsResolved++;
        } else {
          // Keep existing
          summary.conflictsResolved++;
          continue;
        }
      } else {
        summary.sitesAdded++;
      }
    }
  }

  // Merge navigation sites
  if (backupData.data.navSites) {
    const existingNavSites = existingData.navSites || [];
    const existingMap = new Map(existingNavSites.map(ns => [ns.id, ns]));

    for (const navSite of backupData.data.navSites) {
      if (existingMap.has(navSite.id)) {
        if (mergeStrategy === 'backup') {
          const existing = existingMap.get(navSite.id);
          navSite.createdAt = existing.createdAt;
          navSite.updatedAt = new Date().toISOString();
          summary.navSitesUpdated++;
          summary.conflictsResolved++;
        } else {
          summary.conflictsResolved++;
          continue;
        }
      } else {
        summary.navSitesAdded++;
      }
    }
  }

  // Merge field mappings (backup always wins for performance)
  if (backupData.data.fieldMappings) {
    const existingMappings = existingData.fieldMappings || {};
    const mergedMappings = {
      ...existingMappings,
      ...backupData.data.fieldMappings
    };
    backupData.data.fieldMappings = mergedMappings;
  }

  // Merge submission records (backup always wins)
  if (backupData.data.submissionRecords) {
    const existingRecords = existingData.submissionRecords || {};
    const mergedRecords = {
      ...existingRecords,
      ...backupData.data.submissionRecords
    };
    backupData.data.submissionRecords = mergedRecords;
  }

  // Merge settings (careful with LLM config - don't overwrite if user has local config)
  if (backupData.data.settings) {
    const existingSettings = existingData.settings || {};

    // Preserve sensitive settings from existing
    backupData.data.settings = {
      ...backupData.data.settings,
      // Keep existing LLM config if it exists and is valid
      llmConfig: existingSettings.llmConfig || backupData.data.settings.llmConfig
    };
  }

  // Save merged data
  await storage.set(backupData.data);

  return summary;
}

/**
 * Import sites from JSON/CSV (for bulk import)
 */
export async function importSites(file, format = 'json') {
  const text = await file.text();

  if (format === 'json') {
    const data = JSON.parse(text);
    const sites = Array.isArray(data) ? data : data.sites || [];

    let added = 0;
    let skipped = 0;

    for (const siteData of sites) {
      try {
        // Validate required fields
        if (!siteData.siteName || !siteData.siteUrl) {
          skipped++;
          continue;
        }

        await storage.addSite(siteData);
        added++;
      } catch (error) {
        console.error('[BackupService] Failed to import site:', error);
        skipped++;
      }
    }

    return { added, skipped, total: sites.length };
  }

  if (format === 'csv') {
    const lines = text.split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    let added = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const values = lines[i].split(',').map(v => v.trim());
      const siteData = {};

      headers.forEach((header, index) => {
        siteData[header] = values[index];
      });

      try {
        if (!siteData.siteName || !siteData.siteUrl) {
          skipped++;
          continue;
        }

        await storage.addSite(siteData);
        added++;
      } catch (error) {
        console.error('[BackupService] Failed to import site from CSV:', error);
        skipped++;
      }
    }

    return { added, skipped, total: lines.length - 1 };
  }

  throw new Error(`Unsupported import format: ${format}`);
}

/**
 * Export sites to CSV
 */
export async function exportSitesToCSV() {
  const sites = await storage.getAllSites();

  if (sites.length === 0) {
    throw new Error('No sites to export');
  }

  // Define CSV headers
  const headers = [
    'siteName', 'email', 'siteUrl', 'category',
    'pricing', 'tagline', 'shortDescription', 'longDescription', 'logo', 'screenshot'
  ];

  // Build CSV content
  const csvRows = [];

  // Header row
  csvRows.push(headers.join(','));

  // Data rows
  for (const site of sites) {
    const row = headers.map(header => {
      const value = site[header] || '';
      // Escape quotes and wrap in quotes if contains comma
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(row.join(','));
  }

  const csv = csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `nav-submitter-sites-${date}.csv`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Get backup summary without creating full backup
 */
export async function getBackupSummary() {
  const data = await storage.get(null);

  return {
    sites: (data.sites || []).length,
    navSites: (data.navSites || []).length,
    submissionRecords: Object.keys(data.submissionRecords || {}).length,
    fieldMappings: Object.keys(data.fieldMappings || {}).length,
    hasLlmConfig: !!(data.settings?.llmConfig?.apiKey),
    storageSize: JSON.stringify(data).length
  };
}

export default {
  createBackup,
  downloadBackup,
  readBackupFile,
  restoreBackupReplace,
  restoreBackupMerge,
  importSites,
  exportSitesToCSV,
  getBackupSummary,
  validateBackupData
};

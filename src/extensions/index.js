/**
 * Extension System Loader
 * Discovers, loads, and runs extensions for the daily digest
 */

import { config } from '../config.js';

// Import all extensions here
import yearProgress from './year-progress.js';

// Registry of all available extensions
const extensionRegistry = [
  yearProgress,
];

/**
 * Get all enabled extensions, sorted by order
 * @returns {Array} Array of enabled extensions
 */
export const getEnabledExtensions = () => {
  if (!config.extensionsEnabled) {
    return [];
  }
  
  return extensionRegistry
    .filter(ext => {
      try {
        return ext.enabled ? ext.enabled(config) : true;
      } catch (error) {
        console.warn(`Extension "${ext.name}" enabled check failed:`, error.message);
        return false;
      }
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0));
};

/**
 * Run all enabled extensions and collect their results
 * @param {Object} context - Context passed to extensions
 * @returns {Promise<Array>} Array of extension results
 */
export const runExtensions = async (context = {}) => {
  const extensions = getEnabledExtensions();
  
  if (extensions.length === 0) {
    return [];
  }
  
  console.log(`\n🧩 Running ${extensions.length} extension(s)...`);
  
  const results = [];
  
  for (const ext of extensions) {
    try {
      console.log(`  → ${ext.name}...`);
      const result = await ext.run({
        ...context,
        config,
        date: new Date(),
      });
      
      if (result && result.html) {
        results.push({
          name: ext.name,
          title: result.title || ext.name,
          html: result.html,
          order: ext.order || 0,
        });
        console.log(`    ✓ ${ext.name} completed`);
      }
    } catch (error) {
      console.error(`    ✗ ${ext.name} failed:`, error.message);
    }
  }
  
  return results;
};

/**
 * Format extension results as HTML sections
 * @param {Array} extensionResults - Results from runExtensions()
 * @returns {string} HTML string with all extension sections
 */
export const formatExtensionSections = (extensionResults) => {
  if (!extensionResults || extensionResults.length === 0) {
    return '';
  }
  
  const sections = extensionResults.map(result => {
    return `
<div style="margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%); border-radius: 8px;">
  <h2 style="margin: 0 0 10px 0; color: #333; font-size: 1.1em;">${result.title}</h2>
  ${result.html}
</div>`;
  });
  
  return sections.join('\n');
};

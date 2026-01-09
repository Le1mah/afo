import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { formatDateForTitle, formatDateForId } from './date-filter.js';

/**
 * Create a new report collector
 * @returns {Object} Report collector
 */
export const createReportCollector = () => {
  const startTime = Date.now();
  const now = new Date();
  
  return {
    startTime,
    date: {
      dateString: formatDateForTitle(now),
      dateId: formatDateForId(now),
      dateFilterEnabled: config.dateFilterEnabled,
    },
    config: {
      maxFeeds: config.maxFeeds,
      maxItemsPerFeed: config.maxItemsPerFeed,
      maxConcurrentFeeds: config.maxConcurrentFeeds,
      maxConcurrentItems: config.maxConcurrentItems,
      enableFullArticleFetch: config.enableFullArticleFetch,
      digestCacheEnabled: config.digestCacheEnabled,
      dateFilterEnabled: config.dateFilterEnabled,
      openaiModel: config.openaiModel,
    },
    feeds: {
      total: 0,
      successful: 0,
      failed: 0,
      withArticles: 0,
      articlesPerFeed: {},
      errors: [],
    },
    items: {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      cached: 0,
      errors: [],
    },
    performance: {
      totalDuration: 0,
      averageItemProcessingTime: 0,
      processingTimes: [],
    },
  };
};

/**
 * Record a feed processing result
 * @param {Object} report - Report collector
 * @param {boolean} success - Whether processing succeeded
 * @param {Error} [error] - Error if failed
 * @param {string} [feedTitle] - Feed title
 */
export const recordFeedResult = (report, success, error = null, feedTitle = '') => {
  report.feeds.total++;
  if (success) {
    report.feeds.successful++;
  } else {
    report.feeds.failed++;
    if (error) {
      report.feeds.errors.push({
        feed: feedTitle,
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    }
  }
};

/**
 * Record articles count for a feed
 * @param {Object} report - Report collector
 * @param {string} feedTitle - Feed title
 * @param {number} articleCount - Number of articles processed
 */
export const recordFeedArticles = (report, feedTitle, articleCount) => {
  if (articleCount > 0) {
    report.feeds.withArticles++;
    report.feeds.articlesPerFeed[feedTitle] = articleCount;
  }
};

/**
 * Record an item processing result
 * @param {Object} report - Report collector
 * @param {string} status - Status: 'success', 'failed', 'skipped', 'cached'
 * @param {number} [processingTime] - Processing time in milliseconds
 * @param {Error} [error] - Error if failed
 * @param {string} [itemTitle] - Item title
 */
export const recordItemResult = (report, status, processingTime = 0, error = null, itemTitle = '') => {
  report.items.total++;
  
  switch (status) {
    case 'success':
      report.items.successful++;
      report.items.processed++;
      break;
    case 'failed':
      report.items.failed++;
      if (error) {
        report.items.errors.push({
          item: itemTitle,
          message: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    case 'skipped':
      report.items.skipped++;
      break;
    case 'cached':
      report.items.cached++;
      report.items.processed++;
      report.items.successful++;
      break;
  }
  
  if (processingTime > 0) {
    report.performance.processingTimes.push(processingTime);
  }
};

/**
 * Finalize the report with computed metrics
 * @param {Object} report - Report collector
 * @returns {Object} Finalized report
 */
export const finalizeReport = (report) => {
  const endTime = Date.now();
  report.performance.totalDuration = endTime - report.startTime;
  
  if (report.performance.processingTimes.length > 0) {
    const sum = report.performance.processingTimes.reduce((a, b) => a + b, 0);
    report.performance.averageItemProcessingTime = Math.round(
      sum / report.performance.processingTimes.length
    );
  }
  
  return {
    ...report,
    timestamp: new Date().toISOString(),
    performance: {
      totalDuration: report.performance.totalDuration,
      totalDurationFormatted: formatDuration(report.performance.totalDuration),
      averageItemProcessingTime: report.performance.averageItemProcessingTime,
      averageItemProcessingTimeFormatted: formatDuration(report.performance.averageItemProcessingTime),
    },
  };
};

/**
 * Format duration in milliseconds to human-readable string
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
const formatDuration = (ms) => {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
};

/**
 * Generate JSON report
 * @param {Object} report - Report data
 * @returns {string} JSON string
 */
export const generateJsonReport = (report) => {
  return JSON.stringify(report, null, 2);
};

/**
 * Generate Markdown report
 * @param {Object} report - Report data
 * @returns {string} Markdown string
 */
export const generateMarkdownReport = (report) => {
  const lines = [];
  
  lines.push('# AFO Feed Digest Report');
  lines.push('');
  
  // Daily digest info
  if (report.date) {
    lines.push(`**📅 Date:** ${report.date.dateString}`);
    lines.push(`**Mode:** ${report.date.dateFilterEnabled ? 'Daily Digest (today\'s articles)' : 'Legacy (latest N articles)'}`);
  }
  lines.push(`**Generated:** ${report.timestamp}`);
  lines.push(`**Duration:** ${report.performance.totalDurationFormatted}`);
  lines.push('');
  
  lines.push('## Configuration');
  lines.push('');
  lines.push(`- **Model:** ${report.config.openaiModel}`);
  lines.push(`- **Max Feeds:** ${report.config.maxFeeds}`);
  lines.push(`- **Date Filter:** ${report.config.dateFilterEnabled ? 'Enabled (daily mode)' : 'Disabled (legacy mode)'}`);
  if (!report.config.dateFilterEnabled) {
    lines.push(`- **Max Items Per Feed:** ${report.config.maxItemsPerFeed}`);
  }
  lines.push(`- **Concurrent Feeds:** ${report.config.maxConcurrentFeeds}`);
  lines.push(`- **Concurrent Items:** ${report.config.maxConcurrentItems}`);
  lines.push(`- **Full Article Fetch:** ${report.config.enableFullArticleFetch ? 'Enabled' : 'Disabled'}`);
  lines.push(`- **Digest Cache:** ${report.config.digestCacheEnabled ? 'Enabled' : 'Disabled'}`);
  lines.push('');
  
  lines.push('## Feed Processing Summary');
  lines.push('');
  lines.push(`- **Total Feeds Checked:** ${report.feeds.total}`);
  lines.push(`- **Feeds with Articles:** ${report.feeds.withArticles || 0}`);
  lines.push(`- **Successful:** ${report.feeds.successful}`);
  lines.push(`- **Failed:** ${report.feeds.failed}`);
  lines.push('');
  
  // Articles per feed breakdown
  if (report.feeds.articlesPerFeed && Object.keys(report.feeds.articlesPerFeed).length > 0) {
    lines.push('### Articles Per Feed');
    lines.push('');
    lines.push('| Feed | Articles |');
    lines.push('|------|----------|');
    for (const [feed, count] of Object.entries(report.feeds.articlesPerFeed).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${feed} | ${count} |`);
    }
    lines.push('');
  }
  
  if (report.feeds.errors.length > 0) {
    lines.push('### Feed Errors');
    lines.push('');
    for (const error of report.feeds.errors) {
      lines.push(`- **${error.feed || 'Unknown'}:** ${error.message}`);
    }
    lines.push('');
  }
  
  lines.push('## Item Processing Summary');
  lines.push('');
  lines.push(`- **Total Items:** ${report.items.total}`);
  lines.push(`- **Processed:** ${report.items.processed}`);
  lines.push(`- **Successful:** ${report.items.successful}`);
  lines.push(`- **Failed:** ${report.items.failed}`);
  lines.push(`- **Skipped:** ${report.items.skipped}`);
  lines.push(`- **From Cache:** ${report.items.cached}`);
  lines.push('');
  
  if (report.items.errors.length > 0) {
    lines.push('### Item Errors');
    lines.push('');
    for (const error of report.items.errors.slice(0, 10)) {
      lines.push(`- **${error.item || 'Unknown'}:** ${error.message}`);
    }
    if (report.items.errors.length > 10) {
      lines.push(`- ... and ${report.items.errors.length - 10} more errors`);
    }
    lines.push('');
  }
  
  lines.push('## Performance Metrics');
  lines.push('');
  lines.push(`- **Total Duration:** ${report.performance.totalDurationFormatted}`);
  lines.push(`- **Average Item Processing Time:** ${report.performance.averageItemProcessingTimeFormatted}`);
  lines.push('');
  
  return lines.join('\n');
};

/**
 * Save reports to files
 * @param {Object} report - Report data
 * @param {Object} options - Options
 * @param {boolean} [options.json=true] - Save JSON report
 * @param {boolean} [options.markdown=true] - Save Markdown report
 * @returns {Promise<Object>} Paths to saved reports
 */
export const saveReports = async (report, options = {}) => {
  const { json = true, markdown = true } = options;
  
  if (!config.enableReporting) {
    return { json: null, markdown: null };
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const paths = {};
  
  await fs.mkdir(config.reportOutputDir, { recursive: true });
  
  if (json) {
    const jsonPath = path.join(config.reportOutputDir, `execution-${timestamp}.json`);
    await fs.writeFile(jsonPath, generateJsonReport(report), 'utf-8');
    paths.json = jsonPath;
    console.log(`JSON report saved to: ${jsonPath}`);
  }
  
  if (markdown) {
    const markdownPath = path.join(config.reportOutputDir, `execution-${timestamp}.md`);
    await fs.writeFile(markdownPath, generateMarkdownReport(report), 'utf-8');
    paths.markdown = markdownPath;
    console.log(`Markdown report saved to: ${markdownPath}`);
  }
  
  return paths;
};

/**
 * Print report summary to console
 * @param {Object} report - Report data
 */
export const printReportSummary = (report) => {
  console.log('\n' + '='.repeat(60));
  console.log('EXECUTION SUMMARY');
  console.log('='.repeat(60));
  
  // Date info for daily digest mode
  if (report.date) {
    console.log(`Date: ${report.date.dateString}`);
    console.log(`Mode: ${report.date.dateFilterEnabled ? 'Daily Digest' : 'Legacy'}`);
  }
  
  console.log(`Duration: ${report.performance.totalDurationFormatted}`);
  console.log(`Feeds Checked: ${report.feeds.total}`);
  console.log(`Feeds with Articles: ${report.feeds.withArticles || 0}`);
  console.log(`Articles Processed: ${report.items.successful}/${report.items.total} successful`);
  
  if (report.items.cached > 0) {
    console.log(`  └─ From Cache: ${report.items.cached}`);
  }
  if (report.items.failed > 0) {
    console.log(`  └─ Failed: ${report.items.failed}`);
  }
  if (report.feeds.failed > 0) {
    console.log(`Failed Feeds: ${report.feeds.failed}`);
  }
  console.log('='.repeat(60) + '\n');
};


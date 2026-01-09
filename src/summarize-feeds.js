import fs from 'fs/promises';
import crypto from 'crypto';
import OpenAI from 'openai';
import { extract } from '@extractus/feed-extractor';
import { XMLBuilder } from 'fast-xml-parser';
import pLimit from 'p-limit';
import { parseOpml } from './opml.js';
import { loadEnvFile } from './load-env.js';
import { config, requireEnv } from './config.js';
import { generateMultiLayerDigest, formatDigestForFeed, generateItemHash } from './digest.js';
import {
  createReportCollector,
  recordFeedResult,
  recordFeedArticles,
  recordItemResult,
  finalizeReport,
  saveReports,
  printReportSummary,
} from './reporting.js';
import { retryOnError } from './retry.js';
import {
  filterTodayArticles,
  getTodayInfo,
  formatDateForTitle,
  formatDateForId,
} from './date-filter.js';

loadEnvFile();

/**
 * Flatten OPML outlines into a list of feeds
 */
const flattenFeeds = (nodes) => {
  if (!nodes) {
    return [];
  }
  const list = Array.isArray(nodes) ? nodes : [nodes];
  const feeds = [];
  for (const node of list) {
    if (node.xmlUrl) {
      feeds.push({
        title: node.title || node.text || node.xmlUrl,
        xmlUrl: node.xmlUrl,
      });
    }
    if (node.children?.length) {
      feeds.push(...flattenFeeds(node.children));
    }
  }
  return feeds;
};

/**
 * Coerce various value types to text
 */
const coerceText = (value, fallback = '') => {
  if (value == null) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const flattened = value.map((item) => coerceText(item, '')).filter(Boolean);
    return flattened.join(' ').trim() || fallback;
  }
  if (typeof value === 'object') {
    return (
      coerceText(value.value, fallback) ||
      coerceText(value.content, fallback) ||
      coerceText(value.text, fallback) ||
      coerceText(value['#text'], fallback) ||
      fallback
    );
  }
  return String(value);
};

/**
 * Coerce various date formats
 */
const coerceDate = (value) => {
  if (!value) {
    return new Date();
  }
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

/**
 * Get cache path for a feed
 */
const getFeedCachePath = (feedUrl) => {
  const filename = crypto.createHash('sha1').update(feedUrl).digest('hex');
  return `${config.feedCacheDir}/${filename}.json`;
};

/**
 * Read feed from cache
 */
const readFeedCache = async (feedUrl) => {
  if (!config.feedCacheEnabled) {
    return null;
  }
  const cachePath = getFeedCachePath(feedUrl);
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const fetchedAt = parsed?.fetchedAt ? new Date(parsed.fetchedAt) : null;
    if (!fetchedAt || Date.now() - fetchedAt.getTime() > config.feedCacheTtlMs) {
      return null;
    }
    const entries = (parsed.entries ?? []).map((entry) => ({
      ...entry,
      publishedAt: coerceDate(entry.publishedAt),
    }));
    return entries;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to read cache for ${feedUrl}:`, error.message);
    }
    return null;
  }
};

/**
 * Write feed to cache
 */
const writeFeedCache = async (feedUrl, entries) => {
  if (!config.feedCacheEnabled) {
    return;
  }
  const cachePath = getFeedCachePath(feedUrl);
  await fs.mkdir(config.feedCacheDir, { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    entries: entries.map((entry) => ({
      ...entry,
      publishedAt: entry.publishedAt?.toISOString?.() ?? new Date().toISOString(),
    })),
  };
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
};

/**
 * Pick a link from entry
 */
const pickLink = (entry) => {
  if (!entry) {
    return undefined;
  }
  const direct =
    entry.link ??
    entry.url ??
    entry.guid ??
    entry.id ??
    entry.canonical ??
    entry.canonicalUrl;
  if (typeof direct === 'string') {
    return direct;
  }
  if (direct && typeof direct === 'object') {
    return direct.href || direct.url || direct.link || undefined;
  }
  if (entry.links) {
    const links = Array.isArray(entry.links) ? entry.links : [entry.links];
    for (const link of links) {
      if (typeof link === 'string') {
        return link;
      }
      if (link?.href) {
        return link.href;
      }
      if (link?.url) {
        return link.url;
      }
    }
  }
  return undefined;
};

/**
 * Load feed definitions from OPML
 */
const loadFeedDefinitions = async () => {
  const outlines = await parseOpml(config.feedsOpml);
  const flattened = flattenFeeds(outlines);
  const seen = new Set();
  const feeds = [];
  for (const feed of flattened) {
    if (!feed.xmlUrl || seen.has(feed.xmlUrl)) {
      continue;
    }
    seen.add(feed.xmlUrl);
    feeds.push(feed);
  }
  if (!feeds.length) {
    throw new Error(`No feed definitions found in ${config.feedsOpml}`);
  }
  return feeds;
};

/**
 * Normalize a feed entry
 */
const normalizeEntry = (entry, sourceTitle) => {
  const description =
    entry.description ||
    entry.summary ||
    entry.content ||
    entry.contentSnippet ||
    '';
  const published =
    entry.published ||
    entry.pubDate ||
    entry.updated ||
    entry.created ||
    entry.isoDate ||
    entry.date ||
    entry.modified;
  return {
    sourceTitle,
    title: coerceText(entry.title) || coerceText(entry.id) || 'Untitled entry',
    link: pickLink(entry),
    description: coerceText(description),
    publishedAt: coerceDate(published),
  };
};

/**
 * Fetch feed entries with retry
 */
const fetchFeedEntries = async (feed) => {
  const cachedEntries = await readFeedCache(feed.xmlUrl);
  if (cachedEntries) {
    console.log(`Using cached entries for feed: ${feed.title}`);
    return cachedEntries;
  }
  
  const feedData = await retryOnError(
    async () => {
      return await extract(feed.xmlUrl, {
        requestOptions: {
          headers: {
            'user-agent': 'afo-feed-summarizer/1.0 (+https://github.com/tenki/afo)',
          },
        },
      });
    },
    {
      onRetry: (error, attempt, delay) => {
        console.warn(`Retry ${attempt} for feed ${feed.title} after ${delay}ms: ${error.message}`);
      },
    }
  );
  
  const sourceTitle = feedData?.title || feed.title || feed.xmlUrl;
  const entries = (feedData?.entries ?? []).map((entry) => normalizeEntry(entry, sourceTitle));
  await writeFeedCache(feed.xmlUrl, entries);
  return entries;
};

/**
 * Group digests by source feed
 * @param {Array} digests - Array of digests
 * @returns {Object} Digests grouped by feed title
 */
const groupDigestsByFeed = (digests) => {
  const grouped = {};
  
  for (const digest of digests) {
    const feedTitle = digest.sourceTitle || 'Unknown Feed';
    if (!grouped[feedTitle]) {
      grouped[feedTitle] = [];
    }
    grouped[feedTitle].push(digest);
  }
  
  // Sort feeds alphabetically
  const sortedFeeds = Object.keys(grouped).sort();
  const result = {};
  for (const feed of sortedFeeds) {
    // Sort articles within each feed by publish time (newest first)
    result[feed] = grouped[feed].sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });
  }
  
  return result;
};

/**
 * Format a single article for the daily digest HTML
 * @param {Object} digest - Article digest
 * @returns {string} HTML for the article
 */
const formatArticleHtml = (digest) => {
  const lines = [];
  
  // Article title with link
  const title = digest.title || 'Untitled';
  const link = digest.link || '';
  lines.push(`<h3 style="margin: 16px 0 8px 0; color: #333;">▸ <a href="${link}" style="color: #0066cc; text-decoration: none;">${escapeHtml(title)}</a></h3>`);
  
  // One-line summary
  if (digest.digests?.oneLine) {
    lines.push(`<p style="margin: 4px 0; font-weight: bold; color: #555;">💡 ${escapeHtml(digest.digests.oneLine)}</p>`);
  }
  
  // Overall summary
  if (digest.digests?.overall) {
    lines.push(`<p style="margin: 8px 0; color: #444; line-height: 1.6;">${escapeHtml(digest.digests.overall)}</p>`);
  }
  
  // Paragraph summaries (collapsible)
  if (digest.digests?.paragraphs && digest.digests.paragraphs.length > 0) {
    lines.push(`<details style="margin: 8px 0;">`);
    lines.push(`<summary style="cursor: pointer; color: #666;">📝 关键要点 (${digest.digests.paragraphs.length} sections)</summary>`);
    lines.push(`<ul style="margin: 8px 0; padding-left: 20px; color: #555;">`);
    for (const p of digest.digests.paragraphs) {
      const title = p.title && p.title !== `Section ${p.index + 1}` ? `<strong>${escapeHtml(p.title)}:</strong> ` : '';
      lines.push(`<li style="margin: 4px 0;">${title}${escapeHtml(p.summary)}</li>`);
    }
    lines.push(`</ul>`);
    lines.push(`</details>`);
  }
  
  return lines.join('\n');
};

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
const escapeHtml = (str) => {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Format the daily digest as HTML
 * @param {Object} groupedDigests - Digests grouped by feed
 * @param {string} dateString - Formatted date string
 * @returns {string} HTML content
 */
const formatDailyDigestHtml = (groupedDigests, dateString) => {
  const feedNames = Object.keys(groupedDigests);
  const totalArticles = feedNames.reduce((sum, f) => sum + groupedDigests[f].length, 0);
  
  const lines = [];
  
  // Header
  lines.push(`<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">`);
  lines.push(`<h1 style="border-bottom: 2px solid #333; padding-bottom: 10px; color: #222;">📰 Daily Digest - ${escapeHtml(dateString)}</h1>`);
  lines.push(`<p style="color: #666; margin-bottom: 20px;">Found <strong>${totalArticles}</strong> articles from <strong>${feedNames.length}</strong> feeds</p>`);
  
  // Each feed section
  for (const feedTitle of feedNames) {
    const articles = groupedDigests[feedTitle];
    
    lines.push(`<hr style="border: none; border-top: 2px solid #ddd; margin: 24px 0;" />`);
    lines.push(`<h2 style="color: #444; margin: 16px 0;">📰 ${escapeHtml(feedTitle)} <span style="color: #888; font-size: 0.8em; font-weight: normal;">(${articles.length} article${articles.length > 1 ? 's' : ''})</span></h2>`);
    
    for (const digest of articles) {
      lines.push(formatArticleHtml(digest));
    }
  }
  
  // Footer
  lines.push(`<hr style="border: none; border-top: 2px solid #ddd; margin: 24px 0;" />`);
  lines.push(`<p style="color: #888; font-size: 0.9em; text-align: center;">Generated by AFO Feed Digest</p>`);
  lines.push(`</div>`);
  
  return lines.join('\n');
};

/**
 * Build daily digest Atom feed XML (single entry)
 * @param {Object} groupedDigests - Digests grouped by feed
 * @returns {string} Atom XML
 */
const buildDailyDigestFeed = (groupedDigests) => {
  const dateString = formatDateForTitle();
  const dateId = formatDateForId();
  const htmlContent = formatDailyDigestHtml(groupedDigests, dateString);
  
  const feedNames = Object.keys(groupedDigests);
  const totalArticles = feedNames.reduce((sum, f) => sum + groupedDigests[f].length, 0);
  
  const title = config.includeDateInTitle 
    ? `${config.channelTitle} - ${dateString}`
    : config.channelTitle;
  
  const atomObject = {
    '?xml': {
      '@_version': '1.0',
      '@_encoding': 'UTF-8',
    },
    feed: {
      '@_xmlns': 'http://www.w3.org/2005/Atom',
      title: config.channelTitle,
      link: [
        { '@_href': config.channelLink, '@_rel': 'alternate' },
        { '@_href': config.channelLink, '@_rel': 'self' },
      ],
      id: config.channelLink,
      updated: new Date().toISOString(),
      subtitle: config.channelDescription,
      entry: {
        title: title,
        link: {
          '@_href': config.channelLink,
          '@_rel': 'alternate',
        },
        id: `daily-digest-${dateId}`,
        updated: new Date().toISOString(),
        published: new Date().toISOString(),
        author: {
          name: 'AFO Feed Digest',
        },
        summary: `${totalArticles} articles from ${feedNames.length} feeds`,
        content: {
          '@_type': 'html',
          '#text': htmlContent,
        },
      },
    },
  };
  
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    suppressEmptyNode: true,
    attributeNamePrefix: '@_',
  });
  
  return builder.build(atomObject);
};

/**
 * Build Atom feed XML (legacy mode - multiple entries)
 */
const buildAtomFeed = (digests) => {
  const atomObject = {
    '?xml': {
      '@_version': '1.0',
      '@_encoding': 'UTF-8',
    },
    feed: {
      '@_xmlns': 'http://www.w3.org/2005/Atom',
      title: config.channelTitle,
      link: [
        { '@_href': config.channelLink, '@_rel': 'alternate' },
        { '@_href': config.channelLink, '@_rel': 'self' },
      ],
      id: config.channelLink,
      updated: new Date().toISOString(),
      subtitle: config.channelDescription,
      entry: digests.map((digest) => ({
        title: digest.title,
        link: {
          '@_href': digest.link || config.channelLink,
          '@_rel': 'alternate',
        },
        id: digest.link || crypto.createHash('sha1').update(digest.title).digest('hex'),
        updated: digest.publishedAt?.toISOString?.() || new Date().toISOString(),
        published: digest.publishedAt?.toISOString?.() || new Date().toISOString(),
        author: {
          name: digest.sourceTitle,
        },
        content: {
          '@_type': 'html',
          '#text': formatDigestForFeed(digest)
            .split('\n')
            .map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
            .join('<br/>'),
        },
      })),
    },
  };
  
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    suppressEmptyNode: true,
    attributeNamePrefix: '@_',
  });
  
  return builder.build(atomObject);
};

/**
 * Write output file
 */
const writeOutput = async (outputPath, atomXml) => {
  await fs.mkdir(config.projectRoot, { recursive: true });
  await fs.writeFile(outputPath, atomXml, 'utf-8');
};

/**
 * Verify API key is valid by making a test call
 */
const verifyApiKey = async (client) => {
  console.log('🔐 Verifying API key...');
  try {
    const response = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5,
    });
    console.log('✓ API key verified successfully');
    console.log(`✓ Model: ${config.openaiModel}`);
    console.log(`✓ Base URL: ${config.openaiBaseUrl || 'default (OpenAI)'}`);
    return true;
  } catch (error) {
    console.error('❌ API key verification failed!');
    console.error(`Error: ${error.message}`);
    if (error.status === 401) {
      console.error('→ The API key is invalid or unauthorized');
    } else if (error.status === 404) {
      console.error('→ Model not found. Check OPENAI_MODEL is correct for your provider');
    } else if (error.code === 'ENOTFOUND') {
      console.error('→ Cannot reach API endpoint. Check OPENAI_BASE_URL');
    }
    throw new Error(`API verification failed: ${error.message}`);
  }
};

/**
 * Main execution
 */
export const main = async () => {
  const apiKey = requireEnv('OPENAI_API_KEY');
  
  console.log('🚀 Starting AFO Feed Digest');
  console.log(`📝 API Key: ${apiKey.slice(0, 7)}...${apiKey.slice(-4)} (${apiKey.length} chars)`);
  
  // Show date filter info
  if (config.dateFilterEnabled) {
    const todayInfo = getTodayInfo();
    console.log(`📅 Daily Digest Mode: ${todayInfo.dateString}`);
    console.log(`   Date Range (UTC): ${todayInfo.start} to ${todayInfo.end}`);
  } else {
    console.log(`📅 Legacy Mode: Processing latest ${config.maxItemsPerFeed} items per feed`);
  }
  
  const openai = new OpenAI({
    apiKey,
    baseURL: config.openaiBaseUrl || undefined,
  });
  
  // Verify API key works before processing
  await verifyApiKey(openai);
  
  const report = createReportCollector();
  const feeds = await loadFeedDefinitions();
  const limitedFeeds = feeds.slice(0, config.maxFeeds);
  
  console.log(`\nProcessing ${limitedFeeds.length} feeds (max: ${config.maxFeeds})`);
  
  const digests = [];
  let totalTodayArticles = 0;
  let feedsWithArticles = 0;
  
  // Process feeds sequentially for better control and logging
  for (const feed of limitedFeeds) {
    try {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📰 Processing feed: ${feed.title}`);
      
      const entries = await fetchFeedEntries(feed);
      
      // Apply date filter if enabled
      let entriesToProcess;
      if (config.dateFilterEnabled) {
        entriesToProcess = filterTodayArticles(entries);
        console.log(`  📅 Found ${entriesToProcess.length} articles from today (${entries.length} total)`);
      } else {
        entriesToProcess = entries.slice(0, config.maxItemsPerFeed);
        console.log(`  📄 Processing ${entriesToProcess.length} latest articles`);
      }
      
      if (!entriesToProcess.length) {
        console.log(`  ⏭️  No articles to process, skipping feed`);
        recordFeedResult(report, true, null, feed.title);
        continue;
      }
      
      feedsWithArticles++;
      totalTodayArticles += entriesToProcess.length;
      recordFeedArticles(report, feed.title, entriesToProcess.length);
      
      // Process each article
      for (let i = 0; i < entriesToProcess.length; i++) {
        const item = entriesToProcess[i];
        const itemStartTime = Date.now();
        
        try {
          console.log(`  [${i + 1}/${entriesToProcess.length}] ${item.title}`);
          const digest = await generateMultiLayerDigest(openai, item);
          digests.push(digest);
          const processingTime = Date.now() - itemStartTime;
          recordItemResult(report, 'success', processingTime, null, item.title);
          console.log(`      ✓ Completed in ${processingTime}ms`);
        } catch (error) {
          console.error(`      ✗ Failed: ${error.message}`);
          recordItemResult(report, 'failed', Date.now() - itemStartTime, error, item.title);
        }
        
        // Delay between items (if configured) - applies after EVERY item including last
        if (config.delayBetweenItemsMs > 0) {
          await new Promise(resolve => setTimeout(resolve, config.delayBetweenItemsMs));
        }
      }
      
      recordFeedResult(report, true, null, feed.title);
      
      // Delay between feeds (if configured) - adds to item delay for finer rate control
      if (config.delayBetweenFeedsMs > 0) {
        await new Promise(resolve => setTimeout(resolve, config.delayBetweenFeedsMs));
      }
      
    } catch (error) {
      console.error(`  ❌ Failed to process feed: ${error.message}`);
      recordFeedResult(report, false, error, feed.title);
    }
  }
  
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  
  if (!digests.length) {
    console.warn('📭 No articles found for today. No digest generated.');
    const finalReport = finalizeReport(report);
    await saveReports(finalReport);
    printReportSummary(finalReport);
    return;
  }
  
  console.log(`\n📊 Summary: ${digests.length} articles from ${feedsWithArticles} feeds`);
  
  // Build output based on mode
  let atomXml;
  if (config.dateFilterEnabled) {
    // Daily digest mode: single entry grouped by feed
    const groupedDigests = groupDigestsByFeed(digests);
    atomXml = buildDailyDigestFeed(groupedDigests);
    console.log(`\n✓ Generated daily digest with ${Object.keys(groupedDigests).length} feed sections`);
  } else {
    // Legacy mode: individual entries
    digests.sort((a, b) => {
      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });
    atomXml = buildAtomFeed(digests);
    console.log(`\n✓ Generated feed with ${digests.length} individual entries`);
  }
  
  await writeOutput(config.outputFeed, atomXml);
  console.log(`✓ Wrote output to ${config.outputFeed}`);
  
  const finalReport = finalizeReport(report);
  await saveReports(finalReport);
  printReportSummary(finalReport);
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exitCode = 1;
  });
}

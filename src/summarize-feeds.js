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
  recordItemResult,
  finalizeReport,
  saveReports,
  printReportSummary,
} from './reporting.js';
import { retryOnError } from './retry.js';

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
 * Build Atom feed XML
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
  
  const openai = new OpenAI({
    apiKey,
    baseURL: config.openaiBaseUrl || undefined,
  });
  
  // Verify API key works before processing
  await verifyApiKey(openai);
  
  const report = createReportCollector();
  const feeds = await loadFeedDefinitions();
  const limitedFeeds = feeds.slice(0, config.maxFeeds);
  
  console.log(`Processing ${limitedFeeds.length} feeds (max: ${config.maxFeeds})`);
  
  const feedLimit = pLimit(config.maxConcurrentFeeds);
  const digests = [];
  
  // Process feeds with concurrency control
  await Promise.all(
    limitedFeeds.map((feed) =>
      feedLimit(async () => {
        try {
          console.log(`\nProcessing feed: ${feed.title}`);
          const entries = await fetchFeedEntries(feed);
          const limitedEntries = entries.slice(0, config.maxItemsPerFeed);
          
          if (!limitedEntries.length) {
            console.warn(`Feed "${feed.title}" returned no entries to process.`);
            recordFeedResult(report, true, null, feed.title);
            return;
          }
          
          console.log(`  Found ${limitedEntries.length} items to process`);
          
          // Process items with concurrency control
          const itemLimit = pLimit(config.maxConcurrentItems);
          const itemResults = [];
          
          for (let i = 0; i < limitedEntries.length; i++) {
            const item = limitedEntries[i];
            const itemStartTime = Date.now();
            
            try {
              console.log(`  Processing: ${item.title}`);
              const digest = await generateMultiLayerDigest(openai, item);
              digests.push(digest);
              const processingTime = Date.now() - itemStartTime;
              recordItemResult(report, 'success', processingTime, null, item.title);
              console.log(`  ✓ Completed in ${processingTime}ms`);
            } catch (error) {
              console.error(`  ✗ Failed to process "${item.title}":`, error.message);
              recordItemResult(report, 'failed', Date.now() - itemStartTime, error, item.title);
            }
            
            // Delay between items (if configured)
            if (config.delayBetweenItemsMs > 0 && i < limitedEntries.length - 1) {
              console.log(`  ⏳ Waiting ${config.delayBetweenItemsMs}ms before next item...`);
              await new Promise(resolve => setTimeout(resolve, config.delayBetweenItemsMs));
            }
          }
          
          recordFeedResult(report, true, null, feed.title);
          
          // Delay between feeds (if configured)
          if (config.delayBetweenFeedsMs > 0) {
            console.log(`⏳ Waiting ${config.delayBetweenFeedsMs}ms before next feed...`);
            await new Promise(resolve => setTimeout(resolve, config.delayBetweenFeedsMs));
          }
        } catch (error) {
          console.error(`Failed to process feed "${feed.title}" (${feed.xmlUrl}):`, error.message);
          recordFeedResult(report, false, error, feed.title);
        }
      })
    )
  );
  
  if (!digests.length) {
    console.warn('No digests were generated; skipping feed creation.');
    const finalReport = finalizeReport(report);
    await saveReports(finalReport);
    printReportSummary(finalReport);
    return;
  }
  
  // Sort digests by published date (newest first)
  digests.sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return dateB - dateA;
  });
  
  const atomXml = buildAtomFeed(digests);
  await writeOutput(config.outputFeed, atomXml);
  console.log(`\n✓ Wrote ${digests.length} digests to ${config.outputFeed}`);
  
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

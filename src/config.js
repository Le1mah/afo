import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnvFile } from './load-env.js';

// Load .env file first, before reading any environment variables
loadEnvFile();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const parseNumber = (value, defaultValue) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseBoolean = (value, defaultValue) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value === 'true' || value === '1' || value === 'yes';
};

export const config = {
  // Paths
  projectRoot,
  feedsOpml: path.resolve(projectRoot, process.env.FEEDS_OPML ?? 'Feeds.opml'),
  outputFeed: path.resolve(projectRoot, process.env.OUTPUT_FEED ?? 'summary.xml'),
  feedCacheDir: path.resolve(projectRoot, process.env.FEED_CACHE_DIR ?? '.cache/feeds'),
  digestCacheDir: path.resolve(projectRoot, process.env.DIGEST_CACHE_DIR ?? '.cache/digests'),
  reportOutputDir: path.resolve(projectRoot, process.env.REPORT_OUTPUT_DIR ?? 'reports'),

  // OpenAI Configuration
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',

  // Feed Processing Limits
  maxFeeds: parseNumber(process.env.MAX_FEEDS, 10),
  maxItemsPerFeed: parseNumber(process.env.MAX_ITEMS_PER_FEED, 1),

  // Caching
  feedCacheTtlMinutes: parseNumber(process.env.FEED_CACHE_TTL_MINUTES, 60),
  digestCacheTtlMinutes: parseNumber(process.env.DIGEST_CACHE_TTL_MINUTES, 10080), // 7 days

  // Concurrency
  maxConcurrentFeeds: parseNumber(process.env.MAX_CONCURRENT_FEEDS, 3),
  maxConcurrentItems: parseNumber(process.env.MAX_CONCURRENT_ITEMS, 5),
  rateLimitDelayMs: parseNumber(process.env.RATE_LIMIT_DELAY_MS, 1000),
  delayBetweenItemsMs: parseNumber(process.env.DELAY_BETWEEN_ITEMS_MS, 0),
  delayBetweenFeedsMs: parseNumber(process.env.DELAY_BETWEEN_FEEDS_MS, 0),

  // Retry Configuration
  maxRetries: parseNumber(process.env.MAX_RETRIES, 3),
  retryBaseDelayMs: parseNumber(process.env.RETRY_BASE_DELAY_MS, 1000),
  retryMaxDelayMs: parseNumber(process.env.RETRY_MAX_DELAY_MS, 30000),

  // Content Processing
  summaryCharLimit: parseNumber(process.env.SUMMARY_CHAR_LIMIT, 1200),
  contentFetchTimeout: parseNumber(process.env.CONTENT_FETCH_TIMEOUT_MS, 10000),

  // Output Feed Metadata
  channelTitle: process.env.SUMMARY_FEED_TITLE ?? 'AFO AI Feed Digest',
  channelLink: process.env.SUMMARY_FEED_LINK ?? 'https://github.com/tenki/afo',
  channelDescription: process.env.SUMMARY_FEED_DESCRIPTION ?? 'Automatic summaries generated from RSS/Atom sources.',

  // Feature Flags
  enableFullArticleFetch: parseBoolean(process.env.ENABLE_FULL_ARTICLE_FETCH, true),
  enableDigestCache: parseBoolean(process.env.ENABLE_DIGEST_CACHE, true),
  enableReporting: parseBoolean(process.env.ENABLE_REPORTING, true),
};

// Derived values
config.feedCacheTtlMs = Math.max(0, config.feedCacheTtlMinutes) * 60 * 1000;
config.digestCacheTtlMs = Math.max(0, config.digestCacheTtlMinutes) * 60 * 1000;
config.feedCacheEnabled = config.feedCacheTtlMs > 0;
config.digestCacheEnabled = config.enableDigestCache && config.digestCacheTtlMs > 0;

export const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};


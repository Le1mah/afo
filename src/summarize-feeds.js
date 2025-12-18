import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import OpenAI from 'openai';

const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const FEEDS_OPML = path.resolve(projectRoot, process.env.FEEDS_OPML ?? 'Feeds.opml');
const OUTPUT_RSS = path.resolve(projectRoot, process.env.OUTPUT_RSS ?? 'summary.xml');
const MAX_FEEDS = Number(process.env.MAX_FEEDS ?? 10);
const MAX_ITEMS_PER_FEED = Number(process.env.MAX_ITEMS_PER_FEED ?? 1);
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const SUMMARY_CHAR_LIMIT = Number(process.env.SUMMARY_CHAR_LIMIT ?? 1200);
const CHANNEL_TITLE = process.env.SUMMARY_FEED_TITLE ?? 'AFO AI Feed Digest';
const CHANNEL_LINK = process.env.SUMMARY_FEED_LINK ?? 'https://github.com/tenki/afo';
const CHANNEL_DESCRIPTION =
  process.env.SUMMARY_FEED_DESCRIPTION ??
  'Automatic summaries generated from Feeds.opml sources.';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  trimValues: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressEmptyNode: true,
});

const flattenOutlines = (outline) => {
  if (!outline) {
    return [];
  }
  const outlines = Array.isArray(outline) ? outline : [outline];
  const feeds = [];
  for (const node of outlines) {
    if (node.xmlUrl) {
      feeds.push({
        title: node.title || node.text || node.xmlUrl,
        xmlUrl: node.xmlUrl,
      });
    }
    if (node.outline) {
      feeds.push(...flattenOutlines(node.outline));
    }
  }
  return feeds;
};

const readOpmlFeeds = async (opmlPath) => {
  const raw = await fs.readFile(opmlPath, 'utf-8');
  const parsed = xmlParser.parse(raw);
  const outlines = parsed?.opml?.body?.outline;
  if (!outlines) {
    throw new Error(`No outlines found in OPML file at ${opmlPath}`);
  }
  const feeds = flattenOutlines(outlines);
  if (!feeds.length) {
    throw new Error('OPML does not contain any feed definitions.');
  }
  return feeds;
};

const fetchFeed = async (url) => {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'afo-feed-summarizer/1.0 (+https://github.com/tenki/afo)',
      accept: 'application/rss+xml, application/atom+xml;q=0.9, */*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
};

const ensureArray = (value) => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const getLinkFromAtom = (link) => {
  if (!link) {
    return undefined;
  }
  if (typeof link === 'string') {
    return link;
  }
  if (Array.isArray(link)) {
    for (const item of link) {
      const href = getLinkFromAtom(item);
      if (href) {
        return href;
      }
    }
    return undefined;
  }
  if (link.href) {
    return link.href;
  }
  if (link.url) {
    return link.url;
  }
  return undefined;
};

const normalizeArticle = (entry, sourceTitle) => {
  if (!entry) {
    return undefined;
  }
  const title =
    entry.title?.text || entry.title?.['#text'] || entry.title || 'Untitled entry';
  const link =
    entry.link?.href ||
    entry.link?.url ||
    entry.link ||
    entry.guid ||
    getLinkFromAtom(entry.link);
  const description =
    entry['content:encoded'] ||
    entry.content?.text ||
    entry.content ||
    entry.description ||
    entry.summary ||
    '';
  const published =
    entry.pubDate || entry.published || entry.updated || entry.modified || new Date().toUTCString();
  const publishedValue =
    typeof published === 'object'
      ? published?.text || published?.['#text'] || new Date().toUTCString()
      : published;
  const publishedDate = new Date(publishedValue);
  const safeDate = Number.isNaN(publishedDate.getTime()) ? new Date() : publishedDate;
  return {
    sourceTitle,
    title: typeof title === 'object' ? title?.['#text'] ?? 'Untitled entry' : title,
    link: typeof link === 'object' ? link?.href ?? link?.url ?? undefined : link,
    description: typeof description === 'object' ? description?.['#text'] ?? '' : description,
    publishedAt: safeDate,
  };
};

const extractArticles = (feedXml, fallbackTitle) => {
  const parsed = xmlParser.parse(feedXml);
  if (parsed?.rss?.channel) {
    const channel = parsed.rss.channel;
    const channelTitle = channel.title || fallbackTitle;
    const items = ensureArray(channel.item);
    return items
      .map((item) => normalizeArticle(item, channelTitle))
      .filter(Boolean);
  }
  if (parsed?.feed) {
    const feedTitle = parsed.feed.title || fallbackTitle;
    const entries = ensureArray(parsed.feed.entry);
    return entries
      .map((entry) => normalizeArticle(entry, feedTitle))
      .filter(Boolean);
  }
  throw new Error('Unsupported feed format encountered.');
};

const truncate = (text, limit) => {
  if (!text) {
    return '';
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…`;
};

const summarizeArticle = async (client, article) => {
  const content = truncate(article.description ?? '', SUMMARY_CHAR_LIMIT);
  const prompt = [
    `Summarize the following blog entry for senior software developers.`,
    `Source: ${article.sourceTitle}`,
    `Title: ${article.title}`,
    `Body: ${content || '(no body provided)'}`,
    `Output 2 concise sentences (<=75 words total) referencing the most important insight.`,
  ].join('\n');
  const response = await client.responses.create({
    model: DEFAULT_MODEL,
    input: prompt,
  });
  const summaryText =
    response.output?.[0]?.content?.[0]?.text ?? response.output_text ?? '';
  const summary = summaryText.trim() || truncate(article.description ?? '', 280);
  return {
    ...article,
    summary: summary.trim(),
  };
};

const buildRss = (items) => {
  const rssObject = {
    '?xml': {
      version: '1.0',
      encoding: 'UTF-8',
    },
    rss: {
      version: '2.0',
      channel: {
        title: CHANNEL_TITLE,
        link: CHANNEL_LINK,
        description: CHANNEL_DESCRIPTION,
        lastBuildDate: new Date().toUTCString(),
        language: 'en',
        item: items.map((item) => ({
          title: item.title,
          link: item.link ?? CHANNEL_LINK,
          guid: crypto.createHash('sha1').update(item.link ?? item.title).digest('hex'),
          pubDate: item.publishedAt?.toUTCString?.() ?? new Date().toUTCString(),
          description: `${item.sourceTitle}: ${item.summary}`,
        })),
      },
    },
  };
  return xmlBuilder.build(rssObject);
};

const writeOutput = async (outputPath, rssXml) => {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rssXml, 'utf-8');
};

const main = async () => {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const openai = new OpenAI({ apiKey });
  const feeds = await readOpmlFeeds(FEEDS_OPML);
  const limitedFeeds = feeds.slice(0, MAX_FEEDS);
  const summaries = [];
  for (const feed of limitedFeeds) {
    try {
      const feedXml = await fetchFeed(feed.xmlUrl);
      const articles = extractArticles(feedXml, feed.title).slice(0, MAX_ITEMS_PER_FEED);
      for (const article of articles) {
        try {
          const summarized = await summarizeArticle(openai, article);
          summaries.push(summarized);
        } catch (error) {
          console.error(`Failed to summarize "${article.title}":`, error.message);
        }
      }
    } catch (error) {
      console.error(`Failed to process feed "${feed.title}" (${feed.xmlUrl}):`, error.message);
    }
  }

  if (!summaries.length) {
    console.warn('No summaries were generated; skipping RSS creation.');
    return;
  }

  const rss = buildRss(summaries);
  await writeOutput(OUTPUT_RSS, rss);
  console.log(`Wrote ${summaries.length} summaries to ${OUTPUT_RSS}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

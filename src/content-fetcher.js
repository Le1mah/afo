import * as cheerio from 'cheerio';
import { config } from './config.js';
import { retryOnError } from './retry.js';

/**
 * Fetch HTML content from a URL with timeout
 * @param {string} url - The URL to fetch
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<string>} The HTML content
 */
const fetchWithTimeout = async (url, timeout) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; afo-feed-summarizer/1.0; +https://github.com/tenki/afo)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    
    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Extract main content from HTML using various heuristics
 * @param {string} html - The HTML content
 * @param {string} url - The source URL (for context)
 * @returns {Object} Extracted content with title, text, and metadata
 */
const extractContent = (html, url) => {
  const $ = cheerio.load(html);
  
  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, iframe, noscript, [role="navigation"], [role="banner"], [role="contentinfo"], .ad, .advertisement, .social-share, .comments').remove();
  
  let title = '';
  let content = '';
  let description = '';
  
  // Extract title
  title = $('meta[property="og:title"]').attr('content') ||
          $('meta[name="twitter:title"]').attr('content') ||
          $('title').text() ||
          $('h1').first().text() ||
          '';
  
  // Extract description
  description = $('meta[property="og:description"]').attr('content') ||
                $('meta[name="description"]').attr('content') ||
                $('meta[name="twitter:description"]').attr('content') ||
                '';
  
  // Try to find main content using common selectors
  const contentSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.entry-content',
    '.article-content',
    '.content',
    '#content',
    '.post-body',
    '.article-body',
  ];
  
  for (const selector of contentSelectors) {
    const element = $(selector).first();
    if (element.length && element.text().trim().length > 200) {
      content = element.text();
      break;
    }
  }
  
  // Fallback: use body content if no main content found
  if (!content || content.trim().length < 100) {
    content = $('body').text();
  }
  
  // Don't collapse all whitespace yet - preserve paragraph structure
  content = content
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  title = title.trim();
  description = description.trim();
  
  // Split into paragraphs using multiple strategies
  let paragraphs = [];
  
  // Strategy 1: Split by double newlines (traditional paragraph breaks)
  const byNewlines = content.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 100);
  
  if (byNewlines.length >= 3) {
    // Good paragraph extraction
    paragraphs = byNewlines;
  } else {
    // Strategy 2: Split by sentence groups (every 3-5 sentences)
    const sentences = content.split(/(?<=[.!?])\s+/);
    const sentencesPerParagraph = 4;
    
    for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
      const paragraphText = sentences.slice(i, i + sentencesPerParagraph).join(' ').trim();
      if (paragraphText.length > 100) {
        paragraphs.push(paragraphText);
      }
    }
  }
  
  // Limit to reasonable paragraph count
  paragraphs = paragraphs.slice(0, 15);
  
  // Now collapse whitespace for final content
  const cleanContent = content.replace(/\s+/g, ' ').trim();
  
  return {
    title,
    description,
    content: cleanContent,
    paragraphs,
    wordCount: cleanContent.split(/\s+/).length,
  };
};

/**
 * Fetch and extract article content from a URL
 * @param {string} url - The article URL
 * @param {Object} options - Options
 * @param {boolean} [options.retry=true] - Whether to retry on failure
 * @param {string} [options.fallbackContent=''] - Fallback content if fetch fails
 * @returns {Promise<Object>} Extracted content
 */
export const fetchArticleContent = async (url, options = {}) => {
  const {
    retry = true,
    fallbackContent = '',
  } = options;
  
  if (!config.enableFullArticleFetch) {
    return {
      title: '',
      description: '',
      content: fallbackContent,
      paragraphs: fallbackContent ? [fallbackContent] : [],
      wordCount: fallbackContent.split(/\s+/).length,
      fetchError: 'Full article fetch is disabled',
    };
  }
  
  try {
    const fetchFn = async () => {
      const html = await fetchWithTimeout(url, config.contentFetchTimeout);
      return extractContent(html, url);
    };
    
    if (retry) {
      return await retryOnError(fetchFn, {
        onRetry: (error, attempt, delay) => {
          console.warn(`Retry ${attempt} for ${url} after ${delay}ms: ${error.message}`);
        },
      });
    } else {
      return await fetchFn();
    }
  } catch (error) {
    console.error(`Failed to fetch article content from ${url}:`, error.message);
    
    // Return fallback content
    return {
      title: '',
      description: '',
      content: fallbackContent,
      paragraphs: fallbackContent ? [fallbackContent] : [],
      wordCount: fallbackContent.split(/\s+/).length,
      fetchError: error.message,
    };
  }
};

/**
 * Truncate text to a maximum length
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export const truncateText = (text, maxLength) => {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  return `${text.slice(0, maxLength)}…`;
};


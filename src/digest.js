import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import { fetchArticleContent, truncateText } from './content-fetcher.js';
import { retryOnError } from './retry.js';

// Load custom prompt if it exists
let customPrompt = null;
try {
  const promptPath = path.join(config.projectRoot, 'summary-prompt.md');
  customPrompt = await fs.readFile(promptPath, 'utf-8');
  console.log('✓ Loaded custom summary prompt from summary-prompt.md');
} catch (error) {
  if (error.code !== 'ENOENT') {
    console.warn('Failed to load summary-prompt.md:', error.message);
  }
}

/**
 * Generate a hash for an item to use as cache key
 * @param {Object} item - The feed item
 * @returns {string} SHA-256 hash
 */
export const generateItemHash = (item) => {
  const key = `${item.title || ''}|${item.link || ''}|${item.publishedAt?.toISOString() || ''}`;
  return crypto.createHash('sha256').update(key).digest('hex');
};

/**
 * Get the cache path for a digest
 * @param {string} itemHash - The item hash
 * @returns {string} Cache file path
 */
const getDigestCachePath = (itemHash) => {
  return path.join(config.digestCacheDir, `${itemHash}.json`);
};

/**
 * Read digest from cache
 * @param {string} itemHash - The item hash
 * @returns {Promise<Object|null>} Cached digest or null
 */
const readDigestCache = async (itemHash) => {
  if (!config.digestCacheEnabled) {
    return null;
  }
  
  try {
    const cachePath = getDigestCachePath(itemHash);
    const raw = await fs.readFile(cachePath, 'utf-8');
    const cached = JSON.parse(raw);
    
    const cachedAt = cached?.cachedAt ? new Date(cached.cachedAt) : null;
    if (!cachedAt || Date.now() - cachedAt.getTime() > config.digestCacheTtlMs) {
      return null;
    }
    
    return cached.digest;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Failed to read digest cache for ${itemHash}:`, error.message);
    }
    return null;
  }
};

/**
 * Write digest to cache
 * @param {string} itemHash - The item hash
 * @param {Object} digest - The digest data
 */
const writeDigestCache = async (itemHash, digest) => {
  if (!config.digestCacheEnabled) {
    return;
  }
  
  try {
    const cachePath = getDigestCachePath(itemHash);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    
    const payload = {
      cachedAt: new Date().toISOString(),
      digest,
    };
    
    await fs.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (error) {
    console.warn(`Failed to write digest cache for ${itemHash}:`, error.message);
  }
};

/**
 * Call OpenAI API to generate text
 * @param {Object} client - OpenAI client
 * @param {string} systemPrompt - System prompt
 * @param {string} userPrompt - User prompt
 * @returns {Promise<string>} Generated text
 */
const callOpenAI = async (client, systemPrompt, userPrompt) => {
  const response = await retryOnError(
    async () => {
      return await client.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });
    },
    {
      onRetry: (error, attempt, delay) => {
        console.warn(`OpenAI API retry ${attempt} after ${delay}ms: ${error.message}`);
      },
    }
  );
  
  return response.choices?.[0]?.message?.content?.trim() || '';
};

/**
 * Try to extract and parse JSON from a response that might be wrapped in markdown
 * @param {string} response - Raw response
 * @returns {Object|null} Parsed object or null
 */
const extractJson = (response) => {
  if (!response) return null;
  
  // Try direct parse first
  try {
    return JSON.parse(response.trim());
  } catch (e) {
    // Continue to other methods
  }
  
  // Try to extract JSON from markdown code block
  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Continue
    }
  }
  
  // Try to find JSON object pattern
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Continue
    }
  }
  
  return null;
};

/**
 * Generate all summaries using custom prompt (if available)
 * @param {Object} client - OpenAI client
 * @param {string} content - Full article content
 * @returns {Promise<Object|null>} Structured summary or null if custom prompt not used
 */
const generateWithCustomPrompt = async (client, content) => {
  if (!customPrompt) {
    return null;
  }
  
  console.log(`  → Using custom prompt to generate all summaries...`);
  
  const truncatedContent = truncateText(content, 12000);
  const maxRetries = config.maxRetries || 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const userPrompt = `${customPrompt}

## Article to Summarize:

${truncatedContent}

IMPORTANT: Output ONLY the JSON object, no markdown formatting, no code blocks, no additional text.`;
      
      const response = await callOpenAI(
        client,
        'You are an article summarization agent. Follow the instructions exactly. Output ONLY valid JSON - no markdown, no code blocks, no explanations.',
        userPrompt
      );
      
      // Try to parse JSON response
      const result = extractJson(response);
      
      if (result) {
        console.log(`  ✓ Custom prompt generated: ${result.metadata?.paragraph_count || result.paragraph_summary?.length || 0} paragraphs`);
        await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs));
        return result;
      }
      
      // JSON parsing failed
      if (attempt < maxRetries) {
        console.warn(`  ⚠️  JSON parse failed (attempt ${attempt}/${maxRetries}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs * 2));
      } else {
        console.warn(`  ⚠️  Failed to parse custom prompt JSON after ${maxRetries} attempts`);
        console.warn(`  Response preview:`, response.slice(0, 150).replace(/\n/g, ' '));
      }
      
    } catch (error) {
      if (attempt < maxRetries) {
        console.warn(`  ⚠️  Custom prompt error (attempt ${attempt}/${maxRetries}): ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs * 2));
      } else {
        console.error(`  ✗ Failed with custom prompt after ${maxRetries} attempts:`, error.message);
      }
    }
  }
  
  return null;
};

/**
 * Ask AI to split content into logical paragraphs/sections and summarize them
 * @param {Object} client - OpenAI client
 * @param {string} content - Full article content
 * @returns {Promise<Array<Object>>} Array of paragraph digests
 */
const generateParagraphDigests = async (client, content) => {
  if (!content || content.trim().length < 200) {
    console.log('  ⚠️  Content too short for paragraph digest generation');
    return [];
  }
  
  console.log(`  → Asking AI to split and summarize content...`);
  
  try {
    // Truncate content if too long
    const truncatedContent = truncateText(content, 8000);
    
    const systemPrompt = 'You are a technical content analyzer for senior developers. Your task is to intelligently split content into logical sections and create summaries.';
    
    const userPrompt = `Analyze this article and break it down into 5-8 key sections or main points. For each section, provide:
1. A brief title (2-4 words)
2. A concise 1-2 sentence summary

Format your response as a JSON array with objects containing "title" and "summary" fields.

Article content:
${truncatedContent}

Respond ONLY with valid JSON, no additional text.`;
    
    const response = await callOpenAI(client, systemPrompt, userPrompt);
    
    // Try to parse JSON response
    let paragraphs;
    try {
      // Extract JSON from response (in case there's markdown formatting)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;
      paragraphs = JSON.parse(jsonStr);
    } catch (parseError) {
      console.warn('  ⚠️  AI did not return valid JSON, falling back to simple split');
      // Fallback: treat response as plain text and split by lines
      paragraphs = response
        .split(/\n+/)
        .filter(line => line.trim().length > 20)
        .map((line, index) => ({
          title: `Point ${index + 1}`,
          summary: line.trim()
        }));
    }
    
    // Validate and format results
    const digests = paragraphs
      .filter(p => p && (p.summary || p.content))
      .slice(0, 10) // Limit to 10
      .map((p, index) => ({
        index,
        title: p.title || `Section ${index + 1}`,
        summary: p.summary || p.content || '',
      }));
    
    console.log(`  ✓ AI identified ${digests.length} key sections`);
    
    await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs));
    
    return digests;
    
  } catch (error) {
    console.error('  ✗ Failed to generate AI-split paragraphs:', error.message);
    
    // Fallback to manual split
    console.log('  → Falling back to manual paragraph splitting...');
    return await generateParagraphDigestsManual(client, content);
  }
};

/**
 * Fallback: Manual paragraph splitting and summarization
 * @param {Object} client - OpenAI client
 * @param {string} content - Full article content
 * @returns {Promise<Array<Object>>} Array of paragraph digests
 */
const generateParagraphDigestsManual = async (client, content) => {
  // Simple split by sentences grouped together
  const sentences = content.split(/(?<=[.!?])\s+/);
  const paragraphs = [];
  const sentencesPerGroup = 4;
  
  for (let i = 0; i < Math.min(sentences.length, 40); i += sentencesPerGroup) {
    const group = sentences.slice(i, i + sentencesPerGroup).join(' ').trim();
    if (group.length > 100) {
      paragraphs.push(group);
    }
  }
  
  const limitedParagraphs = paragraphs.slice(0, 8);
  console.log(`  → Summarizing ${limitedParagraphs.length} manual sections...`);
  
  const systemPrompt = 'You are a technical content summarizer. Create concise summaries.';
  const digests = [];
  
  for (const [index, paragraph] of limitedParagraphs.entries()) {
    try {
      const userPrompt = `Summarize in 1-2 sentences:\n\n${truncateText(paragraph, 800)}`;
      const summary = await callOpenAI(client, systemPrompt, userPrompt);
      
      digests.push({
        index,
        title: `Section ${index + 1}`,
        summary: summary || paragraph.slice(0, 200) + '...',
      });
      
      console.log(`    [${index + 1}/${limitedParagraphs.length}] ✓`);
      
      if (index < limitedParagraphs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs));
      }
    } catch (error) {
      console.error(`    [${index + 1}] ✗ ${error.message}`);
    }
  }
  
  return digests;
};

/**
 * Generate section-level digest (if applicable)
 * @param {Object} client - OpenAI client
 * @param {Array<Object>} paragraphDigests - Paragraph digests
 * @param {string} fullContent - Full article content
 * @returns {Promise<string>} Section digest
 */
const generateSectionDigest = async (client, paragraphDigests, fullContent) => {
  if (!paragraphDigests || paragraphDigests.length === 0) {
    return '';
  }
  
  try {
    const combinedParagraphs = paragraphDigests
      .map(p => p.summary)
      .join('\n\n');
    
    const systemPrompt = 'You are a technical content analyzer. Identify and summarize key sections or themes from the content.';
    const userPrompt = `Based on these paragraph summaries, identify 2-3 main sections or themes and provide a brief summary for each:\n\n${combinedParagraphs}`;
    
    const sectionSummary = await callOpenAI(client, systemPrompt, userPrompt);
    
    await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs));
    
    return sectionSummary;
  } catch (error) {
    console.error('Failed to generate section digest:', error.message);
    return paragraphDigests.slice(0, 3).map(p => p.summary).join(' ');
  }
};

/**
 * Generate overall digest
 * @param {Object} client - OpenAI client
 * @param {string} title - Article title
 * @param {string} content - Full or truncated content
 * @param {Array<Object>} paragraphDigests - Paragraph digests
 * @returns {Promise<string>} Overall digest
 */
const generateOverallDigest = async (client, title, content, paragraphDigests) => {
  try {
    const contextContent = paragraphDigests && paragraphDigests.length > 0
      ? paragraphDigests.map(p => p.summary).join('\n')
      : truncateText(content, 2000);
    
    const systemPrompt = 'You are a technical content summarizer for senior software developers. Create comprehensive yet concise summaries.';
    const userPrompt = `Write a comprehensive summary (3-5 sentences) of this article:\n\nTitle: ${title}\n\nContent:\n${contextContent}`;
    
    const overallSummary = await callOpenAI(client, systemPrompt, userPrompt);
    
    await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs));
    
    return overallSummary;
  } catch (error) {
    console.error('Failed to generate overall digest:', error.message);
    return truncateText(content, 300);
  }
};

/**
 * Generate one-line digest
 * @param {Object} client - OpenAI client
 * @param {string} title - Article title
 * @param {string} overallDigest - Overall digest
 * @returns {Promise<string>} One-line digest
 */
const generateOneLineDigest = async (client, title, overallDigest) => {
  try {
    const systemPrompt = 'You are a technical content summarizer. Create ultra-concise one-line summaries.';
    const userPrompt = `Create a single sentence summary (max 20 words) of this article:\n\nTitle: ${title}\n\nSummary: ${overallDigest}`;
    
    const oneLineSummary = await callOpenAI(client, systemPrompt, userPrompt);
    
    await new Promise(resolve => setTimeout(resolve, config.rateLimitDelayMs));
    
    return oneLineSummary;
  } catch (error) {
    console.error('Failed to generate one-line digest:', error.message);
    return truncateText(overallDigest, 100);
  }
};

/**
 * Generate multi-layer digest for an article
 * @param {Object} client - OpenAI client
 * @param {Object} item - Feed item with title, link, description, etc.
 * @returns {Promise<Object>} Multi-layer digest
 */
export const generateMultiLayerDigest = async (client, item) => {
  const itemHash = generateItemHash(item);
  
  // Check cache first
  const cached = await readDigestCache(itemHash);
  if (cached) {
    console.log(`Using cached digest for: ${item.title}`);
    return cached;
  }
  
  console.log(`Generating digest for: ${item.title}`);
  
  // Fetch full article content
  const articleContent = await fetchArticleContent(item.link, {
    fallbackContent: item.description || '',
  });
  
  // Log content extraction results
  if (articleContent.fetchError) {
    console.log(`  ⚠️  Article fetch failed: ${articleContent.fetchError} (using fallback)`);
  } else {
    console.log(`  ✓ Fetched article: ${articleContent.wordCount} words, ${articleContent.paragraphs.length} paragraphs`);
  }
  
  const content = articleContent.content || item.description || '';
  
  console.log(`  → Content ready: ${content.split(' ').length} words`);
  
  // Try custom prompt first (single API call for all summaries)
  const customResult = await generateWithCustomPrompt(client, content);
  
  let paragraphDigests, sectionDigest, overallDigest, oneLineDigest;
  
  if (customResult) {
    // Use custom prompt results
    paragraphDigests = (customResult.paragraph_summary || []).map((summary, index) => ({
      index,
      title: `Section ${index + 1}`,
      summary,
    }));
    sectionDigest = ''; // Not used with custom prompt
    overallDigest = customResult.overall_summary || '';
    oneLineDigest = customResult.one_line_summary || '';
  } else {
    // Fallback to multi-step approach
    console.log(`  → Falling back to multi-step digest generation...`);
    
    paragraphDigests = await generateParagraphDigests(client, content);
    
    console.log(`  → Generating section digest...`);
    sectionDigest = await generateSectionDigest(client, paragraphDigests, content);
    
    console.log(`  → Generating overall digest...`);
    overallDigest = await generateOverallDigest(client, item.title, content, paragraphDigests);
    
    console.log(`  → Generating one-line digest...`);
    oneLineDigest = await generateOneLineDigest(client, item.title, overallDigest);
  }
  
  const digest = {
    itemHash,
    title: item.title,
    link: item.link,
    sourceTitle: item.sourceTitle,
    publishedAt: item.publishedAt,
    articleContent: {
      fetchedSuccessfully: !articleContent.fetchError,
      wordCount: articleContent.wordCount,
      error: articleContent.fetchError,
    },
    digests: {
      paragraphs: paragraphDigests,
      sections: sectionDigest,
      overall: overallDigest,
      oneLine: oneLineDigest,
    },
  };
  
  // Cache the result
  await writeDigestCache(itemHash, digest);
  
  return digest;
};

/**
 * Format digest for feed output
 * @param {Object} digest - Multi-layer digest
 * @returns {string} Formatted digest text
 */
export const formatDigestForFeed = (digest) => {
  const parts = [];
  
  // One-line digest
  if (digest.digests.oneLine) {
    parts.push(digest.digests.oneLine);
  }
  
  parts.push('------');
  
  // Overall digest
  if (digest.digests.overall) {
    parts.push(digest.digests.overall);
  }
  
  parts.push('------');
  
  // Paragraph digests (with titles if available)
  if (digest.digests.paragraphs && digest.digests.paragraphs.length > 0) {
    const paragraphTexts = digest.digests.paragraphs
      .map((p, i) => {
        if (p.title && p.title !== `Section ${i + 1}`) {
          return `[${i + 1}] ${p.title}: ${p.summary}`;
        }
        return `[${i + 1}] ${p.summary}`;
      })
      .join('\n\n');
    parts.push('Key sections:\n' + paragraphTexts);
  }
  
  return parts.join('\n\n');
};


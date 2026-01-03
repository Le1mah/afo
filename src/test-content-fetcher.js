#!/usr/bin/env node

import { loadEnvFile } from './load-env.js';
loadEnvFile();

import { fetchArticleContent } from './content-fetcher.js';

const testUrl = process.argv[2];

if (!testUrl) {
  console.log('Usage: node src/test-content-fetcher.js <url>');
  console.log('Example: node src/test-content-fetcher.js https://example.com/article');
  process.exit(1);
}

console.log('Testing content fetcher for:', testUrl);
console.log('='.repeat(60));

try {
  const result = await fetchArticleContent(testUrl, { retry: false });
  
  console.log('\n📊 EXTRACTION RESULTS:\n');
  console.log('Title:', result.title || '(none)');
  console.log('Description:', result.description ? result.description.slice(0, 100) + '...' : '(none)');
  console.log('Word Count:', result.wordCount);
  console.log('Paragraphs Found:', result.paragraphs.length);
  
  if (result.fetchError) {
    console.log('\n❌ Fetch Error:', result.fetchError);
  }
  
  console.log('\n📝 PARAGRAPHS:\n');
  result.paragraphs.slice(0, 5).forEach((p, i) => {
    console.log(`[${i + 1}] ${p.slice(0, 200)}${p.length > 200 ? '...' : ''}`);
    console.log('');
  });
  
  if (result.paragraphs.length > 5) {
    console.log(`... and ${result.paragraphs.length - 5} more paragraphs`);
  }
  
  console.log('\n📄 FULL CONTENT (first 500 chars):\n');
  console.log(result.content.slice(0, 500) + '...');
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ Content extraction completed');
  
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}


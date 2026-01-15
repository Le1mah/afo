#!/usr/bin/env node
/**
 * Preview extension output in browser
 * Usage: node src/extensions/preview.js
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { runExtensions, formatExtensionSections } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const generatePreviewHtml = (extensionHtml) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Extension Preview</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .preview-container {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 2px solid #ddd;
      padding-bottom: 10px;
    }
    .meta {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="preview-container">
    <h1>📰 Extension Preview</h1>
    <p class="meta">Generated: ${new Date().toLocaleString()}</p>
    ${extensionHtml}
  </div>
</body>
</html>
`;

async function main() {
  console.log('🔍 Running extensions...\n');
  
  const results = await runExtensions({ date: new Date() });
  
  if (results.length === 0) {
    console.log('No extensions enabled or no output generated.');
    return;
  }
  
  const extensionHtml = formatExtensionSections(results);
  const fullHtml = generatePreviewHtml(extensionHtml);
  
  // Write to preview file
  const previewPath = path.join(__dirname, '../../extension-preview.html');
  await fs.writeFile(previewPath, fullHtml, 'utf-8');
  
  console.log(`\n✅ Preview saved to: ${previewPath}`);
  console.log(`\n📂 Open in browser: file://${previewPath}`);
  
  // Also output to terminal
  console.log('\n--- Terminal Preview ---\n');
  for (const result of results) {
    console.log(`[${result.name}] ${result.title}`);
  }
}

main().catch(console.error);

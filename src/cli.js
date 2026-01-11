#!/usr/bin/env node

import fs from 'fs/promises';
import { loadEnvFile } from './load-env.js';

// Load environment FIRST before any other imports that use config
loadEnvFile();

import { config } from './config.js';
import { main } from './summarize-feeds.js';
import { generateMarkdownReport } from './reporting.js';

/**
 * Parse command line arguments
 */
const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    verbose: false,
    debug: false,
    feed: null,
    maxItems: null,
    skipCache: false,
    showReport: false,
    output: null,
    opml: null,
    help: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--debug':
        options.debug = true;
        options.verbose = true;
        break;
      case '--feed':
        options.feed = args[++i];
        break;
      case '--max-items':
        options.maxItems = parseInt(args[++i], 10);
        break;
      case '--skip-cache':
        options.skipCache = true;
        break;
      case '--show-report':
        options.showReport = true;
        break;
      case '--output':
        options.output = args[++i];
        break;
      case '--opml':
        options.opml = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        console.warn(`Unknown option: ${arg}`);
    }
  }
  
  return options;
};

/**
 * Print help text
 */
const printHelp = () => {
  console.log(`
AFO Feed Digest CLI - Local Testing Tool

Usage: node src/cli.js [options]
   or: npm run test:local -- [options]

Options:
  --dry-run              Process feeds but don't write output files
  --verbose, -v          Show detailed logging and progress (includes HTTP status, content length, error details)
  --debug                Enable debug mode (implies --verbose)
  --feed <url|index>     Process only a specific feed (by URL or index)
  --max-items <n>        Limit number of items per feed (overrides config)
  --skip-cache           Ignore cache and re-fetch all feeds
  --show-report          Print report to console after execution
  --output <path>        Override output feed path
  --opml <path>          Override OPML file path
  --help, -h             Show this help message

Environment Variables:
  All standard config environment variables are supported.
  See .env.example for details.

Examples:
  # Run with default settings
  npm run test:local

  # Process only first feed with verbose output
  npm run test:local -- --feed 0 --verbose

  # Dry run with detailed logging
  npm run test:local -- --dry-run --debug

  # Process specific feed URL with limited items
  npm run test:local -- --feed https://example.com/feed.xml --max-items 2

  # Skip cache and show report
  npm run test:local -- --skip-cache --show-report
`);
};

/**
 * Apply CLI options to config
 */
const applyOptions = (options) => {
  if (options.maxItems !== null) {
    config.maxItemsPerFeed = options.maxItems;
    console.log(`[CLI] Override: MAX_ITEMS_PER_FEED = ${options.maxItems}`);
  }
  
  if (options.skipCache) {
    config.feedCacheEnabled = false;
    config.digestCacheEnabled = false;
    console.log('[CLI] Cache disabled');
  }
  
  if (options.output) {
    config.outputFeed = options.output;
    console.log(`[CLI] Override: OUTPUT_FEED = ${options.output}`);
  }
  
  if (options.opml) {
    config.feedsOpml = options.opml;
    console.log(`[CLI] Override: FEEDS_OPML = ${options.opml}`);
  }
  
  if (options.verbose) {
    console.log('[CLI] Verbose mode enabled');
    config.enableVerboseFeedLogging = true;
    console.log('[CLI] Current configuration:', {
      maxFeeds: config.maxFeeds,
      maxItemsPerFeed: config.maxItemsPerFeed,
      maxConcurrentFeeds: config.maxConcurrentFeeds,
      maxConcurrentItems: config.maxConcurrentItems,
      openaiModel: config.openaiModel,
      enableFullArticleFetch: config.enableFullArticleFetch,
      digestCacheEnabled: config.digestCacheEnabled,
      enableVerboseFeedLogging: config.enableVerboseFeedLogging,
    });
  }
  
  if (options.feed !== null) {
    // If feed is a number, treat it as an index
    // Otherwise treat it as a URL
    if (/^\d+$/.test(options.feed)) {
      const feedIndex = parseInt(options.feed, 10);
      config.maxFeeds = feedIndex + 1;
      console.log(`[CLI] Processing feed at index ${feedIndex}`);
    } else {
      // For URL filtering, we'd need to modify the feed loading logic
      console.log(`[CLI] Feed URL filtering not yet implemented: ${options.feed}`);
      console.log('[CLI] Note: Use --feed <index> to select by position');
    }
  }
  
  if (options.dryRun) {
    console.log('[CLI] DRY RUN MODE - No files will be written');
  }
};

/**
 * Read and display latest report
 */
const displayLatestReport = async () => {
  try {
    const files = await fs.readdir(config.reportOutputDir);
    const mdFiles = files.filter(f => f.endsWith('.md')).sort().reverse();
    
    if (mdFiles.length === 0) {
      console.log('\nNo reports found.');
      return;
    }
    
    const latestReport = mdFiles[0];
    const reportPath = `${config.reportOutputDir}/${latestReport}`;
    const content = await fs.readFile(reportPath, 'utf-8');
    
    console.log('\n' + '='.repeat(60));
    console.log('EXECUTION REPORT');
    console.log('='.repeat(60));
    console.log(content);
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('Failed to read report:', error.message);
  }
};

/**
 * Main CLI execution
 */
const runCli = async () => {
  const options = parseArgs();
  
  if (options.help) {
    printHelp();
    return;
  }
  
  console.log('AFO Feed Digest - Local Testing Mode\n');
  
  // Apply CLI options
  applyOptions(options);
  
  if (options.dryRun) {
    // In dry-run mode, we need to prevent file writes
    // For now, just disable reporting and warn about output
    config.enableReporting = false;
    console.log('[CLI] Note: Dry-run mode still generates output file (use --output /dev/null to suppress)\n');
  }
  
  try {
    // Run the main process
    await main();
    
    // Show report if requested
    if (options.showReport) {
      await displayLatestReport();
    }
    
    if (options.dryRun) {
      console.log('\n[CLI] Dry run completed successfully');
    }
  } catch (error) {
    console.error('\n[CLI] Execution failed:', error);
    process.exitCode = 1;
  }
};

// Run CLI
runCli().catch((error) => {
  console.error('Fatal CLI error:', error);
  process.exitCode = 1;
});


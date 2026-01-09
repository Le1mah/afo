# AFO - AI Feed Orchestrator

Multi-layer RSS/Atom feed digest system that generates comprehensive AI-powered summaries, running on GitHub Actions. Creates a **Daily Digest** - a single, newspaper-style entry with all today's articles organized by feed.

## Features

- 📰 **Daily Digest Mode**: Collects articles published today (UTC) and generates a single digest entry
- 🔄 **Multi-layer Digest Generation**: Paragraph → Section → Overall → One-line summaries
- 📑 **Organized by Feed**: Articles grouped by source feed with clear visual separation
- 🌐 **Full Article Fetching**: Extracts complete article content from links using intelligent HTML parsing
- ⚡ **Sequential Processing**: Configurable delays between items and feeds for rate limiting
- 🔁 **Smart Retry Logic**: Exponential backoff with jitter for resilient API calls
- 💾 **Intelligent Caching**: Two-tier caching (feed + digest) to minimize API calls
- 📊 **Comprehensive Reporting**: JSON and Markdown execution reports with per-feed stats
- 🎯 **Atom Feed Output**: Modern Atom 1.0 format with structured HTML content
- 🧪 **CLI Testing Tool**: Local testing with dry-run, verbose mode, and feed filtering
- 🤖 **GitHub Actions Ready**: Automated execution with cron scheduling

## How It Works

```
Daily Digest - January 9, 2026
Found 15 articles from 8 feeds

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📰 Smashing Magazine (3 articles)

▸ How To Design For Deaf People
  💡 一句话摘要
  
  整体摘要...
  
  📝 关键要点 (5 sections)
  - Section 1...
  - Section 2...

▸ Another Article
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📰 CSS-Tricks (2 articles)
...
```

The system:
1. Loads your OPML feed list
2. Fetches all feeds and filters to **today's articles only** (UTC)
3. Skips feeds with no new articles
4. Generates multi-layer AI summaries for each article
5. Groups articles by feed and creates a single daily digest entry
6. Outputs as an Atom feed that RSS readers can subscribe to

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required configuration:
- `OPENAI_API_KEY` - Your OpenAI API key (or compatible provider)
- `OPENAI_BASE_URL` - API endpoint (optional, for custom providers)

### 3. Add Your Feeds

Edit `Feeds.opml` with your RSS/Atom sources. You can export this from most feed readers.

### 4. Run Locally

```bash
# Full run
npm run summarize

# Test with CLI options
npm run test:local -- --verbose

# Dry run (no file writes)
npm run test:local -- --dry-run --debug

# Test date filtering
npm run test:date-filter
```

## Configuration

All configuration is via environment variables. See `.env.example` for complete list.

### Core Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *required* | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model to use for digests |
| `OPENAI_BASE_URL` | - | Custom API endpoint |
| `MAX_FEEDS` | `10` | Maximum feeds to process |

### Daily Digest Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DATE_FILTER_ENABLED` | `true` | Enable daily digest mode (today's articles only) |
| `INCLUDE_DATE_IN_TITLE` | `true` | Include date in digest title |
| `FALLBACK_DAYS` | `0` | Days to look back if no articles today (0 = no fallback) |

When `DATE_FILTER_ENABLED=true` (default):
- Only articles published today (UTC 00:00 - 23:59) are processed
- Feeds with no articles today are skipped
- Output is a single entry organized by feed

When `DATE_FILTER_ENABLED=false` (legacy mode):
- Processes the N latest articles per feed (based on `MAX_ITEMS_PER_FEED`)
- Each article becomes a separate entry in the output feed

### Legacy Mode Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ITEMS_PER_FEED` | `1` | Maximum items per feed (only used when `DATE_FILTER_ENABLED=false`) |

### Processing Delays

| Variable | Default | Description |
|----------|---------|-------------|
| `DELAY_BETWEEN_ITEMS_MS` | `0` | Delay between processing items (ms) |
| `DELAY_BETWEEN_FEEDS_MS` | `0` | Delay between processing feeds (ms) |
| `RATE_LIMIT_DELAY_MS` | `1000` | Delay between API calls |

### Retry Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_RETRIES` | `3` | Maximum retry attempts |
| `RETRY_BASE_DELAY_MS` | `1000` | Base retry delay |
| `RETRY_MAX_DELAY_MS` | `30000` | Maximum retry delay |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| `FEED_CACHE_TTL_MINUTES` | `60` | Feed cache duration |
| `DIGEST_CACHE_TTL_MINUTES` | `10080` | Digest cache duration (7 days) |
| `ENABLE_DIGEST_CACHE` | `true` | Enable digest caching |

### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_FULL_ARTICLE_FETCH` | `true` | Fetch full article content |
| `ENABLE_REPORTING` | `true` | Generate execution reports |

## CLI Usage

The CLI tool provides flexible local testing:

```bash
node src/cli.js [options]
# or
npm run test:local -- [options]
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Process without writing files |
| `--verbose`, `-v` | Detailed logging |
| `--debug` | Debug mode (implies verbose) |
| `--feed <index>` | Process specific feed by index |
| `--max-items <n>` | Override max items per feed |
| `--skip-cache` | Ignore all caches |
| `--show-report` | Display report after execution |
| `--output <path>` | Override output path |
| `--opml <path>` | Override OPML path |
| `--help`, `-h` | Show help |

### Examples

```bash
# Test with first feed only
npm run test:local -- --feed 0 --verbose

# Dry run with debug output
npm run test:local -- --dry-run --debug

# Process specific feed, skip cache
npm run test:local -- --feed 0 --skip-cache --show-report
```

## Output Format

### Daily Digest Mode (Default)

The system generates a **single Atom entry** with all today's articles organized by feed:

```html
<entry>
  <title>AFO AI Feed Digest - January 9, 2026</title>
  <id>daily-digest-2026-01-09</id>
  <content type="html">
    📰 Daily Digest - January 9, 2026
    Found 15 articles from 8 feeds
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    📰 Feed Name (3 articles)
    
    ▸ Article Title
      💡 One-line summary
      Overall summary...
      📝 Key sections (collapsible)
    
    ...
  </content>
</entry>
```

### Legacy Mode

When `DATE_FILTER_ENABLED=false`, generates individual entries per article:

```
Title: [Original Article Title]
Source: [Original Feed Name]

[One-line digest - ultra-concise summary]
------
[Overall digest - comprehensive 3-5 sentence summary]
------
Paragraph-level summaries:
[1] [First paragraph summary]
[2] [Second paragraph summary]
...
```

## Architecture

```
┌─────────────────┐
│  GitHub Actions │
│   (Cron/Manual) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Load OPML     │
│   Parse Feeds   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Fetch Feeds    │
│  (with cache)   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  Filter by Date (UTC)   │
│  Only today's articles  │
└────────┬────────────────┘
         │
         ▼
┌─────────────────┐
│ Fetch Full      │
│ Article Content │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Multi-layer     │
│ Digest (4 lvls) │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ Group by Feed           │
│ Build Daily Digest HTML │
└────────┬────────────────┘
         │
         ▼
┌─────────────────┐
│ Build Atom Feed │
│ (single entry)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Generate Reports│
│ Commit to Repo  │
└─────────────────┘
```

## GitHub Actions Setup

1. **Add Secrets**: Go to repository Settings → Secrets → Add:
   - `OPENAI_API_KEY` (required)
   - `OPENAI_BASE_URL` (optional, for custom providers)

2. **Configure Variables** (optional): Settings → Variables → Add any config overrides:
   - `OPENAI_MODEL`
   - `MAX_FEEDS`
   - `DATE_FILTER_ENABLED`
   - `DELAY_BETWEEN_ITEMS_MS`
   - `DELAY_BETWEEN_FEEDS_MS`
   - etc.

3. **Adjust Schedule**: Edit `.github/workflows/summarize.yml` cron expression:
   ```yaml
   schedule:
     - cron: '0 20 * * *'  # Daily at 8 PM UTC (4 AM SGT next day)
   ```

4. **Manual Trigger**: Actions tab → "Summarize feeds" → Run workflow

## Reports

Execution reports are generated in `reports/` directory:

- `execution-TIMESTAMP.json` - Structured data
- `execution-TIMESTAMP.md` - Human-readable summary

Reports include:
- Date and mode information (daily digest vs legacy)
- Feed processing statistics with per-feed article counts
- Item processing statistics  
- Error details with retry attempts
- Performance metrics

### Example Report

```markdown
# AFO Feed Digest Report

**📅 Date:** January 9, 2026
**Mode:** Daily Digest (today's articles)
**Generated:** 2026-01-09T20:00:00.000Z
**Duration:** 2m 15s

## Feed Processing Summary

- **Total Feeds Checked:** 10
- **Feeds with Articles:** 5
- **Successful:** 10
- **Failed:** 0

### Articles Per Feed

| Feed | Articles |
|------|----------|
| Smashing Magazine | 3 |
| CSS-Tricks | 2 |
| ...
```

## File Structure

```
src/
  ├── config.js              # Configuration management
  ├── date-filter.js         # UTC day filtering utilities
  ├── content-fetcher.js     # Full article content fetching
  ├── digest.js              # Multi-layer digest generation
  ├── retry.js               # Retry logic with exponential backoff
  ├── reporting.js           # Report generation (JSON + Markdown)
  ├── summarize-feeds.js     # Main orchestration
  ├── cli.js                 # CLI/test script
  ├── opml.js                # OPML parsing
  ├── load-env.js            # Environment loading
  ├── test-date-filter.js    # Date filter tests
  └── test-content-fetcher.js # Content fetcher tests

.cache/
  ├── feeds/                 # Feed cache
  └── digests/               # Digest cache

reports/                     # Execution reports
```

## Troubleshooting

### No Articles Found

If the daily digest is empty:
- Check if your feeds have articles published today (UTC)
- Try setting `DATE_FILTER_ENABLED=false` to process latest articles regardless of date
- Run `npm run test:date-filter` to verify date filtering is working
- Check feed timezone - articles must be published within UTC day boundaries

### Rate Limits

If you hit rate limits, adjust:
- `DELAY_BETWEEN_ITEMS_MS` - Add delay between items (e.g., `2000`)
- `DELAY_BETWEEN_FEEDS_MS` - Add delay between feeds (e.g., `5000`)
- `RATE_LIMIT_DELAY_MS` - Increase delay between API calls
- `MAX_RETRIES` - Increase retry attempts

### Memory Issues

For large feeds:
- Reduce `MAX_FEEDS`
- Enable caching to avoid reprocessing

### Article Fetch Failures

If article fetching fails frequently:
- Set `ENABLE_FULL_ARTICLE_FETCH=false` to use feed descriptions only
- Increase `CONTENT_FETCH_TIMEOUT_MS`
- Check `MAX_RETRIES` configuration

## Development

```bash
# Parse OPML structure
npm run parse:opml

# Test date filtering
npm run test:date-filter

# Test content fetcher
npm run test:content

# Test with verbose output
npm run test:local -- --verbose

# Debug specific feed
npm run test:local -- --feed 0 --debug --skip-cache
```

## License

MIT

## Contributing

Contributions welcome! Please follow the repository guidelines in `AGENTS.md`.

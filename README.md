# AFO - AI Feed Orchestrator

Multi-layer RSS/Atom feed digest system that generates comprehensive AI-powered summaries with full article content extraction, running on GitHub Actions.

## Features

- 🔄 **Multi-layer Digest Generation**: Paragraph → Section → Overall → One-line summaries
- 📰 **Full Article Fetching**: Extracts complete article content from links using intelligent HTML parsing
- ⚡ **Concurrent Processing**: Configurable concurrency for feeds and items
- 🔁 **Smart Retry Logic**: Exponential backoff with jitter for resilient API calls
- 💾 **Intelligent Caching**: Two-tier caching (feed + digest) to minimize API calls
- 📊 **Comprehensive Reporting**: JSON and Markdown execution reports
- 🎯 **Atom Feed Output**: Modern Atom 1.0 format with structured content
- 🧪 **CLI Testing Tool**: Local testing with dry-run, verbose mode, and feed filtering
- 🤖 **GitHub Actions Ready**: Automated execution with cron scheduling

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
npm run test:local -- --verbose --max-items 1

# Dry run (no file writes)
npm run test:local -- --dry-run --debug
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
| `MAX_ITEMS_PER_FEED` | `1` | Maximum items per feed |

### Concurrency & Performance

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_FEEDS` | `3` | Concurrent feed processing |
| `MAX_CONCURRENT_ITEMS` | `5` | Concurrent item processing |
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

# Process 2 items per feed, skip cache
npm run test:local -- --max-items 2 --skip-cache --show-report
```

## Output Format

The system generates an Atom feed with multi-layer digests:

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
│  Check Caches   │
│  (Feed+Digest)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Concurrent Feed │
│   Processing    │
└────────┬────────┘
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
┌─────────────────┐
│ Build Atom Feed │
│ Generate Reports│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Commit to Repo  │
└─────────────────┘
```

## GitHub Actions Setup

1. **Add Secret**: Go to repository Settings → Secrets → Add `OPENAI_API_KEY`

2. **Configure Variables** (optional): Settings → Variables → Add any config overrides:
   - `OPENAI_MODEL`
   - `MAX_FEEDS`
   - `MAX_ITEMS_PER_FEED`
   - `MAX_CONCURRENT_FEEDS`
   - `MAX_CONCURRENT_ITEMS`
   - etc.

3. **Adjust Schedule**: Edit `.github/workflows/summarize.yml` cron expression:
   ```yaml
   schedule:
     - cron: '0 12 * * *'  # Daily at noon UTC
   ```

4. **Manual Trigger**: Actions tab → "Summarize feeds" → Run workflow

## Reports

Execution reports are generated in `reports/` directory:

- `execution-TIMESTAMP.json` - Structured data
- `execution-TIMESTAMP.md` - Human-readable summary

Reports include:
- Execution metadata and duration
- Feed processing statistics
- Item processing statistics  
- Error details with retry attempts
- Performance metrics

## File Structure

```
src/
  ├── config.js              # Configuration management
  ├── content-fetcher.js     # Full article content fetching
  ├── digest.js              # Multi-layer digest generation
  ├── retry.js               # Retry logic with exponential backoff
  ├── reporting.js           # Report generation (JSON + Markdown)
  ├── summarize-feeds.js     # Main orchestration
  ├── cli.js                 # CLI/test script
  ├── opml.js                # OPML parsing
  └── load-env.js            # Environment loading

.cache/
  ├── feeds/                 # Feed cache
  └── digests/               # Digest cache

reports/                     # Execution reports
```

## Troubleshooting

### Rate Limits

If you hit rate limits, adjust:
- `RATE_LIMIT_DELAY_MS` - Increase delay between calls
- `MAX_CONCURRENT_ITEMS` - Reduce concurrency
- `MAX_RETRIES` - Increase retry attempts

### Memory Issues

For large feeds:
- Reduce `MAX_FEEDS` and `MAX_ITEMS_PER_FEED`
- Reduce `MAX_CONCURRENT_FEEDS` and `MAX_CONCURRENT_ITEMS`
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

# Test with verbose output
npm run test:local -- --verbose --max-items 1

# Debug specific feed
npm run test:local -- --feed 0 --debug --skip-cache
```

## License

MIT

## Contributing

Contributions welcome! Please follow the repository guidelines in `AGENTS.md`.

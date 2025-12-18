# AFO Feed Summaries

This repository orchestrates an AI-powered digest that reads every feed listed in `Feeds.opml`, summarizes the latest entries with OpenAI, and publishes the results as a consumable RSS file (`summary.xml`).

## Getting Started
1. Install dependencies once per environment:
   ```bash
   npm install
   ```
2. Export your OpenAI API key (and optional overrides), then run the summarizer:
   ```bash
   export OPENAI_API_KEY=sk-your-key
   npm run summarize
   ```
3. The script fetches the first entry from the first 10 feeds by default, writes summaries to `summary.xml`, and logs which feeds were processed.

## Configuration
The summarizer reads a handful of environment variables:
- `OPENAI_MODEL` – override the OpenAI Responses model (`gpt-4o-mini` default).
- `MAX_FEEDS` / `MAX_ITEMS_PER_FEED` – control how many feeds or entries are touched per run.
- `SUMMARY_FEED_TITLE`, `SUMMARY_FEED_DESCRIPTION`, `SUMMARY_FEED_LINK` – customize metadata for the generated RSS channel.
- `FEEDS_OPML` / `OUTPUT_RSS` – change source OPML or output paths when needed.

## GitHub Actions Automation
The workflow in `.github/workflows/summarize.yml` runs on a daily cron or manually. To enable it:
1. Add `OPENAI_API_KEY` to the repository secrets.
2. (Optional) Define repository variables for the configuration knobs listed above.
3. The workflow installs dependencies, runs `npm run summarize`, then commits a refreshed `summary.xml` back to the repository via `stefanzweifel/git-auto-commit-action`.

Once the workflow merges a few runs, point your RSS reader at the committed `summary.xml` file to read the AI-generated digest alongside your other feeds.

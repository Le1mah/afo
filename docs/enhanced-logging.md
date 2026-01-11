# Enhanced Feed Logging

This document describes the enhanced logging features added to help troubleshoot feed processing issues.

## Features Added

### 1. Detailed Error Information
When a feed fails to load, the system now logs:
- HTTP status code (e.g., `HTTP 403`)
- Content type (e.g., `[application/octet-stream]`)
- Content length (e.g., `[1024 bytes]`)
- Error codes (e.g., `[ECONNRESET]`)
- Content preview (first 200 characters) when available

### 2. Success Response Details
When a feed loads successfully, the system logs:
- HTTP status code (e.g., `HTTP 200`)
- Content length (e.g., `[15360 bytes]`)
- Content preview (when verbose mode is enabled)

### 3. Enhanced Retry Logging
Retry attempts now include the same detailed error information.

### 4. Verbose Mode
Use `--verbose` or `-v` flag to enable:
- Content previews for successful responses
- More detailed error information
- Enhanced troubleshooting information

## Usage Examples

### Basic Run (Standard Logging)
```bash
npm run test:local
```
Output:
```
✗ Charles Harries | Blog: Request failed with error code 403
✓ dbushell.com (all feeds): 3 article(s) today
```

### Verbose Run (Enhanced Logging)
```bash
npm run test:local -- --verbose
```
Output:
```
✗ Charles Harries | Blog: Request failed with error code 403 HTTP 403 (Forbidden) [text/html] [2048 bytes]
    Content preview: <html><head><title>403 Forbidden</title></head><body>...
✓ dbushell.com (all feeds): 3 article(s) [HTTP 200, 15360 bytes]
    Content preview: <?xml version="1.0" encoding="UTF-8"?><rss version="2.0">...
```

## Environment Variables

### ENABLE_VERBOSE_FEED_LOGGING
Enable verbose feed logging permanently (without --verbose flag):

```bash
export ENABLE_VERBOSE_FEED_LOGGING=true
npm run test:local
```

## Error Types Handled

### HTTP Errors
- `403 Forbidden` - Access denied
- `404 Not Found` - Feed doesn't exist
- `429 Too Many Requests` - Rate limited
- `500+` - Server errors

### Network Errors
- `ECONNRESET` - Connection reset
- `ETIMEDOUT` - Request timeout
- `ENOTFOUND` - DNS resolution failed
- `ECONNREFUSED` - Connection refused
- `EHOSTUNREACH` - Host unreachable

### Content Errors
- Invalid content type (e.g., `application/octet-stream`)
- Malformed XML
- Certificate errors

## Troubleshooting Guide

### 403 Forbidden
- Check if the feed requires authentication
- Verify user-agent is not blocked
- Consider adding authentication headers

### 404 Not Found
- Verify feed URL is correct
- Check if feed has moved
- Look for redirect information

### Invalid Content Type
- Feed might be serving binary data
- Check if URL points to actual feed
- Verify feed format (RSS/Atom)

### Certificate Errors
- Feed's SSL certificate might be expired
- Certificate chain might be incomplete
- Consider if feed should use HTTP instead

### Timeouts
- Feed server might be slow
- Network connectivity issues
- Consider increasing timeout values

## Implementation Details

The enhanced logging is implemented in:

- `src/summarize-feeds.js` - Main feed processing logic
- `src/retry.js` - Enhanced retry error detection
- `src/config.js` - Configuration for verbose logging
- `src/cli.js` - CLI integration for verbose mode

Key functions:
- `formatErrorDetails()` - Consistent error formatting
- `isRetryableError()` - Enhanced retry logic
- `fetchFeedEntries()` - Enhanced feed fetching with logging
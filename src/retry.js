import { config } from './config.js';

/**
 * Generates a delay with exponential backoff and jitter
 * @param {number} attempt - The attempt number (0-indexed)
 * @param {number} baseDelay - Base delay in milliseconds
 * @param {number} maxDelay - Maximum delay in milliseconds
 * @returns {number} Delay in milliseconds
 */
const calculateBackoffDelay = (attempt, baseDelay, maxDelay) => {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelay);
  // Add jitter (±25% randomness)
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.floor(cappedDelay + jitter);
};

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 * @template T
 * @param {() => Promise<T>} fn - The async function to retry
 * @param {Object} options - Retry options
 * @param {number} [options.maxRetries] - Maximum number of retries
 * @param {number} [options.baseDelay] - Base delay in milliseconds
 * @param {number} [options.maxDelay] - Maximum delay in milliseconds
 * @param {(error: Error, attempt: number) => boolean} [options.shouldRetry] - Function to determine if retry should occur
 * @param {(error: Error, attempt: number, delay: number) => void} [options.onRetry] - Callback on retry
 * @returns {Promise<T>} The result of the function
 * @throws {Error} The last error if all retries fail
 */
export const retryWithBackoff = async (fn, options = {}) => {
  const {
    maxRetries = config.maxRetries,
    baseDelay = config.retryBaseDelayMs,
    maxDelay = config.retryMaxDelayMs,
    shouldRetry = () => true,
    onRetry = null,
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }
      
      // Check if we should retry this error
      if (!shouldRetry(error, attempt)) {
        break;
      }
      
      // Calculate delay and wait
      const delay = calculateBackoffDelay(attempt, baseDelay, maxDelay);
      
      if (onRetry) {
        onRetry(error, attempt + 1, delay);
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError;
};

/**
 * Checks if an error is retryable (network errors, rate limits, timeouts)
 * @param {Error} error - The error to check
 * @returns {boolean} Whether the error is retryable
 */
export const isRetryableError = (error) => {
  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || 
      error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH' || error.code === 'EAI_AGAIN') {
    return true;
  }
  
  // HTTP status codes that should be retried
  if (error.status || error.statusCode) {
    const status = error.status || error.statusCode;
    // Retry on 429 (rate limit), 500, 502, 503, 504, and also on timeouts
    return status === 429 || status === 408 || (status >= 500 && status <= 504);
  }
  
  // OpenAI specific errors
  if (error.type === 'rate_limit_error' || error.type === 'server_error') {
    return true;
  }
  
  // Socket errors
  if (error.message && error.message.includes('socket hang up')) {
    return true;
  }
  
  // Certificate errors (might be temporary)
  if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || error.code === 'CERT_HAS_EXPIRED') {
    return false; // Don't retry certificate errors
  }
  
  return false;
};

/**
 * Wrapper for retrying with default retryable error checking
 * @template T
 * @param {() => Promise<T>} fn - The async function to retry
 * @param {Object} options - Retry options (same as retryWithBackoff)
 * @returns {Promise<T>} The result of the function
 */
export const retryOnError = async (fn, options = {}) => {
  return retryWithBackoff(fn, {
    shouldRetry: isRetryableError,
    ...options,
  });
};


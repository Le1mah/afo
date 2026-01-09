/**
 * Date filtering utilities for daily digest
 * Filters articles by UTC day
 */

/**
 * Get the start and end of today in UTC
 * @returns {{start: Date, end: Date}} Today's UTC day range
 */
export const getTodayRange = () => {
  const now = new Date();
  
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0
  ));
  
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23, 59, 59, 999
  ));
  
  return { start, end };
};

/**
 * Get the date range for a specific date
 * @param {Date} date - The date to get range for
 * @returns {{start: Date, end: Date}} The day's UTC range
 */
export const getDateRange = (date) => {
  const d = new Date(date);
  
  const start = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0, 0, 0, 0
  ));
  
  const end = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    23, 59, 59, 999
  ));
  
  return { start, end };
};

/**
 * Check if a date is within today (UTC)
 * @param {Date|string} date - The date to check
 * @returns {boolean} True if date is today
 */
export const isToday = (date) => {
  if (!date) return false;
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  
  const { start, end } = getTodayRange();
  return d >= start && d <= end;
};

/**
 * Check if a date is within a specified range
 * @param {Date|string} date - The date to check
 * @param {Date} start - Range start
 * @param {Date} end - Range end
 * @returns {boolean} True if date is within range
 */
export const isWithinRange = (date, start, end) => {
  if (!date) return false;
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return false;
  
  return d >= start && d <= end;
};

/**
 * Filter articles to only those published today (UTC)
 * @param {Array} entries - Array of feed entries with publishedAt field
 * @returns {Array} Entries published today
 */
export const filterTodayArticles = (entries) => {
  if (!entries || !Array.isArray(entries)) return [];
  
  const { start, end } = getTodayRange();
  
  return entries.filter(entry => {
    const publishedAt = entry.publishedAt;
    if (!publishedAt) return false;
    
    const date = new Date(publishedAt);
    if (isNaN(date.getTime())) return false;
    
    return date >= start && date <= end;
  });
};

/**
 * Filter articles within a date range
 * @param {Array} entries - Array of feed entries with publishedAt field
 * @param {Date} start - Range start
 * @param {Date} end - Range end
 * @returns {Array} Entries within range
 */
export const filterArticlesByRange = (entries, start, end) => {
  if (!entries || !Array.isArray(entries)) return [];
  
  return entries.filter(entry => {
    const publishedAt = entry.publishedAt;
    if (!publishedAt) return false;
    
    const date = new Date(publishedAt);
    if (isNaN(date.getTime())) return false;
    
    return date >= start && date <= end;
  });
};

/**
 * Get formatted date string for digest title
 * @param {Date} date - The date (defaults to today)
 * @returns {string} Formatted date string (e.g., "January 9, 2026")
 */
export const formatDateForTitle = (date = new Date()) => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });
};

/**
 * Get ISO date string for IDs
 * @param {Date} date - The date (defaults to today)
 * @returns {string} ISO date string (e.g., "2026-01-09")
 */
export const formatDateForId = (date = new Date()) => {
  return date.toISOString().split('T')[0];
};

/**
 * Get today's date info for logging
 * @returns {Object} Date info
 */
export const getTodayInfo = () => {
  const { start, end } = getTodayRange();
  return {
    dateString: formatDateForTitle(),
    dateId: formatDateForId(),
    start: start.toISOString(),
    end: end.toISOString(),
  };
};

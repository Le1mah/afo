/**
 * Year Progress Extension
 * Displays a visual progress bar showing how much of the year has passed
 */

/**
 * Check if a year is a leap year
 * @param {number} year - The year to check
 * @returns {boolean} True if leap year
 */
const isLeapYear = (year) => {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
};

/**
 * Get the day of year (1-365 or 1-366)
 * @param {Date} date - The date
 * @returns {number} Day of year
 */
const getDayOfYear = (date) => {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
};

/**
 * Generate SVG progress bar
 * @param {number} percentage - Percentage complete (0-100)
 * @param {Object} options - Styling options
 * @returns {string} SVG markup
 */
const generateProgressBarSvg = (percentage, options = {}) => {
  const {
    width = 400,
    height = 24,
    backgroundColor = '#e0e0e0',
    fillColor = '#4CAF50',
    borderRadius = 12,
    showPercentageText = true,
  } = options;
  
  const fillWidth = Math.max(0, Math.min(100, percentage));
  
  return `
<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="max-width: ${width}px;">
  <!-- Background -->
  <rect x="0" y="0" width="${width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}" fill="${backgroundColor}" />
  
  <!-- Progress fill -->
  <rect x="0" y="0" width="${(fillWidth / 100) * width}" height="${height}" rx="${borderRadius}" ry="${borderRadius}" fill="${fillColor}" />
  
  <!-- Percentage text (centered) -->
  ${showPercentageText ? `
  <text x="${width / 2}" y="${height / 2 + 1}" text-anchor="middle" dominant-baseline="middle" 
        font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" 
        font-size="12" font-weight="bold" fill="${fillWidth > 50 ? '#fff' : '#333'}">
    ${percentage.toFixed(1)}%
  </text>` : ''}
</svg>`.trim();
};

/**
 * Generate text-based progress bar (fallback)
 * @param {number} percentage - Percentage complete (0-100)
 * @param {number} width - Width in characters
 * @returns {string} Text progress bar
 */
const generateTextProgressBar = (percentage, width = 30) => {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
};

/**
 * Year Progress Extension
 */
export default {
  name: 'year-progress',
  order: -100, // Show first (before feeds)
  
  /**
   * Check if extension is enabled
   * @param {Object} config - App configuration
   * @returns {boolean} True if enabled
   */
  enabled: (config) => {
    return config.extensionYearProgress !== false;
  },
  
  /**
   * Run the extension
   * @param {Object} context - Extension context
   * @returns {Promise<Object>} Extension result with HTML
   */
  async run(context) {
    const { date = new Date() } = context;
    
    const year = date.getFullYear();
    const daysInYear = isLeapYear(year) ? 366 : 365;
    const dayOfYear = getDayOfYear(date);
    const percentage = (dayOfYear / daysInYear) * 100;
    
    // Calculate remaining days
    const remainingDays = daysInYear - dayOfYear;
    
    // Calculate weeks passed
    const weeksPassed = Math.floor(dayOfYear / 7);
    const weeksRemaining = Math.floor(remainingDays / 7);
    
    // Generate SVG progress bar
    const svgProgressBar = generateProgressBarSvg(percentage, {
      width: 400,
      height: 28,
      backgroundColor: '#e8eaed',
      fillColor: percentage < 25 ? '#4285f4' :  // Blue (Q1)
                 percentage < 50 ? '#34a853' :  // Green (Q2)
                 percentage < 75 ? '#fbbc04' :  // Yellow (Q3)
                                   '#ea4335',   // Red (Q4)
    });
    
    // Text fallback for readers that don't support SVG
    const textProgressBar = generateTextProgressBar(percentage);
    
    // Determine quarter
    const quarter = Math.ceil((date.getMonth() + 1) / 3);
    const quarterNames = ['Q1', 'Q2', 'Q3', 'Q4'];
    
    const html = `
<div style="text-align: center;">
  <!-- SVG Progress Bar -->
  <div style="margin: 10px 0;">
    ${svgProgressBar}
  </div>
  
  <!-- Stats -->
  <div style="display: flex; justify-content: space-around; flex-wrap: wrap; gap: 10px; margin-top: 15px;">
    <div style="text-align: center;">
      <div style="font-size: 1.5em; font-weight: bold; color: #333;">${dayOfYear}</div>
      <div style="font-size: 0.8em; color: #666;">Day of ${year}</div>
    </div>
    <div style="text-align: center;">
      <div style="font-size: 1.5em; font-weight: bold; color: #333;">${remainingDays}</div>
      <div style="font-size: 0.8em; color: #666;">Days Left</div>
    </div>
    <div style="text-align: center;">
      <div style="font-size: 1.5em; font-weight: bold; color: #333;">${quarterNames[quarter - 1]}</div>
      <div style="font-size: 0.8em; color: #666;">Quarter</div>
    </div>
    <div style="text-align: center;">
      <div style="font-size: 1.5em; font-weight: bold; color: #333;">${weeksPassed}</div>
      <div style="font-size: 0.8em; color: #666;">Weeks Passed</div>
    </div>
  </div>
  
  <!-- Text fallback (hidden by default, shown if SVG fails) -->
  <noscript>
    <pre style="font-family: monospace; margin: 10px 0;">${textProgressBar} ${percentage.toFixed(1)}%</pre>
  </noscript>
</div>`.trim();
    
    return {
      title: `📊 ${year} Progress`,
      html,
    };
  },
};

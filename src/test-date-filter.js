#!/usr/bin/env node
/**
 * Test script for date filtering functionality
 * Tests UTC day filtering logic with various edge cases
 */

import {
  getTodayRange,
  getDateRange,
  isToday,
  isWithinRange,
  filterTodayArticles,
  formatDateForTitle,
  formatDateForId,
  getTodayInfo,
} from './date-filter.js';

console.log('🧪 Testing Date Filter Module\n');
console.log('='.repeat(60));

// Test 1: getTodayRange
console.log('\n📅 Test 1: getTodayRange()');
const { start, end } = getTodayRange();
console.log(`  Start: ${start.toISOString()}`);
console.log(`  End:   ${end.toISOString()}`);
console.log(`  ✓ Range spans 24 hours: ${end - start === 86399999}`);

// Test 2: isToday
console.log('\n📅 Test 2: isToday()');
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

console.log(`  Now (${now.toISOString()}): ${isToday(now) ? '✓ Today' : '✗ Not Today'}`);
console.log(`  Yesterday: ${isToday(yesterday) ? '✗ Incorrectly marked as today' : '✓ Not Today'}`);
console.log(`  Tomorrow: ${isToday(tomorrow) ? '✗ Incorrectly marked as today' : '✓ Not Today'}`);
console.log(`  Null: ${isToday(null) ? '✗ Incorrectly marked as today' : '✓ Not Today'}`);
console.log(`  Invalid: ${isToday('invalid') ? '✗ Incorrectly marked as today' : '✓ Not Today'}`);

// Test 3: Edge cases at midnight UTC
console.log('\n📅 Test 3: UTC Midnight Edge Cases');
const todayMidnight = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate(),
  0, 0, 0, 0
));
const justBeforeMidnight = new Date(todayMidnight.getTime() - 1);
const justAfterMidnight = new Date(todayMidnight.getTime() + 1);
const endOfToday = new Date(Date.UTC(
  now.getUTCFullYear(),
  now.getUTCMonth(),
  now.getUTCDate(),
  23, 59, 59, 999
));
const justAfterEndOfToday = new Date(endOfToday.getTime() + 1);

console.log(`  Just before today's midnight (yesterday): ${isToday(justBeforeMidnight) ? '✗ Wrong' : '✓ Correct - Not Today'}`);
console.log(`  Today's midnight: ${isToday(todayMidnight) ? '✓ Correct - Today' : '✗ Wrong'}`);
console.log(`  Just after midnight: ${isToday(justAfterMidnight) ? '✓ Correct - Today' : '✗ Wrong'}`);
console.log(`  End of today (23:59:59.999): ${isToday(endOfToday) ? '✓ Correct - Today' : '✗ Wrong'}`);
console.log(`  Just after end of today (tomorrow): ${isToday(justAfterEndOfToday) ? '✗ Wrong' : '✓ Correct - Not Today'}`);

// Test 4: filterTodayArticles
console.log('\n📅 Test 4: filterTodayArticles()');
const testArticles = [
  { title: 'Today Article 1', publishedAt: now },
  { title: 'Today Article 2', publishedAt: new Date() },
  { title: 'Yesterday Article', publishedAt: yesterday },
  { title: 'Tomorrow Article', publishedAt: tomorrow },
  { title: 'No Date Article', publishedAt: null },
  { title: 'Invalid Date Article', publishedAt: 'invalid' },
];

const todayArticles = filterTodayArticles(testArticles);
console.log(`  Total articles: ${testArticles.length}`);
console.log(`  Articles from today: ${todayArticles.length}`);
console.log(`  Expected: 2`);
console.log(`  Result: ${todayArticles.length === 2 ? '✓ Correct' : '✗ Wrong'}`);
todayArticles.forEach(a => console.log(`    - ${a.title}`));

// Test 5: formatDateForTitle and formatDateForId
console.log('\n📅 Test 5: Date Formatting');
const testDate = new Date('2026-01-09T12:00:00Z');
console.log(`  formatDateForTitle: ${formatDateForTitle(testDate)}`);
console.log(`  formatDateForId: ${formatDateForId(testDate)}`);
console.log(`  Expected ID: 2026-01-09`);
console.log(`  Result: ${formatDateForId(testDate) === '2026-01-09' ? '✓ Correct' : '✗ Wrong'}`);

// Test 6: getTodayInfo
console.log('\n📅 Test 6: getTodayInfo()');
const info = getTodayInfo();
console.log(`  dateString: ${info.dateString}`);
console.log(`  dateId: ${info.dateId}`);
console.log(`  start: ${info.start}`);
console.log(`  end: ${info.end}`);

// Test 7: Empty and invalid arrays
console.log('\n📅 Test 7: Edge Cases for filterTodayArticles()');
console.log(`  Empty array: ${filterTodayArticles([]).length === 0 ? '✓ Returns []' : '✗ Wrong'}`);
console.log(`  Null input: ${filterTodayArticles(null).length === 0 ? '✓ Returns []' : '✗ Wrong'}`);
console.log(`  Undefined input: ${filterTodayArticles(undefined).length === 0 ? '✓ Returns []' : '✗ Wrong'}`);

console.log('\n' + '='.repeat(60));
console.log('✅ Date Filter Tests Complete\n');

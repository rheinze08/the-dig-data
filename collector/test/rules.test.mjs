// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {categorize, CATEGORIES} from '../lib/categories.mjs';
import {advanceStreak, promotionDecision} from '../lib/rules.mjs';

test('a streak counts consecutive clean days', () => {
  let run = advanceStreak(undefined, {date: '2026-11-20', ok: true});
  assert.equal(run.cleanRuns, 1);
  run = advanceStreak(run, {date: '2026-11-21', ok: true});
  run = advanceStreak(run, {date: '2026-11-22', ok: true});
  assert.equal(run.cleanRuns, 3);
  assert.equal(run.lastCleanDate, '2026-11-22');
});

test('a second run on the same day does not add to the streak', () => {
  let run = advanceStreak(undefined, {date: '2026-11-20', ok: true});
  run = advanceStreak(run, {date: '2026-11-20', ok: true});
  run = advanceStreak(run, {date: '2026-11-20', ok: true});
  assert.equal(run.cleanRuns, 1);
});

test('a failed collection resets the streak to 0', () => {
  let run = advanceStreak({cleanRuns: 5, lastCleanDate: '2026-11-20'}, {date: '2026-11-21', ok: false});
  assert.equal(run.cleanRuns, 0);
  assert.equal(run.lastResult, 'failed');
  run = advanceStreak(run, {date: '2026-11-21', ok: true});
  assert.equal(run.cleanRuns, 1);
  run = advanceStreak(run, {date: '2026-11-22', ok: true});
  assert.equal(run.cleanRuns, 2);
});

test('a skipped day starts the streak again at 1', () => {
  const run = advanceStreak({cleanRuns: 2, lastCleanDate: '2026-11-20'}, {date: '2026-11-22', ok: true});
  assert.equal(run.cleanRuns, 1);
});

test('the streak crosses a month and a year end', () => {
  assert.equal(advanceStreak({cleanRuns: 2, lastCleanDate: '2026-11-30'}, {date: '2026-12-01', ok: true}).cleanRuns, 3);
  assert.equal(advanceStreak({cleanRuns: 2, lastCleanDate: '2026-12-31'}, {date: '2027-01-01', ok: true}).cleanRuns, 3);
});

test('promotion needs 3 clean runs and 25 sales', () => {
  const proving = {status: 'proving'};
  const clean = cleanRuns => ({cleanRuns, lastResult: 'clean'});
  assert.equal(promotionDecision(proving, clean(3), 25).promote, true);
  assert.equal(promotionDecision(proving, clean(7), 108).promote, true);
  assert.equal(promotionDecision(proving, clean(2), 108).promote, false);
  assert.equal(promotionDecision(proving, clean(3), 24).promote, false);
  assert.equal(promotionDecision(proving, clean(3), null).promote, false);
  assert.equal(promotionDecision(proving, {cleanRuns: 3, lastResult: 'failed'}, 108).promote, false);
});

test('a live city is never judged', () => {
  assert.equal(promotionDecision({status: 'live'}, {cleanRuns: 0, lastResult: 'failed'}, 0).promote, false);
  assert.equal(promotionDecision({status: 'live'}, {cleanRuns: 9, lastResult: 'clean'}, 99).promote, false);
});

test('titles get the categories they clearly name', () => {
  const cases = [
    ['Grainfather Brewing System, Western Cowboy Art, Tools & Furniture', ['tools', 'furniture', 'art']],
    ['Elite Legacy- Prestonwood- Patio, Henredon, Snap-on, Knives, Appliances, Women’s Clothing, Floral', ['tools', 'furniture', 'clothing']],
    ['Vinyl Records, LPs & Turntable', ['vinyl & records', 'electronics']],
    ['Duncanville Estate Sale coins, jewelry, comics, Bev Doolittle', ['jewelry', 'collectibles']],
    ['1967 Corvette, Golf Cart and Boat', ['vehicles']],
    ['Pyrex, Cast Iron & Cookbooks', ['kitchen', 'books']],
    ['Vintage Toys & Games, Pool Table', ['toys & games']],
    ['Estate Sale', []],
    ['25% off! Perfect in Plano!', []],
  ];
  for (const [title, expected] of cases) assert.deepEqual(categorize(title), expected, title);
});

test('look-alike words are not tagged', () => {
  assert.deepEqual(categorize('The Art of Elegant Living'), []);
  assert.deepEqual(categorize('Art Deco Time Capsule'), []);
  assert.deepEqual(categorize('State of the art home'), []);
  assert.deepEqual(categorize('Santa’s Workshop estate sale'), []);
  assert.deepEqual(categorize('Jewel Box Estate Sale'), []);
  assert.deepEqual(categorize('Curated Collections in Carrollton'), []);
  assert.deepEqual(categorize('Bookcases and bookends'), ['furniture']);
  assert.deepEqual(categorize('Toy cars and model trucks'), ['toys & games']);
  assert.deepEqual(categorize('Famous American Record Producer from the 70s'), []);
  assert.deepEqual(categorize('8K+ items, 10K square feet'), []);
});

test('every tag is one of the twelve categories', () => {
  assert.equal(CATEGORIES.length, 12);
  assert.deepEqual(CATEGORIES, ['tools', 'furniture', 'vinyl & records', 'jewelry', 'collectibles', 'vehicles',
    'kitchen', 'clothing', 'books', 'art', 'electronics', 'toys & games']);
});

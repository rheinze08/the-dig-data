// The vision pass: ready to enable, and inert without a key. All API calls
// here are stubs; nothing in this suite reaches the network.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enrichSalesWithVision, photoCacheKey, visionFromEnv} from '../lib/vision.mjs';

const openAiReply = keywords => ({
  ok: true, status: 200,
  json: async () => ({choices: [{message: {content: JSON.stringify({keywords})}}]}),
});

test('no key in the environment means no vision pass', () => {
  assert.equal(visionFromEnv({}), null);
  assert.equal(visionFromEnv({OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '  '}), null);
  assert.deepEqual(visionFromEnv({OPENAI_API_KEY: 'sk-test'}),
    {provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o-mini'});
  assert.equal(visionFromEnv({ANTHROPIC_API_KEY: 'sk-ant-test'}).provider, 'anthropic');
  assert.equal(visionFromEnv({OPENAI_API_KEY: 'sk-test', DIG_VISION_MODEL: 'other-model'}).model, 'other-model');
});

test('the cache key is the photo URL hash', () => {
  assert.match(photoCacheKey('https://photos.example/a.jpg'), /^[0-9a-f]{64}$/);
  assert.notEqual(photoCacheKey('https://photos.example/a.jpg'), photoCacheKey('https://photos.example/b.jpg'));
});

test('cached photos are never scanned twice', async () => {
  const url = 'https://photos.example/cached.jpg';
  const cache = {[photoCacheKey(url)]: {keywords: ['figurines'], provider: 'openai', scannedAt: '2026-11-20T00:00:00.000Z'}};
  const sales = [{photoUrls: [url], photoKeywords: [], contentsLine: null}];
  let calls = 0;
  const stats = await enrichSalesWithVision(sales, {
    config: visionFromEnv({OPENAI_API_KEY: 'sk-test'}), cache,
    fetchImpl: async () => { calls++; return openAiReply(['should-not-be-used']); },
  });
  assert.equal(calls, 0);
  assert.equal(stats.scanned, 0);
  assert.equal(stats.cached, 1);
  assert.deepEqual(sales[0].photoKeywords, ['figurines']);
  assert.equal(sales[0].contentsLine, 'Figurines.');
});

test('a new photo is scanned once, cached, and merged into the sale', async () => {
  const cache = {};
  const sales = [{photoUrls: ['https://photos.example/new.jpg'], photoKeywords: ['furniture'], contentsLine: 'Furniture.'}];
  const stats = await enrichSalesWithVision(sales, {
    config: visionFromEnv({OPENAI_API_KEY: 'sk-test'}), cache,
    fetchImpl: async () => openAiReply(['vinyl records', 'turntable']),
    now: () => new Date('2026-11-21T11:00:00Z'),
  });
  assert.equal(stats.scanned, 1);
  assert.deepEqual(sales[0].photoKeywords, ['furniture', 'vinyl records', 'turntable']);
  assert.equal(sales[0].contentsLine, 'Furniture.', 'an existing contents line is left alone');
  const entry = cache[photoCacheKey('https://photos.example/new.jpg')];
  assert.deepEqual(entry.keywords, ['vinyl records', 'turntable']);
  assert.equal(entry.provider, 'openai');
});

test('at most 12 photos are scanned per sale, and the per-run cap holds', async () => {
  const urls = Array.from({length: 30}, (_, n) => 'https://photos.example/' + n + '.jpg');
  const sales = [{photoUrls: urls, photoKeywords: [], contentsLine: null},
    {photoUrls: ['https://photos.example/other.jpg'], photoKeywords: [], contentsLine: null}];
  let calls = 0;
  const stats = await enrichSalesWithVision(sales, {
    config: visionFromEnv({OPENAI_API_KEY: 'sk-test'}), cache: {},
    fetchImpl: async () => { calls++; return openAiReply(['tools']); },
    maxPerSale: 12, maxNewPerRun: 5,
  });
  assert.equal(calls, 5);
  assert.equal(stats.scanned, 5);
});

test('a failing vision API adds nothing and never breaks the collection', async () => {
  const sales = [{photoUrls: ['https://photos.example/x.jpg'], photoKeywords: ['tools'], contentsLine: 'Tools.'}];
  const stats = await enrichSalesWithVision(sales, {
    config: visionFromEnv({OPENAI_API_KEY: 'sk-test'}), cache: {},
    fetchImpl: async () => ({ok: false, status: 500, json: async () => ({})}),
  });
  assert.equal(stats.scanned, 0);
  assert.equal(stats.failed, 1);
  assert.deepEqual(sales[0].photoKeywords, ['tools']);
});

test('with no config the pass is a no-op', async () => {
  const sales = [{photoUrls: ['https://photos.example/x.jpg'], photoKeywords: [], contentsLine: null}];
  const stats = await enrichSalesWithVision(sales, {config: null, cache: {}, fetchImpl: async () => openAiReply(['x'])});
  assert.deepEqual([stats.scanned, stats.cached], [0, 0]);
  assert.deepEqual(sales[0].photoKeywords, []);
});

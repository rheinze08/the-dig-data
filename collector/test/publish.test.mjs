// search.json carries the Phase 9 signals when a feed has them, and keeps
// its previous shape for sales that predate them.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSearch} from '../lib/publish.mjs';

const config = {
  defaultCity: 'houston', publicFeedBase: 'https://example.org/feeds',
  cities: [{slug: 'houston', name: 'Houston', state: {code: 'TX'}, status: 'live'}],
};
const baseSale = {
  id: 'abc', title: 'Tools & Furniture', company: 'Acme', categories: ['tools'],
  sessions: [{date: '2026-11-21'}], lat: 29.7, lng: -95.4, approximate: true,
  sources: [{name: 'EstateSales.net', url: 'https://www.estatesales.net/TX/X/77005/1'}],
};

test('rating, photo count, keywords and contents line reach search.json', () => {
  const feed = {collectedAt: '2026-11-21T11:00:00.000Z', sales: [{...baseSale,
    digRating: 'Deep Dig', photoCount: 38, photoKeywords: ['tools', 'figurines'],
    contentsLine: 'Tools and figurines.'}]};
  const [entry] = buildSearch(config, {houston: feed}, '2026-11-21T11:00:00.000Z').sales;
  assert.equal(entry.digRating, 'Deep Dig');
  assert.equal(entry.photoCount, 38);
  assert.deepEqual(entry.photoKeywords, ['tools', 'figurines']);
  assert.equal(entry.contentsLine, 'Tools and figurines.');
});

test('a sale without the new fields keeps the previous search shape', () => {
  const feed = {collectedAt: '2026-11-21T11:00:00.000Z', sales: [baseSale]};
  const [entry] = buildSearch(config, {houston: feed}, '2026-11-21T11:00:00.000Z').sales;
  assert.deepEqual(Object.keys(entry), ['id', 'citySlug', 'cityName', 'status', 'title', 'company',
    'categories', 'firstDate', 'lastDate', 'lat', 'lng', 'approximate', 'sources']);
});

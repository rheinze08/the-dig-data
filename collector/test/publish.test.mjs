// search.json carries the Phase 9 signals when a feed has them, and keeps
// its previous shape for sales that predate them.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildSearch, PHOTO_URL_LIMIT, publicPhotoUrls} from '../lib/publish.mjs';

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

test('photoUrls reach search.json in source order, capped at twelve address strings', () => {
  const urls = Array.from({length: 15}, (_, i) => `https://picturescdn.estatesales.net/1/${15 - i}.jpg`);
  const feed = {collectedAt: '2026-11-21T11:00:00.000Z', sales: [
    {...baseSale, photoCount: 40, photoUrls: [null, urls[0], 'data:image/png;base64,xx', urls[0], ...urls.slice(1)]},
    {...baseSale, id: 'none', photoUrls: []},
    {...baseSale, id: 'junk', photoUrls: [42, 'not a url', 'https://']},
  ]};
  const [withPhotos, none, junk] = buildSearch(config, {houston: feed}, '2026-11-21T11:00:00.000Z').sales;
  assert.equal(PHOTO_URL_LIMIT, 12);
  assert.deepEqual(withPhotos.photoUrls, urls.slice(0, 12));
  assert.equal(withPhotos.photoCount, 40);
  assert.equal(Object.hasOwn(none, 'photoUrls'), false);
  assert.equal(Object.hasOwn(junk, 'photoUrls'), false);
});

test('publicPhotoUrls keeps only http(s) address strings and never invents a list', () => {
  assert.deepEqual(publicPhotoUrls(undefined), []);
  assert.deepEqual(publicPhotoUrls('https://a.example/1.jpg'), []);
  assert.deepEqual(publicPhotoUrls(['https://a.example/2.jpg', 'https://a.example/1.jpg', 'https://a.example/2.jpg']),
    ['https://a.example/2.jpg', 'https://a.example/1.jpg']);
});

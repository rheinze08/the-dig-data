// The deterministic photo/listing signals: rating, keywords, contents line.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildContentsLine, extractKeywords, rateSale, saleSignals} from '../lib/signals.mjs';

test('many photos and broad contents make a Deep Dig, with the reasons spelled out', () => {
  const {digRating, ratingReasons} = rateSale({
    photoCount: 38, categories: ['tools', 'furniture', 'kitchen', 'books'], days: 3,
  });
  assert.equal(digRating, 'Deep Dig');
  assert.equal(ratingReasons[0], '38 photos');
  assert.match(ratingReasons.join(' '), /tools, furniture and kitchen in the listing/);
  assert.ok(ratingReasons.length >= 2 && ratingReasons.length <= 3);
});

test('a middle sale is Worth a Look', () => {
  const {digRating, ratingReasons} = rateSale({photoCount: 12, categories: ['furniture'], days: 1});
  assert.equal(digRating, 'Worth a Look');
  assert.equal(ratingReasons[0], '12 photos');
});

test('few photos and no contents signals make Slim Pickings, still with reasons', () => {
  const known = rateSale({photoCount: 2, categories: [], days: 1});
  assert.equal(known.digRating, 'Slim Pickings');
  assert.deepEqual(known.ratingReasons, ['only 2 photos', 'few details in the listing']);
  const unknown = rateSale({photoCount: null, categories: [], days: 1});
  assert.equal(unknown.digRating, 'Slim Pickings');
  assert.deepEqual(unknown.ratingReasons, ['no photo count from the source', 'few details in the listing']);
});

test('every rating carries reasons, at the boundaries too', () => {
  for (const input of [
    {photoCount: 0, categories: [], days: 1},
    {photoCount: 500, categories: ['tools'], days: 1},
    {photoCount: null, categories: ['tools', 'furniture', 'art', 'books'], days: 4},
    {photoCount: 5, categories: ['jewelry', 'collectibles'], days: 2},
  ]) {
    const {digRating, ratingReasons} = rateSale(input);
    assert.ok(['Deep Dig', 'Worth a Look', 'Slim Pickings'].includes(digRating), digRating);
    assert.ok(ratingReasons.length >= 1 && ratingReasons.length <= 3, JSON.stringify(input));
  }
});

test('keywords come from the title, the description and photo captions only', () => {
  const keywords = extractKeywords({
    title: 'Estate Sale',
    description: 'Beautiful furniture, crystal and china, Beatles memorabilia and vinyl records throughout.',
    photoText: 'Brass figurines on the mantel',
    photoUrls: ['https://photos.example/5123/a1b2c3d4e5f6.jpg'],
  });
  assert.ok(keywords.includes('furniture'), keywords.join(', '));
  assert.ok(keywords.includes('vinyl & records'), keywords.join(', '));
  assert.ok(keywords.includes('china'), keywords.join(', '));
  assert.ok(keywords.includes('crystal'), keywords.join(', '));
  assert.ok(keywords.includes('figurines'), keywords.join(', '));
  assert.ok(!keywords.includes('tools'), keywords.join(', '));
});

test('a photo filename can carry a keyword, a hash name cannot', () => {
  assert.deepEqual(extractKeywords({title: 'Estate Sale', photoUrls: ['https://photos.example/brass-figurines.jpg']}),
    ['figurines']);
  assert.deepEqual(extractKeywords({title: 'Estate Sale', photoUrls: ['https://photos.example/bf52abd2-f859-4977.jpg']}),
    []);
});

test('no signals means no keywords and no contents line, never invented ones', () => {
  assert.deepEqual(extractKeywords({title: 'Estate Sale'}), []);
  assert.equal(buildContentsLine([]), null);
  const signals = saleSignals({title: 'Estate Sale', sessions: [{date: '2026-11-21'}], photoCount: null, photoUrls: []});
  assert.deepEqual(signals.photoKeywords, []);
  assert.equal(signals.contentsLine, null);
  assert.equal(signals.digRating, 'Slim Pickings');
  assert.ok(signals.ratingReasons.length >= 1);
});

test('the contents line names what is being sold in one line', () => {
  assert.equal(buildContentsLine(['tools', 'furniture', 'figurines', 'vinyl & records']),
    'Tools, furniture, figurines and vinyl & records.');
  assert.equal(buildContentsLine(['furniture']), 'Furniture.');
  assert.equal(buildContentsLine(['tools', 'furniture']), 'Tools and furniture.');
});

test('saleSignals rates the merged sale shape the collector builds', () => {
  const signals = saleSignals({
    title: 'Lifetime of Memories: Decor, Beatles, Star Wars & More!',
    description: 'Beautiful furnishings and artwork, crystal and china, Beatles memorabilia, vinyls and CDs.',
    photoText: null,
    photoCount: 522,
    photoUrls: ['https://picturescdn.estatesales.net/5135811/1-1/bf52abd2.jpg'],
    sessions: [{date: '2026-11-18'}, {date: '2026-11-19'}, {date: '2026-11-20'}, {date: '2026-11-21'}],
  });
  assert.equal(signals.digRating, 'Deep Dig');
  assert.equal(signals.ratingReasons[0], '522 photos');
  assert.ok(signals.photoKeywords.includes('vinyl & records'), signals.photoKeywords.join(', '));
  assert.match(signals.contentsLine, /\.$/);
});

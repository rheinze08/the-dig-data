// Dedupe fixtures: one sale record per real sale.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {groupSales, mergeGroup, titleSimilarity} from '../lib/pool.mjs';

let seq = 0;
const listing = (over = {}) => ({
  title: 'Estate Sale',
  company: null,
  streetAddress: null,
  city: 'Houston',
  zip: '77005',
  sessions: [{date: '2026-11-21', start: '09:00', end: '15:00'}],
  source: {name: 'Source' + (++seq), url: 'https://example.org/sale/' + seq},
  ...over,
});
const titlesOf = groups => groups.map(group => group.map(record => record.title));

test('the same sale on two sources with variant titles merges into one record', () => {
  // One source still holds the street address, the other has released it.
  // Same company, same ZIP, overlapping dates, and titles that clearly name
  // the same contents in different words.
  const records = [
    listing({title: 'Huge Estate Sale - Tools, Furniture & Vinyl Records', company: 'Acme Estate Sales LLC',
      streetAddress: '1210 W Gray St', sessions: [{date: '2026-11-21', start: '09:00', end: '15:00'}]}),
    listing({title: 'Estate Sale: Vinyl Records, Furniture and Tools Galore', company: 'Acme Estate Sales',
      sessions: [{date: '2026-11-21', start: '09:00', end: '16:00'}]}),
  ];
  const groups = groupSales(records);
  assert.equal(groups.length, 1, JSON.stringify(titlesOf(groups)));
  const sale = mergeGroup(groups[0]);
  assert.equal(sale.sources.length, 2);
  assert.equal(sale.streetAddress, '1210 W Gray St');
});

test('the real Creek Point / Creekpoint cross-post merges (the-dig-data, 2026-11-20)', () => {
  // The same Lewisville sale reached the published Dallas–Fort Worth feed
  // twice: one source wrote the street as two words, the other as one.
  const records = [
    listing({title: 'Relocating Everything must go', company: 'Bright Ridge Estate Sales',
      streetAddress: '1713 Creek Point Dr', city: 'Lewisville', zip: '75067',
      sessions: [{date: '2026-11-20', start: '10:00', end: '16:00'}, {date: '2026-11-21', start: '10:00', end: '16:00'}],
      source: {name: 'EstateSales.net', url: 'https://www.estatesales.net/TX/Lewisville/75067/5154030'}}),
    listing({title: 'Relocating everything must go!', company: 'Bright Ridge Estate Sales',
      streetAddress: '1713 Creekpoint Dr', city: 'Lewisville', zip: '75067',
      sessions: [{date: '2026-11-20', start: '10:00', end: '15:30'}, {date: '2026-11-21', start: '10:00', end: '15:30'}],
      source: {name: 'EstateSales.org', url: 'https://estatesales.org/estate-sales/tx/lewisville/75067/relocating-everything-must-go-2472890'}}),
  ];
  const groups = groupSales(records);
  assert.equal(groups.length, 1, JSON.stringify(titlesOf(groups)));
  const sale = mergeGroup(groups[0]);
  assert.deepEqual(sale.sources.map(source => source.name), ['EstateSales.org', 'EstateSales.net']);
  assert.deepEqual(sale.sessions.map(session => session.date), ['2026-11-20', '2026-11-21']);
});

test('a multi-day sale listed with different day sets keeps every session', () => {
  const records = [
    listing({title: 'Three Day Estate Sale', company: 'Acme Estate Sales', streetAddress: '44 Palm Court',
      sessions: [{date: '2026-11-20', start: '09:00', end: '15:00'}, {date: '2026-11-21', start: '09:00', end: '15:00'},
        {date: '2026-11-22', start: '10:00', end: '14:00'}]}),
    listing({title: 'Three Day Estate Sale!', company: 'Acme Estate Sales', streetAddress: '44 Palm Ct',
      sessions: [{date: '2026-11-21', start: '09:00', end: '15:00'}, {date: '2026-11-22', start: '10:00', end: '14:00'}]}),
  ];
  const groups = groupSales(records);
  assert.equal(groups.length, 1, JSON.stringify(titlesOf(groups)));
  assert.deepEqual(mergeGroup(groups[0]).sessions.map(session => session.date),
    ['2026-11-20', '2026-11-21', '2026-11-22']);
});

test('overlapping ranges at the same address merge even without a shared day', () => {
  // One source lists Friday and Sunday, the other only Saturday: the ranges
  // overlap, but no single date is shared.
  const records = [
    listing({title: 'Weekend Estate Sale', streetAddress: '9 Birch Lane',
      sessions: [{date: '2026-11-20', start: '09:00', end: null}, {date: '2026-11-22', start: '09:00', end: null}]}),
    listing({title: 'Weekend Estate Sale', streetAddress: '9 Birch Ln',
      sessions: [{date: '2026-11-21', start: '09:00', end: null}]}),
  ];
  assert.equal(groupSales(records).length, 1);
});

test('two same-company sales at different addresses the same weekend stay separate', () => {
  const records = [
    listing({title: 'Estate Sale - Tools & Furniture', company: 'Acme Estate Sales', streetAddress: '100 Oak Street'}),
    listing({title: 'Estate Sale - Tools & Furniture', company: 'Acme Estate Sales', streetAddress: '250 Pine Avenue'}),
  ];
  assert.equal(groupSales(records).length, 2);
});

test('the same address on different weekends is not one sale', () => {
  const records = [
    listing({streetAddress: '9 Birch Lane', sessions: [{date: '2026-11-21', start: '09:00', end: null}]}),
    listing({streetAddress: '9 Birch Ln', sessions: [{date: '2026-11-28', start: '09:00', end: null}]}),
  ];
  assert.equal(groupSales(records).length, 2);
});

test('same company and ZIP with unrelated contents in the titles stay separate', () => {
  const records = [
    listing({title: 'Estate Sale - Furniture & Home Decor', company: 'Acme Estate Sales'}),
    listing({title: 'Estate Sale - Tools, Garage & Workshop', company: 'Acme Estate Sales'}),
  ];
  assert.equal(groupSales(records).length, 2);
});

test('different ZIPs never merge on the company path', () => {
  const records = [
    listing({title: 'Estate Sale - Tools & Furniture', company: 'Acme Estate Sales', zip: '77005'}),
    listing({title: 'Estate Sale - Tools & Furniture', company: 'Acme Estate Sales', zip: '77006'}),
  ];
  assert.equal(groupSales(records).length, 2);
});

test('title similarity reads through filler words and punctuation', () => {
  assert.equal(titleSimilarity('Huge Estate Sale - Tools, Furniture & Vinyl Records',
    'Estate Sale: Vinyl Records, Furniture and Tools Galore'), true);
  assert.equal(titleSimilarity('Relocating Everything must go', 'Relocating everything must go!'), true);
  assert.equal(titleSimilarity('Estate Sale - Furniture & Home Decor', 'Estate Sale - Tools, Garage & Workshop'), false);
  assert.equal(titleSimilarity('Estate Sale', 'Estate Sale'), true);
  assert.equal(titleSimilarity('Estate Sale', 'Moving Sale - Everything Goes'), false);
});

test('mergeGroup pools contact, photos and descriptions from every listing', () => {
  const group = [
    listing({title: 'Tools & Furniture Estate Sale', company: 'Acme Estate Sales',
      photoUrls: ['https://photos.example/a.jpg', 'https://photos.example/b.jpg'], photoCount: 40,
      description: 'Tools, furniture and vinyl records throughout the house.'}),
    listing({title: 'Tools & Furniture Estate Sale', company: 'Acme Estate Sales',
      contactPhone: '(713) 555-0100', contactUrl: 'https://acme.example/', photoCount: 12,
      photoUrls: ['https://photos.example/b.jpg', 'https://photos.example/c.jpg'],
      description: 'Tools and furniture.'}),
  ];
  const sale = mergeGroup(group);
  assert.equal(sale.contactPhone, '(713) 555-0100');
  assert.equal(sale.contactUrl, 'https://acme.example/');
  assert.equal(sale.photoCount, 40);
  assert.deepEqual(sale.photoUrls,
    ['https://photos.example/a.jpg', 'https://photos.example/b.jpg', 'https://photos.example/c.jpg']);
  assert.equal(sale.description, 'Tools, furniture and vinyl records throughout the house.');
  assert.equal(sale.sources.length, 2);
});

test('a sale with no contact or photo signals merges without inventing them', () => {
  const sale = mergeGroup([listing({title: 'Plain Estate Sale'})]);
  assert.equal(sale.contactPhone, null);
  assert.equal(sale.contactUrl, null);
  assert.equal(sale.photoCount, null);
  assert.deepEqual(sale.photoUrls, []);
});

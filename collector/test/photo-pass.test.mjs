import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reconcilePhotos} from '../lib/photo-pass.mjs';

const photos = Array.from({length: 8}, (_, i) => 'https://photos.example/' + i);
const sale = (id, date) => ({id, title: 'Estate sale ' + id, sessions: [{date}], photoUrls: photos});
const read = {keywords: ['desks', 'chairs', 'lamps'], contentsLine: 'Desks with chairs and lamps.', readAt: '2026-11-20T01:02:03Z'};

test('queue uses first observation, stable opening-date/id ties, distinct IDs and actual source URLs', () => {
  const original = Array.from({length: 62}, (_, i) => sale('old-' + String(i).padStart(2, '0'), '2026-12-01'));
  const initial = reconcilePhotos({houston: {sales: original}}, {}, {}, '2026-11-20T01:00:00.000Z');
  const latest = {...sale('new', '2026-11-22'), photoUrls: [null, 'data:image/png,xxx', 'https://', photos[0], photos[0]]};
  const fresh = [
    ...original, latest, sale('z', '2026-11-21'), sale('a', '2026-11-21'), {...sale('no-photo', '2026-12-05'), photoUrls: []},
  ];
  const result = reconcilePhotos({houston: {sales: fresh}, austin: {sales: [sale('new', '2026-11-22')]}},
    {'old-00': read}, initial.state, '2026-11-21T01:00:00.000Z');
  assert.equal(result.queue.length, 60);
  assert.deepEqual(result.queue.slice(0, 4).map(entry => entry.id), ['new', 'a', 'z', 'old-01']);
  assert.deepEqual(result.queue[0], {id: 'new', title: latest.title, city: 'houston', photoUrls: photos.slice(0, 6)});
  assert.equal(new Set(result.queue.map(entry => entry.id)).size, 60);
  assert.ok(result.queue.every(entry => entry.photoUrls.length <= 6 && entry.photoUrls.length > 0));
  assert.ok(result.queue.every(entry => entry.id !== 'no-photo' && entry.id !== 'old-00'));
  assert.equal(result.state['old-00'].firstSeen, initial.state['old-00'].firstSeen);
});

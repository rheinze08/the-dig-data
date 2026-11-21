// The refresh path end to end, with a stand-in collector and a temporary home.
// node --test collector/test/*.test.mjs
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {dirUrl} from '../lib/config.mjs';
import {refresh} from '../lib/refresh.mjs';

const city = (slug, status) => ({
  slug, name: slug[0].toUpperCase() + slug.slice(1), state: {code: 'TX', name: 'Texas'},
  center: {lat: 30, lng: -97, label: 'downtown'}, radiusMiles: 25, timeZone: 'America/Chicago', status,
  sources: {estateSalesNet: {directory: 'https://www.estatesales.net/TX/Austin/78701'}},
});

async function makeHome(cities) {
  const dir = await mkdtemp(join(tmpdir(), 'dig-refresh-'));
  await mkdir(join(dir, 'collector/config'), {recursive: true});
  await mkdir(join(dir, 'collector/state'), {recursive: true});
  await writeFile(join(dir, 'collector/config/cities.json'), JSON.stringify({
    defaultCity: 'houston', publicFeedBase: 'https://raw.githubusercontent.com/rheinze08/the-dig-data/main', cities,
  }, null, 2) + '\n');
  await writeFile(join(dir, 'collector/config/discovery-zips.json'), JSON.stringify({
    cities: Object.fromEntries(cities.map(entry => [entry.slug, {zips: ['77001']}])),
  }));
  return dir;
}

const json = async (dir, path) => JSON.parse(await readFile(join(dir, path), 'utf8'));
const sale = (slug, n) => ({
  id: `${slug}-${n}`, title: n === 0 ? 'Tools & Furniture' : 'Estate Sale', company: n % 2 ? 'Acme Estate Sales' : null,
  streetAddress: null, city: 'Somewhere', state: 'TX', zip: '77001', addressHidden: true,
  sessions: [{date: '2026-11-21', start: '09:00', end: '15:00'}, {date: '2026-11-19', start: '09:00', end: '15:00'}],
  sources: [{name: 'EstateSales.net', url: `https://www.estatesales.net/TX/X/77001/${n}`}],
  categories: n === 0 ? ['tools', 'furniture'] : [], lat: 30, lng: -97, approximate: true,
});

// Stands in for collect.mjs: `plan[slug]` is the sale count to write, or false to fail.
let tick = 0;
function collector(dir, date, plan) {
  return async entry => {
    if (plan[entry.slug] === false) return false;
    await mkdir(join(dir, 'cities', entry.slug), {recursive: true});
    const feed = {asOf: date, collectedAt: `${date}T11:00:00.${String(tick++).padStart(3, '0')}Z`,
      window: {start: date, end: date, timeZone: 'America/Chicago'},
      sales: Array.from({length: plan[entry.slug]}, (_, n) => sale(entry.slug, n))};
    await writeFile(join(dir, 'cities', entry.slug, 'sales.json'), JSON.stringify(feed, null, 2) + '\n');
    return true;
  };
}

const quiet = () => {};
const day = (dir, date, plan) => refresh({home: dirUrl(dir), collect: collector(dir, date, plan), log: quiet,
  now: () => new Date(date + 'T17:00:00Z')});

test('proving cities publish, earn their way on, and Houston never regresses', async () => {
  const dir = await makeHome([city('houston', 'live'), city('austin', 'proving'), city('waco', 'proving')]);
  try {
    // Day 1: all three collect. Proving feeds are published and marked proving.
    let outcome = await day(dir, '2026-11-20', {houston: 28, austin: 26, waco: 12});
    assert.deepEqual(outcome.failed, []);
    assert.deepEqual(outcome.promoted, []);
    let index = await json(dir, 'cities.json');
    assert.deepEqual(index.cities.map(c => [c.slug, c.status, c.enabled, c.sales, c.cleanRuns]),
      [['houston', 'live', true, 28, 1], ['austin', 'proving', false, 26, 1], ['waco', 'proving', false, 12, 1]]);
    assert.equal(index.cities[1].feedUrl, 'https://raw.githubusercontent.com/rheinze08/the-dig-data/main/cities/austin/sales.json');
    assert.equal(index.cities[1].collectedAt, (await json(dir, 'cities/austin/sales.json')).collectedAt);
    // The root feed is Houston's feed, byte for byte.
    assert.deepEqual(await readFile(join(dir, 'sales.json')), await readFile(join(dir, 'cities/houston/sales.json')));

    // search.json carries every sale from live and proving cities.
    let search = await json(dir, 'search.json');
    assert.equal(search.sales.length, 28 + 26 + 12);
    assert.deepEqual(Object.keys(search.sales[0]), ['id', 'citySlug', 'cityName', 'status', 'title', 'company',
      'categories', 'firstDate', 'lastDate', 'lat', 'lng', 'approximate', 'sources']);
    const first = search.sales.find(entry => entry.id === 'austin-0');
    assert.deepEqual([first.citySlug, first.cityName, first.status, first.firstDate, first.lastDate, first.categories],
      ['austin', 'Austin', 'proving', '2026-11-19', '2026-11-21', ['tools', 'furniture']]);
    assert.equal(first.sources[0].url, 'https://www.estatesales.net/TX/X/77001/0');

    // A second run the same day changes no streak.
    await day(dir, '2026-11-20', {houston: 28, austin: 26, waco: 12});
    assert.equal((await json(dir, 'cities.json')).cities[1].cleanRuns, 1);

    // Day 2: Houston fails. Its feed and status stay; its streak resets; the others publish.
    const houstonBefore = await readFile(join(dir, 'cities/houston/sales.json'));
    outcome = await day(dir, '2026-11-21', {houston: false, austin: 27, waco: 30});
    assert.deepEqual(outcome.failed, ['houston']);
    index = await json(dir, 'cities.json');
    assert.deepEqual(index.cities.map(c => [c.slug, c.status, c.enabled, c.sales, c.cleanRuns]),
      [['houston', 'live', true, 28, 0], ['austin', 'proving', false, 27, 2], ['waco', 'proving', false, 30, 2]]);
    assert.deepEqual(await readFile(join(dir, 'cities/houston/sales.json')), houstonBefore);
    assert.deepEqual(await readFile(join(dir, 'sales.json')), houstonBefore);
    assert.equal((await json(dir, 'search.json')).sales.length, 28 + 27 + 30);

    // Day 3: Austin has 3 clean runs and 26 sales, so it goes live. Waco has 3 clean runs
    // but only 24 sales, so it stays proving.
    outcome = await day(dir, '2026-11-22', {houston: 29, austin: 26, waco: 24});
    assert.deepEqual(outcome.promoted, ['austin']);
    index = await json(dir, 'cities.json');
    assert.deepEqual(index.cities.map(c => [c.slug, c.status, c.enabled, c.cleanRuns]),
      [['houston', 'live', true, 1], ['austin', 'live', true, 3], ['waco', 'proving', false, 3]]);
    let config = await json(dir, 'collector/config/cities.json');
    assert.deepEqual(config.cities.map(c => c.status), ['live', 'live', 'proving']);
    assert.equal(config.cities[1].discoveryZips, undefined);
    assert.equal((await json(dir, 'collector/state/runs.json')).cities.austin.promotedOn, '2026-11-22');
    search = await json(dir, 'search.json');
    assert.equal(search.sales.find(entry => entry.citySlug === 'austin').status, 'live');

    // Day 4: Waco fails. Its streak resets to 0, so 25 sales tomorrow will not promote it.
    await day(dir, '2026-11-23', {houston: 29, austin: 26, waco: false});
    outcome = await day(dir, '2026-11-24', {houston: 29, austin: 26, waco: 40});
    assert.deepEqual(outcome.promoted, []);
    index = await json(dir, 'cities.json');
    assert.deepEqual(index.cities[2].cleanRuns, 1);
    assert.equal(index.cities[2].status, 'proving');

    // A live city that fails stays live, whatever its streak or count.
    await day(dir, '2026-11-25', {houston: 29, austin: false, waco: 40});
    config = await json(dir, 'collector/config/cities.json');
    assert.deepEqual(config.cities.map(c => c.status), ['live', 'live', 'proving']);
  } finally {
    await rm(dir, {recursive: true});
  }
});

test('a city that has never collected is listed without a feed', async () => {
  const dir = await makeHome([city('houston', 'live'), city('austin', 'proving')]);
  try {
    const outcome = await day(dir, '2026-11-20', {houston: 28, austin: false});
    assert.deepEqual(outcome.failed, ['austin']);
    const entry = (await json(dir, 'cities.json')).cities[1];
    assert.deepEqual([entry.status, entry.feedUrl, entry.sales, entry.collectedAt, entry.cleanRuns], ['proving', null, null, null, 0]);
    assert.equal((await json(dir, 'search.json')).sales.length, 28);
  } finally {
    await rm(dir, {recursive: true});
  }
});

test('a city dropped from the config loses its feed', async () => {
  const dir = await makeHome([city('houston', 'live'), city('austin', 'proving')]);
  try {
    await day(dir, '2026-11-20', {houston: 28, austin: 26});
    const config = await json(dir, 'collector/config/cities.json');
    config.cities.pop();
    await writeFile(join(dir, 'collector/config/cities.json'), JSON.stringify(config, null, 2));
    await day(dir, '2026-11-21', {houston: 28});
    await assert.rejects(readFile(join(dir, 'cities/austin/sales.json')), {code: 'ENOENT'});
    assert.deepEqual((await json(dir, 'cities.json')).cities.map(c => c.slug), ['houston']);
    assert.equal((await json(dir, 'collector/state/runs.json')).cities.austin, undefined);
  } finally {
    await rm(dir, {recursive: true});
  }
});

test('index-only rebuilds the public files without moving a streak', async () => {
  const dir = await makeHome([city('houston', 'live'), city('austin', 'proving')]);
  try {
    await day(dir, '2026-11-20', {houston: 28, austin: 26});
    const runs = await readFile(join(dir, 'collector/state/runs.json'), 'utf8');
    await rm(join(dir, 'cities.json'));
    await rm(join(dir, 'search.json'));
    await refresh({home: dirUrl(dir), log: quiet, now: () => new Date('2026-11-25T17:00:00Z')});
    assert.equal(await readFile(join(dir, 'collector/state/runs.json'), 'utf8'), runs);
    assert.deepEqual((await json(dir, 'cities.json')).cities.map(c => c.cleanRuns), [1, 1]);
    assert.equal((await json(dir, 'search.json')).sales.length, 54);
  } finally {
    await rm(dir, {recursive: true});
  }
});

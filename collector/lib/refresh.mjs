// The daily refresh: collect every city, keep each city's streak, apply the
// promotion rule, then rebuild cities.json and search.json.
import {copyFile, readdir, rm} from 'node:fs/promises';
import {collectionOrder, loadCities, paths, readJson, writeJson} from './config.mjs';
import {buildIndex, buildSearch} from './publish.mjs';
import {advanceStreak, promotionDecision, PROMOTION} from './rules.mjs';

function localDate(timeZone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'})
    .formatToParts(instant);
  return ['year', 'month', 'day'].map(name => parts.find(part => part.type === name).value).join('-');
}

// `collect(city)` collects one city into the home and resolves true on success.
// It must leave the city's previous feed in place when it fails.
// With `collect` omitted nothing is collected and no streak moves: the index
// and search files are rebuilt from the feeds already in the home.
export async function refresh({home, collect = null, log = console.log, now = () => new Date()}) {
  const at = paths(home);
  const config = await loadCities(home);
  const runs = await readJson(at.runs, {});
  runs.version = 1;
  runs.rule = {...PROMOTION};
  runs.cities ??= {};
  const feeds = {};
  const report = [];

  for (const city of collectionOrder(config)) {
    if (!collect) {
      feeds[city.slug] = await readJson(at.feed(city), null);
      continue;
    }
    const before = (await readJson(at.feed(city), null))?.collectedAt ?? null;
    let ok = false;
    try {
      ok = await collect(city) === true;
    } catch (error) {
      log(`Collection for ${city.slug} threw: ${error.message}`);
    }
    const feed = feeds[city.slug] = await readJson(at.feed(city), null);
    // A clean collection always leaves a new snapshot behind.
    if (ok && (!feed || feed.collectedAt === before)) {
      ok = false;
      log(`Collection for ${city.slug} reported success but wrote no new feed.`);
    }
    const run = runs.cities[city.slug] = advanceStreak(runs.cities[city.slug],
      {date: ok ? feed.asOf : localDate(city.timeZone, now()), ok});
    const entry = {slug: city.slug, name: city.name, ok, was: city.status, sales: feed ? feed.sales.length : null,
      collectedAt: feed?.collectedAt ?? null, cleanRuns: run.cleanRuns, promoted: false, note: ''};
    if (!ok) {
      entry.note = feed ? 'collection FAILED, previous feed kept' : 'collection FAILED, no feed yet';
    } else if (city.status === 'proving') {
      const decision = promotionDecision(city, run, feed.sales.length);
      if (decision.promote) {
        city.status = 'live';
        run.promotedOn = feed.asOf;
        entry.promoted = true;
        entry.note = 'PROMOTED proving -> live: ' + decision.reason;
      } else {
        entry.note = 'stays proving: ' + decision.reason;
      }
    }
    entry.status = city.status;
    report.push(entry);
  }

  // Forget the streaks and feeds of cities that are no longer configured.
  const known = new Set(config.cities.map(city => city.slug));
  for (const slug of Object.keys(runs.cities)) if (!known.has(slug)) delete runs.cities[slug];
  let folders = [];
  try {
    folders = await readdir(at.citiesDir, {withFileTypes: true});
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const folder of folders) {
    if (folder.isDirectory() && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder.name) && !known.has(folder.name)) {
      await rm(new URL(folder.name + '/', at.citiesDir), {recursive: true});
      log(`Removed the feed of ${folder.name}, which is no longer configured.`);
    }
  }

  const promoted = report.filter(entry => entry.promoted);
  if (promoted.length) await writeJson(config.file, config);
  if (collect) await writeJson(at.runs, runs);
  const fallback = config.cities.find(city => city.slug === config.defaultCity);
  // The root sales.json stays the default city's feed: app v0.1.1 reads that address.
  if (feeds[fallback.slug]) await copyFile(at.feed(fallback), at.rootFeed);
  await writeJson(at.index, buildIndex(config, runs, feeds));
  const search = buildSearch(config, feeds, now().toISOString());
  await writeJson(at.search, search);

  for (const entry of report) {
    log(`City ${entry.slug}: ${entry.status} sales=${entry.sales ?? 'none'} cleanRuns=${entry.cleanRuns}`
      + ` collectedAt=${entry.collectedAt ?? 'never'}${entry.note ? ' (' + entry.note + ')' : ''}`);
  }
  for (const entry of promoted) log(`PROMOTED ${entry.slug}: proving -> live (${entry.note.split(': ')[1]})`);
  log(`Index: ${config.cities.length} cities, ${config.cities.filter(city => city.status === 'live').length} live. `
    + `Search: ${search.sales.length} sales across ${search.cities.length} cities.`);
  return {report, promoted: promoted.map(entry => entry.slug), failed: report.filter(entry => !entry.ok).map(entry => entry.slug),
    searchSales: search.sales.length};
}

// Collects one city and writes its feed. refresh.mjs runs this for every city.
import {createHash} from 'node:crypto';
import {copyFile, mkdir, open, rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {collectNet, collectOrg} from './lib/net-org.mjs';
import {collectCl, collectCom, collectGsalr} from './lib/com-cl.mjs';
import {createLocator} from './lib/locate.mjs';
import {groupSales, hasSessionInWindow, mergeGroup, milesBetween} from './lib/pool.mjs';
import {categorize} from './lib/categories.mjs';
import {saleSignals} from './lib/signals.mjs';
import {enrichSalesWithVision, visionFromEnv} from './lib/vision.mjs';
import {lostSources} from './lib/rules.mjs';
import {defaultHome, dirUrl, findCity, loadCities, paths, readJson, writeJson} from './lib/config.mjs';

const usage = `Usage: node collector/collect.mjs [--city SLUG] [--date YYYY-MM-DD] [--report-only] [--config DIR] [--out DIR]
  --report-only  measure the city without touching its published feed
  --config DIR   read cities.json and discovery-zips.json from DIR (always report-only)
  --out DIR      where a report-only run writes (default collector/.report/<slug>/)`;
const options = {city: null, date: null, config: null, out: null, reportOnly: false};
for (let args = process.argv.slice(2); args.length;) {
  const flag = args.shift();
  const name = flag.slice(2);
  if (flag === '--report-only') options.reportOnly = true;
  else if (['--city', '--date', '--config', '--out'].includes(flag) && args.length && options[name] === null) options[name] = args.shift();
  else throw Error(usage);
}
// A city list from outside the home is a candidate being measured. It never publishes.
if (options.config) options.reportOnly = true;
if (options.out && !options.reportOnly) throw Error(usage);

const home = defaultHome();
const at = paths(home);
const config = await loadCities(home, options.config ? dirUrl(options.config) : undefined);
const city = findCity(config, options.city ?? config.defaultCity);
const stateDir = at.stateDir(city);
const outDir = options.reportOnly ? (options.out ? dirUrl(options.out) : at.reportDir(city)) : null;
const feedFile = options.reportOnly ? new URL('sales.json', outDir) : at.feed(city);
const cacheFile = new URL('geocodes.json', options.reportOnly ? outDir : stateDir);

// Coverage lists a city's sources in this fixed order.
const sources = [
  ['estateSalesNet', 'EstateSales.net', collectNet], ['estateSalesOrg', 'EstateSales.org', collectOrg],
  ['estateSaleCom', 'EstateSale.com', collectCom], ['craigslist', city.sources.craigslist?.name, collectCl],
  ['gsalr', 'GSALR.com', collectGsalr],
].filter(([key]) => city.sources[key]).map(([, name, collect]) => [name, collect]);
const zone = city.timeZone;
const localParts = new Intl.DateTimeFormat('en-US', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
}).formatToParts(new Date());
const localDate = ['year', 'month', 'day'].map(name => localParts.find(part => part.type === name).value).join('-');
const today = options.date || localDate;
const midnight = new Date(today + 'T00:00:00Z');
if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(+midnight)
    || midnight.toISOString().slice(0, 10) !== today) {
  throw Error(usage);
}
const through = new Date(+midnight + 13 * 86400000).toISOString().slice(0, 10);

// Header values must be Latin-1, and a city name can carry a dash outside it.
const agentCity = city.name.replace(/[^\x20-\x7e]/g, '-');

async function fetchSource(name, collect) {
  let nextPage = 0;
  async function get(url, {browserHeaders = false} = {}) {
    await delay(Math.max(0, nextPage - Date.now()));
    nextPage = Date.now() + 1100;
    try {
      const response = await fetch(url, {
        headers: browserHeaders ? {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 TheDig/5.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        } : {'User-Agent': 'TheDig/5.0 (' + agentCity + ' estate sale map; https://github.com/rheinze08/the-dig-data)'},
        signal: AbortSignal.timeout(18000),
      });
      if (!response.ok) throw Error('HTTP ' + response.status + ' ' + response.statusText);
      return await response.text();
    } catch (error) {
      throw Error(error.cause?.code || error.message);
    }
  }
  try {
    const result = await collect({today, through, get, city});
    console.log(name + ' ' + result.status + ': ' + result.detail);
    return result;
  } catch (error) {
    return {records: [], status: 'blocked', detail: error.message};
  }
}

// A source that cannot be read today must not quietly empty a published feed.
// The rule is lostSources in lib/rules.mjs.
function checkAgainstPrevious(previous, coverage) {
  const {lost, share, total, tooMany} = lostSources(previous?.coverage, coverage);
  // On GitHub Actions the warning also shows on the run's summary page.
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::warning title=Source blocked::' : 'WARNING ';
  for (const {name, included} of lost) {
    console.log(`${prefix}${city.slug}: ${name} is blocked on this run. It supplied ${included} of ${total} listings in the previous feed. ${coverage[name].detail}`);
  }
  if (tooMany) {
    throw Error(`Blocked sources supplied ${share} of ${total} listings in the previous ${city.slug} feed. The previous feed has been retained. `
      + lost.map(({name}) => name + ': ' + coverage[name].detail).join(' | '));
  }
}

async function refresh() {
  await mkdir(options.reportOnly ? outDir : stateDir, {recursive: true});
  // Earlier verified pins exist only for cities that had a hand-checked first survey.
  const pins = city.historicalPins ? (await readJson(new URL(city.historicalPins, stateDir))).pins : [];
  let cache = {};
  // A first report-only run starts from the city's published geocoding cache when it has one.
  for (const path of [cacheFile, new URL('geocodes.json', stateDir)]) {
    try {
      cache = await readJson(path);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const locator = createLocator(cache, pins, {state: city.state.name});
  const results = await Promise.all(sources.map(([name, collect]) => fetchSource(name, collect)));
  const coverage = {};
  const records = [];
  const seenUrls = new Set();
  for (const [index, {records: found, status, detail}] of results.entries()) {
    const name = sources[index][0];
    const entry = coverage[name] = {status, detail, candidates: 0, included: 0};
    for (const record of found) {
      if (!record.title || !record.source?.url || !record.sessions?.length || (!record.city && !record.zip)) {
        entry.status = 'partial';
        entry.detail += '; discarded incomplete listing ' + (record.source?.url || '(URL missing)');
        continue;
      }
      if (seenUrls.has(record.source.url)) continue;
      if (!hasSessionInWindow(record.sessions, today, through)) continue;
      seenUrls.add(record.source.url);
      records.push(record);
      entry.candidates++;
    }
  }
  if (!records.length && Object.values(coverage).some(s => s.status !== 'reached')) {
    throw Error('No fresh listings and incomplete coverage. The previous sales.json has been retained. ' + JSON.stringify(coverage));
  }
  if (!options.reportOnly) checkAgainstPrevious(await readJson(feedFile, null), coverage);

  const sales = [];
  const unlocated = [];
  let outsideRadius = 0;
  for (const group of groupSales(records)) {
    const sale = mergeGroup(group);
    const location = await locator.locate(sale, group);
    if (!location) {
      unlocated.push(...sale.sources.map(s => s.url));
      continue;
    }
    if (milesBetween(city.center, location) > city.radiusMiles) {
      outsideRadius++;
      continue;
    }
    for (const {name} of sale.sources) coverage[name].included++;
    const fingerprint = sale.sources[0].url;
    const id = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
    const {title, company, streetAddress, city: town, zip, addressHidden, sessions, sources: listings,
      contactPhone, contactUrl, photoCount, photoUrls} = sale;
    // Phase 9A fields. Contact and photo facts appear only when a source
    // publicly carried them; the rating, its reasons and the keywords are
    // derived from those facts by lib/signals.mjs. Stored photo URLs stop
    // at the vision scan cap — the count stays the source's true count.
    const published = {id, title, company, streetAddress, city: town, state: city.state.code, zip, addressHidden, sessions,
      sources: listings, categories: categorize(title)};
    if (contactPhone) published.contactPhone = contactPhone;
    if (contactUrl) published.contactUrl = contactUrl;
    if (photoCount !== null) published.photoCount = photoCount;
    if (photoUrls.length) published.photoUrls = photoUrls.slice(0, 12);
    const signals = saleSignals(sale);
    published.digRating = signals.digRating;
    published.ratingReasons = signals.ratingReasons;
    published.photoKeywords = signals.photoKeywords;
    if (signals.contentsLine) published.contentsLine = signals.contentsLine;
    sales.push({...published, ...location});
  }
  await writeJson(cacheFile, Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))));
  if (unlocated.length && !sales.length) throw Error('Geocoding was incomplete; previous sales.json retained. ' + [...locator.errors]);
  sales.sort((a, b) => a.sessions[0].date.localeCompare(b.sessions[0].date)
    || (a.sessions[0].start ?? '').localeCompare(b.sessions[0].start ?? '') || a.title.localeCompare(b.title)
    // Sales that tie on all three keep one order from run to run.
    || a.id.localeCompare(b.id));
  // The vision pass (lib/vision.mjs) runs only when a vision key is in the
  // environment; without one this is skipped whole and the collection is
  // unchanged. Trouble inside it is reported, never fatal.
  const vision = visionFromEnv();
  if (vision) {
    const scanFile = new URL('photo-scan.json', options.reportOnly ? outDir : stateDir);
    try {
      let scanCache = {};
      for (const path of [scanFile, new URL('photo-scan.json', stateDir)]) {
        try {
          scanCache = await readJson(path);
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      const perRun = Number(process.env.DIG_VISION_MAX_PER_RUN);
      const stats = await enrichSalesWithVision(sales, {config: vision, cache: scanCache,
        maxNewPerRun: Number.isFinite(perRun) && perRun > 0 ? perRun : 120});
      await writeJson(scanFile, Object.fromEntries(Object.entries(scanCache).sort(([a], [b]) => a.localeCompare(b))));
      console.log(`Vision (${vision.provider}): scanned=${stats.scanned} cached=${stats.cached} failed=${stats.failed} salesTouched=${stats.salesTouched}`);
    } catch (error) {
      console.log('Vision pass skipped: ' + error.message);
    }
  }
  const listings = sales.reduce((n, s) => n + s.sources.length, 0);
  const counts = {candidates: records.length, listings, sales: sales.length,
    duplicates: listings - sales.length, outsideRadius, unlocatedListings: unlocated.length};
  const snapshot = {asOf: today, collectedAt: new Date().toISOString(), window: {start: today, end: through, timeZone: zone},
    area: {lat: city.center.lat, lng: city.center.lng, radiusMiles: city.radiusMiles}, coverage, counts, unlocated,
    geocodingNotes: [...locator.errors], sales};
  if (!options.reportOnly) await mkdir(at.feedDir(city), {recursive: true});
  await writeJson(feedFile, snapshot);
  // The root sales.json is the default city's feed at the address app v0.1.1 reads.
  if (!options.reportOnly && city.slug === config.defaultCity) await copyFile(feedFile, at.rootFeed);
  console.log(JSON.stringify(counts));
  console.log(`${options.reportOnly ? 'Measured' : 'Collected'} ${city.slug}: sales=${sales.length} window=${today}..${through} collectedAt=${snapshot.collectedAt}`
    + (options.reportOnly ? ' (report only, nothing published)' : ''));
  if (unlocated.length || locator.errors.size) console.log({unlocated, geocodingNotes: [...locator.errors]});
}

let handle;
try {
  handle = await open(at.lock, 'wx');
} catch (error) {
  if (error.code === 'EEXIST') throw Error('A collection already holds collector/.refresh.lock (owner PID in file).');
  throw error;
}
try {
  await handle.writeFile(String(process.pid));
  await refresh();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await handle.close();
  await rm(at.lock, {force: true});
}

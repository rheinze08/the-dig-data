// City config, and where every file the collector reads or writes lives.
import {readFile, rename, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// The home is the-dig-data checkout that holds this collector: config and state
// sit under collector/, the public feeds at the top. A copy of the code that
// lives somewhere else names the home with DIG_DATA_HOME.
export const dirUrl = path => pathToFileURL(resolve(path) + '/');
export const defaultHome = () => process.env.DIG_DATA_HOME
  ? dirUrl(process.env.DIG_DATA_HOME) : new URL('../../', import.meta.url);

export const STATUSES = ['live', 'proving'];
const sourceKeys = ['estateSalesNet', 'estateSalesOrg', 'estateSaleCom', 'craigslist', 'gsalr'];

export function paths(home) {
  const at = path => new URL(path, home);
  return {
    home,
    configDir: at('collector/config/'),
    runs: at('collector/state/runs.json'),
    photoReads: at('photo-reads.json'),
    photoState: at('collector/state/photo-state.json'),
    photoQueue: at('collector/state/photo-queue.json'),
    lock: at('collector/.refresh.lock'),
    stateDir: city => at(`collector/state/${city.slug}/`),
    reportDir: city => at(`collector/.report/${city.slug}/`),
    feed: city => at(feedPath(city)),
    feedDir: city => at(`cities/${city.slug}/`),
    citiesDir: at('cities/'),
    rootFeed: at('sales.json'),
    index: at('cities.json'),
    search: at('search.json'),
  };
}

export const feedPath = city => `cities/${city.slug}/sales.json`;
export const feedUrl = (config, city) => `${config.publicFeedBase}/${feedPath(city)}`;

export async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function writeAtomic(url, text) {
  const tmp = new URL(url.href.replace(/([^/]+)$/, '.$1.' + process.pid + '.tmp'));
  try {
    await writeFile(tmp, text);
    await rename(tmp, url);
  } finally {
    await rm(tmp, {force: true});
  }
}

export const writeJson = (url, value) => writeAtomic(url, JSON.stringify(value, null, 2) + '\n');

// Reads the city list and each city's discovery ZIPs. A bad entry stops every
// command that depends on it instead of quietly collecting the wrong area.
// `configDir` defaults to the home's collector/config/.
export async function loadCities(home, configDir = paths(home).configDir) {
  const file = new URL('cities.json', configDir);
  const config = await readJson(file);
  const discovery = await readJson(new URL('discovery-zips.json', configDir), {cities: {}});
  const check = (condition, message) => {
    if (!condition) throw Error('cities.json: ' + message);
  };
  check(Array.isArray(config.cities) && config.cities.length, 'cities must be a non-empty list');
  check(/^https:\/\/\S+[^/]$/.test(config.publicFeedBase ?? ''), 'publicFeedBase must be an HTTPS URL without a trailing slash');
  const slugs = new Set();
  for (const city of config.cities) {
    check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city.slug ?? ''), 'invalid slug ' + JSON.stringify(city.slug));
    const at = city.slug + ': ';
    check(!slugs.has(city.slug), at + 'duplicate slug');
    slugs.add(city.slug);
    check(typeof city.name === 'string' && city.name.trim(), at + 'name is required');
    check(/^[A-Z]{2}$/.test(city.state?.code ?? '') && typeof city.state.name === 'string' && city.state.name.trim(),
      at + 'state needs a two-letter code and a name');
    check(Number.isFinite(city.center?.lat) && Math.abs(city.center.lat) <= 90
      && Number.isFinite(city.center?.lng) && Math.abs(city.center.lng) <= 180, at + 'center needs lat and lng');
    check(typeof city.center.label === 'string' && city.center.label.trim(), at + 'center.label is required');
    check(Number.isFinite(city.radiusMiles) && city.radiusMiles > 0, at + 'radiusMiles must be positive');
    check(STATUSES.includes(city.status), at + 'status must be "live" or "proving"');
    try {
      new Intl.DateTimeFormat('en-US', {timeZone: city.timeZone});
    } catch {
      check(false, at + 'unknown timeZone ' + JSON.stringify(city.timeZone));
    }
    check(city.sources && Object.keys(city.sources).length, at + 'at least one source is required');
    for (const [key, source] of Object.entries(city.sources)) {
      check(sourceKeys.includes(key), at + 'unknown source ' + key);
      check(/^https:\/\//.test(source?.directory ?? ''), at + key + ' needs an HTTPS directory');
    }
    check(!city.sources.craigslist || city.sources.craigslist.name, at + 'craigslist needs a source name');
    for (const key of ['estateSaleCom', 'gsalr']) {
      check(!city.sources[key] || city.sources[key].place, at + key + ' needs the place its directory names');
    }
    const zips = discovery.cities?.[city.slug]?.zips;
    check(Array.isArray(zips) && zips.length && zips.every(zip => /^\d{5}$/.test(zip)),
      at + 'discovery-zips.json has no ZIP list (run: node collector/cities.mjs zips ' + city.slug + ')');
    // Kept off the enumerable keys so the config can be written back unchanged.
    Object.defineProperty(city, 'discoveryZips', {value: new Set(zips), enumerable: false});
  }
  const fallback = config.cities.find(city => city.slug === config.defaultCity);
  check(fallback, 'defaultCity must name a listed city');
  check(fallback.status === 'live', 'defaultCity must be live');
  Object.defineProperty(config, 'file', {value: file, enumerable: false});
  return config;
}

export function findCity(config, slug) {
  const city = config.cities.find(candidate => candidate.slug === slug);
  if (!city) throw Error('Unknown city ' + JSON.stringify(slug) + '. Known: ' + config.cities.map(c => c.slug).join(', '));
  return city;
}

// Every city is collected on every refresh. The default city goes first.
export function collectionOrder(config) {
  return [...config.cities].sort((a, b) => Number(b.slug === config.defaultCity) - Number(a.slug === config.defaultCity));
}

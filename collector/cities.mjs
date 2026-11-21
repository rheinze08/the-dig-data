#!/usr/bin/env node
// City list tasks for people adding or checking a city.
import {readFile} from 'node:fs/promises';
import {defaultHome, dirUrl, feedPath, loadCities, paths, readJson, writeAtomic} from './lib/config.mjs';

const usage = `Usage: node collector/cities.mjs <command> [--config DIR]
  list         every city with its status, clean-run streak and feed path
  zips SLUG    fetch a city's discovery ZIPs from Census TIGERweb
  summary      one line with each published city's sale count, for the refresh commit message
  --config DIR use the cities.json and discovery-zips.json in DIR instead of collector/config/`;

// One ZIP list per line keeps this file's diffs readable.
function formatDiscovery(discovery) {
  const cities = Object.entries(discovery.cities).map(([slug, city]) => `    ${JSON.stringify(slug)}: {
      "box": ${JSON.stringify(city.box)},
      "queried": ${JSON.stringify(city.queried)},
      "zips": ${JSON.stringify(city.zips)}
    }`);
  return `{\n  "source": ${JSON.stringify(discovery.source)},\n  "cities": {\n${cities.join(',\n')}\n  }\n}\n`;
}

async function fetchZips(configDir, slug) {
  // The city may not have a ZIP list yet, so read the list without validating it.
  const city = JSON.parse(await readFile(new URL('cities.json', configDir))).cities.find(c => c.slug === slug);
  if (!city) throw Error('Unknown city ' + JSON.stringify(slug));
  const file = new URL('discovery-zips.json', configDir);
  const discovery = await readJson(file, {
    source: 'Census ZCTAs intersecting each box [west, south, east, north], from TIGERweb tigerWMS_Current/MapServer/2. Each box is the search circle plus a small margin.',
    cities: {},
  });
  // The circle's bounding box plus a 0.02-degree margin, rounded outward.
  const latPad = city.radiusMiles / 69 + 0.02;
  const lngPad = city.radiusMiles / (69.17 * Math.cos(city.center.lat * Math.PI / 180)) + 0.02;
  const down = value => Math.floor(value * 100) / 100;
  const up = value => Math.ceil(value * 100) / 100;
  const box = discovery.cities[slug]?.box ?? [down(city.center.lng - lngPad), down(city.center.lat - latPad),
    up(city.center.lng + lngPad), up(city.center.lat + latPad)];
  const url = new URL('https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query');
  url.search = new URLSearchParams({geometry: box.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', outFields: 'ZCTA5', returnGeometry: 'false', f: 'json'});
  const response = await fetch(url, {signal: AbortSignal.timeout(60000)});
  const result = await response.json();
  if (!response.ok || !Array.isArray(result.features) || result.exceededTransferLimit) {
    throw Error('TIGERweb did not return a complete ZIP list (HTTP ' + response.status + ')');
  }
  const zips = [...new Set(result.features.map(feature => feature.attributes.ZCTA5))].sort();
  if (!zips.length) throw Error('TIGERweb returned no ZIPs for ' + box.join(','));
  discovery.cities[slug] = {box, queried: new Date().toISOString().slice(0, 10), zips};
  await writeAtomic(file, formatDiscovery(discovery));
  console.log(`${slug}: ${zips.length} discovery ZIPs for box ${box.join(', ')}`);
}

const args = process.argv.slice(2);
const flag = args.indexOf('--config');
const custom = flag >= 0 ? args.splice(flag, 2)[1] : null;
const [command, ...rest] = args;
try {
  const home = defaultHome();
  if (flag >= 0 && !custom) throw Error(usage);
  const configDir = custom ? dirUrl(custom) : paths(home).configDir;
  if (command === 'zips' && rest.length === 1) {
    await fetchZips(configDir, rest[0]);
  } else if (command === 'list' && !rest.length) {
    const config = await loadCities(home, configDir);
    const runs = custom ? {} : await readJson(paths(home).runs, {});
    for (const city of config.cities) {
      console.log([city.slug, city.status, 'cleanRuns=' + (runs.cities?.[city.slug]?.cleanRuns ?? 0), feedPath(city)].join('\t'));
    }
  } else if (command === 'summary' && !rest.length) {
    const index = await readJson(paths(home).index);
    console.log(index.cities.filter(city => city.feedUrl).map(city => `${city.slug} ${city.sales}`).join(', '));
  } else {
    throw Error(usage);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

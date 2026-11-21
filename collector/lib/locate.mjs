import {setTimeout as delay} from 'node:timers/promises';
import {streetKey} from './pool.mjs';

const agent = 'TheDig/5.0 (estate sale map; https://github.com/rheinze08/the-dig-data)';
const norm = text => (text || '').toLowerCase().trim();

export function validPoint(point) {
  return point && Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

function isSameStreet(sale, number, address) {
  if (norm(address.house_number) !== norm(number) || !address.road) return false;
  if (sale.zip && address.postcode) {
    if (address.postcode.split('-')[0] !== sale.zip) return false;
  } else if (![address.town,address.city,address.village,address.municipality]
    .some(city => city && norm(city) === norm(sale.city))) return false;

  const requested = streetKey(sale.streetAddress.slice(number.length)).split(' unit ')[0];
  return requested === streetKey(address.road);
}

// `state` is the full name of the state the city's sales are in.
export function createLocator(cache, historicalSales, {state, spacing = 1100} = {}) {
  if (!state) throw Error('createLocator needs the state name');
  let nextRequest = 0;
  let suspended = false;
  const errors = new Set();
  const previous = new Map();
  for (const s of historicalSales) {
    const {lat, lng, basis, precision} = s.location;
    // Phase 1 is the first hand-checked Houston survey. Its notes flag one street-suffix mismatch. Use its area center unless
    // a current lookup resolves the actual published street.
    if (precision === 'street' && /; matched /i.test(basis)) continue;
    const key = precision === 'street' ? streetQueryKey(s) : 'zip:' + s.zip;
    previous.set(key, {lat, lng, basis: 'Phase 1: ' + basis});
  }

  function streetQueryKey(s) {
    return ['street', streetKey(s.streetAddress), s.zip || norm(s.city)].join(':');
  }

  async function lookup(key, query, accept) {
    if (validPoint(cache[key])) return cache[key];
    // A genuine empty match expires; network failures can be retried on the next run.
    if (cache[key]?.retryAfter > Date.now() || suspended) return null;
    await delay(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + spacing;
    const url = new URL('search', process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org/');
    url.search = new URLSearchParams({format:'jsonv2', countrycodes:'us', addressdetails:'1', limit:'3', ...query});
    try {
      const response = await fetch(url, {headers:{'User-Agent':agent}, signal:AbortSignal.timeout(15000)});
      if (!response.ok) {
        if ([403, 429, 503].includes(response.status)) suspended = true;
        throw Error('HTTP ' + response.status);
      }
      const results = await response.json();
      if (!Array.isArray(results)) throw Error('unexpected response');
      const result = results.find(r => r.address?.state === state && accept(r)
        && validPoint({lat:Number(r.lat), lng:Number(r.lon)}));
      if (!result) {
        cache[key] = {retryAfter:Date.now() + 7 * 24 * 3600000};
        return null;
      }
      return cache[key] = {lat:Number(result.lat), lng:Number(result.lon), basis:'OpenStreetMap Nominatim'};
    } catch (err) {
      errors.add('Nominatim: ' + err.message);
      return null;
    }
  }

  async function locate(sale, group) {
    if (sale.streetAddress) {
      const key = streetQueryKey(sale);
      // Distinguish Nominatim matches (including cached misses) from other public points.
      // This gives the published street a lookup even when an old listing pin exists.
      const lookupKey = 'nominatim:' + key;
      const number = sale.streetAddress.trim().match(/^\d+[a-z]?(?:-\d+)?\b/i)?.[0];
      const osm = cache[key]?.basis === 'OpenStreetMap Nominatim' ? cache[key] : null;
      if (!cache[lookupKey] && cache[key]?.retryAfter) cache[lookupKey] = cache[key];
      const hit = osm || (number && await lookup(lookupKey, {
        street:sale.streetAddress, city:sale.city || '', postalcode:sale.zip || '', state,
      }, r => isSameStreet(sale, number, r.address)));
      const shown = group.find(r => r.streetAddress && validPoint(r.point));
      const publicPoint = shown && {...shown.point, basis:'Public listing map: ' + shown.source.name};
      const cachedPoint = validPoint(cache[key]) ? cache[key] : null;
      const address = hit || publicPoint || cachedPoint || previous.get(key);
      if (address) {
        cache[key] = address;
        if (hit) delete cache[lookupKey];
        return {lat:address.lat, lng:address.lng, approximate:false};
      }
    }
    if (sale.zip) {
      const key = 'zip:' + sale.zip;
      const centroid = await lookup(key, {postalcode:sale.zip}, r => r.type === 'postcode'
        && r.address.postcode === sale.zip) || previous.get(key);
      if (centroid) {
        cache[key] = centroid;
        return {lat:centroid.lat, lng:centroid.lng, approximate:true};
      }
    }
    if (sale.city) {
      const key = 'city:' + norm(sale.city);
      const centroid = await lookup(key, {city:sale.city, state}, r =>
        ['city','town','village','municipality','hamlet','administrative'].includes(r.type)
        && [r.name,r.address.city,r.address.town,r.address.village].some(s => norm(s) === norm(sale.city)));
      if (centroid) return {lat:centroid.lat, lng:centroid.lng, approximate:true};
    }
    return null;
  }
  return {locate, errors};
}

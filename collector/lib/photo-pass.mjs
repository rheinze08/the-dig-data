// Listing sites don't share a publication clock. Track when an ID first enters
// the collector's feeds, retaining that timestamp while any city publishes it.
import {isDeepStrictEqual} from 'node:util';

const queueLimit = 60;
const photosPerSale = 6;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validatePhotoReads(reads) {
  if (!isObject(reads)) throw Error('photo-reads.json must be an object keyed by sale ID');
  for (const [id, read] of Object.entries(reads)) {
    if (!isObject(read) || !Array.isArray(read.keywords) || read.keywords.length < 3
        || read.keywords.length > 8 || !read.keywords.every(word => typeof word === 'string' && word.trim())
        || typeof read.contentsLine !== 'string' || !read.contentsLine.trim()
        || typeof read.readAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(read.readAt) || !Number.isFinite(Date.parse(read.readAt))) {
      throw Error('Invalid photo-reads.json entry for ' + id + ': expected 3–8 keywords, a contents line and an ISO readAt');
    }
  }
}

// Keep exactly the fields this pass overrides. Some older feeds lack one or
// both fields and descriptions/captions are never published. Re-deriving the
// original from a retained feed would silently discard those source signals.
function originalSignals(sale) {
  const fields = {};
  if (Object.hasOwn(sale, 'photoKeywords')) fields.photoKeywords = sale.photoKeywords;
  if (Object.hasOwn(sale, 'contentsLine')) fields.contentsLine = sale.contentsLine;
  return fields;
}

export function reconcilePhotos(feeds, reads, previous, observedAt) {
  validatePhotoReads(reads);
  const state = {};
  const candidates = new Map();
  const changedCities = new Set();
  for (const [city, feed] of Object.entries(feeds)) {
    for (const sale of feed?.sales ?? []) {
      const {id, title} = sale;
      const record = state[id] ??= {firstSeen: previous[id]?.firstSeen ?? observedAt};
      const read = reads[id];
      if (read || sale.photoRead === true) {
        const fallback = sale.photoRead === true ? previous[id]?.originals?.[city] : originalSignals(sale);
        if (!fallback) throw Error('Missing original photo signals for ' + city + '/' + id);
        // Save the original before changing a feed, even when undoing a
        // read, so an interrupted write can be safely retried.
        (record.originals ??= {})[city] = fallback;
        const signals = read ? {photoKeywords: read.keywords, contentsLine: read.contentsLine} : fallback;
        if (Boolean(read) !== (sale.photoRead === true) || !isDeepStrictEqual(originalSignals(sale), signals)) {
          delete sale.photoKeywords;
          delete sale.contentsLine;
          delete sale.photoRead;
          Object.assign(sale, signals);
          if (read) sale.photoRead = true;
          changedCities.add(city);
        }
      }
      if (read || !sale.photoUrls?.length) continue;
      const urls = sale.photoUrls.filter(url => typeof url === 'string' && /^https?:\/\//i.test(url) && URL.canParse(url));
      if (!urls.length) continue;
      let candidate = candidates.get(id);
      if (!candidate) {
        const firstDate = sale.sessions.map(session => session.date).sort()[0];
        candidate = {entry: {id, title, city, photoUrls: []}, firstDate, firstSeen: record.firstSeen};
        candidates.set(id, candidate);
      }
      const photos = candidate.entry.photoUrls;
      for (const url of urls) {
        if (photos.length >= photosPerSale) break;
        if (!photos.includes(url)) photos.push(url);
      }
    }
  }
  const queue = [...candidates.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)
    || b.firstDate.localeCompare(a.firstDate) || a.entry.id.localeCompare(b.entry.id))
    .slice(0, queueLimit).map(candidate => candidate.entry);
  return {
    state: Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b))),
    reads: Object.fromEntries(Object.entries(reads).filter(([id]) => Object.hasOwn(state, id))),
    queue, changedCities,
  };
}

// Builds the two public files that describe every feed: cities.json and search.json.
import {CATEGORIES} from './categories.mjs';
import {feedUrl} from './config.mjs';

// cities.json: one entry per city. `feeds` maps a slug to its feed, or null
// when the city has never collected. `enabled` is true only for live cities:
// app v0.2.0 and the website list a city when it is enabled and has a feed.
export function buildIndex(config, runs, feeds) {
  return {
    version: 2,
    defaultCity: config.defaultCity,
    searchUrl: config.publicFeedBase + '/search.json',
    cities: config.cities.map(city => {
      const feed = feeds[city.slug] ?? null;
      return {
        slug: city.slug, name: city.name, state: city.state.code, timeZone: city.timeZone,
        status: city.status, enabled: city.status === 'live',
        feedUrl: feed ? feedUrl(config, city) : null,
        sales: feed ? feed.sales.length : null,
        collectedAt: feed ? feed.collectedAt : null,
        cleanRuns: runs.cities?.[city.slug]?.cleanRuns ?? 0,
        center: {lat: city.center.lat, lng: city.center.lng, label: city.center.label},
        radiusMiles: city.radiusMiles,
      };
    }),
  };
}

// search.json: every sale from every live and proving city, cut down to what a
// search needs. firstDate and lastDate span the sale's whole published schedule.
export function buildSearch(config, feeds, generatedAt) {
  const sales = [];
  const cities = [];
  for (const city of config.cities) {
    const feed = feeds[city.slug];
    if (!feed) continue;
    cities.push({slug: city.slug, name: city.name, state: city.state.code, status: city.status,
      sales: feed.sales.length, collectedAt: feed.collectedAt});
    for (const sale of feed.sales) {
      const dates = sale.sessions.map(session => session.date).sort();
      const entry = {
        id: sale.id, citySlug: city.slug, cityName: city.name, status: city.status,
        title: sale.title, company: sale.company ?? null,
        categories: Array.isArray(sale.categories) ? sale.categories : [],
        firstDate: dates[0], lastDate: dates.at(-1),
        lat: sale.lat, lng: sale.lng, approximate: sale.approximate,
        sources: sale.sources.map(({name, url}) => ({name, url})),
      };
      // Phase 9 search signals ride along when the feed carries them, so a
      // keyword search can match what a sale is selling. Feeds written
      // before those fields existed keep their previous search shape.
      if (sale.digRating) entry.digRating = sale.digRating;
      if (Number.isFinite(sale.photoCount)) entry.photoCount = sale.photoCount;
      if (Array.isArray(sale.photoKeywords) && sale.photoKeywords.length) entry.photoKeywords = sale.photoKeywords;
      if (sale.contentsLine) entry.contentsLine = sale.contentsLine;
      sales.push(entry);
    }
  }
  return {version: 1, generatedAt, categories: CATEGORIES, cities, sales};
}

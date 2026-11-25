import {hasSessionInWindow} from './pool.mjs';

// Each city's discovery ZIPs (collector/config/discovery-zips.json) deliberately over-select.
// The collector measures each pin against the city's circle after resolving its
// public location.
const netSitemap = 'https://www.estatesales.net/site-maps/sale';
const netTypes = new Set(['EstateSales', 'MovingSales', 'MovedOffsiteToWarehouse', 'ByAppointment']);
const entities = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' };

function decode(value) {
  return String(value ?? '').replace(/&(\w+|#\d+|#x[\da-f]+);/gi, (encoded, key) => {
    if (key.startsWith('#')) {
      const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return n <= 0x10ffff ? String.fromCodePoint(n) : encoded;
    }
    return entities[key] ?? encoded;
  }).replace(/\s+/g, ' ').trim();
}

function visible(html) {
  return decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function challenge(error) {
  return /\b(?:401|403|429)\b|challenge|captcha|access denied/i.test(error.message);
}

async function readListings(urls, parse, get, today, through) {
  const records = [];
  const failures = [];
  let checked = 0;
  for (const url of urls) {
    try {
      const record = parse(await get(url), url);
      checked++;
      if (record && hasSessionInWindow(record.sessions, today, through)) records.push(record);
    } catch (error) {
      failures.push(`${url} — ${error.message}`);
      if (challenge(error)) break;
    }
  }
  return {records, checked, failures};
}

function netState(html) {
  const script = html.match(/<script\b[^>]*\bid="estatesales-net-state"[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw Error('Public page is missing the listing state');
  return JSON.parse(script[1]).NGRX_STATE;
}

// Texts stay inside the collector (signals read them, feeds don't carry
// them), so a long item list is capped rather than carried whole.
const capText = text => text && text.length > 8000 ? text.slice(0, 8000) : text;

export function netListing(html, url) {
  const id = url.split('/').at(-1);
  const sale = netState(html)['feature.traditionalSaleViewState']?.entitiesById?.[id];
  if (!sale?.name || !sale.typeName) throw Error('Sale detail is missing');
  if (sale.isDeleted || sale.isPublished === false || !netTypes.has(sale.typeName)) return null;
  const sessions = (sale.dates ?? []).map(day => {
    // The site serializes local wall times with a trailing Z. Do not convert them to UTC.
    const start = day.localStartDate?._value;
    if (!start?.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) throw Error('Unrecognized local start date');
    return {date: start.slice(0, 10), start: start.slice(11, 16),
      end: day.showEndTime ? day.localEndDate?._value?.slice(11, 16) || null : null};
  });
  if (!sessions.length) throw Error('Missing sale dates');
  const location = sale.locationInfo;
  const address = sale.schema?.location?.address;
  const city = decode(address?.addressLocality || sale.postalCodeCityName);
  const zip = address?.postalCode || url.split('/').at(-2);
  if (!city || !zip) throw Error('Missing public locality');
  const street = decode(address?.streetAddress);
  const streetAddress = location?.showAddress && street &&
    visible(html).toLowerCase().includes(street.toLowerCase()) ? street : null;
  const record = {title: decode(sale.name), company: sale.seller?.isOrg ? decode(sale.seller.name) || null : null,
    streetAddress, city, zip, sessions, source: {name: 'EstateSales.net', url}};
  if (streetAddress && location.showMap && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    record.point = {lat: location.latitude, lng: location.longitude};
  }
  // Contact, only what the public listing itself shows: the seller's phone
  // when the listing says to show it, and their website or company page.
  const seller = sale.seller ?? {};
  if (seller.showPhoneNumber && seller.primaryPhone) record.contactPhone = decode(seller.primaryPhone);
  const contactUrl = /^https?:\/\//i.test(seller.websiteUrl ?? '') ? seller.websiteUrl
    : seller.pageUrl ? new URL(seller.pageUrl, 'https://www.estatesales.net').href : null;
  if (contactUrl) record.contactUrl = contactUrl;
  const description = capText(decode(sale.plainTextDescription));
  if (description) record.description = description;
  // Photo URLs + the source's own count. A sale can carry hundreds of
  // photos; the stored URL list stops at the scan cap, the count stays true.
  const pictures = Array.isArray(sale.pictures) ? sale.pictures : [];
  const photoUrls = pictures.map(picture => picture.url).filter(u => /^https:\/\//.test(u ?? ''));
  const photoCount = Number.isFinite(sale.pictureCount) ? sale.pictureCount : photoUrls.length;
  if (photoUrls.length || Number.isFinite(sale.pictureCount)) {
    record.photoUrls = photoUrls.slice(0, 12);
    record.photoCount = Math.max(photoCount, photoUrls.length);
  }
  const captions = pictures.map(picture => decode(picture.description)).filter(Boolean);
  if (captions.length) record.photoText = capText(captions.join(' '));
  return record;
}

export async function collectNet({today, through, get, city}) {
  const netDirectory = city.sources.estateSalesNet.directory;
  const discoveryZips = city.discoveryZips;
  const stateCode = city.state.code;
  // The local directory and sitemap can use different city slugs for one sale ID.
  const urls = new Map();
  const issues = [];
  let discoveries = 0;
  let sitemapReached = false;
  let hostBlocked = false;
  // The directory's first rendered page is capped. Its links supplement the
  // public sale sitemap, which includes upcoming dates beyond this weekend.
  try {
    const state = netState(await get(netDirectory))['feature.cityViewState'];
    if (!Array.isArray(state?.filteredSales)) throw Error('Missing local directory results');
    for (const sale of state.filteredSales) {
      if (sale.stateCode !== stateCode || !discoveryZips.has(sale.postalCodeNumber)) continue;
      const place = encodeURIComponent(sale.cityName.replace(/\s+/g, '-'));
      urls.set(String(sale.id), `https://www.estatesales.net/${stateCode}/${place}/${sale.postalCodeNumber}/${sale.id}`);
    }
    discoveries++;
  } catch (error) {
    issues.push(`${netDirectory} — ${error.message}`);
    hostBlocked = challenge(error);
  }
  if (!hostBlocked) {
    try {
      const xml = await get(netSitemap);
      if (!/<urlset\b/.test(xml) || !/<loc>https:\/\/www\.estatesales\.net\/[A-Z]{2}\/[^<]+\/\d{5}\/\d+<\/loc>/.test(xml)) {
        throw Error('Unrecognized public sale sitemap');
      }
      for (const match of xml.matchAll(RegExp(`<loc>(https://www\\.estatesales\\.net/${stateCode}/[^/<]+/(\\d{5})/\\d+)</loc>`, 'g'))) {
        if (discoveryZips.has(match[2])) urls.set(match[1].split('/').at(-1), match[1]);
      }
      discoveries++;
      sitemapReached = true;
    } catch (error) {
      issues.push(`${netSitemap} — ${error.message}`);
      hostBlocked = challenge(error);
    }
  }
  const checked = await readListings(hostBlocked ? [] : urls.values(), netListing, get, today, through);
  issues.push(...checked.failures);
  return {records: checked.records, status: !discoveries ? 'blocked' : issues.length ? 'partial' : 'reached',
    detail: `${sitemapReached ? 'Read the public sale sitemap. ' : ''}Checked ${checked.checked}/${urls.size} local candidate details.${issues.length ? ' ' + issues.join(' | ') : ''}`};
}

const months = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');

function clock(raw) {
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP])M$/i);
  if (!match) return null;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'P' ? 12 : 0);
  return String(hour).padStart(2, '0') + ':' + (match[2] ?? '00');
}

export function orgListing(html, url) {
  const event = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
    // A seller's description can put raw line breaks inside a JSON string.
    .map(match => JSON.parse(match[1].replace(/[\u0000-\u001f]+/g, ' '))).find(obj => obj['@type'] === 'Event');
  if (!event?.name) throw Error('Missing public event schema');
  const times = html.match(/>In-person:\s*<\/span>\s*<ul\b[^>]*>([\s\S]*?)<\/ul>/i)?.[1];
  const sessions = [...(times ?? '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(match => {
    const row = visible(match[1]);
    const fields = row.match(/\b([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})\b/);
    if (!fields || !months.includes(fields[1])) throw Error('Unrecognized in-person date');
    const date = [fields[3], String(months.indexOf(fields[1])+1).padStart(2,'0'), fields[2].padStart(2,'0')].join('-');
    const clocks = row.match(/\b\d{1,2}(?::\d{2})?\s*[AP]M\b/gi) || [];
    return {date, start: clocks[0] ? clock(clocks[0]) : null, end: clocks[1] ? clock(clocks[1]) : null};
  });
  if (!sessions.length) throw Error('Missing public in-person shopping sessions');
  const address = event.location?.address;
  if (!address?.addressLocality || !address?.postalCode) throw Error('Missing public locality');
  // A map payload can include the unreleased street. Read only the buyer-facing address block.
  const block = html.match(/Sale Address<\/h4>\s*<div\b[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  const displayed = block.match(/<span\b[^>]*>\s*([^<>]+?)\s*<br\s*\/?\s*>/i)?.[1];
  const record = {title: decode(event.name), company: decode(event.organizer?.name) || null,
    streetAddress: displayed ? decode(displayed) : null, city: decode(address.addressLocality),
    zip: String(address.postalCode), sessions, source: {name: 'EstateSales.org', url}};
  // The event schema itself carries the organizer's public phone and
  // company page, the item-list description, and the hero photo.
  if (event.organizer?.telephone) record.contactPhone = decode(event.organizer.telephone);
  if (/^https:\/\//.test(event.organizer?.url ?? '')) record.contactUrl = event.organizer.url;
  const description = capText(decode(event.description));
  if (description) record.description = description;
  // Gallery photos are the CDN images named for this sale; data-aspect is
  // the full-size URL, src its thumbnail. Alt text here is the generic
  // "Estate sale photo", which carries no signal and is dropped. A sale with
  // no photos names the site's "nophoto" placeholder as its schema image;
  // that is not a photo of the sale and is left out.
  const photoUrls = new Set();
  for (const image of [].concat(event.image ?? [])) {
    if (/^https:\/\//.test(image) && !/\/nophoto[^/]*$/i.test(new URL(image).pathname)) photoUrls.add(image);
  }
  for (const match of html.matchAll(/<img\b[^>]*\bdata-aspect="(https:\/\/eso-cdn\.[^"]+\.jpg)"[^>]*>/gi)) {
    photoUrls.add(match[1]);
  }
  if (photoUrls.size) {
    record.photoUrls = [...photoUrls].slice(0, 12);
    record.photoCount = photoUrls.size;
  }
  return record;
}

export async function collectOrg({today, through, get, city}) {
  const orgDirectory = city.sources.estateSalesOrg.directory;
  const discoveryZips = city.discoveryZips;
  const detailLink = RegExp(`class="card__image" href="(/estate-sales/${city.state.code.toLowerCase()}/[^/"]+/(\\d{5})/[^/"]+)"`, 'i');
  const urls = new Set();
  const pages = new Set();
  const issues = [];
  let next = orgDirectory;
  let pagesRead = 0;
  let cardsRead = 0;
  let reportedTotal;
  let hostBlocked = false;
  while (next) {
    try {
      if (pages.has(next) || pages.size >= 100) throw Error('Incomplete pagination');
      pages.add(next);
      const html = await get(next);
      const localHtml = html.split(/Featured Estate Sales &amp; Auctions/i)[0];
      const cards = localHtml.split(/<div\b[^>]*class="card bg-white rounded p-relative overflow-hidden"[^>]*>/gi).slice(1);
      const totalMatch = html.match(/(\d+) estate sales\s*<span[^>]*>currently listed/i);
      if (totalMatch) reportedTotal = Number(totalMatch[1]);
      if (!cards.length && reportedTotal !== 0) throw Error('Unrecognized local results');
      for (const card of cards) {
        const type = card.match(/<div class="card__type[^"]*">([\s\S]*?)<\/div>/)?.[1];
        if (!type) throw Error('Directory card missing its sale type');
        if (!/in-person.*(?:estate sale|moving sale)/i.test(visible(type))) continue;
        const link = card.match(detailLink);
        if (!link) throw Error('In-person sale missing its local detail link');
        if (discoveryZips.has(link[2])) urls.add(new URL(decode(link[1]), orgDirectory).href);
      }
      pagesRead++;
      cardsRead += cards.length;
      const href = html.match(/<a\b[^>]*\bpager__next\b[^>]*\bhref="([^"]+)"[^>]*>/i)?.[1];
      next = href ? new URL(decode(href), orgDirectory).href : null;
      if (next && new URL(next).origin !== 'https://estatesales.org') throw Error('Unexpected pagination origin');
    } catch (error) {
      issues.push(`${next} — ${error.message}`);
      hostBlocked = challenge(error);
      break;
    }
  }
  if (reportedTotal != null && cardsRead !== reportedTotal) issues.push(`Read ${cardsRead} of ${reportedTotal} directory cards.`);
  const checked = await readListings(hostBlocked ? [] : urls, orgListing, get, today, through);
  issues.push(...checked.failures);
  return {records: checked.records, status: !pagesRead ? 'blocked' : issues.length ? 'partial' : 'reached',
    detail: `Read ${cardsRead} ${city.name} directory cards over ${pagesRead} pages. Checked ${checked.checked}/${urls.size} in-person local candidate details.${issues.length ? ' '+issues.join(' | ') : ''}`};
}

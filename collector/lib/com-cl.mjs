import {hasSessionInWindow} from './pool.mjs';

// Directory URLs come from each city's sources in collector/config/cities.json. The Craigslist
// search is centered on a ZIP, with a margin for the collector's coordinate-based cutoff.
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function decode(text) {
  const entities = {amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', ndash: '–', mdash: '—', rsquo: '’'};
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (token, code) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] ?? token;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : token;
  });
}

function plain(html = '') {
  return decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function checkPage(html) {
  if (/_Incapsula_Resource/i.test(html) && html.length < 12000) throw Error('Incapsula challenge in HTTP 200 response');
  if (/<title[^>]*>\s*(?:blocked|access denied|just a moment)/i.test(html)) throw Error('access challenge in HTTP 200 response');
}

function clock(value) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])\.?m\.?$/i);
  if (match && +match[1] >= 1 && +match[1] <= 12 && +(match[2] ?? 0) < 60) {
    const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0);
    return String(hour).padStart(2, '0') + ':' + (match[2] || '00');
  }
  if (/^(?:0\d|1[3-9]|2[0-3]):[0-5]\d$/.test(value)) return value;
  if (/^\d{1,2}(?::\d{2})?$/.test(value)) return value + ' (AM/PM unspecified)';
  return value;
}

function publicStreet(text) {
  if (!text || !/^(?:#?\d|One\b)/i.test(text) || /withheld|release|available on|appointment only/i.test(text)) return null;
  return text;
}

// Matches the city's state written as its code or its name.
const stateWords = state => '(?:' + escapeRegExp(state.code) + '|' + escapeRegExp(state.name) + ')';

function craigslistSale(html, url, {today, through, city:{sources, state}}) {
  const title = plain(html.match(/<span\b[^>]*\bid=["']titletextonly["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
  const body = plain(html.match(/<section\b[^>]*\bid=["']postingbody["'][^>]*>([\s\S]*?)<\/section>/i)?.[1]);
  if (!title || !body) throw Error('unrecognized posting layout');
  const estate = /\b(?:estate[\s,-]+(?:tag\s+)?sale|estate liquidation|whole[- ]house liquidation)\b/i;
  if (!(estate.test(title) || estate.test(body)) || /\b(?:not (?:an? )?estate sale|online[- ]only|pickup[- ]only|pick[- ]up only)\b/i.test(title + ' ' + body)) return null;

  const dates = [...new Set(Array.from(html.matchAll(/<a\s[^>]*\bhref=["'][^"']*sale_date=(\d{4}-\d{2}-\d{2})[^"']*["'][^>]*>/gi), m => m[1]))];
  if (!dates.length) throw Error('estate listing without a structured event date');
  const rawTime = plain(html.match(/start time:\s*<\/span>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
  const [start, end] = rawTime.split(/\s*(?:[–—-]|\bto\b|\buntil\b)\s*/i, 2).map(clock);
  const sessions = dates.sort().map(date => ({date, start: start ?? null, end: end ?? null}));
  if (!hasSessionInWindow(sessions, today, through)) return null;

  const place = plain(html.match(/<meta\b[^>]*\bname=["']geo\.placename["'][^>]*\bcontent=["']([^"']*)/i)?.[1]);
  const zip = place.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  const city = place.replace(RegExp('[,\\s]+' + stateWords(state) + '\\b.*$', 'i'), '').replace(/[,\s]*\d{5}(?:-\d{4})?$/, '').trim();
  if (!city && !zip) throw Error('estate listing without a public city or ZIP');
  const streetAddress = publicStreet(plain(html.match(/<div\b[^>]*class=["']mapaddress["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]));
  // Craigslist's map point may be deliberately shifted. Geocode the published street instead.
  return {title, company: null, streetAddress, city, zip, sessions, source: {name: sources.craigslist.name, url}};
}

function listingUrls(html, directory, pattern, allowedHost) {
  const urls = new Set();
  for (const match of html.matchAll(pattern)) {
    const url = new URL(decode(match[1]), directory);
    if (url.protocol === 'https:' && allowedHost.test(url.hostname)) {
      url.search = '';
      url.hash = '';
      urls.add(url.href);
    }
  }
  return [...urls];
}

async function collectDetails(urls, context, parse, notes) {
  const records = [], errors = [];
  for (const url of urls) {
    try {
      const html = await context.get(url);
      checkPage(html);
      const sale = parse(html, url, context);
      if (sale) records.push(sale);
    } catch (error) {
      errors.push(url + ' — ' + error.message);
      if (/challenge|\b(?:403|429)\b/i.test(error.message)) break;
    }
  }
  return {
    records, status: errors.length || notes.length ? 'partial' : 'reached',
    detail: [urls.length + ' directory listings discovered', records.length + ' in-window estate listings before radius filtering', ...notes, ...errors].join('; ')
  };
}

export async function collectCl(context) {
  const CL_DIRECTORY = context.city.sources.craigslist.directory;
  try {
    const html = await context.get(CL_DIRECTORY);
    checkPage(html);
    if (!/<ol\b[^>]*class=["']cl-static-search-results["']/i.test(html)) throw Error('static search results missing');
    const urls = listingUrls(html, CL_DIRECTORY, /<li\b[^>]*class=["']cl-static-search-result["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["']/gi, /(?:^|\.)craigslist\.org$/i);
    const notes = [];
    const cards = [...html.matchAll(/<li\b[^>]*class=["']cl-static-search-result["']/gi)].length;
    if (urls.length < cards) notes.push('some search cards had no usable listing URL');
    if (urls.length >= 120 || /\brel=["']next["']/i.test(html)) notes.push('static results may be truncated');
    return await collectDetails(urls, context, craigslistSale, notes);
  } catch (error) {
    return {records: [], status: 'blocked', detail: CL_DIRECTORY + ' — ' + error.message};
  }
}

const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function estateSaleCom(html, url, {today, through, city:{state}}) {
  const text = plain(html);
  const title = plain(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const saleType = text.match(/\bSale Type\b\s*(.*?)\s*(?:Company Information|Listing Information)\b/i)?.[1];
  if (!title || !saleType) throw Error('unrecognized sale detail layout');
  if (!/\bestate sales?\b/i.test(saleType) || /online|auction/i.test(saleType)) return null;
  const location = text.match(/\bSale Location\s+(.*?)\s+Sale Dates and Times\b/i)?.[1];
  const schedule = text.match(/\bSale Dates and Times\s+(.*?)\s+Sale Type\b/i)?.[1];
  if (!location || !schedule) throw Error('sale location or schedule missing');
  const sessions = [];
  const rows = [...schedule.matchAll(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+(\w+)\s+(\d{1,2})\b,?\s*(\d{4}\b)?(.*?)(?=\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b|$)/gi)];
  if (!rows.length) throw Error('unrecognized sale dates');
  // A yearless schedule may straddle New Year even when the search window does not.
  const firstYear = Number(today.slice(0,4));
  const lastYear = Number(through.slice(0,4));
  const nearbyYears = new Set([firstYear - 1, firstYear, lastYear, lastYear + 1]);
  for (const [,weekday,month,day,year,times] of rows) {
    const monthNumber = months.indexOf(month.slice(0,3).toLowerCase()) + 1;
    if (!monthNumber || /cancelled|canceled/i.test(times)) continue;
    const years = year ? [year] : nearbyYears;
    for (const y of years) {
      const date = y + '-' + String(monthNumber).padStart(2,'0') + '-' + day.padStart(2,'0');
      if (new Date(date+'T12:00:00Z').toUTCString().slice(0,3).toLowerCase() !== weekday.slice(0,3).toLowerCase()) continue;
      const clocks = times.match(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi) || [];
      sessions.push({date, start: clock(clocks[0]), end: clock(clocks[1])});
    }
  }
  if (!hasSessionInWindow(sessions, today, through)) return null;
  // Block boundaries expose the street and locality independently of the site's repeated mobile detail.
  const lines = decode(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<br\s*\/?>|<\/(?:tr|td|div|p|h\d)>/gi,'\n').replace(/<[^>]+>/g,''))
    .split(/\n/).map(x => x.replace(/\s+/g,' ').trim()).filter(Boolean);
  const heading = lines.findIndex(line => /^Sale Location$/i.test(line));
  const following = lines.slice(heading + 1);
  const scheduleHeading = following.findIndex(line => /^Sale Dates and Times$/i.test(line));
  if (heading < 0 || scheduleHeading < 0) throw Error('unrecognized address section');
  const addressLines = following.slice(0, scheduleHeading);
  const inState = RegExp('^(.*?)\\s*,\\s*' + stateWords(state) + '\\b(?:\\s*(\\d{5}))?', 'i');
  const place = addressLines.find(line => inState.test(line));
  const parts = place?.match(inState);
  if (!parts || /\d/.test(parts[1])) throw Error('unrecognized street/city boundary');
  const streetAddress = publicStreet(addressLines[addressLines.indexOf(place) - 1]);
  const company = text.match(/\bCompany Information\s+(.*?)\s+(?:Contact:|Phone:|Email:|EstateSale\.com ID#)/i)?.[1] || null;
  return {title, company, streetAddress, city: parts[1], zip: parts[2] ?? null, sessions, source: {name: 'EstateSale.com', url}};
}

export async function collectCom(context) {
  const {directory: COM_DIRECTORY, place} = context.city.sources.estateSaleCom;
  try {
    const html = await context.get(COM_DIRECTORY, {browserHeaders:true});
    checkPage(html);
    if (!RegExp('Upcoming Estate Sales Near ' + escapeRegExp(place), 'i').test(plain(html))) throw Error(place + ' directory missing');
    const urls = listingUrls(html, COM_DIRECTORY, /["']((?:https:\/\/(?:www\.)?estatesale\.com)?\/sales\/view\/\d+(?:\.html)?)(?:[?#][^"']*)?["']/gi, /^(?:www\.)?estatesale\.com$/i);
    const notes = [];
    if (!urls.length && !/no (?:upcoming |estate )?sales (?:found|listed)/i.test(plain(html))) notes.push('no recognizable detail links');
    if (/\brel=["']next["']/i.test(html)) notes.push('additional directory pages advertised');
    return await collectDetails(urls, context, estateSaleCom, notes);
  } catch (error) {
    return {records: [], status:'blocked', detail: COM_DIRECTORY + ' — ' + error.message};
  }
}

// A denied directory request ends this source's refresh. A readable but unrecognized
// index also stays explicit in coverage until a buyer-visible listing layout is available.
export async function collectGsalr(context) {
  const {directory: url, place} = context.city.sources.gsalr;
  try {
    const html = await context.get(url, {browserHeaders:true});
    checkPage(html);
    const message = plain(html);
    if (RegExp(escapeRegExp(place), 'i').test(message) && /no (?:garage |yard |estate )?sales (?:found|listed|near|in)/i.test(message)) {
      return {records:[], status:'reached', detail:url + ' — public directory reported no sales'};
    }
    return {records:[], status:'partial', detail:url + ' — directory readable, estate listing details unverified'};
  } catch (error) {
    return {records:[], status:'blocked', detail:url + ' — ' + error.message};
  }
}

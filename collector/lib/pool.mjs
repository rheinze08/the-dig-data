// The map uses straight-line miles from the city's configured reference point.
export function milesBetween(center, {lat, lng}) {
  const radians = degrees => degrees * Math.PI / 180;
  const halfChord = Math.sin(radians(lat - center.lat) / 2) ** 2
    + Math.cos(radians(center.lat)) * Math.cos(radians(lat)) * Math.sin(radians(lng - center.lng) / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(halfChord));
}

// The window selects listings. A qualifying listing keeps its full published schedule.
export function hasSessionInWindow(sessions, today, through) {
  return sessions.some(({date}) => date >= today && date <= through);
}

function words(value) {
  return (value ?? '').normalize('NFKD').toLowerCase().replace(/['’]/g, '')
    .replace(/[^a-z0-9#]+/g, ' ').trim();
}

const streetWords = {
  street: 'st', avenue: 'ave', court: 'ct', lane: 'ln', drive: 'dr', place: 'pl',
  road: 'rd', boulevard: 'blvd', parkway: 'pkwy', circle: 'cir', highway: 'hwy',
  north: 'n', south: 's', west: 'w', east: 'e', northwest: 'nw', southwest: 'sw',
  northeast: 'ne', southeast: 'se', apartment: 'unit', apt: 'unit', suite: 'unit', ste: 'unit',
};

export function streetKey(address) {
  return words(address?.replace(/#/g, ' unit ')).split(/\s+/).map(word => streetWords[word] ?? word).join(' ');
}

// Company names drift between sources: "Estate Greats" on one and "Estate
// Greats Estate Sales" on the other, "Rapid Estate Sales / Auctions" against
// "/ Auction", "Top Shelf Estate Sales" against "Top Shelf & Co Realty &
// Estate Sales". The key keeps only the words that name the business.
const companyFiller = new Set(['llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'ltd', 'the', 'and',
  'estate', 'estates', 'sale', 'sales', 'auction', 'auctions', 'appraisal', 'appraisals', 'realty',
  'liquidation', 'liquidations', 'services', 'service', 'group']);

function companyKey(company) {
  return words(company).split(/\s+/).filter(word => word && !companyFiller.has(word)).join('');
}

// Same business: the keys agree, or one is the other with words added after
// it ("topshelf" / "topshelfrealty"). A key of under four letters must agree
// exactly, so "bb" never swallows "bbcollectibles".
function sameCompany(left, right) {
  const a = companyKey(left), b = companyKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

// One source can write a street name as two words where another writes one
// ("1713 Creek Point Dr" / "1713 Creekpoint Dr" reached the Dallas–Fort Worth
// feed as two sales on 2026-11-20). Compare street addresses with the house
// number kept apart and the rest squeezed together as well as spaced out.
function sameStreet(left, right) {
  const a = streetKey(left), b = streetKey(right);
  if (a === b) return true;
  const squeezed = key => {
    const [first, ...rest] = key.split(' ');
    return first + '|' + rest.join('');
  };
  return squeezed(a) === squeezed(b);
}

// Overlapping published ranges count, not only a day both listings share:
// one source can list Friday and Sunday where another lists only Saturday.
function datesOverlap(left, right) {
  const range = record => {
    const dates = record.sessions.map(session => session.date).sort();
    return [dates[0], dates.at(-1)];
  };
  const [aStart, aEnd] = range(left);
  const [bStart, bEnd] = range(right);
  return aStart <= bEnd && bStart <= aEnd;
}

// Sale-title filler: words that say nothing about which sale this is. The
// holiday a sale falls on is filler too: one source can call a sale its
// "Thanksgiving Estate Sale" and the other its "Black Friday Estate Sale".
const titleFiller = new Set(['estate', 'sale', 'sales', 'the', 'a', 'an', 'and', 'of', 'in', 'at', 'to', 'for',
  'from', 'with', 'day', 'days', 'huge', 'big', 'massive', 'great', 'amazing', 'beautiful', 'wonderful', 'off',
  'everything', 'must', 'go', 'goes', 'this', 'weekend', 'only', 'more', 'plus', 'lots', 'lot', 'many',
  'multi', 'family', 'moving', 'downsizing', 'liquidation', 'tag', 'thanksgiving', 'christmas', 'holiday',
  'holidays']);
const holidayPhrases = /\b(?:black friday|cyber monday|small business saturday|labor day|memorial day)\b/g;

function titleWords(title) {
  return words(title).replace(holidayPhrases, ' ').split(/\s+/).filter(word => word && !titleFiller.has(word));
}

// One title can write a word as two ("Work Bench") where the other writes it
// as one ("Workbench"). Join two neighbouring words when the other title has
// the joined word.
function joinSplitWords(list, other) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i + 1 < list.length && other.has(list[i] + list[i + 1])) {
      out.push(list[i] + list[i + 1]);
      i++;
    } else out.push(list[i]);
  }
  return new Set(out);
}

// Whether two titles name the same sale in the same meaningful words, once
// filler, punctuation and split words are set aside. Needs at least two such
// words, so "Estate Sale" against "Estate Sale" is never strong.
function titlesSame(leftTitle, rightTitle) {
  const leftList = titleWords(leftTitle), rightList = titleWords(rightTitle);
  const left = joinSplitWords(leftList, new Set(rightList));
  const right = joinSplitWords(rightList, left);
  return left.size >= 2 && left.size === right.size && [...left].every(word => right.has(word));
}

// Whether two titles plausibly name the same sale: their meaningful words
// mostly agree once filler and punctuation are dropped. Two titles that are
// all filler ("Estate Sale") count as similar only when they are identical.
export function titleSimilarity(leftTitle, rightTitle) {
  const leftList = titleWords(leftTitle), rightList = titleWords(rightTitle);
  const left = joinSplitWords(leftList, new Set(rightList));
  const right = joinSplitWords(rightList, left);
  if (!left.size || !right.size) return words(leftTitle) === words(rightTitle) && !!words(leftTitle);
  const shared = [...left].filter(word => right.has(word)).length;
  const jaccard = shared / (left.size + right.size - shared);
  const containment = shared / Math.min(left.size, right.size);
  return jaccard >= 0.4 || containment >= 0.6;
}

function differentZips(left, right) {
  return left.zip && right.zip && left.zip !== right.zip;
}

function sameStreetSale(left, right) {
  if (!left.streetAddress || !right.streetAddress || differentZips(left, right)) return false;
  const sameCity = left.city && words(left.city) === words(right.city);
  const sameZip = left.zip && left.zip === right.zip;
  return (sameCity || sameZip) && sameStreet(left.streetAddress, right.streetAddress)
    && datesOverlap(left, right);
}

// The fallback for a listing whose street address is still held: same
// normalized company, overlapping dates, the same ZIP (or the same city when
// a ZIP is missing), and titles that plausibly name the same sale. When both
// listings carry street addresses this never applies: two different street
// addresses are two sales, even for one company on one weekend.
function companyMatch(left, right) {
  if (left.streetAddress && right.streetAddress) return false;
  if (!sameCompany(left.company, right.company) || !datesOverlap(left, right)) return false;
  const sameZip = left.zip && left.zip === right.zip;
  const sameCity = left.city && words(left.city) === words(right.city);
  if (differentZips(left, right)) return sameCity && heldZipCrossPost(left, right);
  // Metro city and suburb names can differ for the same ZIP and one sale.
  if (!sameZip && !sameCity) return false;
  return titleSimilarity(left.title, right.title);
}

// A source that still holds the street can show a neighbouring ZIP, so the
// held listing's ZIP may differ from the released one's ("TIME CAPSULE IN
// MARIETTA!" sat in 30064 on EstateSales.net and at a 30060 street on
// EstateSales.org, Atlanta feed 2026-11-25). Merge across the ZIPs only when
// exactly one side has released its street and the titles are the same in
// every meaningful word; the caller has already required the same company,
// the same city and overlapping dates.
function heldZipCrossPost(left, right) {
  return !left.streetAddress !== !right.streetAddress && titlesSame(left.title, right.title);
}

function possibleCrossPost(leftGroup, rightGroup) {
  if (leftGroup.some(left => rightGroup.some(right => left.source.name === right.source.name))) return false;
  const zipClash = leftGroup.some(left => rightGroup.some(right => differentZips(left, right)));
  if (!zipClash) return leftGroup.some(left => rightGroup.some(right => companyMatch(left, right)));
  // Across different ZIPs every pair must pass, which only the held-ZIP rule allows.
  return leftGroup.every(left => rightGroup.every(right => companyMatch(left, right)));
}

export function groupSales(records) {
  const seen = new Set();
  const groups = [];
  const sorted = [...records].sort((a, b) => Number(!!b.streetAddress) - Number(!!a.streetAddress));
  for (const record of sorted) {
    if (seen.has(record.source.url)) continue;
    seen.add(record.source.url);
    const exact = record.streetAddress && groups.filter(group => group.every(other => sameStreetSale(other, record)));
    if (exact && exact.length === 1) exact[0].push(record);
    else groups.push([record]);
  }

  // Evaluate all fallback candidates before merging. Greedy insertion of a hidden
  // listing can silently join two sales run by the same company on the same day.
  const candidates = groups.map(() => new Set());
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (!possibleCrossPost(groups[i], groups[j])) continue;
      candidates[i].add(j);
      candidates[j].add(i);
    }
  }

  const pooled = [];
  const visited = new Set();
  for (let i = 0; i < groups.length; i++) {
    if (visited.has(i)) continue;
    const component = [i];
    visited.add(i);
    for (const index of component) {
      for (const neighbor of candidates[index]) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        component.push(neighbor);
      }
    }
    // Every group must agree with every other one. Leave one-to-many matches
    // as separate sales and preserve all exact street matches made above.
    if (component.every(index => candidates[index].size === component.length - 1)) {
      pooled.push(component.flatMap(index => groups[index]));
    } else {
      pooled.push(...component.map(index => groups[index]));
    }
  }
  return pooled;
}

export function mergeGroup(group) {
  const anchor = group[0];
  const sessions = new Map();
  for (const record of group) {
    for (const date of new Set(record.sessions.map(s => s.date))) {
      const daily = record.sessions.filter(s => s.date === date);
      if (!sessions.has(date)) {
        sessions.set(date, daily.map(s => ({date, start: s.start || null, end: s.end || null})));
        continue;
      }
      // Preserve one source's day schedule when cross-posts give conflicting hours.
      for (const previous of sessions.get(date)) {
        const same = daily.find(s => s.start && s.start === previous.start)
          ?? (daily.length === 1 && !previous.start ? daily[0] : null);
        if (same) {
          previous.start ||= same.start || null;
          previous.end ||= same.end || null;
        }
      }
    }
  }
  // Contact, photos and the listing texts pool with the sessions: the first
  // public phone or company page wins, photo URLs union without repeats, and
  // the count is the largest any one source reported (a source can report a
  // count far beyond the URLs worth storing). `description` and `photoText`
  // stay inside the collector; the feeds carry only what they support.
  const photoUrls = [...new Set(group.flatMap(record => record.photoUrls ?? []))];
  const knownCounts = group.map(record => record.photoCount
    ?? (Array.isArray(record.photoUrls) ? record.photoUrls.length : null))
    .filter(count => count !== null);
  const descriptions = group.map(record => record.description).filter(Boolean);
  return {
    title: anchor.title, company: group.find(r => r.company)?.company ?? null,
    streetAddress: anchor.streetAddress || null,
    city: anchor.city || group.find(r => r.city)?.city || null,
    zip: anchor.zip || group.find(r => r.zip)?.zip || null,
    addressHidden: !anchor.streetAddress,
    sessions: [...sessions.values()].flat().sort((a, b) => a.date.localeCompare(b.date)
      || (a.start ?? '').localeCompare(b.start ?? '')),
    sources: group.map(r => r.source).sort((a, b) => a.url.localeCompare(b.url)),
    contactPhone: group.find(r => r.contactPhone)?.contactPhone ?? null,
    contactUrl: group.find(r => r.contactUrl)?.contactUrl ?? null,
    photoUrls,
    photoCount: knownCounts.length ? Math.max(...knownCounts) : null,
    description: descriptions.sort((a, b) => b.length - a.length)[0] ?? null,
    photoText: [...new Set(group.map(record => record.photoText).filter(Boolean))].join(' ') || null,
  };
}

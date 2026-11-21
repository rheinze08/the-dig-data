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

function companyKey(company) {
  return words(company).replace(/\b(?:llc|inc|incorporated)\b/g, '').replaceAll(' ', '');
}

function sharedDate(left, right) {
  return left.sessions.some(a => right.sessions.some(b => a.date === b.date));
}

function differentZips(left, right) {
  return left.zip && right.zip && left.zip !== right.zip;
}

function sameStreetSale(left, right) {
  if (!left.streetAddress || !right.streetAddress || differentZips(left, right)) return false;
  const sameCity = left.city && words(left.city) === words(right.city);
  const sameZip = left.zip && left.zip === right.zip;
  return (sameCity || sameZip) && streetKey(left.streetAddress) === streetKey(right.streetAddress)
    && sharedDate(left, right);
}

function companyMatch(left, right) {
  if (left.streetAddress && right.streetAddress) return false;
  const company = companyKey(left.company);
  if (!company || company !== companyKey(right.company) || !sharedDate(left, right)) return false;
  const sameCity = left.city && words(left.city) === words(right.city);
  // Metro city and suburb names can differ for the same ZIP and identical sale title.
  const postalAlias = left.zip && left.zip === right.zip && words(left.title) && words(left.title) === words(right.title);
  return sameCity || postalAlias;
}

function possibleCrossPost(leftGroup, rightGroup) {
  if (leftGroup.some(left => rightGroup.some(right =>
    left.source.name === right.source.name || differentZips(left, right)))) return false;
  return leftGroup.some(left => rightGroup.some(right => companyMatch(left, right)));
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
  return {
    title: anchor.title, company: group.find(r => r.company)?.company ?? null,
    streetAddress: anchor.streetAddress || null,
    city: anchor.city || group.find(r => r.city)?.city || null,
    zip: anchor.zip || group.find(r => r.zip)?.zip || null,
    addressHidden: !anchor.streetAddress,
    sessions: [...sessions.values()].flat().sort((a, b) => a.date.localeCompare(b.date)
      || (a.start ?? '').localeCompare(b.start ?? '')),
    sources: group.map(r => r.source).sort((a, b) => a.url.localeCompare(b.url)),
  };
}

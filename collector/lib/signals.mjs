// What a sale is offering, and how deep a dig it looks like, from signals a
// reader could check on the source listing itself: the title, the listing
// description, photo captions, and the photo count. Nothing here looks at a
// photo's pixels; lib/vision.mjs is the (optional) pass that does. When the
// signals say nothing, these functions return emptiness, never a guess.
import {categorize, normalizeTitle, CATEGORIES} from './categories.mjs';

// Concrete things worth naming beyond the twelve categories. Terms are
// matched on normalized text the way categories.mjs matches titles: write
// "mid century" for "mid-century", "?" for an optional letter.
const SPECIFIC_KEYWORDS = [
  ['figurines', ['figurines?']],
  ['china', ['china', 'china sets?', 'bone china']],
  ['crystal', ['crystal']],
  ['antiques', ['antiques?']],
  ['mid-century', ['mid century', 'mcm']],
  ['rugs', ['rugs?', 'persian rugs?', 'oriental rugs?']],
  ['lamps', ['lamps?']],
  ['mirrors', ['mirrors?']],
  ['silver', ['sterling silver', 'silverplate', 'silver']],
  ['watches', ['watches']],
  ['cameras', ['cameras?']],
  ['guitars', ['guitars?']],
  ['pianos', ['pianos?']],
  ['coins', ['coins?']],
  ['comics', ['comics?', 'comic books?']],
  ['dolls', ['dolls?']],
  ['model trains', ['model trains?', 'lionel']],
  ['christmas decor', ['christmas']],
  ['patio furniture', ['patio (?:furniture|sets?)']],
];

const phrasePattern = terms => RegExp('(?<![a-z0-9])(?:' + terms.join('|').replaceAll(' ', '\\s') + ')(?![a-z0-9])', 'g');
const compiledSpecifics = SPECIFIC_KEYWORDS.map(([display, terms]) => ({display, pattern: phrasePattern(terms)}));

// The categories the whole listing names, not only its title. The published
// `categories` field stays title-only (see AGENTS.md); this wider set drives
// the rating's breadth and the keyword list.
export function listingCategories(title, texts = []) {
  const found = new Set(categorize(title));
  for (const text of texts) for (const category of categorize(text)) found.add(category);
  return CATEGORIES.filter(category => found.has(category));
}

function filenameText(photoUrls) {
  return (photoUrls ?? []).map(url => {
    try {
      return decodeURIComponent(new URL(url).pathname.split('/').at(-1).replace(/\.[a-z0-9]+$/i, ''));
    } catch {
      return '';
    }
  }).join(' ');
}

// Searchable words for what is being sold: the listing's categories first,
// then the specific things its words name. Photo filenames can add a
// specific ("brass-figurines.jpg") but never a whole category; hash-style
// filenames naturally match nothing.
export function extractKeywords({title, description = null, photoText = null, photoUrls = []} = {}) {
  const texts = [description, photoText].filter(Boolean);
  const keywords = [...listingCategories(title, texts)];
  const haystack = normalizeTitle([title, ...texts, filenameText(photoUrls)].filter(Boolean).join(' '));
  for (const {display, pattern} of compiledSpecifics) {
    pattern.lastIndex = 0;
    if (pattern.test(haystack) && !keywords.includes(display)) keywords.push(display);
  }
  return keywords.slice(0, 10);
}

// "Tools, furniture, figurines and vinyl & records." — one line, at most
// five things named. Null when there is nothing verifiable to say.
export function buildContentsLine(keywords) {
  const items = (keywords ?? []).slice(0, 5);
  if (!items.length) return null;
  const joined = items.length === 1 ? items[0]
    : items.slice(0, -1).join(', ') + ' and ' + items.at(-1);
  return joined[0].toUpperCase() + joined.slice(1) + '.';
}

// Rating v1, deterministic. Points: photo count (30+ → 3, 10+ → 2, 5+ → 1),
// breadth of categories (4+ → 3, 3 → 2, 2 → 1), and 3+ sale days → 1.
// 4+ points is a Deep Dig, 2+ is Worth a Look, the rest is Slim Pickings.
// Reasons always name the drivers that were actually there — and for Slim
// Pickings, what was missing — so the badge can be argued with.
export function rateSale({photoCount = null, categories = [], days = 1} = {}) {
  const knownPhotos = Number.isFinite(photoCount) ? photoCount : null;
  let score = 0;
  const drivers = [];
  if (knownPhotos !== null && knownPhotos >= 5) {
    score += knownPhotos >= 30 ? 3 : knownPhotos >= 10 ? 2 : 1;
    drivers.push(knownPhotos + ' photos');
  }
  if (categories.length >= 2) {
    score += categories.length >= 4 ? 3 : categories.length === 3 ? 2 : 1;
    const named = categories.slice(0, 3);
    drivers.push((named.length === 2 ? named.join(' and ') : named.slice(0, -1).join(', ') + ' and ' + named.at(-1))
      + ' in the listing');
  }
  if (days >= 3) {
    score += 1;
    drivers.push('runs ' + days + ' days');
  }
  const digRating = score >= 4 ? 'Deep Dig' : score >= 2 ? 'Worth a Look' : 'Slim Pickings';
  const ratingReasons = [...drivers];
  if (digRating === 'Slim Pickings') {
    if (knownPhotos === null) ratingReasons.push('no photo count from the source');
    else if (knownPhotos === 0) ratingReasons.push('no photos in the listing');
    else if (knownPhotos < 5) ratingReasons.push('only ' + knownPhotos + (knownPhotos === 1 ? ' photo' : ' photos'));
    if (categories.length <= 1) ratingReasons.push('few details in the listing');
  }
  if (!ratingReasons.length) ratingReasons.push('few details in the listing');
  return {digRating, ratingReasons: ratingReasons.slice(0, 3)};
}

// Everything collect.mjs needs for one merged sale.
export function saleSignals(sale) {
  const photoKeywords = extractKeywords(sale);
  const breadth = listingCategories(sale.title, [sale.description, sale.photoText].filter(Boolean));
  const days = new Set((sale.sessions ?? []).map(session => session.date)).size || 1;
  const {digRating, ratingReasons} = rateSale({photoCount: sale.photoCount ?? null, categories: breadth, days});
  return {photoKeywords, contentsLine: buildContentsLine(photoKeywords), digRating, ratingReasons};
}

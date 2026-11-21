// Category keyword rules. This is the one place they live.
//
// A sale is tagged from its title at collect time. A sale can carry several
// tags or none. Only clear hits count: when a word usually means something
// else in a sale title, leave it out or list the phrase under `except`.
//
// Titles are matched after normalizing: lower case, accents and apostrophes
// dropped, "&" read as "and", and every other punctuation mark read as a space.
// So write "snap on" for "Snap-On" and "pots and pans" for "Pots & Pans".
// Each term is a whole word or phrase and may use regular-expression syntax
// ("tools?" matches "tool" and "tools"). `except` phrases are blanked out of
// the title before that category is matched.
export const CATEGORY_RULES = [
  {name: 'tools', terms: [
    'tools?', 'toolbox(?:es)?', 'tool ?chests?', 'craftsman', 'dewalt', 'snap on', 'makita', 'ryobi', 'kobalt',
    'woodworking', 'woodshop', 'table saws?', 'band ?saws?', 'drill press(?:es)?', 'lathes?',
    'welders?', 'welding', 'air compressors?', 'mechanics?', 'machinist', 'workbench(?:es)?',
  ]},
  {name: 'furniture', terms: [
    'furniture', 'furnishings', 'sofas?', 'couch(?:es)?', 'sectionals?', 'loveseats?', 'recliners?', 'dressers?',
    'armoires?', 'bookcases?', 'bookshel(?:f|ves)', 'hutch(?:es)?', 'credenzas?', 'sideboards?', 'buffets?',
    'china cabinets?', 'curio cabinets?', 'dining (?:tables?|sets?|rooms?|chairs?)', 'bedroom (?:sets?|suites?)',
    'coffee tables?', 'end tables?', 'nightstands?', 'beds?', 'bed frames?', 'headboards?', 'mattress(?:es)?',
    'desks?', 'ethan allen', 'la z boy', 'lazy boy', 'lazboy', 'drexel', 'henredon', 'thomasville', 'stickley',
    'broyhill', 'bassett', 'restoration hardware', 'pottery barn', 'west elm', 'arhaus',
  ], except: ['bed and bath', 'bed bath', 'flower beds?', 'truck beds?', 'buffet (?:style|line)']},
  {name: 'vinyl & records', terms: [
    'vinyl', 'records', 'record (?:albums?|collection)', 'lps?', '45s', '78s', 'albums',
  ], except: ['vinyl (?:siding|flooring|fence|fencing)', 'photo albums?', 'stamp albums?']},
  {name: 'jewelry', terms: [
    'jewelry', 'jewellery', 'jewelery', 'diamonds?', 'necklaces?', 'bracelets?', 'earrings',
    'watches', 'rolex', '1[048] ?kt? gold', 'james avery', 'david yurman',
  ], except: ['jewelry (?:box|boxes|armoire|armoires|cabinet|cabinets)']},
  {name: 'collectibles', terms: [
    'collectibles?', 'collectables?', 'collectors?', 'memorabilia', 'coins?', 'stamps?',
    'comics?', 'comic books?', '(?:sports?|baseball|football|basketball|trading) cards', 'pokemon', 'funko',
    'hot wheels', 'lladro', 'hummels?', 'precious moments', 'department 56', 'dept 56', 'figurines?',
    'die ?cast', 'militaria', 'breweriana', 'star wars', 'beatles', 'lionel', 'autographs?', 'autographed',
    'madame alexander', 'beanie babies', 'franklin mint', 'swarovski', 'waterford', 'wedgwood', 'limoges',
  ]},
  {name: 'vehicles', terms: [
    'cars?', 'trucks?', 'vehicles?', 'automobiles?', 'motorcycles?', 'harley(?: davidson)?', 'boats?', 'rvs?',
    'campers?', 'travel trailers?', 'utility trailers?', 'golf carts?', 'tractors?', 'atvs?', 'utvs?', 'jeeps?',
    'corvettes?', 'cadillacs?', 'chevrolet', 'chevy', 'lexus', 'mercedes', 'bmw', 'buick', 'pickups?',
    'ford f ?\\d{3}', 'kayaks?', 'jet skis?', 'suvs?', 'minivans?',
  ], except: [
    '(?:toy|model|die ?cast|slot|matchbox|pedal|tonka|hot wheels) (?:cars?|trucks?|vehicles?|tractors?|boats?)',
    'cars? (?:seats?|ports?|parts|care|audio|stereos?)', 'bar carts?', 'tea carts?', 'gravy boats?',
  ]},
  {name: 'kitchen', terms: [
    'kitchens?', 'kitchenware', 'kitchenaid', 'cookware', 'bakeware', 'pyrex', 'corning ?ware', 'le creuset',
    'cast iron', 'saladmaster', 'dishes', 'dinnerware', 'flatware', 'silverware', 'fiesta ?ware', 'tupperware',
    'pots and pans', 'small appliances', 'vitamix', 'fine china', 'china sets?', 'cutlery', 'cookbooks?',
  ]},
  {name: 'clothing', terms: [
    'clothing', 'clothes', 'apparel', 'shoes', 'boots', 'purses', 'handbags?', 'furs?', 'fur coats?', 'dresses',
    'suits', 'coats', 'jackets', 'hats', 'western wear', 'louis vuitton', 'chanel', 'gucci', 'prada',
    'designer (?:bags|clothing|clothes|handbags|purses|shoes|fashions?)', 'fashions?', 'scarves', 'mens ?wear',
    'womens ?wear', 'fashionistas?',
  ]},
  {name: 'books', terms: [
    'books?', 'cookbooks?', 'bibles?', 'first editions?', 'novels', 'textbooks', 'comic books?', 'paperbacks?',
    'hardbacks?', 'hardcovers?',
  ], except: ['books? ?(?:cases?|shel(?:f|ves)|ends)']},
  {name: 'art', terms: [
    'art', 'artwork', 'artworks', 'paintings?', 'sculptures?', 'bronzes?', 'lithographs?', 'watercolou?rs?',
    'artists?', 'etchings?', 'serigraphs?', 'giclees?', 'oil on canvas',
  ], except: ['art deco', 'art nouveau', 'art glass', 'state of the art', 'the art of', 'arts and crafts', 'art supplies']},
  {name: 'electronics', terms: [
    'electronics', 'tvs?', 'televisions?', 'stereos?', 'audio', 'speakers', 'hi ?fi', 'turntables?',
    'computers?', 'laptops?', 'cameras?', 'radios?', 'ham radios?', 'amplifiers?', 'mcintosh', 'marantz', 'bose',
    'sonos', 'macintosh', 'bang and olufsen', 'ipads?', 'iphones?', 'playstation', 'xbox', 'nintendo', 'video games?',
  ], except: ['tv (?:stands?|trays?|consoles?|cabinets?)']},
  {name: 'toys & games', terms: [
    'toys?', 'games', 'gaming', 'video games?', 'board games?', 'game rooms?', 'game tables?', 'arcade',
    'legos?', 'barbies?', 'dolls?', 'hot wheels', 'matchbox', 'tonka', 'puzzles?', 'action figures?',
    'nintendo', 'playstation', 'xbox', 'pokemon', 'model trains?', 'trains', 'lionel', 'pinball',
    'pool tables?', 'poker', 'slot machines?', 'foosball', 'ping pong',
  ], except: ['doll ?houses? furniture']},
];

export const CATEGORIES = CATEGORY_RULES.map(rule => rule.name);

export function normalizeTitle(title) {
  return String(title ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’‘`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const phrases = list => RegExp('(?<![a-z0-9])(?:' + list.join('|').replaceAll(' ', '\\s') + ')(?![a-z0-9])', 'g');
const compiled = CATEGORY_RULES.map(({name, terms, except}) => ({
  name, terms: phrases(terms), except: except ? phrases(except) : null,
}));

// The categories a title clearly names, in the order above.
export function categorize(title) {
  const text = normalizeTitle(title);
  if (!text) return [];
  return compiled.filter(({terms, except}) => {
    terms.lastIndex = 0;
    return terms.test(except ? text.replace(except, ' ') : text);
  }).map(rule => rule.name);
}

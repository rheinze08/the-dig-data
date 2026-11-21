// The rules a city earns its way on by. No judgment: the refresh applies them.

// A proving city goes live once it has this many clean days in a row and its
// latest collection found at least this many sales.
export const PROMOTION = {cleanRuns: 3, sales: 25};

const nextDay = date => new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

// One city's streak after a collection. `date` is the city's local date for the
// run (the feed's asOf). cleanRuns counts consecutive days with a successful
// collection:
//   - a failed collection resets it to 0
//   - a second success on the same date leaves it unchanged
//   - a success on the next calendar date adds 1
//   - a success after a skipped day starts again at 1
export function advanceStreak(previous, {date, ok}) {
  const before = {cleanRuns: 0, lastCleanDate: null, ...previous};
  if (!ok) return {...before, cleanRuns: 0, lastRunDate: date, lastResult: 'failed'};
  let cleanRuns = 1;
  if (before.cleanRuns > 0 && before.lastCleanDate === date) cleanRuns = before.cleanRuns;
  else if (before.cleanRuns > 0 && before.lastCleanDate && nextDay(before.lastCleanDate) === date) cleanRuns = before.cleanRuns + 1;
  return {...before, cleanRuns, lastCleanDate: date, lastRunDate: date, lastResult: 'clean'};
}

// Whether a city flips from proving to live after this run, with the reason either way.
// Only proving cities are judged. A live city is never moved back by this rule.
export function promotionDecision(city, run, sales) {
  if (city.status !== 'proving') return {promote: false, reason: 'already ' + city.status};
  const facts = `cleanRuns=${run.cleanRuns} (needs ${PROMOTION.cleanRuns}), sales=${sales ?? 'none'} (needs ${PROMOTION.sales})`;
  if (run.lastResult !== 'clean') return {promote: false, reason: 'this collection failed; ' + facts};
  const promote = run.cleanRuns >= PROMOTION.cleanRuns && Number.isFinite(sales) && sales >= PROMOTION.sales;
  return {promote, reason: facts};
}

// What a collection lost, measured against the feed it would replace. A source
// counts as lost when it supplied listings to the previous feed and is blocked
// now. When the lost sources supplied half or more of the previous feed's
// listings, publishing would quietly empty the feed, so the collection fails
// and the previous feed stays.
export function lostSources(previousCoverage, coverage) {
  const before = Object.entries(previousCoverage ?? {}).filter(([, source]) => source.included > 0);
  const total = before.reduce((sum, [, source]) => sum + source.included, 0);
  const lost = before.filter(([name]) => coverage[name]?.status === 'blocked')
    .map(([name, source]) => ({name, included: source.included}));
  const share = lost.reduce((sum, source) => sum + source.included, 0);
  return {lost, share, total, tooMany: total > 0 && share * 2 >= total};
}

# The Dig public data feed

The Dig pools upcoming estate sales into one map per city. This repository holds the public feeds and the collector that produces them. Each feed lists shopping dates, available hours, a map location and links to the original listings. Dates and times use the city's time zone. An approximate point marks an area center. Check the original listing for the street address before traveling.

## Files

| File | Contents |
| --- | --- |
| `cities.json` | Every city: slug, name, state, time zone, `status`, `enabled`, feed URL, sales count, `collectedAt`, `cleanRuns`, center and radius |
| `cities/<slug>/sales.json` | One feed per city, live or proving |
| `search.json` | Every sale from every live and proving city, cut down for searching |
| `sales.json` | The Houston feed at its original address, which app v0.1.1 reads. It is a byte-for-byte copy of `cities/houston/sales.json`. |

[City index](https://raw.githubusercontent.com/rheinze08/the-dig-data/main/cities.json) · [Search index](https://raw.githubusercontent.com/rheinze08/the-dig-data/main/search.json) · [Houston feed](https://raw.githubusercontent.com/rheinze08/the-dig-data/main/sales.json)

Each feed includes the collection time, the 14-day window and counts for each source. Cross-posted sales retain all their source links. Each refresh replaces the snapshots. These addresses and shapes are fixed: shipped apps and the website read them. Add fields, never move or rename them.

### City status

A city is `live` or `proving`.

- **live**: listed by every app version and by the website. `enabled` is `true`.
- **proving**: collected and published every day, and shown as a preview by app v0.3.0 and later and by the website. `enabled` is `false`, so app v0.2.0 leaves it out.

`cleanRuns` is the number of days in a row the city's collection has succeeded. A failed collection sets it to 0. A second run on the same day does not add to it. A skipped day starts it again at 1.

**Promotion rule.** After each refresh, a proving city with `cleanRuns` of 3 or more and 25 or more sales in its latest feed becomes live. The refresh makes the change itself in `collector/config/cities.json` and `cities.json` and says so in its log. Nothing moves a live city back.

### `search.json`

```json
{
  "version": 1,
  "generatedAt": "2026-11-21T11:04:10.000Z",
  "categories": ["tools", "furniture", "vinyl & records", "jewelry", "collectibles", "vehicles", "kitchen", "clothing", "books", "art", "electronics", "toys & games"],
  "cities": [{ "slug": "houston", "name": "Houston", "state": "TX", "status": "live", "sales": 28, "collectedAt": "…" }],
  "sales": [{
    "id": "917efdb9740a5300", "citySlug": "houston", "cityName": "Houston", "status": "live",
    "title": "…", "company": "…", "categories": ["collectibles"],
    "firstDate": "2026-11-18", "lastDate": "2026-11-21",
    "lat": 29.59, "lng": -95.13, "approximate": false,
    "sources": [{ "name": "EstateSales.net", "url": "https://…" }]
  }]
}
```

`id` matches the sale's `id` in its city feed. `firstDate` and `lastDate` span the sale's whole published schedule. `company` can be `null` and `categories` can be empty.

### Categories

Each sale carries a `categories` list, tagged from its title when it is collected. The twelve categories and their keyword rules live in one file: [`collector/lib/categories.mjs`](collector/lib/categories.mjs). Only clear hits are tagged. A sale can have several tags or none.

## Daily refresh

The feeds are refreshed by a GitHub Action in this repository, once a day at 11:00 UTC (5:00 AM Central in winter, 6:00 AM in summer). The website in [the-dig-web](https://github.com/rheinze08/the-dig-web) rebuilds from them at 11:37 UTC. No person or agent takes part in a normal day. If a run fails, fix the Action or the collector here.

Each run does this:

1. Runs the collector's tests.
2. Collects every city in `collector/config/cities.json`, live and proving. One city's failure does not stop the others. A failed city keeps its previous feed.
3. Updates each city's `cleanRuns` and applies the promotion rule.
4. Rebuilds `cities.json` and `search.json`.
5. Commits and pushes whatever changed.
6. Fails the run, after publishing, if any city did not collect.

A collection also fails, and keeps the previous feed, when the sources it could not reach supplied half or more of the listings in the feed it would replace. This stops a blocked source from quietly emptying a feed.

### Installing the Action

The workflow waits at [`ci/daily-refresh.yml`](ci/daily-refresh.yml). GitHub runs workflows only from `.github/workflows/`, and only a login with the `workflow` permission can add a file there. On the GitHub website:

1. Open <https://github.com/rheinze08/the-dig-data/new/main?filename=.github/workflows/daily-refresh.yml>.
2. Paste the full contents of [`ci/daily-refresh.yml`](https://raw.githubusercontent.com/rheinze08/the-dig-data/main/ci/daily-refresh.yml) and commit to `main`.
3. Open the **Actions** tab, choose **Daily refresh**, and press **Run workflow** for the first run.

Or from a terminal whose login has the permission: `gh auth refresh -h github.com -s workflow`, then `./ci/install-daily-refresh.sh`.

If `.github/workflows/daily-refresh.yml` exists, the Action is installed and the copy in `ci/` can be deleted.

## The collector

`collector/` is the collector's home. It needs Node.js 22 or newer and nothing else.

| Path | Contents |
| --- | --- |
| `collector/refresh.mjs` | The daily refresh: every city, the streaks, the promotion rule, the index and search |
| `collector/collect.mjs` | Collects one city |
| `collector/cities.mjs` | Lists cities and fetches a city's discovery ZIP codes |
| `collector/lib/` | The source readers, the cross-post pooling, the locator, the category rules and the promotion rule |
| `collector/config/cities.json` | The city list. This is the only copy. |
| `collector/config/discovery-zips.json` | ZIP codes used to find candidate listings |
| `collector/state/` | Each city's geocoding cache and the clean-run streaks (`runs.json`). The Action commits these with the feeds. |
| `collector/test/` | Tests for the rules and the refresh path |

```sh
node collector/refresh.mjs                               # what the Action runs
node collector/refresh.mjs --index-only                  # rebuild cities.json and search.json from the feeds on disk
node collector/collect.mjs --city austin --report-only   # measure a city; writes only to the ignored collector/.report/
node collector/cities.mjs list                           # every city with its status and streak
node --test collector/test/*.test.mjs
```

| `refresh.mjs` exit | Meaning |
| --- | --- |
| 0 | Every city collected. |
| 2 | One or more cities failed. Everything that did collect is ready to publish. |
| 1 | The refresh itself broke. Publish nothing. |

To add a city, add it to `collector/config/cities.json` with `"status": "proving"`, run `node collector/cities.mjs zips <slug>` and commit both files. It is collected and published as a preview from the next refresh, and goes live by the promotion rule.

A copy of the collector code is kept in the private app repository, `rheinze08/the-dig`, as a manual fallback. It reads the config and state here and publishes here. Change the collector in this repository first.

Locations use [OpenStreetMap](https://www.openstreetmap.org/copyright) Nominatim, with a cache, an identifying user agent and at least 1.1 seconds between requests. Some locations use data from OpenStreetMap contributors.

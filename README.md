# The Dig public data feed

The Dig pools upcoming estate sales for Texas cities. Houston is live and covers about 25 miles around Friendswood. Each feed lists shopping dates, available hours, a map location and links to the original listings. Dates and times use the city's time zone. An approximate point marks an area center. Check the original listing for the street address before traveling.

| File | Contents |
| --- | --- |
| `cities.json` | Every city with its slug, name, time zone, enabled flag, feed URL, sales count and collection time |
| `cities/<slug>/sales.json` | One feed for each enabled city |
| `sales.json` | The Houston feed at its original address, which app v0.1.1 reads |

Each feed includes the collection time, the 14-day window and counts for each source. Cross-posted sales retain all their source links. Each refresh replaces the snapshots. A city that is not enabled has no feed. [City index](https://raw.githubusercontent.com/rheinze08/the-dig-data/main/cities.json) · [Houston feed](https://raw.githubusercontent.com/rheinze08/the-dig-data/main/sales.json)

Some locations use data from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

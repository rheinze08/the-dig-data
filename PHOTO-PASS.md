# The Dig photo pass

A pass reviews the first 40 entries of the published queue, or all entries if fewer are available. Each sale gets up to six source photos. The daily collector builds a queue of up to 60 distinct unread sale IDs with source photo URLs. It sorts by when the collector first saw the sale, newest first. Ties use later opening date first, then sale ID ascending. The city field is the feed slug. Images belong to the source and stay in a temporary directory outside the repository.

## 1. Freeze the batch and download the photos

Use Bash, Node.js 22 or newer, Git, an authenticated GitHub CLI and an image viewer. Run these blocks in the same shell. A disposable checkout keeps publication separate from any other work in progress.

```bash
export XDG_CONFIG_HOME=/data/home/.config
export PASS_DIR=$(mktemp -d /tmp/the-dig-photo-pass.XXXXXXXX)
git clone --quiet --branch main https://github.com/rheinze08/the-dig-data.git "$PASS_DIR/checkout"
cd "$PASS_DIR/checkout"
git rev-parse HEAD > "$PASS_DIR/input-commit"
node --input-type=module <<'JS'
import fs from 'node:fs/promises';
import path from 'node:path';
const tmp = process.env.PASS_DIR;
const queue = JSON.parse(await fs.readFile('collector/state/photo-queue.json'));
const batch = queue.slice(0, 40);
await fs.writeFile(path.join(tmp, 'batch.json'), JSON.stringify(batch, null, 2));
await fs.writeFile(path.join(tmp, 'drafts.json'), '{}\n');
for (const [i, sale] of batch.entries()) {
  const dir = path.join(tmp, String(i + 1).padStart(2, '0') + '-' + sale.id);
  await fs.mkdir(dir);
  const results = [];
  for (const [j, url] of sale.photoUrls.slice(0, 6).entries()) {
    try {
      const r = await fetch(url, {signal: AbortSignal.timeout(30000)});
      if (!r.ok) throw Error('HTTP ' + r.status);
      const type = r.headers.get('content-type')?.split(';')[0].toLowerCase();
      if (!type?.startsWith('image/')) throw Error('Unexpected media type ' + type);
      const ext = ({'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp',
        'image/avif':'avif', 'image/gif':'gif'})[type] || 'img';
      const file = (j + 1) + '.' + ext;
      await fs.writeFile(path.join(dir, file), Buffer.from(await r.arrayBuffer()));
      results.push({url, file});
    } catch (error) {
      results.push({url, error: error.message});
    }
  }
  await fs.writeFile(path.join(dir, 'downloads.json'), JSON.stringify(results, null, 2));
  console.log(dir, results.filter(x => x.file).length + '/' + results.length, 'downloaded');
}
JS
```

## 2. Read the images and write the draft

Open every downloaded image in each numbered directory. Inspect the original at full size whenever a detail on a contact sheet is unclear. Give each readable sale **3–8 distinct shopper search terms** and **one plain contents line of at most 120 characters** describing the visible merchandise. Use a brand or model only when the item or its label establishes it. Avoid claims about age, material, authenticity, completeness, working condition or value that the images cannot establish.

Write one entry per readable sale into `$PASS_DIR/drafts.json`. Use the ID from the directory name and a real ISO timestamp from `node -p 'new Date().toISOString()'` when you finish reading it. Use this shape.

```json
{
  "example-sale-id": {
    "keywords": ["coffee mugs", "serving bowls", "dinner plates"],
    "contentsLine": "Stacks of dinner plates sit beside serving bowls and coffee mugs.",
    "readAt": "2026-11-23T14:51:00.000Z"
  }
}
```

Use the photo evidence alone. The seller's title, description, captions and existing keywords cannot supply missing items or the contents line. Exclude illustrations on promotional cards, company logos, house exteriors and sale rules. If downloads fail, retry the same URLs as needed. When the readable photos cannot support three honest terms and a contents line, omit the sale and record its ID and reason in your pass notes. Keep the original batch fixed. These omissions remain eligible when merchandise photos become available.

## 3. Merge and push the sidecar

The following block reapplies the drafts to the latest published sidecar. It keeps an existing read if another reviewer got there first and skips IDs that have already left the published search feed. On a non-fast-forward push, run the **whole block** again so it starts from the latest main. The drafts live outside the disposable checkout and survive retries.

```bash
export XDG_CONFIG_HOME=/data/home/.config
(
  set -e
  git fetch --quiet origin main
  git switch --quiet --detach origin/main
  node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {validatePhotoReads} from './collector/lib/photo-pass.mjs';
const load = p => JSON.parse(fs.readFileSync(p));
const batch = new Map(load(process.env.PASS_DIR + '/batch.json').map(s => [s.id, s]));
const drafts = load(process.env.PASS_DIR + '/drafts.json');
validatePhotoReads(drafts);
const reads = load('photo-reads.json');
const active = new Set(load('search.json').sales.map(s => s.id));
for (const [id, draft] of Object.entries(drafts)) {
  assert(batch.has(id), 'Outside frozen batch: ' + id);
  assert(draft.contentsLine.length <= 120 && draft.contentsLine.trim().toLowerCase()
    !== batch.get(id).title.trim().toLowerCase(), 'Check contents line: ' + id);
  assert.equal(new Set(draft.keywords.map(k => k.trim().toLowerCase())).size, draft.keywords.length);
  if (Object.hasOwn(reads, id) || !active.has(id)) console.log('Already read or departed:', id);
  else reads[id] = draft;
}
fs.writeFileSync('photo-reads.json', JSON.stringify(reads, null, 2) + '\n');
JS
  git add -- photo-reads.json
  if ! git diff --cached --quiet; then
    git -c user.name=rheinze08 -c user.email=105813130+rheinze08@users.noreply.github.com \
      commit -m 'Add verified listing photo reads' -- photo-reads.json
    git push origin HEAD:main
  fi
)
```

## 4. Refresh once

Choose one full refresh after the sidecar is on main. Either let the next scheduled **Daily refresh** pick it up, or dispatch immediately with the command below. Skip the dispatch if the scheduled run already picked up the sidecar. A push by itself does not launch this workflow.

```bash
export XDG_CONFIG_HOME=/data/home/.config
gh workflow run daily-refresh.yml --repo rheinze08/the-dig-data --ref main
```

List runs until the scheduled or dispatched run appears. Match its event, start time, and head SHA to the published sidecar commit or a descendant. Copy that run's numeric ID into the watch command. If the run fails, inspect its log and report the outcome. A city failure can publish a partial refresh and retain that city's previous feed.

```bash
export XDG_CONFIG_HOME=/data/home/.config
gh run list --repo rheinze08/the-dig-data --workflow daily-refresh.yml --branch main \
  --limit 8 --json databaseId,headSha,event,status,createdAt,conclusion
read -r -p 'Refresh run ID: ' run_id
gh run watch "$run_id" --repo rheinze08/the-dig-data --interval 30 --exit-status
git fetch --quiet origin main
git switch --quiet --detach origin/main
```

## 5. Verify publication and clean up

Use the fresh checkout from step 4. This checks every per-city and search row against the published sidecar, checks that the default-city mirror is identical, and shows how many reads from this batch remain in the feed. Refresh removes sidecar entries once the ID disappears from all published city feeds.

```bash
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const load = p => JSON.parse(fs.readFileSync(p));
const index = load('cities.json'), search = load('search.json').sales;
const reads = load('photo-reads.json'), queue = load('collector/state/photo-queue.json');
const batch = load(process.env.PASS_DIR + '/batch.json'), drafts = load(process.env.PASS_DIR + '/drafts.json');
const seen = new Set(), searchRows = new Map(search.map(s => [s.citySlug + '/' + s.id, s]));
function verify(s) {
  const r = reads[s.id];
  assert.equal(s.photoRead === true, Boolean(r), s.id + ' flag');
  if (r) {
    assert.deepEqual(s.photoKeywords, r.keywords, s.id + ' keywords');
    assert.equal(s.contentsLine, r.contentsLine, s.id + ' contents');
  }
}
for (const city of index.cities.filter(c => c.feedUrl)) {
  const sales = load('cities/' + city.slug + '/sales.json').sales;
  assert.equal(sales.length, city.sales);
  for (const s of sales) {
    verify(s);
    seen.add(s.id);
    const key = city.slug + '/' + s.id;
    assert(searchRows.has(key), 'Missing search row ' + key);
    verify(searchRows.get(key));
    searchRows.delete(key);
  }
  console.log(city.slug, sales.length, 'sales,', sales.filter(s => s.photoRead === true).length, 'read');
}
assert.equal(searchRows.size, 0);
assert(Object.keys(reads).every(id => seen.has(id)), 'Departed sidecar ID');
assert(queue.length <= 60 && queue.every(e => !reads[e.id] && e.photoUrls.length <= 6));
assert(fs.readFileSync('sales.json').equals(fs.readFileSync('cities/' + index.defaultCity + '/sales.json')));
const marked = search.filter(s => s.photoRead === true);
console.log('Inspected', batch.length, 'drafted', Object.keys(drafts).length,
  'batch IDs published with reads', Object.keys(drafts).filter(id => reads[id]).length);
console.log('Published', marked.length, 'marked city/search rows,', Object.keys(reads).length, 'unique read IDs');
for (const s of marked.filter(s => Object.hasOwn(drafts, s.id)).slice(0, 5))
  console.log(s.title, '→', s.photoKeywords.join(', '));
JS
```

Record the counts, example matches, skipped IDs and failed downloads. After verification, delete the disposable checkout, notes and downloaded images together. Commit only the sidecar during a pass. The refresh workflow publishes the generated JSON files.

```bash
cd /tmp
node --input-type=module <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir = process.env.PASS_DIR;
assert(/^\/tmp\/the-dig-photo-pass\.[A-Za-z0-9]+$/.test(dir) && fs.realpathSync(dir) === dir);
assert(fs.existsSync(dir + '/input-commit') && fs.existsSync(dir + '/batch.json'));
fs.rmSync(dir, {recursive: true});
JS
unset PASS_DIR
```

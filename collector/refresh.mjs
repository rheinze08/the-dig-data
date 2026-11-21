#!/usr/bin/env node
// The daily refresh. The GitHub Action in .github/workflows/daily-refresh.yml
// runs this once a day and commits whatever it changes.
//
//   node collector/refresh.mjs                collect every city, apply the rules, rebuild the index and search
//   node collector/refresh.mjs --index-only   rebuild cities.json and search.json from the feeds on disk
//
//   exit 0  every city collected
//   exit 2  one or more cities failed; everything that did collect is ready to publish
//   exit 1  the refresh itself broke; publish nothing
import {spawnSync} from 'node:child_process';
import {appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {defaultHome} from './lib/config.mjs';
import {refresh} from './lib/refresh.mjs';

const args = process.argv.slice(2);
const indexOnly = args.length === 1 && args[0] === '--index-only';
if (args.length && !indexOnly) {
  console.error('Usage: node collector/refresh.mjs [--index-only]');
  process.exit(1);
}

const collector = fileURLToPath(new URL('./collect.mjs', import.meta.url));
// Each city collects in its own process, so one city's crash cannot stop the rest.
function collect(city) {
  console.log(`\n== Collecting ${city.slug} (${city.status}) ==`);
  const result = spawnSync(process.execPath, [collector, '--city', city.slug], {stdio: 'inherit'});
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}

const onActions = process.env.GITHUB_ACTIONS === 'true';
try {
  const outcome = await refresh({home: defaultHome(), collect: indexOnly ? null : collect});
  if (onActions) {
    for (const entry of outcome.report) {
      if (!entry.ok) console.log(`::error title=Collection failed::${entry.slug}: ${entry.note}`);
      if (entry.promoted) console.log(`::notice title=City promoted::${entry.slug} is now live. ${entry.note}`);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY && outcome.report.length) {
    const rows = outcome.report.map(entry => `| ${entry.slug} | ${entry.status} | ${entry.ok ? 'clean' : '**FAILED**'} | ${entry.sales ?? ''} | ${entry.cleanRuns} | ${entry.note} |`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, ['## Daily refresh', '',
      '| City | Status | Collection | Sales | cleanRuns | Note |', '| --- | --- | --- | ---: | ---: | --- |', ...rows, '',
      `search.json: ${outcome.searchSales} sales.`, ''].join('\n'));
  }
  if (outcome.failed.length) {
    console.error(`Refresh finished with FAILED cities: ${outcome.failed.join(', ')}`);
    process.exitCode = 2;
  }
} catch (error) {
  console.error('Refresh broke: ' + (error.stack || error.message));
  process.exitCode = 1;
}

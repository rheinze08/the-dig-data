#!/usr/bin/env bash
# Installs the daily refresh Action by moving ci/daily-refresh.yml to where
# GitHub runs workflows, then starts the first run.
#
# GitHub only lets a login with the "workflow" permission add workflow files.
# Grant it once (it opens a browser to approve), then run this script:
#   gh auth refresh -h github.com -s workflow
#   ./ci/install-daily-refresh.sh
#
# The same install can be done on the GitHub website instead. See README, "Daily refresh".
set -Eeuo pipefail
if [[ -z ${XDG_CONFIG_HOME:-} && -d /data/home/.config ]]; then
  export XDG_CONFIG_HOME=/data/home/.config
fi
export GIT_TERMINAL_PROMPT=0
cd -- "$(dirname -- "$0")/.."

if [[ $(git branch --show-current) != main ]]; then
  echo 'Run this on branch main.' >&2
  exit 1
fi
if [[ ! -f ci/daily-refresh.yml ]]; then
  echo 'ci/daily-refresh.yml is gone. The Action may already be installed.' >&2
  exit 1
fi
git pull --quiet --ff-only origin main
mkdir -p .github/workflows
git mv ci/daily-refresh.yml .github/workflows/daily-refresh.yml
git commit --quiet -m 'Install the daily refresh Action' -- ci/daily-refresh.yml .github/workflows/daily-refresh.yml
if ! git push --quiet origin HEAD:main; then
  echo 'GitHub refused the push. Grant the permission first: gh auth refresh -h github.com -s workflow' >&2
  echo 'Then run: git push origin HEAD:main' >&2
  exit 1
fi
echo 'Installed. Starting the first run.'
gh workflow run daily-refresh.yml --repo rheinze08/the-dig-data
echo 'Watch it: gh run watch --repo rheinze08/the-dig-data'

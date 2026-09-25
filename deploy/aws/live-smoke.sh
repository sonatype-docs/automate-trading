#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${1:?usage: live-smoke.sh BASE_URL}"
base_url="${base_url%/}"

curl --fail --silent --show-error "$base_url/api/public/health" | grep -q '"ok":true'
curl --fail --silent --show-error "$base_url/api/public/ready" | grep -q '"ok":true'

for path in \
  / \
  /login \
  /files \
  /backtest/compare \
  /research \
  /optimizer \
  /analytics \
  /trade-intelligence \
  /paper-trading \
  /live-trading; do
  curl --fail --silent --show-error "$base_url$path" -o /dev/null
done

for path in /api/files/list /api/files/download; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$base_url$path")"
  test "$status" = "401"
done

for path in /api/files/presign /api/files/complete; do
  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    -X POST -H 'content-type: application/json' --data '{}' "$base_url$path")"
  test "$status" = "401"
done

echo "Live smoke passed: health/readiness, feature routes, and unauthenticated file API protection."

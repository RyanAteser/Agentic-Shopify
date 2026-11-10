#!/usr/bin/env bash
# Real n8n engine smoke, strictly offline. NO OpenAI, Shopify, Bright Data,
# merchant credentials, paid calls, or public networking.
set -euo pipefail

image="docker.n8n.io/n8nio/n8n:2.46.7"
suffix="ci-$$"
network="ci-n8n-offline-$suffix"
volume="ci-n8n-data-$suffix"
server="ci-n8n-server-$suffix"
tmpdir="$(mktemp -d)"

cleanup(){
  docker rm -f "$server" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmpdir"
}
trap cleanup EXIT

# Derive a separate THREE-NODE workflow and reject any paid HTTP steps.
node scripts/make-n8n-ack-fixture.mjs n8n/shopify-blog-writer.json "$tmpdir/ci-only.json"
docker network create --internal "$network" >/dev/null
docker volume create "$volume" >/dev/null
docker pull "$image" >/dev/null

# Import & publish only the safe fixture into ephemeral SQLite state.
docker run --rm --network "$network" \
  -v "$volume:/home/node/.n8n" -v "$tmpdir/ci-only.json:/tmp/ci-only.json:ro" \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  "$image" import:workflow --input=/tmp/ci-only.json
docker run --rm --network "$network" -v "$volume:/home/node/.n8n" \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  "$image" publish:workflow --id=ci-ack-only-v1

# Internal network prevents external egress. Port is bound only to loopback.
docker run -d --name "$server" --network "$network" \
  -v "$volume:/home/node/.n8n" \
  -p 127.0.0.1::5678 \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_PERSONALIZATION_ENABLED=false \
  -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -e N8N_TEMPLATES_ENABLED=false \
  -e N8N_LOG_LEVEL=error \
  -e N8N_RUNNERS_ENABLED=false \
  -e N8N_HOST=127.0.0.1 \
  -e N8N_PROTOCOL=http \
  "$image" >/dev/null

port="$(docker port "$server" 5678/tcp | head -n 1 | sed 's/.*://')"
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "Failed to resolve local n8n ephemeral TCP port" >&2
  exit 1
fi
base="http://127.0.0.1:$port"
ready=false
for _ in $(seq 1 100); do
  code="$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' "$base/healthz" || true)"
  if [[ "$code" == "200" ]]; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Real n8n engine failed its local health check" >&2
  docker logs --tail 70 "$server" >&2
  exit 1
fi

token="$(printf 'a%.0s' {1..43})"
printf '{"jobId":"ci-ack-123","shop":"ci-only.myshopify.com","topic":"Synthetic paper test","callbackToken":"%s","brief":{},"productCatalog":[],"productCatalogHasMore":false,"productCatalogSampledCount":0,"productCatalogMissingUrls":0,"callbackUrl":"https://invalid.attacker.example/token-leak"}\n' "$token" >"$tmpdir/valid.json"

endpoint="$base/webhook/ci-only-blog-ack"
status="$(curl --silent --show-error --max-time 12 \
  --output "$tmpdir/ack.json" --write-out '%{http_code}' \
  -H 'Content-Type: application/json' --data-binary "@$tmpdir/valid.json" "$endpoint")"
if [[ "$status" != "202" ]]; then
  echo "Real n8n did not return job-scoped HTTP 202 (got $status)" >&2
  docker logs --tail 70 "$server" >&2
  exit 1
fi
python3 - "$tmpdir/ack.json" <<'PY'
import json,sys
with open(sys.argv[1],encoding="utf-8") as f: body=json.load(f)
assert body=={"accepted":True,"jobId":"ci-ack-123","shop":"ci-only.myshopify.com"}, body
PY

# Invalid capability must never receive an accepted 202.
sed 's/"callbackToken":"a*"/"callbackToken":"invalid"/' "$tmpdir/valid.json" >"$tmpdir/invalid.json"
invalid_status="$(curl --silent --max-time 12 --output "$tmpdir/invalid-response.txt" \
  --write-out '%{http_code}' -H 'Content-Type: application/json' \
  --data-binary "@$tmpdir/invalid.json" "$endpoint" || true)"
if [[ "$invalid_status" == "202" ]]; then
  echo "Real n8n accepted an invalid article-job capability" >&2
  exit 1
fi
echo "Real n8n 2.46.7: derived safe webhook + original brief validation + scoped 202 succeeded; invalid input rejected."
echo "No provider nodes, merchant credentials, commerce writes or paid calls were present."

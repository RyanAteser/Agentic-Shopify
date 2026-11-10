#!/usr/bin/env bash
# Actual n8n 2.46.7 with all EIGHT source workflow nodes. Two model calls
# and the app callback are redirected ONLY to an isolated deterministic mock.
set -euo pipefail

n8n_image="docker.n8n.io/n8nio/n8n:2.46.7"
curl_image="curlimages/curl:8.11.1"
node_image="node:22-alpine"
suffix="ci-$$"
network="ci-full-n8n-$suffix"
volume="ci-full-data-$suffix"
server="ci-full-n8n-server-$suffix"
mock="ci-n8n-mock"
tmp="$(mktemp -d)"

cleanup(){
  docker rm -f "$server" "$mock" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

node scripts/make-n8n-full-fixture.mjs n8n/shopify-blog-writer.json "$tmp/full-fixture.json"
chmod 644 "$tmp/full-fixture.json"
docker pull "$n8n_image" >/dev/null
docker pull "$curl_image" >/dev/null
docker pull "$node_image" >/dev/null
docker network create --internal "$network" >/dev/null
docker volume create "$volume" >/dev/null

# This fake model is the ONLY HTTP Request destination in the derived fixture.
docker run -d --name "$mock" --network "$network" --read-only --tmpfs /tmp \
  -v "$PWD/scripts/ci-n8n-full-mock.mjs:/app/mock.mjs:ro" \
  "$node_image" node /app/mock.mjs >/dev/null
code=""
for _ in $(seq 1 30); do
  code="$(docker run --rm --network "$network" "$curl_image" -s --max-time 2 -o /dev/null -w '%{http_code}' "http://$mock:8080/healthz" || true)"
  if [[ "$code" == "200" ]]; then break; fi
  sleep 1
done
if [[ "$code" != "200" ]]; then
  echo "Synthetic model/callback server failed readiness" >&2
  docker logs "$mock" >&2
  exit 1
fi

docker run --rm --network "$network" \
  -v "$volume:/home/node/.n8n" -v "$tmp/full-fixture.json:/tmp/full-fixture.json:ro" \
  -e N8N_DIAGNOSTICS_ENABLED=false "$n8n_image" \
  import:workflow --input=/tmp/full-fixture.json
docker run --rm --network "$network" -v "$volume:/home/node/.n8n" \
  -e N8N_DIAGNOSTICS_ENABLED=false "$n8n_image" \
  publish:workflow --id=ci-blog-full-loop-v1

docker run -d --name "$server" --network "$network" \
  -v "$volume:/home/node/.n8n" \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_PERSONALIZATION_ENABLED=false \
  -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -e N8N_TEMPLATES_ENABLED=false \
  -e N8N_LOG_LEVEL=error \
  -e N8N_RUNNERS_ENABLED=false \
  -e N8N_HOST="$server" \
  -e N8N_LISTEN_ADDRESS=0.0.0.0 \
  -e N8N_PROTOCOL=http "$n8n_image" >/dev/null
url="http://$server:5678"
ready=false
for _ in $(seq 1 100); do
  code="$(docker run --rm --network "$network" "$curl_image" -s --max-time 2 -o /dev/null -w '%{http_code}' "$url/healthz" || true)"
  if [[ "$code" == "200" ]]; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Real n8n did not become healthy" >&2
  docker logs --tail 70 "$server" >&2
  exit 1
fi
# Required n8n 2.x CLI publication lifecycle (validated by PR #22).
docker exec "$server" n8n unpublish:workflow --id=ci-blog-full-loop-v1
docker exec "$server" n8n publish:workflow --id=ci-blog-full-loop-v1
sleep 20

printf '{"jobId":"ci-full-pass","shop":"ci-only.myshopify.com","topic":"Synthetic ecommerce products","callbackToken":"%s","brief":{},"productCatalog":[],"productCatalogHasMore":false,"productCatalogSampledCount":0,"productCatalogMissingUrls":0,"callbackUrl":"https://attacker.example.invalid/ignore"}\n' "$(printf 'a%.0s' {1..43})" >"$tmp/happy.json"
webhook="$url/webhook/ci-only-blog-full"
post(){
  local input="$1"
  docker run --rm --network "$network" -v "$input:/ci/request.json:ro" \
    "$curl_image" -s --show-error --max-time 12 \
    -w '\n%{http_code}' -H 'Content-Type: application/json' \
    --data-binary @/ci/request.json "$webhook"
}
status_of(){ printf '%s\n' "$1" | tail -n 1; }
body_of(){ printf '%s\n' "$1" | sed '$d'; }
state(){
  docker run --rm --network "$network" "$curl_image" \
    -s --show-error --max-time 5 "http://$mock:8080/state"
}
diagnose(){
  echo "Synthetic mock state:" >&2
  state >&2 || true
  docker logs --tail 65 "$server" >&2 || true
}

happy="$(post "$tmp/happy.json")"
if [[ "$(status_of "$happy")" != "202" ]]; then
  echo "Real eight-node n8n rejected synthetic happy job" >&2
  diagnose;exit 1
fi
body_of "$happy" | python3 -c 'import json,sys; x=json.load(sys.stdin); assert x=={"accepted":True,"jobId":"ci-full-pass","shop":"ci-only.myshopify.com"},x'

completed=false
for _ in $(seq 1 45); do
  observed="$(state)"
  if printf '%s' "$observed" | python3 -c 'import json,sys; x=json.load(sys.stdin); assert (x["writerRequests"],x["editorRequests"],x["validCallbacks"],x["modelPolicyViolations"],x["rejectedCalls"])==(1,1,1,0,0); assert x["lastCallback"]["usageStages"]==["writer","editor"]; assert x["lastCallback"]["tokens"]==[[900,350],[1300,450]]' >/dev/null 2>&1; then
    completed=true;break
  fi
  sleep 1
done
if [[ "$completed" != true ]]; then
  echo "Real n8n did not complete writer/editor and signed-app-callback-shaped flow" >&2
  diagnose;exit 1
fi

# Malformed editor response: n8n already acknowledged the job and both
# model steps consumed usage, yet the callback must never claim success.
sed -e 's/ci-full-pass/ci-full-failure/g' \
  -e 's/Synthetic ecommerce products/FAIL_EDITOR/g' \
  "$tmp/happy.json" >"$tmp/failure.json"
failure="$(post "$tmp/failure.json")"
if [[ "$(status_of "$failure")" != "202" ]]; then
  echo "n8n did not acknowledge expected async editor-failure fixture" >&2
  diagnose;exit 1
fi
failed=false
for _ in $(seq 1 45); do
  observed="$(state)"
  if printf '%s' "$observed" | python3 -c 'import json,sys; x=json.load(sys.stdin); assert (x["writerRequests"],x["editorRequests"],x["failedEditorResponses"],x["callbacks"],x["validCallbacks"],x["modelPolicyViolations"])==(2,2,1,1,1,0)' >/dev/null 2>&1; then
    failed=true;break
  fi
  sleep 1
done
if [[ "$failed" != true ]]; then
  echo "Editor failure did not preserve the expected NO-callback state" >&2
  diagnose;exit 1
fi

# The unmodified source Prepare Brief node rejects bad capabilities,
# before triggering the model or callback HTTP nodes.
sed 's/"callbackToken":"a*"/"callbackToken":"invalid"/' \
  "$tmp/happy.json" >"$tmp/invalid.json"
invalid="$(post "$tmp/invalid.json" || true)"
if [[ "$(status_of "$invalid")" == "202" ]]; then
  echo "Real n8n accepted bad job capability" >&2
  diagnose;exit 1
fi
observed="$(state)"
printf '%s' "$observed" | python3 -c 'import json,sys; x=json.load(sys.stdin); assert (x["writerRequests"],x["editorRequests"],x["callbacks"],x["validCallbacks"],x["modelPolicyViolations"])==(2,2,1,1,0),x'
echo "PASS real n8n 2.46.7: all eight nodes hit only the local mock; good callback, editor failure abstention and malformed input denial."
echo "NO OpenAI/Shopify requests, actual merchant credentials, real bills, live publishes or merchant writes."

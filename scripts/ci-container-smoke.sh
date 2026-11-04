#!/usr/bin/env bash
# CI-only, ephemeral smoke test: no Shopify credentials, merchant stores or remote APIs.
set -euo pipefail

image="${1:-agentic-shopify:ci}"
suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-$$"
network="agentic-smoke-${suffix}"
database="agentic-smoke-db-${suffix}"
application="agentic-smoke-app-${suffix}"
pilot_application="agentic-smoke-pilot-${suffix}"
invalid_pilot_application="agentic-smoke-invalid-pilot-${suffix}"

cleanup() {
  docker rm -f "$invalid_pilot_application" "$pilot_application" "$application" "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Prove the final image is not running its application as root.
docker run --rm --entrypoint sh "$image" -c 'test "$(id -u)" -ne 0 && test -r build/server/index.js'

docker network create "$network" >/dev/null
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_USER=agentic -e POSTGRES_PASSWORD=test-only-password \
  -e POSTGRES_DB=agentic_test postgres:16 >/dev/null

db_ready=false
for _ in $(seq 1 40); do
  if docker exec "$database" pg_isready -U agentic -d agentic_test >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 1
done
if [[ "$db_ready" != true ]]; then
  echo "Temporary PostgreSQL never became ready" >&2
  docker logs "$database" >&2
  exit 1
fi

db_url="postgresql://agentic:test-only-password@${database}:5432/agentic_test?schema=public"
# Migration uses exactly the production runtime image and committed SQL.
docker run --rm --network "$network" -e DATABASE_URL="$db_url" \
  "$image" npx prisma migrate deploy --schema prisma/schema.postgresql.prisma

# Credentials are inert CI placeholders. Health must not require external APIs.
docker run -d --name "$application" --network "$network" -p 127.0.0.1::3000 \
  -e DATABASE_URL="$db_url" \
  -e SHOPIFY_API_KEY=ci_dummy_key \
  -e SHOPIFY_API_SECRET=ci-only-inert-secret-not-for-any-store \
  -e SHOPIFY_APP_URL=https://ci.example.invalid \
  -e SCOPES=read_products,write_content \
  "$image" >/dev/null

port="$(docker port "$application" 3000/tcp | head -n 1 | sed 's/.*://')"
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "Could not resolve temporary mapped application port" >&2
  exit 1
fi
url="http://127.0.0.1:${port}/health"
ready=false
for _ in $(seq 1 40); do
  body="$(curl --silent --show-error --max-time 2 --fail "$url" 2>/dev/null || true)"
  if [[ "$body" == '{"status":"ready"}' ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "Built image failed to serve a DB-backed HTTP 200 readiness response" >&2
  docker logs "$application" >&2
  exit 1
fi
echo "Container smoke: non-root image, migrations and DB-backed /health passed"

# Start the SAME built image with an entirely synthetic, read-only
# single-merchant configuration. This does not use Shopify tokens or contact a
# live store. Routing/bridge denials must hold in the actual HTTP server, not
# just unit tests of the guard helpers.
pilot_key="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
docker run -d --name "$pilot_application" --network "$network" -p 127.0.0.1::3000 \
  -e DATABASE_URL="$db_url" \
  -e SHOPIFY_API_KEY="$pilot_key" \
  -e SHOPIFY_API_SECRET=ci-only-inert-secret-not-for-any-store \
  -e SHOPIFY_APP_URL=https://ci.example.invalid \
  -e AGENTIC_PILOT_MODE=read_only \
  -e AGENTIC_PILOT_SHOP=ci-only.myshopify.com \
  -e AGENTIC_PILOT_CLIENT_ID="$pilot_key" \
  -e SCOPES=read_products \
  "$image" >/dev/null

pilot_port="$(docker port "$pilot_application" 3000/tcp | head -n 1 | sed 's/.*://')"
if [[ ! "$pilot_port" =~ ^[0-9]+$ ]]; then
  echo "Could not resolve synthetic read-only pilot port" >&2
  exit 1
fi
pilot_url="http://127.0.0.1:${pilot_port}"
pilot_ready=false
for _ in $(seq 1 40); do
  pilot_body="$(curl --silent --max-time 2 "$pilot_url/health" || true)"
  if [[ "$pilot_body" == '{"status":"ready"}' ]]; then
    pilot_ready=true
    break
  fi
  sleep 1
done
if [[ "$pilot_ready" != true ]]; then
  echo "Synthetic read-only pilot failed its DB-backed readiness check" >&2
  docker logs "$pilot_application" >&2
  exit 1
fi

for path in /app /app/manager /app/seo; do
  status="$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' "$pilot_url$path" || true)"
  if [[ "$status" != "403" ]]; then
    echo "Read-only pilot permitted blocked GET $path (HTTP $status)" >&2
    docker logs "$pilot_application" >&2
    exit 1
  fi
done
# React Router rejects POST to a loader-only route before invoking its
# loader or the pilot guard. HTTP 405 is therefore the expected fail-closed
# response for /app/catalog, not 403. Keep the other write-capable endpoints
# on their explicit 403 guard contract.
status="$(curl --silent --max-time 5 --request POST --output /dev/null --write-out '%{http_code}' "$pilot_url/app/catalog" || true)"
if [[ "$status" != "405" ]]; then
  echo "Read-only pilot catalog POST did not fail closed with HTTP 405 (got $status)" >&2
  docker logs "$pilot_application" >&2
  exit 1
fi
for path in /app /api/seo/rankings /api/agent/due; do
  status="$(curl --silent --max-time 5 --request POST --output /dev/null --write-out '%{http_code}' "$pilot_url$path" || true)"
  if [[ "$status" != "403" ]]; then
    echo "Read-only pilot permitted blocked POST $path (HTTP $status)" >&2
    docker logs "$pilot_application" >&2
    exit 1
  fi
done
# Without an authenticated Shopify session the allowed catalog route must not
# reveal product data. The SDK returns 410 for a missing Shopify launch
# context; explicit denial or redirect to auth are both safe.
status="$(curl --silent --max-time 5 --output /dev/null --write-out '%{http_code}' "$pilot_url/app/catalog" || true)"
case "$status" in
  301|302|303|307|308|400|401|403|410) ;;
  *)
    echo "Anonymous pilot catalog did not require authentication (HTTP $status)" >&2
    docker logs "$pilot_application" >&2
    exit 1
    ;;
esac
echo "Container smoke: read-only pilot starts and rejects unauthorized routes"

# The load-balancer must not mark the pilot ready if the deployed token
# scope request drifts beyond catalog read. Use synthetic credentials only.
docker run -d --name "$invalid_pilot_application" --network "$network" -p 127.0.0.1::3000 \
  -e DATABASE_URL="$db_url" \
  -e SHOPIFY_API_KEY="$pilot_key" \
  -e SHOPIFY_API_SECRET=ci-only-inert-secret-not-for-any-store \
  -e SHOPIFY_APP_URL=https://ci.example.invalid \
  -e AGENTIC_PILOT_MODE=read_only \
  -e AGENTIC_PILOT_SHOP=ci-only.myshopify.com \
  -e AGENTIC_PILOT_CLIENT_ID="$pilot_key" \
  -e SCOPES=read_products,write_content \
  "$image" >/dev/null

invalid_pilot_port="$(docker port "$invalid_pilot_application" 3000/tcp | head -n 1 | sed 's/.*://')"
if [[ ! "$invalid_pilot_port" =~ ^[0-9]+$ ]]; then
  echo "Could not resolve invalid pilot port" >&2
  exit 1
fi
invalid_pilot_url="http://127.0.0.1:${invalid_pilot_port}/health"
invalid_pilot_denied=false
for _ in $(seq 1 30); do
  status="$(curl --silent --max-time 2 --output /dev/null --write-out '%{http_code}' "$invalid_pilot_url" || true)"
  if [[ "$status" == "200" ]]; then
    echo "Misconfigured pilot incorrectly reported HTTP 200 ready" >&2
    exit 1
  fi
  if [[ "$status" == "503" ]]; then
    invalid_pilot_denied=true
    break
  fi
  sleep 1
done
if [[ "$invalid_pilot_denied" != true ]]; then
  echo "Misconfigured pilot never returned the required readiness 503" >&2
  docker logs "$invalid_pilot_application" >&2
  exit 1
fi
echo "Container smoke: elevated pilot scope fails HTTP readiness"

# A dead database must not be reported as ready by the load-balancer endpoint.
docker stop "$database" >/dev/null
unavailable=false
for _ in $(seq 1 20); do
  status="$(curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' "$url" || true)"
  if [[ "$status" == "503" ]]; then
    unavailable=true
    break
  fi
  sleep 1
done
if [[ "$unavailable" != true ]]; then
  echo "Readiness did not return HTTP 503 after PostgreSQL stopped" >&2
  docker logs "$application" >&2
  exit 1
fi
echo "Container smoke: failed dependency correctly returns HTTP 503"

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = new URL("../railway.monika-pilot.json", import.meta.url);
const config = JSON.parse(readFileSync(file, "utf8"));
const docker = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("pilot Railway config is opt-in, builds the tested production Dockerfile", () => {
  assert.equal(config.build.builder, "DOCKERFILE");
  assert.equal(config.build.dockerfilePath, "Dockerfile");
  assert.equal(config.$schema, "https://railway.com/railway.schema.json");
  assert.match(docker, /RUN npx prisma generate --schema prisma\/schema.postgresql.prisma/);
  assert.match(docker, /ENV HOST=0\.0\.0\.0/);
  assert.match(docker, /CMD \["npm","run","start"\]/);
  assert.equal(pkg.scripts.start, "react-router-serve ./build/server/index.js");
});

test("production database migration must succeed before serving requests", () => {
  assert.deepEqual(config.deploy.preDeployCommand, [
    "npx prisma migrate deploy --schema prisma/schema.postgresql.prisma"
  ]);
  assert.equal(config.deploy.healthcheckPath, "/health");
  assert.ok(config.deploy.healthcheckTimeout >= 60 && config.deploy.healthcheckTimeout <= 300);
  assert.equal(config.deploy.restartPolicyType, "ON_FAILURE");
  assert.match(docker, /COPY --from=build \/app\/prisma \.\/prisma/);
  assert.ok(pkg.dependencies.prisma, "Prisma CLI must exist in runtime image for migration");
});

test("pilot config does not embed credentials, billing, environment overrides or privileged execution", () => {
  const raw = readFileSync(file, "utf8");
  for (const forbidden of [
    "SHOPIFY_API_SECRET", "DATABASE_URL", "N8N_OUTBOUND_KEY",
    "AGENTIC_PILOT_MODE", "autoDeploy", "numReplicas", "sleepApplication",
    "sudo ", "chmod 777"
  ]) {
    assert.ok(!raw.includes(forbidden), forbidden);
  }
});

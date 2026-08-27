#!/usr/bin/env bash
# Brings the demo stack up, waits for MMGIS, and seeds a Reference Mission.
# Runs as postStartCommand, so it must be safe to run again on every restart.
#
# Usage: start.sh [demo|dev]
#   demo  pull a published image from GHCR (default)
#   dev   build MMGIS from this branch's Dockerfile
set -euo pipefail

cd "$(dirname "$0")/../.."

FLAVOR="${1:-demo}"
SEED_VARIANT="${MMGIS_SEED_VARIANT:-default}"

# The env file lives outside the repository so a generated demo credential can
# never be committed or reach a Docker build context. Exported because the
# compose file interpolates it too.
# MMGIS_ENV_FILE is honoured only if it is an absolute path. devcontainer.json
# does not expand ${containerEnv:HOME} inside containerEnv, so setting it there
# put the literal string "${containerEnv:HOME}/..." into the environment, which
# then resolved against the working directory and created a junk directory in
# the repository. Anything not starting with / is ignored.
resolve_env_file() {
  case "${MMGIS_ENV_FILE:-}" in
    /*) printf '%s\n' "$MMGIS_ENV_FILE" ;;
    *)  printf '%s\n' "$HOME/.mmgis-codespace/.env" ;;
  esac
}

export MMGIS_ENV_FILE="$(resolve_env_file)"
if [ ! -f "$MMGIS_ENV_FILE" ]; then
  echo "[start] $MMGIS_ENV_FILE is missing; running setup-env.sh"
  .devcontainer/scripts/setup-env.sh
fi

COMPOSE_ARGS=(-p mmgis -f .devcontainer/docker-compose.mmgis.yml)
if [ "$FLAVOR" = "dev" ]; then
  COMPOSE_ARGS+=(-f .devcontainer/docker-compose.dev.yml)
fi
COMPOSE_ARGS+=(--env-file "$MMGIS_ENV_FILE")

# Secrets are generated here rather than in postCreateCommand because prebuilds
# run postCreateCommand -- a secret made there would be shared by every
# codespace created from that prebuild. Both are throwaway, demo-only values,
# and are generated once: the database password has to keep matching the volume
# it initialized.
# In-place edit without `sed -i`, whose syntax differs between GNU and BSD --
# this script should also run from a Mac when testing the stack locally.
replace_in_env() {
  local tmp
  tmp="$(mktemp)"
  sed "$1" "$MMGIS_ENV_FILE" > "$tmp"
  mv "$tmp" "$MMGIS_ENV_FILE"
}

if grep -q '^SECRET=$' "$MMGIS_ENV_FILE"; then
  replace_in_env "s|^SECRET=$|SECRET=$(openssl rand -hex 64)|"
  echo "[start] generated SECRET"
fi
if grep -q '^DB_PASS=GENERATED_ON_FIRST_START$' "$MMGIS_ENV_FILE"; then
  # Fresh credentials against a database volume that some earlier credential
  # initialized would fail authentication. They share a lifecycle ($HOME and the
  # volume are discarded together), so this only happens if one was removed by
  # hand -- say so rather than leaving a confusing Postgres error.
  if docker volume inspect mmgis_mmgis-db >/dev/null 2>&1; then
    echo "[start] a database volume exists but its password is gone."
    echo "[start] this demo keeps nothing worth saving; reset it with:"
    echo "[start]   docker compose ${COMPOSE_ARGS[*]} down -v"
    exit 1
  fi
  replace_in_env "s|^DB_PASS=GENERATED_ON_FIRST_START$|DB_PASS=$(openssl rand -hex 24)|"
  echo "[start] generated DB_PASS"
fi

if [ "$FLAVOR" = "dev" ]; then
  echo "[start] building MMGIS from this branch (first build takes a while)"
else
  echo "[start] starting services (first run pulls the MMGIS image)"
fi
docker compose "${COMPOSE_ARGS[@]}" up -d

echo -n "[start] waiting for MMGIS"
READY=false
for _ in $(seq 1 120); do
  if curl -fsS http://localhost:8888/api/utils/healthcheck >/dev/null 2>&1; then
    READY=true
    echo " -- up"
    break
  fi
  echo -n "."
  sleep 5
done

if [ "$READY" != true ]; then
  echo
  echo "[start] MMGIS did not come up. Logs:"
  docker compose "${COMPOSE_ARGS[@]}" logs --tail 50 mmgis
  exit 1
fi

# Seeded through the application layer rather than the Configure API, which
# would need an admin account and so would consume the SETUP screen below.
echo "[start] seeding Reference Mission (${SEED_VARIANT})"
docker compose "${COMPOSE_ARGS[@]}" exec -T mmgis \
  node scripts/seed-reference-mission.js "$SEED_VARIANT" ||
  echo "[start] seeding failed -- the Configure page can still make one by hand"

URL="http://localhost:8888"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-8888.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
fi

cat <<MSG

  MMGIS is running.

    Open  ${URL}/configure  and create the admin account.
    Then  ${URL}  for the map.

  The forwarded port is private to you; GitHub handles the HTTPS.
  Everything in here is throwaway: demo credentials, demo data, no backups.

MSG

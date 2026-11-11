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

# The end-of-start message (URL, setup code) is also saved here, because
# Codespaces sends postStartCommand output to the creation log, not a terminal.
# Removed now so a terminal opened mid-start says "still starting" rather than
# showing the previous run's message. See info.sh.
INFO_FILE="$(dirname "$MMGIS_ENV_FILE")/info.txt"
rm -f "$INFO_FILE"

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
# An env file from before SETUP_CODE existed has no line to fill in.
grep -q '^SETUP_CODE=' "$MMGIS_ENV_FILE" || echo 'SETUP_CODE=' >> "$MMGIS_ENV_FILE"
if grep -q '^SETUP_CODE=$' "$MMGIS_ENV_FILE"; then
  # Same shape as the code MMGIS generates itself (API/permissions/setupCode.js),
  # but fixed for the life of the codespace so it can be printed below rather
  # than fished out of a log that changes on every restart.
  SETUP_ALPHABET=23456789ABCDEFGHJKMNPQRSTUVWXYZ
  code=""
  for i in $(seq 1 16); do
    code+="${SETUP_ALPHABET:$(( $(od -An -N2 -tu2 /dev/urandom) % ${#SETUP_ALPHABET} )):1}"
    if [ $((i % 4)) -eq 0 ] && [ "$i" -lt 16 ]; then code+="-"; fi
  done
  replace_in_env "s|^SETUP_CODE=$|SETUP_CODE=${code}|"
  echo "[start] generated SETUP_CODE"
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

# --- Site access -------------------------------------------------------------
# The env file carries one demo-level setting, MMGIS_SITE_ACCESS, and this turns
# it into what the MMGIS build in use understands. The auth refactor replaced
# AUTH with SITE_ACCESS + AUTH_PROVIDERS, and builds after it refuse to start
# while AUTH is set -- but the last release (`latest`) still predates it, and a
# fork may pin either. Rewritten on every start, so changing MMGIS_SITE_ACCESS
# and running this script again is all it takes.

# Env files written before MMGIS_SITE_ACCESS existed say AUTH=... instead.
if ! grep -q '^MMGIS_SITE_ACCESS=' "$MMGIS_ENV_FILE"; then
  case "$(sed -n 's/^AUTH=//p' "$MMGIS_ENV_FILE" | tail -1)" in
    off)  legacy_access=public ;;
    none) legacy_access=optional ;;
    *)    legacy_access=required ;;
  esac
  echo "MMGIS_SITE_ACCESS=${legacy_access}" >> "$MMGIS_ENV_FILE"
fi

SITE_ACCESS_VALUE="$(sed -n 's/^MMGIS_SITE_ACCESS=//p' "$MMGIS_ENV_FILE" | tail -1)"
case "$SITE_ACCESS_VALUE" in
  required) LEGACY_AUTH=local ;;
  optional) LEGACY_AUTH=none ;;
  public)   LEGACY_AUTH=off ;;
  *)
    echo "[start] MMGIS_SITE_ACCESS=${SITE_ACCESS_VALUE} in $MMGIS_ENV_FILE is not one of: required, optional, public"
    exit 1
    ;;
esac

MMGIS_IMAGE="${MMGIS_IMAGE:-ghcr.io/nasa-ammos/mmgis:development}"
if [ "$FLAVOR" = "dev" ]; then
  # Built from this working tree, so the tree answers the question.
  if [ -d plugins/core/auth ]; then HAS_SITE_ACCESS=true; else HAS_SITE_ACCESS=false; fi
else
  # Pulled on every start: with a moving tag such as `development`, that is
  # what brings a restarted codespace up to the newest build. A pull of an
  # unchanged tag only checks the digest. If the registry cannot be reached,
  # carry on with the copy already here, if there is one; otherwise stop
  # (set -e) rather than mistake a missing image for one without the refactor.
  echo "[start] pulling ${MMGIS_IMAGE}"
  if ! docker pull -q "$MMGIS_IMAGE" >/dev/null; then
    docker image inspect "$MMGIS_IMAGE" >/dev/null 2>&1 || exit 1
    echo "[start] pull failed; using the copy of ${MMGIS_IMAGE} already here"
  fi
  if docker run --rm --entrypoint test "$MMGIS_IMAGE" -d /usr/src/app/plugins/core/auth; then
    HAS_SITE_ACCESS=true
  else
    HAS_SITE_ACCESS=false
  fi
fi

# Strip what an earlier run wrote (including its marker comment), then append.
MARKER="# --- written by start.sh from MMGIS_SITE_ACCESS; edit that, not these ---"
tmp="$(mktemp)"
grep -v -E -e '^(AUTH|SITE_ACCESS|AUTH_PROVIDERS)=' -e "^${MARKER}\$" "$MMGIS_ENV_FILE" > "$tmp" || true
{
  echo "$MARKER"
  if [ "$HAS_SITE_ACCESS" = true ]; then
    echo "SITE_ACCESS=${SITE_ACCESS_VALUE}"
    echo 'AUTH_PROVIDERS=["local"]'
  else
    echo "AUTH=${LEGACY_AUTH}"
  fi
} >> "$tmp"
mv "$tmp" "$MMGIS_ENV_FILE"
chmod 600 "$MMGIS_ENV_FILE"
echo "[start] site access: ${SITE_ACCESS_VALUE} ($( [ "$HAS_SITE_ACCESS" = true ] && echo "SITE_ACCESS" || echo "legacy AUTH=${LEGACY_AUTH}" ))"

# --- Container user ----------------------------------------------------------
# Newer images run as an unprivileged uid that cannot write ../Missions, which
# belongs to whoever owns this checkout; run those as that owner instead. Older
# releases run as root, which can write anything -- and may not cope with
# another uid -- so they keep the user they were built with.
mkdir -p Missions
MISSIONS_OWNER="$(stat -c '%u:%g' Missions 2>/dev/null || stat -f '%u:%g' Missions)"
if [ "$FLAVOR" = "dev" ]; then
  IMAGE_USER="$(sed -n 's/^USER[[:space:]]\{1,\}//p' Dockerfile | tail -1)"
else
  IMAGE_USER="$(docker image inspect --format '{{.Config.User}}' "$MMGIS_IMAGE")"
fi
case "${IMAGE_USER:-root}" in
  root|0|0:*|root:*) export MMGIS_USER="0:0" ;;
  *)                 export MMGIS_USER="$MISSIONS_OWNER" ;;
esac
echo "[start] mmgis container user: ${MMGIS_USER} (image user: ${IMAGE_USER:-root})"

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
#
# The seed script leaves an existing mission alone, so on its own a codespace
# would keep showing the Reference Mission from whichever image first seeded
# it. Record the image ID the mission came from, next to the env file (same
# lifecycle as the database), and reseed with --force when it changes.
SEED_REFRESH="${MMGIS_SEED_REFRESH:-on-image-change}"
SEED_STAMP="$(dirname "$MMGIS_ENV_FILE")/seeded-image-${SEED_VARIANT}"
RUNNING_IMAGE="$(docker inspect --format '{{.Image}}' "$(docker compose "${COMPOSE_ARGS[@]}" ps -q mmgis)")"
SEED_ARGS=("$SEED_VARIANT")
if [ "$SEED_REFRESH" = "on-image-change" ] && [ -f "$SEED_STAMP" ] &&
  [ "$(cat "$SEED_STAMP")" != "$RUNNING_IMAGE" ]; then
  echo "[start] MMGIS image changed since the Reference Mission was seeded; refreshing it"
  echo "[start] (set MMGIS_SEED_REFRESH=never to keep Configure edits to it)"
  SEED_ARGS+=(--force)
fi
echo "[start] seeding Reference Mission (${SEED_VARIANT})"
if docker compose "${COMPOSE_ARGS[@]}" exec -T mmgis \
  node scripts/seed-reference-mission.js "${SEED_ARGS[@]}"; then
  printf '%s\n' "$RUNNING_IMAGE" > "$SEED_STAMP"
else
  echo "[start] seeding failed -- the Configure page can still make one by hand"
fi

URL="http://localhost:8888"
if [ -n "${CODESPACE_NAME:-}" ]; then
  URL="https://${CODESPACE_NAME}-8888.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
fi

SETUP_LINE="      (no setup code: this image predates it -- see CODESPACES-DEMO.md before"
SETUP_LINE+=$'\n'"       making the port public, since the SETUP form is open until used)"
if [ "$HAS_SITE_ACCESS" = true ]; then
  SETUP_LINE="      setup code: $(sed -n 's/^SETUP_CODE=//p' "$MMGIS_ENV_FILE" | tail -1)   (only asked for while no account exists)"
fi

ACCESS_NOTE=""
if [ "$HAS_SITE_ACCESS" = true ] && [ "$SITE_ACCESS_VALUE" != required ]; then
  ACCESS_NOTE=$'\n'"  Guests only see missions granted to Everyone: Configure -> Users & Access"
  ACCESS_NOTE+=$'\n'"  -> Site-wide -> \"Everyone (including guests)\" -> All missions."
fi

{ cat <<MSG

  MMGIS is running.

    Open  ${URL}/configure  and create the admin account.
${SETUP_LINE}
    Then  ${URL}  for the map.

  Site access: ${SITE_ACCESS_VALUE}. Change MMGIS_SITE_ACCESS in
  ${MMGIS_ENV_FILE} and rerun .devcontainer/scripts/start.sh to open it up.${ACCESS_NOTE}

  The forwarded port is private to you; GitHub handles the HTTPS.
  Everything in here is throwaway: demo credentials, demo data, no backups.
  Sharing it or making it public: see CODESPACES-DEMO.md.
  Show this again: mmgis-info

MSG
} | tee "$INFO_FILE"
chmod 600 "$INFO_FILE"

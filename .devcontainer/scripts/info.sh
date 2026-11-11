#!/usr/bin/env bash
# Prints the MMGIS URL and setup code that start.sh saved on its last run.
#
# start.sh runs as postStartCommand, whose output Codespaces sends to the
# creation log rather than to a terminal anyone is looking at -- so the setup
# code it prints is easy to miss. It also saves that message to a file, and
# this prints it. setup-env.sh hooks this into new shells in the codespace and
# defines `mmgis-info` to run it again.
#
# Usage: info.sh [--quiet-if-missing]
set -uo pipefail

resolve_env_file() {
  case "${MMGIS_ENV_FILE:-}" in
    /*) printf '%s\n' "$MMGIS_ENV_FILE" ;;
    *)  printf '%s\n' "$HOME/.mmgis-codespace/.env" ;;
  esac
}
INFO_FILE="$(dirname "$(resolve_env_file)")/info.txt"

if [ -f "$INFO_FILE" ]; then
  cat "$INFO_FILE"
  exit 0
fi

[ "${1:-}" = "--quiet-if-missing" ] && [ -z "${CODESPACES:-}${REMOTE_CONTAINERS:-}" ] && exit 0
cat <<MSG

  MMGIS is still starting (the first start pulls the image and seeds the
  Reference Mission, which takes a few minutes).

  Run  mmgis-info  again in a minute for the URL and setup code, or watch
  progress with F1 -> "Codespaces: View Creation Log".

MSG

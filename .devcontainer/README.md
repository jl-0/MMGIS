# MMGIS in GitHub Codespaces -- how it is wired

A throwaway MMGIS instance in a browser tab: no local install, no containers to
download, nothing publicly exposed.

**Trying it out? Read [CODESPACES-DEMO.md](../CODESPACES-DEMO.md) instead** -- it
covers starting a codespace, reaching MMGIS, and who pays for the compute. This
file is for people maintaining these configurations.

## Two configurations

| File | Name in the picker | MMGIS comes from |
|---|---|---|
| `devcontainer.json` | MMGIS Demo (published image) | `ghcr.io/nasa-ammos/mmgis:development`, re-pulled on every start |
| `dev/devcontainer.json` | MMGIS Dev (build from this branch) | built from this branch's `Dockerfile` |

**The demo configuration has to stay at `.devcontainer/devcontainer.json`, not in a
named subfolder.** Codespaces only offers the "Dev container configuration"
dropdown on the options page; the badge link, the green *Create codespace* button
and `?quickstart=1` all skip it. With only named configs, those paths fall back to
the default universal image and MMGIS never starts -- a codespace that greets you
with "You are on our default image" is this failure. A root config is the default
for those paths, and named configs alongside it still appear in the dropdown.

## What happens on launch

1. `postCreateCommand` writes the env file -- no manual `cp sample.env .env` step.
2. `postStartCommand` (`scripts/start.sh`) generates the secrets and the setup
   code, works out which auth settings and container user the image needs (see
   below), starts MMGIS and PostGIS, waits for the healthcheck, and seeds a
   Reference Mission.
3. Port 8888 is forwarded and the browser opens it.

Then open `/configure`. The users table is empty, so the admin login page comes up
in SETUP mode: enter the setup code `start.sh` printed, pick a username and
password, and you are the site's SuperAdmin. (Images that predate the setup code
show the same form without that field.)

**Where that output goes.** Codespaces sends `postStartCommand` output to the
creation log (<kbd>F1</kbd> -> *Codespaces: View Creation Log*), not to a terminal,
so a visitor never sees `start.sh`'s message on their own. `start.sh` therefore
also saves it to `~/.mmgis-codespace/info.txt` (mode 600, deleted at the start of
each run so it is never stale), and `setup-env.sh` appends a hook to `~/.bashrc`
(and `~/.zshrc`, if present) that prints it -- via `scripts/info.sh` -- in every
new interactive terminal, plus an `mmgis-info` alias to print it on demand.
Before the file exists, `info.sh` says MMGIS is still starting. The hook is only
installed when `CODESPACES` or `REMOTE_CONTAINERS` is set, so running
`setup-env.sh` on your own machine never touches your shell rc files. The setup
code in that file is a one-time credential, so it is written there and to the
env file only, never to anything that is committed.

`start.sh` runs on every start and is safe to rerun by hand -- that is how a
changed `MMGIS_SITE_ACCESS` takes effect:

    .devcontainer/scripts/start.sh          # demo configuration
    .devcontainer/scripts/start.sh dev      # dev configuration

## Site access across MMGIS versions

The auth refactor (#1146) replaced `AUTH` with `SITE_ACCESS` + `AUTH_PROVIDERS`,
and builds after it **refuse to start while `AUTH` is set**. Builds before it only
understand `AUTH`. Rather than tie the demo to one side of that change, the env
file carries a demo-level setting MMGIS itself ignores:

| `MMGIS_SITE_ACCESS` | Newer builds get | Older builds get |
|---|---|---|
| `required` (default) | `SITE_ACCESS=required` | `AUTH=local` |
| `optional` | `SITE_ACCESS=optional` | `AUTH=none` |
| `public` | `SITE_ACCESS=public` | `AUTH=off` |

`start.sh` decides which column applies by looking for `plugins/core/auth/` in the
image (or, for `dev`, in the working tree), then rewrites the `AUTH` /
`SITE_ACCESS` / `AUTH_PROVIDERS` lines at the bottom of the env file. Edit
`MMGIS_SITE_ACCESS`, never those lines. An env file from before this existed (it
says `AUTH=local`) is migrated on the next start.

On newer builds, access to *missions* is also a role grant, separate from
`SITE_ACCESS`. The server imports grants once, on its first start, and only
grants Everyone -> Viewer if the site was `public` or `optional` at that moment.
The demo starts `required`, so after switching to `public` the site opens but
guests see no missions until an admin grants them -- see
[Making it public](../CODESPACES-DEMO.md#making-it-public). The server log warns
about this too.

`SETUP_CODE` is generated once per codespace and kept in the env file, so it can
be printed by `start.sh` rather than read out of a log that changes on every
restart. It does nothing once an account exists, and older builds ignore it.

## Container user

Images since #1120 run as uid 10001, which cannot write the bind-mounted
`Missions/` owned by the codespace user (seeding then fails with `EACCES`).
`start.sh` therefore sets `MMGIS_USER` to the numeric owner of `Missions/` when
the image's configured user is not root, and to `0:0` when it is (older
releases). The compose file adds `group_add: ["0"]`, which lets an arbitrary uid
write the group-root parts of the image, as upstream's Docker notes describe.

## Credentials

Every credential is generated per codespace, at first start, and reaches nothing
outside that codespace's container network. **Demo and testing only -- never
reuse these values, and do not treat the generated file as a template for a real
deployment;** `sample.env` is that.

**Nothing is written into the working tree.** The env file lives at
`$MMGIS_ENV_FILE` -- `~/.mmgis-codespace/.env` by default, mode 600, outside the
repository. A generated demo credential therefore cannot be committed, cannot
enter a Docker build context, and cannot be picked up by `npm start` or a plain
`docker build` from a clone of this repo. (`.env` is already in both `.gitignore`
and `.dockerignore`; keeping the file outside the tree means correctness does not
depend on those lines staying right.) `$HOME` is also the matching lifecycle: it
survives a stop/start exactly as the Postgres volume does, and is discarded on a
rebuild exactly as the volume is, so the generated password never outlives the
database it created.

Nothing is written literally into the compose file either. `docker-compose.mmgis.yml`
interpolates `${DB_USER}` / `${DB_PASS}` from that file, using the
`${VAR:?message}` form so a missing value fails `up` with a readable error instead
of quietly starting Postgres on a default password. `docker-compose.sample.yml`
still carries `UPDATE ME` literals for the STAC / TiPG / TiTiler-pgSTAC services;
if a fork re-enables those here, interpolate them the same way rather than editing
the literals.

## How TLS works

You never configure a certificate. GitHub forwards port 8888 as

    https://<codespace-name>-8888.app.github.dev

and terminates TLS at its own edge, speaking plain HTTP to the container. So
`HTTPS=false` and no `HTTPS_KEY`/`HTTPS_CERT` are needed. Consequences worth
knowing:

- **The port is in the hostname, not a `:port` suffix**, and MMGIS gets a whole
  origin rather than a subpath -- so `ROOT_PATH` stays empty. Anything that
  hardcodes `host:8888` will not work; see the `NODE_ENV` note below.
- **Forwarded ports are private by default.** Only the codespace owner, signed in
  to GitHub in that browser, can reach the URL. Making a port public removes
  GitHub's sign-in from in front of it, leaving MMGIS's own login as the only
  gate -- do not do that with anything real in the instance. The user-facing
  checklist is in [Making it public](../CODESPACES-DEMO.md#making-it-public).
- **`wss://` works** through the tunnel, so MMGIS websockets can be enabled; they
  are off in this configuration only to keep the cold start simple.
- The session cookie is not marked `Secure`. It does not need to be -- the browser
  is on an HTTPS origin either way -- and leaving it off avoids depending on how
  the tunnel forwards `X-Forwarded-Proto`.

## Why production mode

`NODE_ENV=production`, not development, in both configurations. In development
MMGIS serves the site from webpack-dev-server on `PORT+1` (a second forwarded
origin), and both websocket clients build their URL as `host:PORT` /
`localhost:PORT` -- neither survives a proxy that puts the port in the hostname.
`dev` therefore means "built from this branch", not "hot-reloading"; for
hot-reloading, run the repository locally.

## Seeding

`scripts/seed-reference-mission.js` creates a Reference Mission variant directly
through the application layer. The Configure API would do the same job, but it
requires an admin session -- and creating one would consume the SETUP screen that
lets the visitor choose their own password.

The published image may predate the script, so the compose file mounts it into
the container read-only.

Set `MMGIS_SEED_VARIANT` in `devcontainer.json` to pick a variant: `default`
(Earth, 20+ layers), `Lunar-SouthPole`, or `Mars`.

The seed script leaves an existing mission alone, which on its own would pin a
codespace to the Reference Mission of whichever image first seeded it. So
`start.sh` records the ID of the image it seeded from in
`~/.mmgis-codespace/seeded-image-<variant>` and, when the running image differs,
reseeds with `--force`: the mission folder is recopied from the new image's
blueprint and its configuration replaced. With `MMGIS_SEED_REFRESH=never` it
seeds once and never again. Either way, only that one mission is touched.

To reseed by hand:

    export MMGIS_ENV_FILE="$HOME/.mmgis-codespace/.env"
    docker compose -p mmgis -f .devcontainer/docker-compose.mmgis.yml \
      --env-file "$MMGIS_ENV_FILE" \
      exec mmgis node scripts/seed-reference-mission.js default --force

(`exec` runs as the service's user. If you run other compose commands by hand,
export `MMGIS_USER` the way `start.sh` does, or the service falls back to root
and a later `up` recreates the container.)

## Customizing

`.devcontainer/` travels with a fork. Pin a different image tag
(`MMGIS_IMAGE` -- not `latest`, which on ghcr.io is still 4.2.34 and has no
Reference Mission; see the comment in `devcontainer.json`), seed a different variant, point the seed step at your own
mission data, add services to `docker-compose.mmgis.yml`, or raise
`hostRequirements`. A fork configured for your project's demo is a supported way
to use this.

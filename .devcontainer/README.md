# MMGIS in GitHub Codespaces -- how it is wired

A throwaway MMGIS instance in a browser tab: no local install, no containers to
download, nothing publicly exposed.

**Trying it out? Read [CODESPACES-DEMO.md](../CODESPACES-DEMO.md) instead** -- it
covers starting a codespace, reaching MMGIS, and who pays for the compute. This
file is for people maintaining these configurations.

## Two configurations

Pick one from the Codespaces creation menu.

| Configuration | MMGIS comes from | Use when |
|---|---|---|
| `demo` | pinned image on `ghcr.io/nasa-ammos/mmgis` | evaluating released capability -- starts in the time it takes to pull |
| `dev` | built from this branch's `Dockerfile` | demonstrating a capability *before* it ships -- minutes of build, bigger machine |

## What happens on launch

1. `postCreateCommand` writes the env file -- no manual `cp sample.env .env` step.
2. `postStartCommand` generates the secrets, starts MMGIS and PostGIS, waits for
   the healthcheck, and seeds a Reference Mission.
3. Port 8888 is forwarded and the browser opens it.

Then open `/configure`. The users table is empty, so the admin login page comes up
in SETUP mode: pick a username and password and you are the site admin.

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
  to GitHub in that browser, can reach the URL. Making a port public turns the URL
  into an unauthenticated one -- do not do that with anything real in the instance.
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

Set `MMGIS_SEED_VARIANT` in `devcontainer.json` to pick a variant: `default`
(Earth, 20+ layers), `Lunar-SouthPole`, or `Mars`. To reseed by hand:

    docker compose -p mmgis -f .devcontainer/docker-compose.mmgis.yml \
      --env-file "$MMGIS_ENV_FILE" \
      exec mmgis node scripts/seed-reference-mission.js default --force

## Customizing

`.devcontainer/` travels with a fork. Pin a different image tag
(`MMGIS_IMAGE`), seed a different variant, point the seed step at your own
mission data, add services to `docker-compose.mmgis.yml`, or raise
`hostRequirements`. A fork configured for your project's demo is a supported way
to use this.

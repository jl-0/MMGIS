# Demoing MMGIS with GitHub Codespaces

Run a complete, pre-configured MMGIS -- application, PostGIS database, and a
mission with data in it -- in a browser tab. No install, no containers to pull
onto your own machine, nothing publicly exposed, and nothing to clean up
afterwards beyond deleting the codespace.

This is meant for evaluating MMGIS or looking at a capability before it ships.
It is **not** a deployment: everything in it is throwaway.

## Starting it

**[codespaces.new/NASA-AMMOS/MMGIS](https://codespaces.new/NASA-AMMOS/MMGIS)**

That opens the codespace creation page, where two settings are worth a look
before you create it:

- **Dev container configuration** -- `demo` or `dev`, see the table below.
- **Machine type** -- 2-core is enough for `demo` and is the cheapest against your
  monthly allowance.

Then **Create codespace** and wait. The first launch has to pull or build images,
so give it a few minutes; later starts of the same codespace are quick.

To skip the options and take the defaults, add `?quickstart=1`. To demo a specific
capability, add `?ref=<branch>` -- a demo is a branch, so it stays in step with the
capability it is showing:

    https://codespaces.new/NASA-AMMOS/MMGIS?quickstart=1
    https://codespaces.new/NASA-AMMOS/MMGIS?ref=some-feature-branch

| Configuration | Where MMGIS comes from | Use it when |
|---|---|---|
| `demo` | a published image on `ghcr.io/nasa-ammos/mmgis` | you want to evaluate released MMGIS -- starts in about the time it takes to pull an image |
| `dev` | built from the branch's `Dockerfile` | you want to see a capability that has not shipped yet -- several minutes of build, and it wants a 4-core machine |

Nothing else is required of you. The codespace writes its own configuration,
starts the services, waits for MMGIS to answer, and seeds a demonstration mission.

## Accessing it

When MMGIS is up, the terminal prints its URL and VS Code offers to open it. It
looks like:

    https://<your-codespace-name>-8888.app.github.dev

That address is **private to you**: GitHub requires your signed-in browser session
to reach it, and terminates HTTPS at its own edge, so there is no certificate to
configure and nothing of yours is publicly reachable. You can find the URL again
any time on the **Ports** tab in the editor.

Then:

1. Open **`/configure`** on that URL. Because the instance has no accounts yet,
   the admin page comes up in **SETUP** mode -- choose a username and password and
   you are the site administrator. (Passwords need 8+ characters with an uppercase
   letter, a lowercase letter, a number, and a symbol.)
2. Open the root URL for the map. The seeded Reference Mission is already there.
3. Explore. Configure is fully editable -- add layers, change the look, make
   another mission. You cannot break anything that matters.

If you want someone else to see your screen, share your screen. Do not make the
port public: that turns the address into one anybody with the link can open.

## What it costs, and who pays

**The codespace bills to whoever creates it -- you.** It cannot be charged to
NASA-AMMOS or to the repository owner. GitHub only bills an organization when that
organization has explicitly allowed a specific member or outside collaborator to
spend at its expense, which is not the case here.

Personal accounts get a monthly allowance at no cost:

| Your account plan | Included compute per month | Included storage per month |
|---|---|---|
| GitHub Free | 120 core-hours | 15 GB-month |
| GitHub Pro | 180 core-hours | 20 GB-month |

Compute is measured in **core-hours**, so a 2-core machine consumes the allowance
at twice wall-clock speed: 120 core-hours is about 60 hours of a running 2-core
codespace per month. That is ample for evaluating something. A 4-core machine --
what the `dev` configuration asks for -- burns it twice as fast again.

Two habits keep the meter low:

- **Stop the codespace when you step away.** It also stops itself after an idle
  timeout, which you can shorten. Stopped codespaces cost no compute, only storage.
- **Delete it when you are done.** Storage is billed while it exists, whether or
  not it is running.

If you want to run one for longer than your included allowance covers, GitHub
bills the overage to your personal account once you have a payment method on file,
at (at the time of writing) $0.18 per hour for a 2-core machine and $0.07 per
GB-month of storage. Set a budget first so it cannot surprise you -- an account
with no budget set and no payment method simply stops rather than overspending.

- [GitHub Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
  -- how usage is measured, current prices, included quotas, and how costs are assigned
- [Setting up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets)
  -- cap or alert on spending before you enable paid usage
- [Viewing your usage](https://docs.github.com/en/billing/how-tos/products/view-productlicense-use)
  -- where you stand against the monthly allowance
- [Choosing who owns and pays for codespaces in an organization](https://docs.github.com/en/codespaces/managing-codespaces-for-your-organization/choosing-who-owns-and-pays-for-codespaces-in-your-organization)
  -- the rule that keeps this off anyone else's bill
- [Stopping and starting a codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/stopping-and-starting-a-codespace)
  and [deleting a codespace](https://docs.github.com/en/codespaces/developing-in-a-codespace/deleting-a-codespace)
- [Setting your idle timeout](https://docs.github.com/en/codespaces/setting-your-user-preferences/setting-your-timeout-period-for-github-codespaces)
- [Codespaces quickstart](https://docs.github.com/en/codespaces/quickstart), if
  none of the above is familiar

## What you should not do with it

- **Do not put real or sensitive data in it.** It is a demonstration instance with
  generated throwaway credentials and no backups.
- **Do not treat its configuration as a deployment example.** The generated
  settings favour a fast, dependency-free start. `sample.env` and
  `docker-compose.sample.yml` are the real starting points -- see the
  [MMGIS documentation](https://nasa-ammos.github.io/MMGIS/).
- **Do not expect it to persist.** Deleting the codespace deletes the database
  along with it.

## Making it your own

`.devcontainer/` travels with a fork, so a fork is a supported way to keep a demo
environment configured the way your project needs it: seed your own mission data,
pin a different image, add services, or raise the machine size. This is also a
reasonable way to try something out without touching an MMGIS instance you already
operate.

Maintainer-facing details -- how the configurations are wired, how credentials are
generated and where they live, how TLS termination interacts with MMGIS settings,
and how seeding works -- are in
[`.devcontainer/README.md`](./.devcontainer/README.md).

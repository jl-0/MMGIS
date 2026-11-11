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
| **MMGIS Demo** (default) | the newest `development` build on `ghcr.io/nasa-ammos/mmgis` | you want to evaluate current MMGIS and the newest Reference Mission -- starts in about the time it takes to pull an image |
| **MMGIS Dev** | built from the branch's `Dockerfile` | you want to see a capability that has not shipped yet -- several minutes of build, and it wants a 4-core machine |

If you do not choose, you get **MMGIS Demo**.

Nothing else is required of you. The codespace writes its own configuration,
starts the services, waits for MMGIS to answer, and seeds a demonstration mission.

### Staying on the newest version

The demo runs the `development` build of MMGIS, which upstream republishes as
changes merge. Every start of the codespace checks for a newer build and, if
there is one, switches to it and replaces the Reference Mission with the newer
one. So to update an existing codespace, stop and start it, or run:

    .devcontainer/scripts/start.sh

Your accounts, other missions and settings are kept. Edits you made to the
Reference Mission itself are replaced on an update; to keep them, set
`"MMGIS_SEED_REFRESH": "never"` in `.devcontainer/devcontainer.json` (in your
fork) before creating the codespace. A brand-new codespace always starts on the
newest build.

## Accessing it

Starting MMGIS runs in the background, so the editor opens before MMGIS is
ready. Open a terminal (**Terminal -> New Terminal**, or <kbd>Ctrl</kbd>+<kbd>`</kbd>):
while MMGIS is still starting it says so, and once it is up every new terminal
shows its **URL** and the **setup code** you need below. To show them again at
any time, run:

    mmgis-info

The URL looks like:

    https://<your-codespace-name>-8888.app.github.dev

That address is **private to you**: GitHub requires your signed-in browser session
to reach it, and terminates HTTPS at its own edge, so there is no certificate to
configure and nothing of yours is publicly reachable. You can find the URL again
any time on the **Ports** tab in the editor.

Then:

1. Open **`/configure`** on that URL. Because the instance has no accounts yet,
   the admin page comes up in **SETUP** mode. Enter the **setup code** from the
   terminal (`setup code: XXXX-XXXX-XXXX-XXXX`), then choose a username and
   password, and you are the site administrator. (Passwords need 8+ characters
   with an uppercase letter, a lowercase letter, a number, and a symbol.)

   Can't see the code? Run `mmgis-info`, or read it straight from the
   generated settings with `grep '^SETUP_CODE=' ~/.mmgis-codespace/.env`. The
   full start-up output, including any errors, is in the creation log:
   <kbd>F1</kbd> -> **Codespaces: View Creation Log**. In a codespace created
   before `mmgis-info` existed, use the `grep`, or rebuild the container
   (<kbd>F1</kbd> -> **Codespaces: Rebuild Container**) to get it.
2. Open the root URL for the map. The seeded **Reference Mission** -- the Earth
   demo with 20+ layers and most of the tools configured -- is already there.
3. Explore. Configure is fully editable -- add layers, change the look, make
   another mission. You cannot break anything that matters.

To let someone else into your running instance, see
[Sharing it with someone else](#sharing-it-with-someone-else) below.

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
  timeout ([details](#when-it-shuts-itself-down)), which you can shorten. Stopped
  codespaces cost no compute, only storage.
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

## Sharing it with someone else

The intended way is for them to launch their own -- it costs them nothing but a
click, and their instance is theirs to break. Send them this page.

If you have configured something worth showing and want other people in *your*
running instance, read on.

## Making it public

Two separate gates decide who sees your instance, and you will usually change
both:

| Gate | Controls | Default here |
|---|---|---|
| **Port visibility** (GitHub) | who can reach the URL at all | Private: only you, signed in to GitHub |
| **Site access** (MMGIS) | who must log in once they reach it | `required`: everyone logs in |

Work through the steps in order. The first one matters most: claiming the admin
account before anyone else can reach the page.

### 1. Create the admin account first

Do this while the port is still private (see [Accessing it](#accessing-it)). Until
an account exists, `/configure` offers the SETUP form; the setup code is what stops
a stranger from claiming it, and creating your account retires both.

Use a password you do not use anywhere else. The instance is throwaway, but its
password will be typed into a URL anyone can reach.

### 2. Change your password (and other people's)

Logged in to `/configure`:

1. Open **Users & Access** -> **People** and select the account.
2. Choose **Reset password**, confirm the username, and pick how long the link
   should last.
3. Open the generated link (`.../resetPassword?t=...`) and set the new password.
   The old password stops working once you do.

To reset someone else's password, follow the same steps for their account and send
them the link privately. The link is single-use, and it signs in as that account,
so treat it like a password.

To give someone their own login, use **People** -> **New user**. Accounts can
only be created by an admin unless you turn on self sign-up
(`AUTH_LOCAL_ALLOW_SIGNUP=true`, see step 3).

The only other credentials in the codespace (`DB_PASS`, `SECRET`) are generated
per codespace and never leave its private container network -- the database port
is not forwarded -- so there is nothing to change there.

### 3. Choose who has to log in

This is the `MMGIS_SITE_ACCESS` line of `~/.mmgis-codespace/.env`:

| Value | Visitors | Good for |
|---|---|---|
| `required` (default) | must log in to see anything | sharing with specific people: give each an account |
| `optional` | can browse without logging in, and may log in | a public demo where some people also save Draw files |
| `public` | browse without logging in; no end-user logins at all | a read-only public demo |

`/configure` always needs an admin login, whichever you choose. To change it:

    sed -i 's/^MMGIS_SITE_ACCESS=.*/MMGIS_SITE_ACCESS=public/' ~/.mmgis-codespace/.env
    .devcontainer/scripts/start.sh

Rerunning `start.sh` restarts MMGIS with the new setting and keeps your data. Edit
`MMGIS_SITE_ACCESS` only, not the `SITE_ACCESS` / `AUTH` lines below it, which
`start.sh` rewrites. To let visitors make their own accounts on a `required`
site, change `AUTH_LOCAL_ALLOW_SIGNUP` to `true` in the same file before rerunning.

### 4. Let guests see the missions

For `optional` or `public`, opening the site is not enough on its own: each
mission is visible only to the people it has been granted to. The demo starts as
`required`, so guests have no grant yet and would see no missions.

In `/configure` open **Users & Access** -> **Site-wide**, find **Everyone
(including guests)**, choose **All missions** (or just the ones to show), and
save. The **People** and **Missions** tabs show who can see what.

(Older MMGIS images that predate this page show every mission once the site is
public, so skip this step for them.)

### 5. Make the port public

In the **Ports** tab of the editor, right-click port 8888 and use **Port
Visibility**:

| Visibility | Who can reach the URL |
|---|---|
| **Private** (default) | only you |
| **Private to Organization** | signed-in members of the organization that owns the repository |
| **Public** | anyone with the link, no GitHub sign-in |

Or from a terminal, with the [GitHub CLI](https://cli.github.com/):

    gh codespace ports visibility 8888:public -c "$CODESPACE_NAME"

Then send people the same `https://<codespace-name>-8888.app.github.dev` URL you
have been using. Check it from a private browser window first: you should see the
map (or the MMGIS login page, if site access is `required`), not a GitHub sign-in.

### Before you do: what "public" means here

- **It only lives while the codespace runs.** The codespace stops after 30 minutes
  without you using it -- visitors do not count -- and after 12 hours regardless,
  and the URL stops with it. This is not a way to host something. To keep it up
  for the length of a demo, see
  [When it shuts itself down](#when-it-shuts-itself-down).
- **It is billed to you the whole time it is running**, including while someone
  else is looking at it.
- **A public port is a service on the open internet**, run from your personal
  account. With `public` or `optional` site access, anyone with the link can read
  every mission you granted to Everyone. Fine for the Reference Mission and
  other sample data; not the place for anything sensitive, and not a substitute
  for a real deployment.

### Closing it again

Reverse the steps: set the port back to **Private** (`gh codespace ports
visibility 8888:private -c "$CODESPACE_NAME"`), set `MMGIS_SITE_ACCESS=required`
and rerun `start.sh`, and remove the Everyone grant if you added one. Or simply
stop or delete the codespace.

## When it shuts itself down

A codespace is a temporary development workspace that you pay for by the hour, not
a hosted server, and GitHub stops it on its own so a forgotten one does not keep
billing you. Two limits apply:

- **The idle timeout: 30 minutes by default.** The clock is reset only by signs
  that *you* are there: typing or using the mouse in the editor, and input or
  output in one of its terminals. It is **not** reset by MMGIS running -- it runs
  in the background and prints nothing while idle -- or by people visiting the
  site, or by a browser tab left open but untouched. Closing the tab does not stop
  the codespace either; it keeps running (and billing) until the timeout fires.
- **A 12-hour maximum.** Every codespace is stopped 12 hours after it started,
  however active it is. Nothing extends this.

**Changing the idle timeout.** You can pick 5 to 240 minutes, but only for
codespaces you create *after* changing it -- a running codespace keeps the
timeout it was created with, and there is no per-configuration setting:

- For all new codespaces: github.com -> your profile picture -> **Settings** ->
  **Codespaces** -> **Default idle timeout**.
- For one new codespace: `gh codespace create -R <owner>/MMGIS --idle-timeout 120m`.

An organization can set a lower maximum for its repositories, which then wins.

**Keeping it up for a demo.** Because terminal output counts as activity, a loop
that prints once a minute keeps a codespace running -- up to the 12-hour limit --
including one that is already running. In a terminal in the codespace's editor
(keep that tab open), either for a number of minutes:

    for i in $(seq 120); do date; sleep 60; done

or until a time of day (codespaces run on UTC, so give your time zone):

    zone=America/Los_Angeles
    end=$(TZ=$zone date -d '17:00' +%s)
    echo "Keeping it up until $(TZ=$zone date -d @$end)"
    while [ "$(date +%s)" -lt "$end" ]; do date; sleep 60; done

Check the time it prints before walking away: a misspelled zone name is
silently treated as UTC. If that time has already passed today, the loop ends
at once -- use `'tomorrow 17:00'`.

Either one stops on its own, after which the normal idle timeout applies again;
<kbd>Ctrl</kbd>+<kbd>C</kbd> ends it early. It is billed the whole time. For
anything that should stay up longer than a working day, run MMGIS on a real
server instead -- see the [MMGIS documentation](https://nasa-ammos.github.io/MMGIS/).

**What a stop keeps.** Stopping is a shutdown, not a pause: running processes end
and nothing in memory survives. The disk does, so on the next start (open it from
[github.com/codespaces](https://github.com/codespaces)) MMGIS comes back in about a
minute with your accounts, missions, Configure edits and settings, at the same
URL. A start can also pick up a newer MMGIS build -- see
[Staying on the newest version](#staying-on-the-newest-version). If you had made
the port public, check its visibility on the **Ports** tab after restarting. Only
deleting the codespace, or rebuilding its container, removes the data.

## Stopping and deleting it

A codespace keeps costing you something until you delete it -- compute while it
runs, storage while it exists -- so this is worth doing rather than leaving to the
timeouts.

**Stop it** (keeps everything, costs only storage, restart later):

- In the editor: Command Palette (<kbd>F1</kbd>) -> **Codespaces: Stop Current Codespace**
- From [github.com/codespaces](https://github.com/codespaces): the **...** menu next to it -> **Stop codespace**
- CLI: `gh codespace stop`

Stopping costs nothing and ends the compute charge immediately; starting again is
quick, because the image is already pulled and your data is still there. (If a
newer MMGIS build has been published meanwhile, starting downloads it -- see
[Staying on the newest version](#staying-on-the-newest-version).)

It also stops itself when idle -- see
[When it shuts itself down](#when-it-shuts-itself-down). Leaving it to the timeout
is not free, though: idle-but-running time is billed until the timeout fires,
which on a 2-core machine is a full core-hour of your monthly allowance every time
you walk away instead of stopping.

**Delete it** (removes the container, the database, and anything you configured):

- From [github.com/codespaces](https://github.com/codespaces): the **...** menu -> **Delete codespace**
- CLI: `gh codespace delete`

Deleting is the right end state for a demo. Nothing in the instance is meant to
survive, and GitHub will
[auto-delete inactive codespaces](https://docs.github.com/en/codespaces/setting-your-user-preferences/configuring-automatic-deletion-of-your-codespaces)
eventually anyway -- but not before the storage has been billed.

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

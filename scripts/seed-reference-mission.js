/**
 * Seeds a Reference Mission variant without going through the Configure page.
 *
 * The /api/configure/add endpoint requires an admin session, so seeding over
 * HTTP means creating a user first -- which consumes the one-time SETUP screen
 * that lets a visitor choose their own admin password. This does the same work
 * through the application layer instead, leaving the users table empty.
 *
 * Run it from the application root, after the server has started once so the
 * tables exist:
 *
 *   node scripts/seed-reference-mission.js [variant] [--force]
 *
 * `variant` is a key of REFERENCE_MISSION_VARIANTS ("default" if omitted).
 * Without --force an already-seeded mission is left alone.
 */
require("dotenv").config({ path: __dirname + "/../.env" });

const { sequelize } = require("../API/connection");
const Config = require("../plugins/core/backend/Config/models/config");
const missionTemplates = require("../plugins/core/backend/Utils/missionTemplates");

async function seed(variantKey, force) {
  const variants = missionTemplates.REFERENCE_MISSION_VARIANTS;

  if (!Object.hasOwn(variants, variantKey)) {
    throw new Error(
      `Unknown reference mission variant: ${variantKey}. Valid variants: ${Object.keys(
        variants
      ).join(", ")}`
    );
  }

  const missionName = variants[variantKey].missionName;
  const existing = await Config.findOne({ where: { mission: missionName } });

  if (existing && !force) {
    console.log(`[seed] ${missionName} already exists; skipping.`);
    return;
  }

  const result = await missionTemplates.createReferenceMission(
    missionName,
    variantKey
  );

  if (existing) {
    // Mirrors the route: replace every row for this mission rather than
    // updating them, so the version query does not return the whole history.
    const maxVersion = await Config.max("version", {
      where: { mission: missionName },
    });
    await Config.destroy({ where: { mission: missionName } });
    await Config.create({
      mission: missionName,
      config: result.config,
      version: (maxVersion ?? 0) + 1,
    });
    console.log(`[seed] updated ${missionName}`);
  } else {
    await Config.create({
      mission: missionName,
      config: result.config,
      version: 0,
    });
    console.log(`[seed] created ${missionName}`);
  }
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const variantKey = args.find((a) => !a.startsWith("--")) || "default";

seed(variantKey, force)
  .then(() => sequelize.close())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[seed] failed: ${err.message}`);
    process.exit(1);
  });

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

const fs = require("fs");
const path = require("path");

const { sequelize } = require("../API/connection");

// This script is mounted into whichever MMGIS image the demo pins, which may be
// older than the working tree. The plugin overhaul moved these two modules from
// API/Backend/ to plugins/core/backend/ without changing their exports, so try
// both rather than requiring a particular vintage of image.
function requireEither(...relativePaths) {
  for (const rel of relativePaths) {
    const full = path.join(__dirname, "..", rel);
    if (fs.existsSync(full) || fs.existsSync(`${full}.js`)) return require(full);
  }
  throw new Error(`None of these exist in this image: ${relativePaths.join(", ")}`);
}

const Config = requireEither(
  "plugins/core/backend/Config/models/config",
  "API/Backend/Config/models/config"
);
const missionTemplates = requireEither(
  "plugins/core/backend/Utils/missionTemplates",
  "API/Backend/Utils/missionTemplates"
);

async function seed(variantKey, force) {
  const variants = missionTemplates.REFERENCE_MISSION_VARIANTS;

  // Images built before the variant registry landed know only the Earth mission,
  // and their createReferenceMission takes no variant argument.
  if (!variants) {
    if (variantKey !== "default") {
      throw new Error(
        `This MMGIS build predates reference mission variants; only "default" is available (asked for "${variantKey}").`
      );
    }
    return seedMission("Reference-Mission", () =>
      missionTemplates.createReferenceMission("Reference-Mission")
    );
  }

  if (!Object.hasOwn(variants, variantKey)) {
    throw new Error(
      `Unknown reference mission variant: ${variantKey}. Valid variants: ${Object.keys(
        variants
      ).join(", ")}`
    );
  }

  return seedMission(variants[variantKey].missionName, () =>
    missionTemplates.createReferenceMission(
      variants[variantKey].missionName,
      variantKey
    )
  );
}

async function seedMission(missionName, create) {
  const existing = await Config.findOne({ where: { mission: missionName } });

  if (existing && !force) {
    console.log(`[seed] ${missionName} already exists; skipping.`);
    return;
  }

  const result = await create();

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

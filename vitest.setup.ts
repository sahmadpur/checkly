import "dotenv/config";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

import { beforeEach } from "vitest";

// Dynamic import: a static import here would be hoisted by ESM above the
// DATABASE_URL override above, causing lib/db's PrismaClient adapter to be
// constructed against the wrong (main) database.
beforeEach(async () => {
  const { resetDb } = await import("./tests/helpers/db");
  await resetDb();
});

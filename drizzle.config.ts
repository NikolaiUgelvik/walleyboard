import { defineConfig } from "drizzle-kit";
import { homedir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: join(homedir(), ".walleyboard", "walleyboard.sqlite"),
  },
});

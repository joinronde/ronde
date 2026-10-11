import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Local development keeps a single .env in apps/web; a .env here wins when present
config({ path: [".env", "../../apps/web/.env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});

import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Every app that imports `db` must provide its own DATABASE_URL: Bun only
// loads the .env file of the app's working directory, so a missing value here
// used to silently fall back to 127.0.0.1:5432 and fail every query at
// runtime. Fail fast at startup instead so the misconfiguration is obvious.
const DATABASE_URL: string = (() => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL environment variable is not set. Add DATABASE_URL to the .env file of the app you are running (e.g. apps/ws/.env).",
    );
  }
  return url;
})();

const adapter = new PrismaPg({
  connectionString: DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
});
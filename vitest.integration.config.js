import "dotenv/config";
import { defineConfig } from "vitest/config";

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "Set TEST_DATABASE_URL to a separate migrated PostgreSQL test database before running integration tests.",
  );
}

export default defineConfig({
  test: {
    include: [
      "src/modules/auth/__test__/*.test.js",
      "src/modules/audit/__test__/*.test.js",
    ],
    exclude: ["**/*.unit.test.js"],
  },
});

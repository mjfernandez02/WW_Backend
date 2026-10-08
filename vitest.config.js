import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.unit.test.js",
      "src/modules/practice/__test__/practice.test.js",
    ],
  },
});

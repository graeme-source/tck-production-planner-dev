import { defineConfig } from "vitest/config";

// Unit tests live next to the code they cover (*.test.ts). Keep them free of
// database and network access — pure logic only — so the suite runs anywhere
// (CI, local, Replit) with no environment setup.
export default defineConfig({
  test: {
    include: [
      "artifacts/*/src/**/*.test.{ts,tsx}",
      "lib/*/src/**/*.test.ts",
      // The print bridge is plain JavaScript (no build on the factory PC).
      "tools/print-bridge/**/*.test.mjs",
    ],
    environment: "node",
  },
});

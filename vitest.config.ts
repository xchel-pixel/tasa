import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// El mismo atajo `@/` que usa la aplicación (tsconfig.json).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  // humo/ y humo-fuente/ son Playwright (npm run humo, npm run humo:fuente), no vitest.
  test: { exclude: [...configDefaults.exclude, "humo/**", "humo-fuente/**"] },
});

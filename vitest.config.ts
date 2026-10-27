import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// El mismo atajo `@/` que usa la aplicación (tsconfig.json).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});

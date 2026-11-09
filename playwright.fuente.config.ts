import { defineConfig } from "@playwright/test";

/**
 * humo:fuente — revisión de la fuente externa, APARTE de humo normal y solo cuando Xchel lo pide
 * (`npm run humo:fuente`). Una consulta real al mapa (GetFeatureInfo a las 18 capas) y otra al expediente
 * (BuscaDatos) de un predio fijo ya guardado: si responden, en cuánto tiempo y si cambió la forma de la
 * respuesta. Ver humo-fuente/fuente.spec.ts.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // Sin .env.local: la prueba se salta y lo dice.
}

export default defineConfig({
  testDir: "humo-fuente",
  timeout: 90_000,
  retries: 0,
  reporter: process.env.HUMO_SALIDA ? [["list"], ["json", { outputFile: `${process.env.HUMO_SALIDA}/reporte.json` }]] : "list",
  outputDir: process.env.HUMO_SALIDA ? `${process.env.HUMO_SALIDA}/resultados` : "test-results",
});

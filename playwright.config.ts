import { defineConfig } from "@playwright/test";

/**
 * Prueba de humo contra producción, solo lectura: entra como admin_org y como finanzas y abre
 * las pantallas principales. No llena formularios ni escribe nada. Ver humo/humo.spec.ts.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // Sin .env.local: la prueba se salta y lo dice.
}

export default defineConfig({
  testDir: "humo",
  timeout: 60_000,
  // Sin reintentos de prueba completa: solo se reintenta una página por error de red de la PC (ver ir() en humo.spec.ts).
  retries: 0,
  // Con npm run humo (scripts/humo.mjs): reporte y contexto de cada falla en humo/salidas/<fecha>/, que no se borra.
  reporter: process.env.HUMO_SALIDA ? [["list"], ["json", { outputFile: `${process.env.HUMO_SALIDA}/reporte.json` }]] : "list",
  outputDir: process.env.HUMO_SALIDA ? `${process.env.HUMO_SALIDA}/resultados` : "test-results",
  use: {
    baseURL: process.env.HUMO_URL ?? "https://tasa.xgplataform.com",
    viewport: { width: 390, height: 844 },
    // Microsoft Edge, que ya trae Windows: en esta PC la descarga de Chromium de Playwright se traba.
    channel: "msedge",
  },
});

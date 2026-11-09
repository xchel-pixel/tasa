import { expect, test } from "vitest";
import { resumenNavegador } from "@/lib/navegador";

/** El resumen del navegador para el registro de accesos (0070): nunca el User-Agent completo. */
test("resumen del navegador", () => {
  const casos: [string, string][] = [
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", "Chrome en Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari en iPhone"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0", "Edge en Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Gecko/20100101 Firefox/131.0", "Firefox en Mac"],
    ["Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36", "Samsung Internet en Android"],
    ["node", "Servidor"],
    ["", "Desconocido"],
  ];
  for (const [ua, esperado] of casos) expect(resumenNavegador(ua), ua).toBe(esperado);
});

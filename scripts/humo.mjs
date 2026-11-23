/**
 * Corre humo (Playwright) y deja todo guardado:
 *
 *   npm run humo                         → humo COMPLETO contra la versión local (http://localhost:3200, o HUMO_URL)
 *                                          con la base real: `npx next build` y `npx next start -p 3200` antes
 *   npm run humo:prod                    → en producción, UNA prueba corta (entra, abre el mapa y el PDF);
 *                                          el completo en producción gasta consumo de Vercel compartido
 *   npm run humo -- -g "DEMO equipo"     → solo esa prueba (lo que sigue de -- va tal cual a Playwright)
 *   npm run humo:fuente                  → la revisión de la fuente externa (aparte; solo cuando se pida)
 *
 * · Mantiene la PC despierta mientras corre (Windows: SetThreadExecutionState). Una corrida falló con
 *   net::ERR_NETWORK_IO_SUSPENDED porque Windows suspendió la red con la PC sin uso.
 * · Guarda la salida completa en humo/salidas/<fecha>/salida.txt, el reporte en reporte.json y, de cada
 *   prueba que falle, su contexto en resultados/. Nada se borra en la siguiente corrida.
 * · Al final imprime las fallas con su error y los reintentos por red (anotados por humo.spec.ts).
 * · Al empezar borra las corridas de humo/salidas/ con más de 30 días. La carpeta no se sube (.gitignore).
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";

// Corridas de más de 30 días: fuera.
const SALIDAS = "humo/salidas";
const LIMITE = Date.now() - 30 * 86_400_000;
let borradas = 0;
if (existsSync(SALIDAS)) {
  for (const nombre of readdirSync(SALIDAS)) {
    const ruta = `${SALIDAS}/${nombre}`;
    if (statSync(ruta).isDirectory() && statSync(ruta).mtimeMs < LIMITE) {
      rmSync(ruta, { recursive: true, force: true });
      borradas++;
    }
  }
}
if (borradas) console.log(`Se borraron ${borradas} corrida(s) de humo con más de 30 días.`);

const sello = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
const carpeta = `humo/salidas/${sello}`;
mkdirSync(carpeta, { recursive: true });
const salida = createWriteStream(`${carpeta}/salida.txt`);

// Despierta: ES_CONTINUOUS | ES_SYSTEM_REQUIRED, renovado cada 30 s hasta que termine.
const DESPIERTA = `$k = Add-Type -Name Energia -Namespace Tasa -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);'; while ($true) { [void]$k::SetThreadExecutionState([uint32]2147483649); Start-Sleep -Seconds 30 }`;
const despierta = process.platform === "win32"
  ? spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", DESPIERTA], { stdio: "ignore" })
  : null;

// Repetir una prueba se dice con su motivo: npm run humo -- -g "DEMO finanzas" --repite "se pasó de tiempo a las 00:15".
// Queda al principio y al final del reporte; una corrida con -g sin --repite se marca como parcial.
const args = process.argv.slice(2);
// Producción solo con --prod y solo una prueba corta (nov-2026: Vercel compartido, consumo por funciones).
const iProd = args.indexOf("--prod");
if (iProd >= 0) {
  args.splice(iProd, 1);
  process.env.HUMO_URL ??= "https://tasa.xgplataform.com";
  if (!args.includes("-g")) args.push("-g", "DEMO comisionista en el Mapa catastral");
} else {
  process.env.HUMO_URL ??= "http://localhost:3200";
}
console.log(`Humo contra ${process.env.HUMO_URL}`);
const iRepite = args.indexOf("--repite");
const motivo = iRepite >= 0 ? (args[iRepite + 1] ?? "sin motivo") : null;
if (iRepite >= 0) args.splice(iRepite, 2);
const iFiltro = args.indexOf("-g");
const filtro = iFiltro >= 0 ? args[iFiltro + 1] : null;
const encabezado = motivo
  ? `REPETICIÓN de "${filtro ?? "todas"}" · motivo: ${motivo}`
  : iProd >= 0 ? `Producción: prueba corta ("${filtro}")`
  : filtro ? `Corrida PARCIAL (solo "${filtro}"): no cuenta como humo completo` : "Corrida completa (local)";
console.log(encabezado);
salida.write(`${encabezado}\n`);

// Playwright con el mismo node, sin shell: los argumentos (p. ej. -g "DEMO equipo") llegan tal cual.
const playwright = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...args], {
  env: { ...process.env, HUMO_SALIDA: carpeta },
});
for (const flujo of [playwright.stdout, playwright.stderr]) {
  flujo.on("data", (d) => {
    process.stdout.write(d);
    salida.write(d);
  });
}

playwright.on("close", (codigo) => {
  despierta?.kill();
  salida.end();
  const lineas = [`\n${encabezado}`, `Salida completa: ${carpeta}/salida.txt`];
  const archivo = `${carpeta}/reporte.json`;
  if (existsSync(archivo)) {
    const reporte = JSON.parse(readFileSync(archivo, "utf8"));
    const pruebas = [];
    const recorrer = (s) => { for (const x of s.suites ?? []) recorrer(x); for (const e of s.specs ?? []) for (const p of e.tests ?? []) pruebas.push({ titulo: e.title, p }); };
    for (const s of reporte.suites ?? []) recorrer(s);
    for (const { titulo, p } of pruebas) {
      for (const a of p.annotations ?? []) {
        if (a.type === "reintento por red") lineas.push(`Reintento por red · ${titulo} · ${a.description}`);
        if (a.type === "página lenta") lineas.push(`Página lenta · ${titulo} · ${a.description}`);
      }
      const r = p.results?.at(-1);
      if (r && r.status !== "passed" && r.status !== "skipped") {
        lineas.push(`FALLÓ · ${titulo} · ${(r.error?.message ?? r.status).split("\n")[0]}`);
      }
    }
  }
  console.log(lineas.join("\n"));
  process.exit(codigo ?? 1);
});

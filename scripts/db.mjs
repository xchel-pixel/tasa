/**
 * Migraciones con la CLI de Supabase. Tasa usa UN solo proyecto: hoy es
 * de pruebas; antes de lanzar se resetea y queda como producción.
 *
 *   npm run db:push               → empuja migraciones pendientes (cualquier modo)
 *   npm run db:semilla            → carga la semilla de prueba (solo TASA_MODO=pruebas)
 *   npm run db:verificar          → corre las verificaciones (solo pruebas; no dejan rastro)
 *   npm run db:resembrar          → BORRA todo, aplica migraciones y carga la semilla
 *                                   (solo pruebas). Pide escribir RESEMBRAR; con
 *                                   `-- --si` no pregunta.
 *   npm run db:reset-produccion   → BORRA todo, aplica migraciones sin semilla y pasa
 *                                   TASA_MODO a produccion. Pide escribir el nombre del proyecto.
 *
 * Los datos salen de `.env.local` (no se sube a GitHub):
 *   SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, TASA_MODO
 *
 * Antes, una sola vez por computadora: `npx supabase login`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

const raiz = join(import.meta.dirname, "..");
const archivoEntorno = join(raiz, ".env.local");
const accion = process.argv[2];

function salir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

/** Lee `.env.local` sin dependencias: líneas CLAVE=valor. */
function leerEntorno() {
  if (!existsSync(archivoEntorno)) salir("Falta el archivo .env.local (ver .env.example).");
  const entorno = {};
  for (const linea of readFileSync(archivoEntorno, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) entorno[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return entorno;
}

function supabase(args, { env = {}, capturar = false } = {}) {
  const r = spawnSync("npx", ["supabase", ...args], {
    cwd: raiz,
    stdio: capturar ? ["inherit", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32",
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) salir(`Falló: supabase ${args.join(" ")}`);
  return r.stdout;
}

const ACCIONES = ["push", "semilla", "verificar", "resembrar", "reset-produccion"];
if (!ACCIONES.includes(accion)) salir(`Uso: node scripts/db.mjs <${ACCIONES.join("|")}>`);

const entorno = leerEntorno();
const ref = entorno.SUPABASE_PROJECT_REF;
const password = entorno.SUPABASE_DB_PASSWORD;
const modo = entorno.TASA_MODO;

if (!ref) salir("Falta SUPABASE_PROJECT_REF en .env.local.");
if (!["pruebas", "produccion"].includes(modo)) {
  salir('TASA_MODO en .env.local debe ser "pruebas" o "produccion".');
}

// El candado: semilla y verificaciones existen solo en modo pruebas.
if (["semilla", "verificar", "resembrar"].includes(accion) && modo !== "pruebas") {
  salir(`TASA_MODO=${modo}: la semilla y las verificaciones solo corren en modo pruebas.`);
}
// Un reset en producción borraría los datos reales. No hay forma de pedirlo.
if (accion === "reset-produccion" && modo !== "pruebas") {
  salir("TASA_MODO ya es produccion: este proyecto ya tiene datos reales y no se resetea.");
}

const conPassword = { SUPABASE_DB_PASSWORD: password };
if (["push", "resembrar", "reset-produccion"].includes(accion) && !password) {
  salir("Falta SUPABASE_DB_PASSWORD en .env.local.");
}

console.log(`\nProyecto ${ref} · modo ${modo.toUpperCase()}\n`);

// Amarrar siempre antes de actuar: nunca depende del último `link`.
supabase(["link", "--project-ref", ref], { env: password ? conPassword : {} });

if (accion === "push") {
  supabase(["db", "push", "--linked"], { env: conPassword });
  supabase(["migration", "list", "--linked"], { env: conPassword });
} else if (accion === "semilla") {
  supabase(["db", "query", "--linked", "-f", "supabase/semilla_prueba.sql"]);
  console.log("\n✓ Semilla cargada y comprobada.\n");
} else if (accion === "verificar") {
  supabase(["db", "query", "--linked", "-f", "supabase/verificaciones.sql"]);
  console.log("\n✓ Verificaciones correctas (no dejaron rastro).\n");
} else if (accion === "resembrar") {
  await resembrar();
} else {
  await resetProduccion();
}

/** Datos de prueba desde cero: lo que hace falta tras un cambio de estructura. */
async function resembrar() {
  if (!process.argv.includes("--si")) {
    console.log("Se BORRAN todos los datos de este proyecto de pruebas, se aplican");
    console.log("las migraciones desde cero y se carga la semilla.\n");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const escrito = (await rl.question("Escribe RESEMBRAR para confirmar: ")).trim();
    rl.close();
    if (escrito !== "RESEMBRAR") salir("No coincide. No se hizo nada.");
  }
  supabase(["db", "reset", "--linked", "--no-seed", "--yes"], { env: conPassword });
  supabase(["db", "query", "--linked", "-f", "supabase/semilla_prueba.sql"]);
  console.log("\n✓ Base de pruebas desde cero, con la semilla cargada y comprobada.\n");
}

async function resetProduccion() {
  const proyectos = JSON.parse(supabase(["projects", "list", "-o", "json"], { capturar: true }));
  const nombre = proyectos.find((p) => p.ref === ref)?.name;
  if (!nombre) salir(`No encontré el proyecto ${ref} en tu cuenta.`);

  console.log("==================  RESET A PRODUCCIÓN  ==================");
  console.log(`  Proyecto: ${nombre} (${ref})`);
  console.log("  Se BORRAN todas las tablas y sus datos (semilla incluida),");
  console.log("  se aplican las migraciones SIN semilla y TASA_MODO pasa a");
  console.log("  produccion. Después ya no se puede volver a resetear desde aquí.");
  console.log("==========================================================\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const escrito = (await rl.question(`Escribe el nombre del proyecto (${nombre}) para confirmar: `)).trim();
  rl.close();
  if (escrito !== nombre) salir("No coincide. No se hizo nada.");

  supabase(["db", "reset", "--linked", "--no-seed"], { env: conPassword });
  supabase(["migration", "list", "--linked"], { env: conPassword });

  const texto = readFileSync(archivoEntorno, "utf8").replace(
    /^(\s*TASA_MODO\s*=).*$/m,
    "$1produccion"
  );
  writeFileSync(archivoEntorno, texto);

  console.log("\n✓ Proyecto en producción: migraciones aplicadas, sin semilla.");
  console.log("  TASA_MODO=produccion en .env.local.");
  console.log("  Siguiente: da de alta tu persona como super_admin (ver README).\n");
}

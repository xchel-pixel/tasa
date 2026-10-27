/**
 * Migraciones con la CLI de Supabase, con candados para no equivocarse
 * de proyecto.
 *
 *   npm run db:pruebas            → amarra el proyecto de pruebas y empuja migraciones
 *   npm run db:pruebas:semilla    → corre la semilla de prueba (solo pruebas)
 *   npm run db:pruebas:verificar  → corre las verificaciones (solo pruebas, no dejan rastro)
 *   npm run db:produccion         → amarra producción y empuja migraciones. Nada más.
 *
 * Los datos salen de `.env.local` (no se sube a GitHub):
 *   SUPABASE_REF_PRUEBAS, SUPABASE_DB_PASSWORD_PRUEBAS
 *   SUPABASE_REF_PRODUCCION, SUPABASE_DB_PASSWORD_PRODUCCION
 *
 * Antes, una sola vez por computadora: `npx supabase login`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..");
const [destino, accion = "push"] = process.argv.slice(2);

function salir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

/** Lee `.env.local` sin dependencias: líneas CLAVE=valor. */
function leerEntorno() {
  const archivo = join(raiz, ".env.local");
  if (!existsSync(archivo)) salir("Falta el archivo .env.local (ver .env.example).");
  const entorno = {};
  for (const linea of readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) entorno[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return entorno;
}

function supabase(args, extraEnv = {}) {
  const r = spawnSync("npx", ["supabase", ...args], {
    cwd: raiz,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  if (r.status !== 0) salir(`Falló: supabase ${args.join(" ")}`);
}

function proyectoAmarrado() {
  const archivo = join(raiz, "supabase", ".temp", "project-ref");
  return existsSync(archivo) ? readFileSync(archivo, "utf8").trim() : null;
}

if (!["pruebas", "produccion"].includes(destino)) {
  salir("Uso: node scripts/db.mjs <pruebas|produccion> [push|semilla|verificar]");
}
if (!["push", "semilla", "verificar"].includes(accion)) {
  salir(`Acción desconocida: ${accion}`);
}

const entorno = leerEntorno();
const SUFIJO = destino === "pruebas" ? "PRUEBAS" : "PRODUCCION";
const ref = entorno[`SUPABASE_REF_${SUFIJO}`];
const password = entorno[`SUPABASE_DB_PASSWORD_${SUFIJO}`];

if (!ref) salir(`Falta SUPABASE_REF_${SUFIJO} en .env.local.`);
if (entorno.SUPABASE_REF_PRUEBAS && entorno.SUPABASE_REF_PRUEBAS === entorno.SUPABASE_REF_PRODUCCION) {
  salir("El proyecto de pruebas y el de producción tienen el mismo ref. Revisa .env.local.");
}

// El candado principal: la semilla y las verificaciones existen solo
// para el proyecto de pruebas. No hay forma de pedirlas en producción.
if (accion !== "push" && destino !== "pruebas") {
  salir("La semilla y las verificaciones solo corren en el proyecto de PRUEBAS.");
}

if (destino === "produccion") {
  console.log("\n================  PRODUCCIÓN  ================");
  console.log(`  Proyecto: ${ref}`);
  console.log("  Solo migraciones. La CLI pedirá confirmar.");
  console.log("==============================================\n");
}

// Amarrar siempre antes de actuar: así el último `link` nunca decide
// por nosotros a qué base le estamos hablando.
if (!password && accion === "push") salir(`Falta SUPABASE_DB_PASSWORD_${SUFIJO} en .env.local.`);
supabase(["link", "--project-ref", ref], password ? { SUPABASE_DB_PASSWORD: password } : {});

if (proyectoAmarrado() !== ref) {
  salir(`La CLI quedó amarrada a ${proyectoAmarrado()} y se esperaba ${ref}. No se hizo nada.`);
}

if (accion === "push") {
  supabase(["db", "push", "--linked"], { SUPABASE_DB_PASSWORD: password });
  supabase(["migration", "list", "--linked"], { SUPABASE_DB_PASSWORD: password });
} else if (accion === "semilla") {
  supabase(["db", "query", "--linked", "-f", "supabase/semilla_prueba.sql"]);
  console.log("\n✓ Semilla cargada y comprobada.\n");
} else {
  supabase(["db", "query", "--linked", "-f", "supabase/verificaciones.sql"]);
  console.log("\n✓ Verificaciones correctas (no dejaron rastro).\n");
}

/**
 * Regenera la organización DEMO en la base real (datos sintéticos para la prueba de humo):
 *
 *   npm run demo
 *
 * 1. Corre supabase/produccion/demo.sql: crea DEMO la primera vez y, en cada corrida, borra y
 *    vuelve a crear SOLO sus datos (nunca toca XG ni otra organización; ver 0043).
 * 2. Crea las cuentas de acceso de la gente de DEMO que falten (xchel+demo-…@arqosuv.com) con la
 *    API de administración: no manda correos. Al nacer, la base las amarra a su persona.
 *
 * Necesita en .env.local: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY, y la CLI de Supabase
 * vinculada (`npx supabase login` una vez por computadora).
 */
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..");
process.loadEnvFile(join(raiz, ".env.local"));

export const CORREOS_DEMO = [
  "xchel+demo-admin@arqosuv.com",
  "xchel+demo-finanzas@arqosuv.com",
  "xchel+demo-equipo@arqosuv.com",
  "xchel+demo-ana@arqosuv.com",
  "xchel+demo-beto@arqosuv.com",
  "xchel+demo-carla@arqosuv.com",
];

function salir(mensaje) {
  console.error(`\n✗ ${mensaje}\n`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secreta = process.env.SUPABASE_SECRET_KEY;
if (!url || !secreta) salir("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY en .env.local.");

console.log("1/2 Datos de DEMO (supabase/produccion/demo.sql)…");
const r = spawnSync("npx", ["supabase", "db", "query", "--linked", "-f", "supabase/produccion/demo.sql"], {
  cwd: raiz,
  stdio: ["inherit", "pipe", "inherit"],
  shell: process.platform === "win32",
  encoding: "utf8",
});
if (r.status !== 0 || /"_tag":"Error"|ERROR:/.test(r.stdout ?? "")) {
  console.error(r.stdout);
  salir("Falló demo.sql: no se cambió nada (corre en una transacción).");
}
try {
  for (const f of JSON.parse(r.stdout).rows) console.log(`    ${f.estatus_publico.padEnd(16)} ${f.honorario_tipo.padEnd(10)} ${f.count}`);
} catch {
  console.log(r.stdout);
}

console.log("2/2 Cuentas de acceso de DEMO…");
const admin = createClient(url, secreta, { auth: { persistSession: false } });
const existentes = new Set();
for (let pagina = 1; ; pagina++) {
  const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 1000 });
  if (error) salir(`No se pudieron leer las cuentas: ${error.message}`);
  for (const u of data.users) if (u.email) existentes.add(u.email.toLowerCase());
  if (data.users.length < 1000) break;
}
for (const correo of CORREOS_DEMO) {
  if (existentes.has(correo)) {
    console.log(`    ya existe  ${correo}`);
    continue;
  }
  const { error } = await admin.auth.admin.createUser({ email: correo, email_confirm: true });
  if (error) salir(`No se pudo crear ${correo}: ${error.message}`);
  console.log(`    creada     ${correo}`);
}
console.log("\n✓ DEMO lista.\n");

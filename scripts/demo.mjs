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
 * 3. Sube al bucket público `tarjetas` las fotos lisas de los inmuebles del portafolio de DEMO
 *    (`demo/inmueble-N.png`), hechas aquí mismo, sin librerías.
 *
 * Escribe en la base de producción: la CLI pide confirmar y desde un agente falla. Se corre con
 * `npm run demo -- --yes` (pasa --yes a la CLI) SOLO con el OK de Xchel para esa corrida.
 *
 * Necesita en .env.local: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SECRET_KEY, y la CLI de Supabase
 * vinculada (`npx supabase login` una vez por computadora).
 */
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
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

console.log("1/3 Datos de DEMO (supabase/produccion/demo.sql)…");
const conYes = process.argv.includes("--yes") ? ["--yes"] : [];
const r = spawnSync("npx", ["supabase", "db", "query", "--linked", ...conYes, "-f", "supabase/produccion/demo.sql"], {
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

console.log("2/3 Cuentas de acceso de DEMO…");
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
console.log("3/3 Fotos del portafolio de DEMO…");
const COLORES = [[47, 111, 78], [180, 83, 9], [15, 118, 110], [122, 62, 157], [4, 56, 108], [190, 18, 60], [101, 163, 13]];
for (const [n, color] of COLORES.entries()) {
  const { error } = await admin.storage.from("tarjetas").upload(`demo/inmueble-${n + 1}.png`, pngLiso(400, 300, color), {
    contentType: "image/png",
    upsert: true,
  });
  if (error) salir(`No se pudo subir la foto ${n + 1}: ${error.message}`);
}
console.log(`    ${COLORES.length} fotos`);
console.log("\n✓ DEMO lista.\n");

/** Un PNG de un solo color con una franja más clara (una "foto" de DEMO), sin librerías. */
function pngLiso(ancho, alto, [r, g, b]) {
  const filas = [];
  for (let y = 0; y < alto; y++) {
    const fila = Buffer.alloc(1 + ancho * 3);
    const claro = y > alto * 0.62;
    for (let x = 0; x < ancho; x++) {
      const k = 1 + x * 3;
      fila[k] = claro ? Math.min(255, r + 90) : r;
      fila[k + 1] = claro ? Math.min(255, g + 90) : g;
      fila[k + 2] = claro ? Math.min(255, b + 90) : b;
    }
    filas.push(fila);
  }
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const bloque = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
    const suma = Buffer.alloc(4);
    suma.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, suma]);
  };
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8;
  cabecera[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", cabecera),
    bloque("IDAT", deflateSync(Buffer.concat(filas))),
    bloque("IEND", Buffer.alloc(0)),
  ]);
}

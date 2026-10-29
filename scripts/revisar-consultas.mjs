/**
 * Revisa que la base entienda cada consulta de las pantallas, sin leer
 * datos: manda cada `.from("tabla").select("…")` del código a la API de
 * Supabase con la llave pública y `limit=0`.
 *
 *   node scripts/revisar-consultas.mjs
 *
 * Sin sesión, la base contesta "sin permiso" (es lo esperado: anon no lee
 * tablas). Lo que no puede pasar es un error de la consulta misma, como
 * una relación ambigua (PGRST201) o una columna que no existe: eso tumba
 * la pantalla aunque no haya ningún dato. No escribe nada.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..");
const entorno = Object.fromEntries(
  readFileSync(join(raiz, ".env.local"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
);
const url = entorno.NEXT_PUBLIC_SUPABASE_URL;
const llave = entorno.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function archivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : archivos(r);
    return /\.(ts|tsx)$/.test(n) ? [r] : [];
  });
}

// .from("tabla") seguido de .select("…"), "…" + "…" o `…`.
const patron = /\.from\("(\w+)"\)\s*\.select\(\s*((?:"[^"]*"\s*\+?\s*)+|`[^`]*`)/g;
const consultas = [];
for (const archivo of ["app", "lib", "components"].flatMap((d) => archivos(join(raiz, d)))) {
  const texto = readFileSync(archivo, "utf8");
  for (const m of texto.matchAll(patron)) {
    const select = m[2].startsWith("`") ? m[2].slice(1, -1) : [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
    if (select.includes("${")) continue;
    consultas.push({ archivo: archivo.slice(raiz.length + 1), tabla: m[1], select: select.replace(/\s+/g, "") });
  }
}

let fallas = 0;
for (const c of consultas) {
  const r = await fetch(`${url}/rest/v1/${c.tabla}?select=${encodeURIComponent(c.select)}&limit=0`, {
    headers: { apikey: llave, Authorization: `Bearer ${llave}` },
  });
  const cuerpo = r.ok ? null : await r.json().catch(() => ({}));
  // 42501 = sin permiso (anon no lee tablas): la consulta sí se entendió.
  const sinPermiso = cuerpo?.code === "42501";
  if (!r.ok && !sinPermiso) {
    fallas++;
    console.log(`FALLA ${c.archivo} · ${c.tabla}: ${cuerpo?.code ?? r.status} ${cuerpo?.message ?? ""}`);
  }
}
console.log(`\n${consultas.length} consultas revisadas, ${fallas} con error.`);
process.exit(fallas ? 1 : 0);

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * Una pantalla truena aunque la base esté vacía si su consulta pide
 * `personas(…)` desde una tabla que tiene DOS llaves hacia personas: la
 * API no sabe cuál usar (PGRST201). Pasó con "Alta directa" cuando 0028
 * agregó `referido_por_miembro` a comisionistas.
 *
 * Esta prueba saca de las migraciones qué tablas tienen más de una llave
 * hacia personas y revisa que toda consulta del código que embebe
 * personas desde ellas diga cuál (`personas!<llave>(…)`).
 * (Contra la base real: `node scripts/revisar-consultas.mjs`.)
 */

const raiz = join(import.meta.dirname, "..");
const db = new PGlite();
let ambiguas: Set<string>;

beforeAll(async () => {
  await db.exec(readFileSync(join(raiz, "pruebas", "supabase_simulado.sql"), "utf8"));
  const dir = join(raiz, "supabase", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  const { rows } = await db.query<{ tabla: string }>(
    `select c.conrelid::regclass::text as tabla from pg_constraint c
      where c.contype = 'f' and c.confrelid = 'public.personas'::regclass
      group by 1 having count(*) > 1`
  );
  ambiguas = new Set(rows.map((r) => r.tabla));
}, 60_000);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : archivos(r);
    return /\.(ts|tsx)$/.test(n) ? [r] : [];
  });
}

/** Cada `personas(` sin `!` con la tabla desde la que se embebe. */
function embebidosSinLlave(tabla: string, select: string): string[] {
  const padres: string[] = [];
  const hallados: string[] = [];
  const fichas = select.matchAll(/([\w!:]+)\(|\)/g);
  for (const f of fichas) {
    if (f[0] === ")") {
      padres.pop();
      continue;
    }
    const nombre = f[1].split(":").pop()!; // "alias:tabla!llave"
    const [relacion] = nombre.split("!");
    if (relacion === "personas" && !nombre.includes("!")) hallados.push(padres.at(-1) ?? tabla);
    padres.push(relacion);
  }
  return hallados;
}

describe("Consultas de las pantallas", () => {
  test("hay tablas con dos llaves hacia personas (si no, esta prueba no revisa nada)", () => {
    expect(ambiguas.has("comisionistas")).toBe(true);
  });

  test("toda consulta que embebe personas desde esas tablas dice qué llave usa", () => {
    const patron = /\.from\("(\w+)"\)\s*\.select\(\s*((?:"[^"]*"\s*\+?\s*)+|`[^`]*`)/g;
    const fallas: string[] = [];
    for (const archivo of ["app", "lib", "components"].flatMap((d) => archivos(join(raiz, d)))) {
      for (const m of readFileSync(archivo, "utf8").matchAll(patron)) {
        const select = m[2].startsWith("`") ? m[2].slice(1, -1) : [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("");
        for (const padre of embebidosSinLlave(m[1], select)) {
          if (ambiguas.has(padre)) fallas.push(`${archivo.slice(raiz.length + 1)}: ${padre} → personas sin llave`);
        }
      }
    }
    expect(fallas).toEqual([]);
  });
});

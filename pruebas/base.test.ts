import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";

/**
 * Corre las migraciones, la semilla y `supabase/verificaciones.sql`
 * contra un Postgres de verdad (PGlite), no contra una copia de las
 * reglas en TypeScript: si la base cambia, estas pruebas lo notan.
 *
 * Cada sección `-- @@ Nombre` de las verificaciones es una prueba. Van
 * en orden porque cada una parte de lo que dejó la anterior.
 */

const raiz = join(import.meta.dirname, "..");
const leer = (...ruta: string[]) => readFileSync(join(raiz, ...ruta), "utf8");

const db = new PGlite();

/** Corre SQL y devuelve los avisos "ok — …" que fue dejando. */
async function correr(sql: string): Promise<string[]> {
  const avisos: string[] = [];
  await db.exec(sql, { onNotice: (n) => avisos.push(n.message ?? "") });
  return avisos;
}

/**
 * En el editor de Supabase todo va en begin … rollback. Aquí no: si
 * una sección falla, la transacción abortada tumbaría también a las
 * siguientes y el reporte diría mentiras. La base es nueva en cada
 * corrida, así que no hay rastro que limpiar.
 */
function secciones(sql: string) {
  const limpio = sql
    .split("\n")
    .filter((linea) => !/^\s*(begin|rollback);\s*$/i.test(linea))
    .join("\n");
  const partes = limpio.split(/^-- @@ (.+)$/m);
  const preparacion = partes[0];
  const lista: { nombre: string; sql: string }[] = [];
  for (let i = 1; i < partes.length; i += 2) {
    lista.push({ nombre: partes[i].trim(), sql: partes[i + 1] });
  }
  return { preparacion, lista };
}

beforeAll(async () => {
  await correr(leer("pruebas", "supabase_simulado.sql"));
  const dir = join(raiz, "supabase", "migrations");
  for (const archivo of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await correr(leer("supabase", "migrations", archivo));
  }
}, 60_000);

describe("semilla de prueba", () => {
  test("carga y cuadra sus propios números", async () => {
    const avisos = await correr(leer("supabase", "semilla_prueba.sql"));
    expect(avisos).toContain("Semilla correcta.");
  });
});

describe("verificaciones", () => {
  const { preparacion, lista } = secciones(leer("supabase", "verificaciones.sql"));

  test("preparación (usuarios y ayudantes)", async () => {
    await correr(preparacion);
  });

  for (const { nombre, sql } of lista) {
    test(nombre, async () => {
      const avisos = await correr(sql);
      const fallas = avisos.filter((a) => a.startsWith("FALLA"));
      expect(fallas).toEqual([]);
      if (nombre !== "Fin") {
        expect(avisos.some((a) => a.startsWith("ok"))).toBe(true);
      }
    });
  }
});

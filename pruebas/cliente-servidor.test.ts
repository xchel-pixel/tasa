import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Un archivo "use client" solo le puede dar al servidor componentes (y tipos). Si una página del
 * servidor llama una función de ese archivo (p. ej. `textoComision(c)`), Next truena con "error
 * del servidor", y solo cuando hay datos que pintar: la prueba de humo no lo ve con la lista vacía.
 * Fue el error de Catálogos → Convenios (29-oct-2026). Esta prueba lo busca en el código.
 *
 * Regla: lo que un archivo de servidor importa de uno "use client" debe empezar con mayúscula
 * (componente) o ser un tipo. Funciones y constantes compartidas van en un archivo sin directiva.
 */

const raiz = resolve(import.meta.dirname, "..");
const CARPETAS = ["app", "components", "lib"];

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) return archivos(r);
    return /\.(ts|tsx)$/.test(n) ? [r] : [];
  });
}

const todos = CARPETAS.flatMap((c) => archivos(join(raiz, c)));
const esCliente = (f: string) => /^\s*["']use client["']/.test(readFileSync(f, "utf8"));
const deCliente = new Set(todos.filter(esCliente));

/** La ruta del archivo que importa `desde` ("@/…" o relativa), si es de este proyecto. */
function resolver(desde: string, importador: string): string | null {
  const base = desde.startsWith("@/") ? join(raiz, desde.slice(2)) : desde.startsWith(".") ? resolve(dirname(importador), desde) : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (deCliente.has(c) || todos.includes(c)) return c;
  }
  return null;
}

describe("Servidor y cliente", () => {
  test("el servidor solo importa componentes y tipos de archivos \"use client\"", () => {
    const problemas: string[] = [];
    for (const f of todos) {
      if (deCliente.has(f)) continue;
      const texto = readFileSync(f, "utf8");
      for (const m of texto.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
        if (m[1]) continue;
        const destino = resolver(m[3], f);
        if (!destino || !deCliente.has(destino)) continue;
        const llaves = m[2].match(/\{([^}]*)\}/)?.[1] ?? "";
        for (const nombre of llaves.split(",").map((x) => x.trim()).filter(Boolean)) {
          if (nombre.startsWith("type ")) continue;
          const local = nombre.split(/\s+as\s+/)[0].trim();
          if (!/^[A-Z]/.test(local)) {
            problemas.push(`${relative(raiz, f).split(sep).join("/")} importa "${local}" de ${relative(raiz, destino).split(sep).join("/")}`);
          }
        }
      }
    }
    expect(problemas).toEqual([]);
  });
});

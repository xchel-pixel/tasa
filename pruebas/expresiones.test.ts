import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Expresiones regulares con las diagonales invertidas perdidas. Pasó en el Mapa catastral (nov-2026): al escribir
 * código desde un script, `/[^\d-]/g` quedó como `/[^d-]/g` (borraba los dígitos de la clave) y `/^\d{1,12}…/` como
 * `/^d{1,12}…/` (nunca aceptaba el valor). El código compila y no truena: solo deja de servir.
 *
 * Revisa toda expresión literal (/…/) del código de la app, de scripts/ y de las pruebas de humo; y, en SQL (las
 * migraciones y la semilla: demo.sql y los demás de supabase/produccion), los patrones de ~, ~*, !~ y regexp_*().
 * Una d, s, w, D, S o W suelta seguida de +, *, ? o {, o sola dentro de una clase ([^d-], [s,]), casi siempre es
 * una \d, \s o \w a la que le falta la diagonal.
 */

const raiz = join(import.meta.dirname, "..");
const CARPETAS = ["app", "components", "lib", "scripts", "humo"];
const CARPETAS_SQL = ["supabase/migrations", "supabase/produccion"];
const SQL_SUELTOS = ["supabase/verificaciones.sql", "supabase/seed.sql"];

function archivos(dir: string, extension: RegExp): string[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) return archivos(r, extension);
    return extension.test(n) ? [r] : [];
  });
}

/** Expresiones literales: una / después de ( , = : ! & | ? { } ; [ o return, que no abre comentario. */
const LITERAL = /(?:^|[(,=:!&|?{};[]|\breturn)\s*\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+)\/[dgimsuyv]*/gm;

/**
 * Patrones en SQL: la cadena después de ~ ~* !~ !~* o el segundo argumento de regexp_*(…). Con E'…' las
 * diagonales van dobles (E'\\d' es \d).
 */
const PATRON_SQL = /(?:!?~\*?|\bregexp_[a-z_]+\s*\([^,()']*(?:\([^()]*\))?[^,()']*,)\s*(E?)'((?:[^']|'')*)'/gi;

export function patronesSql(texto: string): string[] {
  return [...texto.matchAll(PATRON_SQL)].map((m) => {
    const cuerpo = m[2].replace(/''/g, "'");
    return m[1] ? cuerpo.replace(/\\\\/g, "\\") : cuerpo;
  });
}

/** Lo sospechoso dentro de una expresión. */
export function diagonalPerdida(cuerpo: string): string | null {
  // Sin lo escapado (\d, \., \/…), para no confundir.
  const sin = cuerpo.replace(/\\./g, "··");
  // Letra de clase suelta con cuantificador: d+ s* w{ … (no precedida de otra letra o dígito: "add+" no cuenta).
  const cuantificada = /(?<![A-Za-z0-9_])[dswDSW](?=[+*?{])/.exec(sin);
  if (cuantificada) return cuantificada[0] + sin[cuantificada.index + 1];
  // Dentro de una clase: [^d-], [d], [s,], [^w]…
  for (const clase of sin.matchAll(/\[\^?([^\]]*)\]/g)) {
    if (/(?:^|[^A-Za-z])[dswDSW](?:$|[^A-Za-z])/.test(clase[1]) && !/^[A-Za-z]+$/.test(clase[1])) return clase[0];
  }
  return null;
}

describe("Expresiones regulares sin diagonales perdidas", () => {
  test("la regla atrapa los casos reales y deja pasar los buenos", () => {
    for (const malo of ["[^d-]", "^d{1,12}(.d{1,2})?$", "s+", "w+", "[s,]"]) expect(diagonalPerdida(malo), malo).not.toBeNull();
    for (const bueno of ["[^\\d-]", "^\\d{1,12}(\\.\\d{1,2})?$", "\\s+", "\\w+", "^Sin límite", "(curp|rfc|sexo|persona)", "[,.]$", "^M(0[1-9]|1[0-8])_PA\\.", "add+"]) {
      expect(diagonalPerdida(bueno), bueno).toBeNull();
    }
  });

  test("ninguna en el código de la app, scripts/ ni humo", () => {
    const hallazgos: string[] = [];
    for (const f of CARPETAS.flatMap((c) => archivos(join(raiz, c), /\.(ts|tsx|mjs|js)$/))) {
      const texto = readFileSync(f, "utf8");
      for (const m of texto.matchAll(LITERAL)) {
        const sospecha = diagonalPerdida(m[1]);
        if (sospecha) hallazgos.push(`${relative(raiz, f)}: /${m[1]}/ (${sospecha})`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  test("ninguna en el SQL: migraciones, semilla (demo.sql) y verificaciones", () => {
    const hallazgos: string[] = [];
    const sql = [...CARPETAS_SQL.flatMap((c) => archivos(join(raiz, c), /\.sql$/)), ...SQL_SUELTOS.map((f) => join(raiz, f)).filter(existsSync)];
    expect(sql.some((f) => f.endsWith("demo.sql")), "revisa demo.sql").toBe(true);
    for (const f of sql) {
      for (const p of patronesSql(readFileSync(f, "utf8"))) {
        const sospecha = diagonalPerdida(p);
        if (sospecha) hallazgos.push(`${relative(raiz, f)}: '${p}' (${sospecha})`);
      }
    }
    expect(hallazgos).toEqual([]);
  });

  test("la revisión ve las expresiones de verdad (si un día deja de encontrarlas, esta prueba no sirve)", () => {
    const texto = readFileSync(join(raiz, "lib", "catastro", "limpiar.ts"), "utf8");
    const encontradas = [...texto.matchAll(LITERAL)].map((m) => m[1]);
    expect(encontradas).toContain("\\s+");
    expect(encontradas.length).toBeGreaterThanOrEqual(5);
    // scripts/ también se lee.
    expect(archivos(join(raiz, "scripts"), /\.(ts|tsx|mjs|js)$/).length).toBeGreaterThan(0);
    // SQL: el patrón de la clave catastral (0059) y los casos con E'' y regexp_replace.
    const migracion = readFileSync(join(raiz, "supabase", "migrations", "0059_mapa_catastral.sql"), "utf8");
    expect(patronesSql(migracion)).toContain("^(0[1-9]|1[0-8])[0-9]{13}$");
    expect(patronesSql("where x ~ '^\\d+$' and regexp_replace(lower(y), '[^0-9]', '', 'g') and z ~* E'^\\\\s+'"))
      .toEqual(["^\\d+$", "[^0-9]", "^\\s+"]);
    expect(diagonalPerdida(patronesSql("where clave ~ '^d{15}$'")[0])).not.toBeNull();
  });
});

import type { ReactNode } from "react";

/**
 * El aviso de privacidad (lo que admin_org pega en Ajustes) en pantalla. Entiende lo poco de Markdown que usa:
 * "# " título, "## " secciones, listas "1. " y "- ", tablas con "|" y **negritas**. Un texto sin nada de eso
 * (como los avisos anteriores) sale en párrafos, como antes. No cambia la redacción: solo le da forma.
 * Las tablas, en el celular, salen como tarjetas (una por renglón, con el nombre de cada columna).
 */

function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((parte, i) =>
    parte.startsWith("**") && parte.endsWith("**") ? <strong key={i}>{parte.slice(2, -2)}</strong> : parte);
}

const celdas = (renglon: string) => renglon.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

type Bloque =
  | { tipo: "titulo" | "seccion" | "parrafo"; texto: string }
  | { tipo: "numerada" | "vinetas"; items: string[] }
  | { tipo: "tabla"; encabezados: string[]; filas: string[][] };

export function bloquesDeAviso(texto: string): Bloque[] {
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push({ tipo: "parrafo", texto: parrafo.join("\n") });
    parrafo = [];
  };
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l.trim()) { cerrarParrafo(); continue; }
    if (/^#\s/.test(l)) { cerrarParrafo(); bloques.push({ tipo: "titulo", texto: l.replace(/^#\s+/, "") }); continue; }
    if (/^##\s/.test(l)) { cerrarParrafo(); bloques.push({ tipo: "seccion", texto: l.replace(/^##\s+/, "") }); continue; }
    if (/^\s*\|/.test(l)) {
      cerrarParrafo();
      const grupo: string[] = [];
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) grupo.push(lineas[i++]);
      i--;
      const [encabezado, ...resto] = grupo;
      bloques.push({ tipo: "tabla", encabezados: celdas(encabezado), filas: resto.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map(celdas) });
      continue;
    }
    const lista = /^(\d+)\.\s+/.test(l) ? "numerada" : /^[-*]\s+/.test(l) ? "vinetas" : null;
    if (lista) {
      cerrarParrafo();
      const items: string[] = [];
      const patron = lista === "numerada" ? /^\d+\.\s+/ : /^[-*]\s+/;
      while (i < lineas.length && patron.test(lineas[i])) items.push(lineas[i++].replace(patron, ""));
      i--;
      bloques.push({ tipo: lista, items });
      continue;
    }
    parrafo.push(l);
  }
  cerrarParrafo();
  return bloques;
}

export function TextoAviso({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col gap-4 leading-7">
      {bloquesDeAviso(texto).map((b, i) => {
        switch (b.tipo) {
          case "titulo":
            return <h1 key={i} className="text-[1.5rem] font-bold leading-tight tracking-tight">{enLinea(b.texto)}</h1>;
          case "seccion":
            return <h2 key={i} className="mt-4 text-[1.125rem] font-bold">{enLinea(b.texto)}</h2>;
          case "parrafo":
            return <p key={i} className="whitespace-pre-line">{enLinea(b.texto)}</p>;
          case "numerada":
            return <ol key={i} className="list-decimal space-y-2 pl-6">{b.items.map((t, j) => <li key={j}>{enLinea(t)}</li>)}</ol>;
          case "vinetas":
            return <ul key={i} className="list-disc space-y-2 pl-6">{b.items.map((t, j) => <li key={j}>{enLinea(t)}</li>)}</ul>;
          case "tabla":
            return (
              <div key={i}>
                {/* Celular: una tarjeta por renglón. */}
                <div className="flex flex-col gap-3 md:hidden">
                  {b.filas.map((f, j) => (
                    <dl key={j} className="rounded-xl border border-linea bg-alterno px-4 py-3">
                      {b.encabezados.map((e, k) => (
                        <div key={k} className={k ? "mt-2" : ""}>
                          <dt className="text-[0.8125rem] font-semibold text-secundario">{enLinea(e)}</dt>
                          <dd className="text-[0.9375rem] leading-6">{enLinea(f[k] ?? "")}</dd>
                        </div>
                      ))}
                    </dl>
                  ))}
                </div>
                {/* Computadora: tabla. */}
                <table className="hidden w-full border-collapse text-left text-[0.9375rem] leading-6 md:table">
                  <thead>
                    <tr>{b.encabezados.map((e, k) => <th key={k} className="border-b border-linea px-3 py-2 align-bottom font-semibold">{enLinea(e)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {b.filas.map((f, j) => (
                      <tr key={j}>{b.encabezados.map((_, k) => <td key={k} className="border-b border-linea px-3 py-2 align-top">{enLinea(f[k] ?? "")}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

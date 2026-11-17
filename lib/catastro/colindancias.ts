import { aUtm, superficieDelPoligono, type Geometria, type Punto } from "./geo";

/**
 * Medidas y colindancias del Registro Público, ordenadas en tabla (Orientación | Medida | Colinda con), una fila por
 * lado o tramo, en el orden en que vienen. Si no se puede ordenar con seguridad, `seguro` es falso y la pantalla
 * muestra el texto completo con un renglón por lado: nunca se pierde ni se corta texto.
 *
 * Sin expresiones con diagonales en literales (regla del proyecto): solo clases como [0-9] y [ ], con new RegExp.
 */

export type FilaColindancia = { orientacion: string; medidas: number[]; colinda: string };
export type Colindancias = { filas: FilaColindancia[]; seguro: boolean; nota: string | null };

const RUMBOS: [string, string][] = [
  ["NOR-?ORIENTE", "Nororiente"], ["NOR-?PONIENTE", "Norponiente"], ["SUR-?ORIENTE", "Suroriente"], ["SUR-?PONIENTE", "Surponiente"],
  ["NOR-?ESTE", "Noreste"], ["NOR-?OESTE", "Noroeste"], ["SUR-?ESTE", "Sureste"], ["SUR-?OESTE", "Suroeste"],
  ["NORTE", "Norte"], ["SUR", "Sur"], ["ORIENTE", "Oriente"], ["PONIENTE", "Poniente"], ["ESTE", "Este"], ["OESTE", "Oeste"],
];
const ABREVIADOS: Record<string, string> = { N: "Norte", S: "Sur", E: "Este", O: "Oeste", NE: "Noreste", NO: "Noroeste", NW: "Noroeste",
  SE: "Sureste", SO: "Suroeste", SW: "Suroeste" };
const RUMBO = RUMBOS.map(([r]) => r).join("|");

/** "NOR-ORIENTE" → "Nororiente"; "NE" → "Noreste". */
export function nombreRumbo(texto: string): string {
  const t = texto.toUpperCase().replaceAll(" ", "");
  if (ABREVIADOS[t]) return ABREVIADOS[t];
  for (const [r, nombre] of RUMBOS) if (new RegExp(`^(?:${r})$`).test(t)) return nombre;
  return texto;
}

// Palabras que, antes de un rumbo, dicen que es parte de la descripción de un lado y no un lado nuevo ("VA AL NOROESTE").
const VERBOS = ["VA", "SIGUE", "CONTINUA", "CONTINÚA", "TERMINA", "BAJA", "SUBE", "GIRA", "QUIEBRA", "HACIA", "DE", "A", "PARA", "RUMBO",
  "VOLTEANDO", "VOLTEA", "DOBLANDO", "DOBLA", "GIRANDO", "QUEBRANDO", "BAJANDO", "SUBIENDO", "SIGUIENDO", "CONTINUANDO", "TERMINANDO"];
const UNIDAD = "(?:METROS|MTRS|MTS|MT|ML|M)";
const NUMERO = "[0-9]+(?:[.,][0-9]+)?";
const MEDIDA = new RegExp(`(^|[^0-9.,A-Z])(${NUMERO})[ ]*${UNIDAD}(?![A-Z0-9²]|[ ]*CUADRADOS)[.]?`, "g");
const CON = new RegExp(`(^|[ ,;.(])(?:COLINDANDO|COLINDA|LINDANDO|LINDA)?[ ]*CON(?=[ :])`, "g");

const aNumero = (s: string) => Number(s.replace(",", "."));
const limpiarBordes = (s: string) => {
  let t = s.trim();
  for (let i = 0; i < 40; i++) {
    const antes = t;
    t = t.replace(/^[:;,.(-]+/, "").replace(/[:;,.(-]+$/, "").trim();
    if (t.endsWith(" Y")) t = t.slice(0, -2).trim();
    if (t.startsWith("Y ")) t = t.slice(2).trim();
    if (t.startsWith(")")) t = t.slice(1).trim();
    if (t === antes) break;
  }
  return t;
};

type Marca = { inicio: number; fin: number; rumbo: string };

/** Dónde empieza cada lado: "AL NORTE", "LINDERO NOROESTE:", "NORTE:" o "NE:" al inicio de una frase. */
function marcas(texto: string): Marca[] {
  const T = texto.toUpperCase();
  const salida: Marca[] = [];
  const re = new RegExp(`(^|[^A-Z0-9ÁÉÍÓÚÑ])((?:AL|LINDERO|COLINDANCIA)[ ]+)?(${RUMBO}|NE|NO|NW|SE|SO|SW|N|S|E|O)(?=$|[ ]*[:.,;(]|[ ]+(?:EN|MIDE|CON|COLINDA|LINDA|LINDANDO|[0-9]))`, "g");
  for (const m of T.matchAll(re)) {
    const inicio = m.index + m[1].length;
    const prefijo = m[2] ?? "";
    const palabra = m[3];
    const abreviado = Boolean(ABREVIADOS[palabra]) && !new RegExp(`^(?:${RUMBO})$`).test(palabra);
    const antes = T.slice(0, inicio).trimEnd();
    const anterior = antes.split(/[ ]+/).pop() ?? "";
    const inicioDeFrase = !antes || /[;:.]$/.test(antes) || antes.endsWith("-");
    const sigue = T.slice(inicio + prefijo.length + palabra.length);
    // Abreviaturas (N, NE…): solo al inicio de frase y con dos puntos o una medida enseguida. Rumbos completos sin "AL":
    // igual, o seguidos de una medida con unidad ("NORTE 12.00 M CON…").
    const conMedida = new RegExp(`^[ ]*${NUMERO}[ ]*${UNIDAD}(?![A-Z])`).test(sigue);
    if (abreviado && !(inicioDeFrase && /^[ ]*(:|[0-9])/.test(sigue))) continue;
    if (!abreviado && !prefijo && !(inicioDeFrase && /^[ ]*(:|[0-9])/.test(sigue)) && !conMedida) continue;
    // "VA AL NOROESTE", "DE NORTE A SUR", "18.58 M AL PONIENTE LINDANDO": parte de la descripción del lado.
    // Si la palabra anterior cierra una frase ("PERSONA A. AL SUR"), no es parte de la descripción.
    const cierraFrase = /[.;,]$/.test(anterior);
    const anteriorLimpio = anterior.replace(/[.,;]$/, "");
    if (!cierraFrase && (VERBOS.includes(anteriorLimpio) || new RegExp(`^${UNIDAD}$`).test(anteriorLimpio))) continue;
    salida.push({ inicio, fin: inicio + prefijo.length + palabra.length, rumbo: nombreRumbo(palabra) });
  }
  return salida;
}

/** El texto de un lado → sus tramos (medidas y con quién colinda). Nulo si no se puede leer con seguridad. */
function tramos(rumbo: string, texto: string): FilaColindancia[] | null {
  const T = texto.toUpperCase();
  const fichas: { pos: number; fin: number; tipo: "medida" | "con"; valor?: number }[] = [];
  for (const m of T.matchAll(MEDIDA)) fichas.push({ pos: m.index + m[1].length, fin: m.index + m[0].length, tipo: "medida", valor: aNumero(m[2]) });
  for (const m of T.matchAll(CON)) fichas.push({ pos: m.index + m[1].length, fin: m.index + m[0].length, tipo: "con" });
  fichas.sort((a, b) => a.pos - b.pos);

  const filas: FilaColindancia[] = [];
  let actual: FilaColindancia = { orientacion: rumbo, medidas: [], colinda: "" };
  let desdeColinda = -1;
  let ultimaMedidaFin = 0;
  let inicioTramo = 0;
  const cerrarColinda = (hasta: number) => {
    if (desdeColinda >= 0) actual.colinda = limpiarBordes(`${actual.colinda} ${texto.slice(desdeColinda, hasta)}`);
    desdeColinda = -1;
  };
  for (const f of fichas) {
    if (f.tipo === "medida") {
      if (desdeColinda >= 0 || actual.colinda) {
        cerrarColinda(f.pos);
        filas.push(actual);
        actual = { orientacion: rumbo, medidas: [], colinda: "" };
        inicioTramo = f.pos;
      }
      actual.medidas.push(f.valor!);
      ultimaMedidaFin = f.fin;
    } else if (desdeColinda < 0 && !actual.colinda) {
      // Una cifra con decimales sin unidad antes de "CON" ("MIDE 2.43 BAJA"): la suma no sería confiable.
      if (new RegExp(`[0-9][.,][0-9]`).test(T.slice(inicioTramo, f.pos).replace(MEDIDA, " "))) return null;
      desdeColinda = f.fin;
    }
  }
  if (desdeColinda >= 0) cerrarColinda(texto.length);
  else if (!actual.colinda) {
    // Sin "CON": con una sola medida, lo que sigue es el colindante ("AL NORESTE MIDE 986.35 M. GREGORIO…").
    if (actual.medidas.length > 1) return null;
    actual.colinda = limpiarBordes(texto.slice(ultimaMedidaFin));
  }
  filas.push(actual);
  return filas.every((f) => f.medidas.length || f.colinda) ? filas : null;
}

/** "SE INICIA EL RECORRIDO DEL VÉRTICE 1 CON RUMBO SURESTE… UNA DISTANCIA DE 63.142 M… COLINDA CON…". */
function recorrido(texto: string): FilaColindancia[] | null {
  const T = texto.toUpperCase();
  if (!T.includes("RUMBO") || !T.includes("DISTANCIA")) return null;
  // Cortes en "(SE) CONTINUA" (cada tramo del recorrido), sobre el texto original (mismas posiciones que en mayúsculas).
  const cortes = [0, ...[...T.matchAll(/(?:SE )?CONTIN[UÚ]A/g)].map((m) => m.index), texto.length];
  const filas: FilaColindancia[] = [];
  for (let i = 0; i + 1 < cortes.length; i++) {
    const pieza = texto.slice(cortes[i], cortes[i + 1]);
    const P = pieza.toUpperCase();
    // Un tramo puede quebrar ("HACE UN QUIEBRE CON RUMBO NORESTE… DISTANCIA DE 22.219 M"): un renglón por rumbo, en orden.
    // La distancia va rotulada ("DISTANCIA DE 4.645 HASTA…"), así que la unidad puede faltar.
    const rumbos = [...P.matchAll(new RegExp(`RUMBO[ ]+(${RUMBO})`, "g"))].map((m) => m[1]);
    const medidas = [...P.matchAll(new RegExp(`DISTANCIA[ ]+DE[ ]+(${NUMERO})`, "g"))].map((m) => aNumero(m[1]));
    if (!rumbos.length || rumbos.length !== medidas.length) return null;
    // "SIENDO LOS LINDEROS… Y COLINDA CON…": lo dice una vez para todo el tramo, y vale para sus quiebres.
    const con = P.indexOf("COLINDA CON");
    const colinda = con >= 0 ? limpiarBordes(pieza.slice(con + "COLINDA CON".length)) : "";
    rumbos.forEach((r, k) => filas.push({ orientacion: nombreRumbo(r), medidas: [medidas[k]], colinda }));
  }
  return filas.length >= 2 ? filas : null;
}

export function leerColindancias(texto: string): Colindancias {
  const limpio = (texto ?? "").replace(/[ ]+/g, " ").trim();
  if (!limpio) return { filas: [], seguro: false, nota: null };
  const porVertices = recorrido(limpio);
  if (porVertices) return { filas: porVertices, seguro: true, nota: null };

  const ms = marcas(limpio);
  if (ms.length < 2) return { filas: [], seguro: false, nota: null };
  const filas: FilaColindancia[] = [];
  for (let i = 0; i < ms.length; i++) {
    const lado = limpio.slice(ms[i].fin, i + 1 < ms.length ? ms[i + 1].inicio : limpio.length);
    const t = tramos(ms[i].rumbo, lado.replace(/^[ ]*:?[ ]*(EN:?|MIDE)?[ ]*/i, " "));
    if (!t) return { filas: [], seguro: false, nota: null };
    filas.push(...t);
  }
  const nota = limpiarBordes(limpio.slice(0, ms[0].inicio)) || null;
  return { filas, seguro: true, nota };
}

const dos = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "20.10 + 1.50 + 26.60 = 48.20" para varios tramos; "13.00" para uno; "—" sin medida. */
export function textoMedida(medidas: number[]): string {
  if (!medidas.length) return "—";
  if (medidas.length === 1) return dos(medidas[0]);
  return `${medidas.map(dos).join(" + ")} = ${dos(medidas.reduce((a, b) => a + b, 0))}`;
}

// ------------------------------------------------------------------
// Medidas del polígono (catastro): de la geometría UTM, un renglón por lado.
// ------------------------------------------------------------------

const OCHO = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];

/** Azimut (grados desde el norte, en el sentido del reloj) → N, NE, E, SE, S, SO, O, NO. */
export function rumboDeAzimut(grados: number): string {
  const a = ((grados % 360) + 360) % 360;
  return OCHO[Math.round(a / 45) % 8];
}

export type LadoPoligono = { lado: number; orientacion: string; largo: number };

/**
 * Los lados del anillo exterior de cada polígono, en orden. Con la geometría UTM de la fuente es exacto; si no hay,
 * se convierte desde grados y queda marcado como aproximado. Se omiten lados de menos de 1 cm (vértices repetidos).
 */
export function ladosDelPoligono(geometria: Geometria | null | undefined, utm: Geometria | null | undefined):
  { lados: LadoPoligono[]; superficie: number | null; aprox: boolean } | null {
  const g = utm ?? geometria;
  if (!g) return null;
  const aprox = !utm;
  const pols: Punto[][][] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  const lados: LadoPoligono[] = [];
  for (const pol of pols) {
    const anillo = (pol[0] ?? []).map((p) => (aprox ? aUtm(p[1], p[0]) : p));
    for (let i = 0; i + 1 < anillo.length; i++) {
      const [x0, y0] = anillo[i];
      const [x1, y1] = anillo[i + 1];
      const largo = Math.hypot(x1 - x0, y1 - y0);
      if (largo < 0.01) continue;
      lados.push({ lado: lados.length + 1, orientacion: rumboDeAzimut((Math.atan2(x1 - x0, y1 - y0) * 180) / Math.PI), largo });
    }
  }
  const s = superficieDelPoligono(geometria ?? null, utm ?? null);
  return lados.length ? { lados, superficie: s && s.m2 > 0 ? s.m2 : null, aprox } : null;
}

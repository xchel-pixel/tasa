import { aUtm, type Geometria, type Punto } from "./geo";

/**
 * El DXF de un predio guardado: el polígono en UTM zona 14 norte (EPSG:32614), en metros, sin pasar a grados.
 * Si el predio trae geometria_utm (0066), las coordenadas son exactamente las de la fuente; si no (guardados
 * antes), se convierten desde los grados guardados (~10 cm de precisión).
 * Formato DXF ASCII de AutoCAD R12 (AC1009), sin dependencias. Cuatro capas:
 *   PREDIO    polilínea cerrada por anillo (en condominio, una por cada parte; los huecos, también cerrados)
 *   VERTICES  número de cada vértice
 *   COTAS     longitud de cada lado en metros, 2 decimales
 *   TEXTOS    clave, superficie del polígono, fecha de consulta y "Información sin validez oficial"
 * Solo lleva la geometría y la clave: nada de propietario, operación ni de dónde salió el dato (ni en capas,
 * comentarios o encabezado).
 */

export type PredioDxf = { clave: string; geometria: Geometria; geometriaUtm?: Geometria | null; consultadoEn: string | Date };

const CAPAS: [string, number][] = [["PREDIO", 7], ["VERTICES", 1], ["COTAS", 3], ["TEXTOS", 5]];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (n: number) => r3(n).toFixed(3);
/** Una coordenada tal cual (la de la fuente, sin redondear), en notación decimal. */
const coord = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

const sinCierre = (puntos: Punto[]) => {
  const [a, z] = [puntos[0], puntos[puntos.length - 1]];
  return puntos.length > 1 && a[0] === z[0] && a[1] === z[1] ? puntos.slice(0, -1) : puntos;
};

/** Los anillos en UTM: los de la fuente tal cual, o convertidos desde grados. */
export function anillosDe(p: Pick<PredioDxf, "geometria" | "geometriaUtm">): Punto[][][] {
  if (!p.geometriaUtm) return anillosUtm(p.geometria);
  const pols = p.geometriaUtm.type === "Polygon" ? [p.geometriaUtm.coordinates] : p.geometriaUtm.coordinates;
  return pols.map((pol) => pol.map((anillo) => sinCierre(anillo.map(([x, y]) => [x, y] as Punto))));
}

/** Los anillos de la geometría en UTM (metros, al milímetro), sin repetir el vértice de cierre. */
export function anillosUtm(g: Geometria): Punto[][][] {
  const pols = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return pols.map((pol) =>
    pol.map((anillo) => sinCierre(anillo.map(([lon, lat]) => aUtm(lat, lon).map(r3) as Punto)))
  );
}

function areaConSigno(a: Punto[]): number {
  let s = 0;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += a[j][0] * a[i][1] - a[i][0] * a[j][1];
  return s / 2;
}

/** Superficie del polígono en m²: cada parte, menos sus huecos. */
export function superficieUtm(pols: Punto[][][]): number {
  return pols.reduce((t, pol) => t + pol.reduce((s, anillo, i) => s + Math.abs(areaConSigno(anillo)) * (i === 0 ? 1 : -1), 0), 0);
}

const miles = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function dxfDePredio({ clave, geometria, geometriaUtm, consultadoEn }: PredioDxf): string {
  const pols = anillosDe({ geometria, geometriaUtm });
  const todos = pols.flat(2);
  const xs = todos.map((p) => p[0]), ys = todos.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Alto del texto proporcional al predio: legible sin tapar el dibujo.
  const h = r3(Math.min(3, Math.max(0.15, Math.hypot(x1 - x0, y1 - y0) / 60)));

  const salida: string[] = [];
  const g = (codigo: number, valor: string | number) => salida.push(String(codigo).padStart(3), String(valor));
  const texto = (capa: string, x: number, y: number, t: string, angulo = 0, centrado = false) => {
    g(0, "TEXT"); g(8, capa); g(10, num(x)); g(20, num(y)); g(30, "0.0"); g(40, num(h)); g(1, t);
    if (angulo) g(50, angulo.toFixed(4));
    if (centrado) { g(72, 1); g(11, num(x)); g(21, num(y)); g(31, "0.0"); g(73, 2); }
  };

  // Encabezado
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$DWGCODEPAGE"); g(3, "ANSI_1252");
  g(9, "$INSBASE"); g(10, "0.0"); g(20, "0.0"); g(30, "0.0");
  g(9, "$EXTMIN"); g(10, num(x0)); g(20, num(y0 - 8 * h)); g(30, "0.0");
  g(9, "$EXTMAX"); g(10, num(x1)); g(20, num(y1)); g(30, "0.0");
  g(0, "ENDSEC");

  // Tablas: tipo de línea, capas y estilo de texto
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, 1);
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, 0); g(3, "Solid line"); g(72, 65); g(73, 0); g(40, "0.0");
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, CAPAS.length + 1);
  for (const [nombre, color] of [["0", 7] as [string, number], ...CAPAS]) {
    g(0, "LAYER"); g(2, nombre); g(70, 0); g(62, color); g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "STYLE"); g(70, 1);
  g(0, "STYLE"); g(2, "STANDARD"); g(70, 0); g(40, "0.0"); g(41, "1.0"); g(50, "0.0"); g(71, 0); g(42, num(h)); g(3, "txt"); g(4, "");
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "BLOCKS"); g(0, "ENDSEC");

  // Entidades
  g(0, "SECTION"); g(2, "ENTITIES");
  let n = 0;
  for (const pol of pols) {
    for (const anillo of pol) {
      g(0, "POLYLINE"); g(8, "PREDIO"); g(66, 1); g(10, "0.0"); g(20, "0.0"); g(30, "0.0"); g(70, 1);
      for (const [x, y] of anillo) { g(0, "VERTEX"); g(8, "PREDIO"); g(10, coord(x)); g(20, coord(y)); g(30, "0.0"); }
      g(0, "SEQEND"); g(8, "PREDIO");

      // Hacia afuera del anillo: depende de su sentido de giro.
      const sentido = areaConSigno(anillo) >= 0 ? 1 : -1;
      const cx = anillo.reduce((s, p) => s + p[0], 0) / anillo.length, cy = anillo.reduce((s, p) => s + p[1], 0) / anillo.length;
      anillo.forEach(([x, y], i) => {
        n += 1;
        const d = Math.hypot(x - cx, y - cy) || 1;
        texto("VERTICES", x + ((x - cx) / d) * h * 0.9, y + ((y - cy) / d) * h * 0.9, String(n), 0, true);
        const [xb, yb] = anillo[(i + 1) % anillo.length];
        const largo = Math.hypot(xb - x, yb - y);
        if (largo === 0) return;
        const [nx, ny] = [((yb - y) / largo) * sentido, (-(xb - x) / largo) * sentido];
        let angulo = (Math.atan2(yb - y, xb - x) * 180) / Math.PI;
        if (angulo > 90) angulo -= 180;
        if (angulo <= -90) angulo += 180;
        texto("COTAS", (x + xb) / 2 + nx * h * 0.8, (y + yb) / 2 + ny * h * 0.8, largo.toFixed(2), angulo, true);
      });
    }
  }

  const fecha = new Date(consultadoEn).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Mexico_City" });
  [
    `Clave catastral: ${clave}`,
    // Exacta con la geometría UTM de la fuente; "aprox." si se calculó desde los grados.
    `Superficie del polígono${geometriaUtm ? "" : " (aprox.)"}: ${miles(superficieUtm(pols))} m²`,
    `Fecha de consulta: ${fecha}`,
    "Información sin validez oficial",
  ].forEach((t, i) => texto("TEXTOS", x0, y0 - 2.5 * h - i * 1.7 * h, t));
  g(0, "ENDSEC");
  g(0, "EOF");
  return salida.join("\r\n") + "\r\n";
}

/** Los bytes del archivo: Windows-1252 (lo que declara $DWGCODEPAGE), para los acentos y el ². */
export function bytesDxf(dxf: string): Buffer {
  return Buffer.from(dxf, "latin1");
}

/**
 * Las capas del mapa catastral para el equipo (admin_org, finanzas y equipo), sin directiva: las usan la pantalla, la
 * ruta de mosaicos y las pruebas. Es una LISTA FIJA: el navegador solo manda el id de la capa; nombres de capas de la
 * fuente, zoom mínimo y estilo los pone el servidor. La fuente bloquea los estilos propios (SLD), así que se dibujan
 * con el estilo de la fuente; los colores de la leyenda son los de ese estilo.
 *
 * Un mosaico es una imagen (PNG): no lleva campos. Los de ejidos dibujan solo la clave agraria de la parcela.
 */

const MUNICIPIOS = Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, "0"));
const porMunicipio = (f: (m: string) => string[]) => MUNICIPIOS.flatMap(f).map((c) => `queretaro:${c}`).join(",");

// Capas de construcciones que la fuente no puede dibujar (nov-2026: "Rendering process failed"; con una sola en la lista
// falla el mosaico entero): Amealco nivel 2; Cadereyta, Colón y Huimilpan nivel 1.
export const CONSTRUCCIONES_ROTAS = ["M01_CIA_N02", "M04_CIA_N01", "M05_CIA_N01", "M08_CIA_N01"];

export type IdCapa = "predios" | "construcciones" | "uso_suelo" | "colonias" | "ejidos" | "manzanas";

export type Capa = {
  id: IdCapa;
  nombre: string;
  /** Las capas de la fuente, en un solo mosaico. */
  fuente: string;
  zoomMin: number;
  /** Color de la leyenda (el del estilo de la fuente); nulo = varios colores. */
  color: string | null;
  /** Línea de la leyenda. */
  leyenda: string;
  encendida: boolean;
};

export const CAPAS: Capa[] = [
  {
    id: "uso_suelo", nombre: "Uso de suelo", zoomMin: 13, color: null, encendida: false,
    // Solo hay programas parciales publicados para Corregidora (06), El Marqués (11) y San Juan del Río (16).
    fuente: "queretaro:M06_PPDU,queretaro:M11_PPDU_TOTAL,queretaro:M16_PPDU",
    leyenda: "Un color por uso, con su nombre. Solo existe para Corregidora, El Marqués y San Juan del Río.",
  },
  {
    id: "colonias", nombre: "Colonias", zoomMin: 14, color: "#003366", encendida: false,
    fuente: porMunicipio((m) => [`M${m}_CLA`]), leyenda: "Límite y nombre de cada colonia.",
  },
  {
    id: "ejidos", nombre: "Ejidos", zoomMin: 14, color: "#ff9900", encendida: false,
    fuente: porMunicipio((m) => [`RAN_M${m}`]), leyenda: "Parcelas ejidales con su clave agraria. Al picar: ejido, parcela y superficie.",
  },
  {
    id: "manzanas", nombre: "Manzanas", zoomMin: 16, color: "#c50002", encendida: false,
    fuente: porMunicipio((m) => [`M${m}_MA`]), leyenda: "Límite de cada manzana.",
  },
  {
    id: "construcciones", nombre: "Construcciones por nivel", zoomMin: 17, color: "#f27c41", encendida: false,
    fuente: porMunicipio((m) => [1, 2, 3, 4, 5].map((n) => `M${m}_CIA_N0${n}`).filter((c) => !CONSTRUCCIONES_ROTAS.includes(c))),
    leyenda: "Huella de lo construido en cada nivel (1 a 5), con su tipo de construcción. La fuente no dibuja el nivel 1 de Cadereyta, Colón y Huimilpan ni el 2 de Amealco.",
  },
  {
    id: "predios", nombre: "Predios", zoomMin: 17, color: "#009900", encendida: true,
    fuente: ["PA", "PRA"].flatMap((t) => MUNICIPIOS.map((m) => `queretaro:M${m}_${t}`)).join(","),
    leyenda: "Urbanos en verde y rústicos en rojo, con su clave.",
  },
];

/** Color de los rústicos en el estilo de la fuente (segunda muestra de la leyenda de Predios). */
export const COLOR_RUSTICOS = "#a80000";

export const capaPorId = (id: string): Capa | null => CAPAS.find((c) => c.id === id) ?? null;

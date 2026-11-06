import type { Campo } from "./limpiar";

/** Cómo se llama y cómo se escribe cada campo de la ficha (sin directiva: lo usan servidor y cliente). */

type Formato = "texto" | "m2" | "pesos" | "pct" | "tabla";

export const ETIQUETAS: Record<Campo, [string, Formato]> = {
  colonia: ["Colonia", "texto"],
  codigo_postal: ["Código postal", "texto"],
  ubicacion: ["Ubicación", "texto"],
  sup_terreno: ["Superficie de terreno", "m2"],
  sup_construccion: ["Superficie de construcción", "m2"],
  calle: ["Calle", "texto"],
  num_ext: ["Número exterior", "texto"],
  num_int: ["Número interior", "texto"],
  localidad: ["Localidad", "texto"],
  manzana: ["Manzana", "texto"],
  tipo_predio: ["Tipo de predio", "texto"],
  estatus: ["Estatus en catastro", "texto"],
  clasificacion: ["Clasificación", "texto"],
  uso: ["Uso", "texto"],
  clave_anterior: ["Clave anterior", "texto"],
  clave_estandar: ["Clave estándar", "texto"],
  clave_original: ["Clave del predio de origen", "texto"],
  folio_real: ["Folio real", "texto"],
  fecha_alta: ["Alta en catastro", "texto"],
  fecha_mantenimiento: ["Último mantenimiento de catastro", "texto"],
  movimientos: ["Movimientos", "tabla"],
  superficie: ["Superficie (expediente)", "m2"],
  tipos_construccion: ["Tipos de construcción", "texto"],
  series_valor: ["Series de valor", "tabla"],
  codigo_valor: ["Código de valor", "texto"],
  fecha_validez: ["Vigencia del valor", "texto"],
  valor_terreno: ["Valor catastral del terreno", "pesos"],
  valor_construccion: ["Valor catastral de la construcción", "pesos"],
  valor_catastral_total: ["Valor catastral total", "pesos"],
  valor_terreno_anterior: ["Valor anterior del terreno", "pesos"],
  valor_construccion_anterior: ["Valor anterior de la construcción", "pesos"],
  regimen: ["Régimen", "texto"],
  tipo_condominio: ["Tipo de condominio", "texto"],
  nombre_condominio: ["Condominio", "texto"],
  indiviso: ["Indiviso", "pct"],
  sup_terreno_privativa: ["Terreno privativo", "m2"],
  sup_terreno_comun: ["Terreno común", "m2"],
  sup_construccion_privativa: ["Construcción privativa", "m2"],
  sup_construccion_comun: ["Construcción común", "m2"],
  valor_terreno_privativo: ["Valor del terreno privativo", "pesos"],
  valor_terreno_comun: ["Valor del terreno común", "pesos"],
  valor_construccion_privativa: ["Valor de la construcción privativa", "pesos"],
  valor_construccion_comun: ["Valor de la construcción común", "pesos"],
  // Sin significado confirmado todavía: con su nombre original.
  cacoct: ["cacoct", "texto"],
  vacopt: ["vacopt", "texto"],
  vatrct: ["vatrct", "texto"],
  vatrpt: ["vatrpt", "texto"],
  rppc_folio_real: ["Folio real (Registro Público)", "texto"],
  rppc_tipo: ["Tipo (Registro Público)", "texto"],
  rppc_estatus: ["Estatus (Registro Público)", "texto"],
  rppc_area_terreno: ["Terreno (Registro Público)", "m2"],
  rppc_ubicacion: ["Ubicación (Registro Público)", "texto"],
  rppc_lote: ["Lote (Registro Público)", "texto"],
  rppc_nom_col_bar_otro: ["Colonia o barrio (Registro Público)", "texto"],
  rppc_medidas: ["Medidas (Registro Público)", "texto"],
  rppc_medid_colind: ["Medidas y colindancias (Registro Público)", "texto"],
  capa_folio: ["Folio (mapa)", "texto"],
  capa_no_oficial: ["Número oficial (mapa)", "texto"],
  capa_localidad: ["Localidad (mapa)", "texto"],
  capa_curt: ["CURT", "texto"],
  capa_area: ["Área del polígono", "m2"],
  capa_perimetro: ["Perímetro del polígono", "texto"],
  capa_coor_x: ["Coordenada X (mapa)", "texto"],
  capa_coor_y: ["Coordenada Y (mapa)", "texto"],
};

const n2 = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** El valor listo para leerse; nulo si no hay. Las tablas, como renglones "a · b · c". */
export function valorLegible(campo: string, valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const formato = ETIQUETAS[campo as Campo]?.[1] ?? "texto";
  if (Array.isArray(valor)) {
    return valor.map((fila) => (fila && typeof fila === "object" ? Object.entries(fila).map(([k, v]) => `${k} ${v}`).join(" · ") : String(fila))).join("\n");
  }
  const n = typeof valor === "number" ? valor : Number(valor);
  if (formato === "m2" && Number.isFinite(n)) return `${n2(n)} m²`;
  if (formato === "pesos" && Number.isFinite(n)) return n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  if (formato === "pct" && Number.isFinite(n)) return `${n.toLocaleString("es-MX", { maximumFractionDigits: 6 })} %`;
  return String(valor);
}

/** Orden en que se muestran: el del catálogo. */
export function camposEnOrden(campos: Record<string, unknown>): [string, string, string][] {
  return (Object.keys(ETIQUETAS) as Campo[])
    .map((c) => [c, ETIQUETAS[c][0], valorLegible(c, campos[c])] as const)
    .filter((x): x is [Campo, string, string] => x[2] !== null);
}

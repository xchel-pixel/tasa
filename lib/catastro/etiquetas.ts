import { municipioPorClave } from "@/lib/traslado/calculo";
import type { Campo } from "./limpiar";
import type { Ficha } from "./servicio";

/**
 * Cómo se llama, cómo se escribe y en qué sección va cada campo de la ficha. Sin directiva: lo usan la pantalla,
 * el PDF y Catálogos, así las tres dicen lo mismo en el mismo orden. Las secciones solo agrupan: qué campo se ve lo
 * decide la configuración de visibilidad en la base (catastro_ficha / catastro_pdf).
 */

type Formato = "texto" | "m2" | "pesos" | "pct" | "fecha" | "lineas" | "tabla";

export const ETIQUETAS: Record<Campo, [string, Formato]> = {
  colonia: ["Colonia", "texto"],
  codigo_postal: ["Código postal", "texto"],
  ubicacion: ["Dirección", "texto"],
  sup_terreno: ["Terreno", "m2"],
  sup_construccion: ["Construcción total", "m2"],
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
  fecha_alta: ["Alta en catastro", "fecha"],
  fecha_mantenimiento: ["Última actualización en catastro", "fecha"],
  movimientos: ["Movimientos", "tabla"],
  superficie: ["Superficie del expediente", "m2"],
  tipos_construccion: ["Tipos de construcción", "texto"],
  series_valor: ["Series de valor", "tabla"],
  codigo_valor: ["Código de valor", "texto"],
  fecha_validez: ["Vigencia", "fecha"],
  valor_terreno: ["Terreno", "pesos"],
  valor_construccion: ["Construcción", "pesos"],
  valor_catastral_total: ["Total", "pesos"],
  valor_terreno_anterior: ["Terreno (valor anterior)", "pesos"],
  valor_construccion_anterior: ["Construcción (valor anterior)", "pesos"],
  regimen: ["Régimen", "texto"],
  tipo_condominio: ["Tipo de condominio", "texto"],
  nombre_condominio: ["Condominio", "texto"],
  indiviso: ["Indiviso", "pct"],
  sup_terreno_privativa: ["Terreno privativo", "m2"],
  sup_terreno_comun: ["Terreno común", "m2"],
  sup_construccion_privativa: ["Construcción privativa", "m2"],
  sup_construccion_comun: ["Construcción común", "m2"],
  valor_terreno_privativo: ["Terreno privativo", "pesos"],
  valor_terreno_comun: ["Terreno común", "pesos"],
  valor_construccion_privativa: ["Construcción privativa", "pesos"],
  valor_construccion_comun: ["Construcción común", "pesos"],
  // Datos del condominio que la fuente trae sin descripción; se etiquetan cuando se confirme qué son.
  cacoct: ["Dato del condominio 1", "texto"],
  vacopt: ["Dato del condominio 2", "texto"],
  vatrct: ["Dato del condominio 3", "texto"],
  vatrpt: ["Dato del condominio 4", "texto"],
  rppc_folio_real: ["Folio real (Registro Público)", "texto"],
  rppc_tipo: ["Tipo (Registro Público)", "texto"],
  rppc_estatus: ["Estatus (Registro Público)", "texto"],
  rppc_area_terreno: ["Terreno (Registro Público)", "m2"],
  rppc_ubicacion: ["Ubicación (Registro Público)", "texto"],
  rppc_lote: ["Lote", "texto"],
  rppc_nom_col_bar_otro: ["Colonia o barrio (Registro Público)", "texto"],
  rppc_medidas: ["Medidas", "lineas"],
  rppc_medid_colind: ["Medidas y colindancias", "lineas"],
  capa_folio: ["Folio del plano", "texto"],
  capa_no_oficial: ["Número oficial", "texto"],
  capa_localidad: ["Clave de localidad", "texto"],
  capa_curt: ["CURT", "texto"],
  capa_area: ["Área del polígono (aprox.)", "m2"],
  capa_perimetro: ["Perímetro del polígono (aprox.)", "texto"],
  capa_coor_x: ["Coordenada X", "texto"],
  capa_coor_y: ["Coordenada Y", "texto"],
};

/** Las columnas de las tablas (series de valor, movimientos), en español. */
const COLUMNAS: Record<string, string> = {
  nivel: "Nivel", tipo: "Tipo", serie: "Serie", area: "Área", areaCons: "Construcción", areaT: "Terreno", factor: "Factor",
  clave: "Clave", descripcion: "Descripción",
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** dd/mmm/aaaa (06/nov/2026). Acepta AAAA-MM-DD (con hora o sin ella) y DD/MM/AAAA; lo demás (p. ej. "2026") tal cual. */
export function fechaLegible(texto: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) {
    // Con hora: la fecha en México.
    if (texto.length > 10) {
      const d = new Date(texto);
      if (!Number.isNaN(d.getTime())) {
        const [a, m, dia] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d).split("-");
        return `${dia}/${MESES[Number(m) - 1]}/${a}`;
      }
    }
    return `${iso[3]}/${MESES[Number(iso[2]) - 1] ?? iso[2]}/${iso[1]}`;
  }
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto.trim());
  if (dmy) return `${dmy[1].padStart(2, "0")}/${MESES[Number(dmy[2]) - 1] ?? dmy[2]}/${dmy[3]}`;
  return texto;
}

/** Medidas y colindancias: una línea por lado ("Al norte…", "Al sur…"), aunque vengan en un solo renglón. */
export function lineasDeColindancias(texto: string): string[] {
  return texto
    .split(/\n|;|(?=\b(?:AL|al|Al)\s+(?:NOR|SUR|ORIENTE|PONIENTE|ESTE|OESTE|NORTE|nor|sur|oriente|poniente|norte|este|oeste|Nor|Sur|Oriente|Poniente|Norte|Este|Oeste))/)
    .map((l) => l.trim().replace(/[,.]$/, ""))
    .filter(Boolean);
}

const n2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** El valor listo para leerse; nulo si no hay. */
export function valorLegible(campo: string, valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const formato = ETIQUETAS[campo as Campo]?.[1] ?? "texto";
  if (Array.isArray(valor)) {
    if (!valor.length) return null;
    return valor.map((fila) => (fila && typeof fila === "object"
      ? Object.entries(fila).map(([k, v]) => `${COLUMNAS[k] ?? k} ${v}`).join(" · ") : String(fila))).join("\n");
  }
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(/,/g, ""));
  if (formato === "m2" && Number.isFinite(n)) return `${n2(n)} m²`;
  if (formato === "pesos" && Number.isFinite(n)) return `$${n2(n)}`;
  if (formato === "pct" && Number.isFinite(n)) return `${n.toLocaleString("en-US", { maximumFractionDigits: 6 })} %`;
  if (formato === "fecha") return fechaLegible(String(valor));
  if (formato === "lineas") return lineasDeColindancias(String(valor)).join("\n");
  // La fuente pone "--" donde no hay dato (p. ej. "CP --"): no se muestra.
  return String(valor).replace(/,?\s*CP\s*-+(?=,|$)/g, "").replace(/^\s*-+\s*$/, "").trim() || null;
}

export type IdSeccion = "identificacion" | "ubicacion" | "superficies" | "valores" | "medidas" | "registro" | "propietario" | "historial";

/** Las secciones de la ficha, en orden. `equipo`: se ve plegada por omisión (solo la ve quien tiene esos campos). */
export const SECCIONES: { id: IdSeccion; titulo: string; equipo: boolean; campos: Campo[] }[] = [
  { id: "identificacion", titulo: "Identificación", equipo: false, campos: [] },
  { id: "ubicacion", titulo: "Ubicación", equipo: false, campos: ["ubicacion"] },
  { id: "superficies", titulo: "Superficies", equipo: false,
    campos: ["sup_terreno", "sup_construccion", "sup_terreno_privativa", "sup_terreno_comun", "sup_construccion_privativa",
             "sup_construccion_comun", "indiviso", "capa_area"] },
  { id: "valores", titulo: "Valores catastrales", equipo: false,
    campos: ["valor_terreno", "valor_construccion", "valor_catastral_total", "fecha_validez", "codigo_valor", "valor_terreno_privativo",
             "valor_terreno_comun", "valor_construccion_privativa", "valor_construccion_comun", "valor_terreno_anterior",
             "valor_construccion_anterior"] },
  { id: "medidas", titulo: "Medidas y colindancias", equipo: false, campos: ["rppc_medid_colind", "rppc_medidas"] },
  { id: "registro", titulo: "Datos del registro", equipo: true,
    campos: ["folio_real", "uso", "clasificacion", "clave_anterior", "clave_estandar", "clave_original", "tipo_predio", "estatus",
             "regimen", "tipo_condominio", "nombre_condominio", "fecha_alta", "fecha_mantenimiento", "manzana", "localidad", "calle",
             "num_ext", "num_int", "colonia", "codigo_postal", "superficie", "tipos_construccion", "series_valor", "movimientos",
             "rppc_folio_real", "rppc_tipo", "rppc_estatus", "rppc_area_terreno", "rppc_ubicacion", "rppc_lote", "rppc_nom_col_bar_otro",
             "capa_folio", "capa_no_oficial", "capa_localidad", "capa_curt", "capa_perimetro", "capa_coor_x", "capa_coor_y",
             "cacoct", "vacopt", "vatrct", "vatrpt"] },
  { id: "propietario", titulo: "Propietario y operación", equipo: true, campos: [] },
  { id: "historial", titulo: "Historial de cambios", equipo: true, campos: [] },
];

export type SeccionLista = { id: IdSeccion; titulo: string; equipo: boolean; filas: [string, string][] };

/** Dirección armada con las piezas, cuando el rol no tiene la dirección completa pero sí sus partes. */
function direccionDePartes(c: Record<string, unknown>): string | null {
  const t = (k: string) => (typeof c[k] === "string" || typeof c[k] === "number" ? String(c[k]).trim() : "");
  const calle = [t("calle"), t("num_ext"), t("num_int") ? `int. ${t("num_int")}` : ""].filter(Boolean).join(" ");
  const partes = [calle, t("colonia"), t("codigo_postal") ? `CP ${t("codigo_postal")}` : ""].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

/**
 * La ficha por secciones, con sus filas ya escritas. Sin campos vacíos ni secciones vacías. Solo lo que trae la
 * ficha (que ya viene filtrada por rol desde la base).
 */
export function seccionesDeFicha(f: Ficha): SeccionLista[] {
  const c: Record<string, unknown> = { ...(f.campos ?? {}) };
  // Predios guardados antes de que existiera el total: si el rol ve terreno y construcción, el total es su suma.
  if (c.valor_catastral_total == null && c.valor_terreno != null && c.valor_construccion != null) {
    const total = Number(c.valor_terreno) + Number(c.valor_construccion);
    if (Number.isFinite(total)) c.valor_catastral_total = total;
  }
  const salida: SeccionLista[] = [];
  for (const s of SECCIONES) {
    let filas: [string, string][] = [];
    if (s.id === "identificacion") {
      filas = [["Clave catastral", f.clave], ["Municipio", municipioPorClave(f.clave) ?? f.municipio]];
    } else if (s.id === "ubicacion") {
      const dir = valorLegible("ubicacion", c.ubicacion) ?? direccionDePartes(c);
      if (dir) filas.push(["Dirección", dir]);
    } else if (s.id === "propietario") {
      const p = f.privados;
      if (p) {
        for (const pr of p.propietarios ?? []) {
          filas.push([pr.origen === "rppc" ? "Propietario (Registro Público)" : "Propietario",
            [pr.nombre, pr.porcentaje !== null && pr.porcentaje !== undefined ? `${pr.porcentaje} %` : null, pr.tipo_adquisicion].filter(Boolean).join(" · ")]);
        }
        const v = valorLegible("valor_terreno", p.valor_operacion);
        if (v) filas.push(["Valor de operación", v]);
        if (p.escritura) filas.push(["Escritura", p.escritura]);
        if (p.notario) filas.push(["Notario", p.notario]);
        if (p.numero_contrato) filas.push(["Contrato", p.numero_contrato]);
      }
    } else if (s.id === "historial") {
      for (const h of f.historial ?? []) {
        filas.push([fechaLegible(h.reemplazada_en), `Cambió: ${h.cambios.map((k) => ETIQUETAS[k as Campo]?.[0] ?? (k === "geometria" ? "Polígono" : k)).join(", ")}`]);
      }
    } else {
      for (const campo of s.campos) {
        const v = valorLegible(campo, c[campo]);
        if (v) filas.push([ETIQUETAS[campo][0], v]);
      }
    }
    if (filas.length) salida.push({ id: s.id, titulo: s.titulo, equipo: s.equipo, filas });
  }
  return salida;
}

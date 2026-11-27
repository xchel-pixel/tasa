import { municipioPorClave } from "@/lib/traslado/calculo";
import type { Campo } from "./limpiar";
import { superficieDelPoligono } from "./geo";
import { SIN_DATO } from "./textos";
import { ladosDelPoligono, leerColindancias, textoMedida, textoParaCopiar } from "./colindancias";
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
  sup_terreno: ["Superficie de terreno (catastro)", "m2"],
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
  // Solo para el equipo: la base no se la manda a otros roles (0068).
  rppc_area_terreno: ["Superficie (Registro Público)", "m2"],
  rppc_ubicacion: ["Ubicación (Registro Público)", "texto"],
  rppc_lote: ["Lote", "texto"],
  rppc_nom_col_bar_otro: ["Colonia o barrio (Registro Público)", "texto"],
  rppc_medidas: ["Medidas", "lineas"],
  rppc_medid_colind: ["Medidas y colindancias", "lineas"],
  capa_folio: ["Folio del plano", "texto"],
  capa_no_oficial: ["Número oficial", "texto"],
  capa_localidad: ["Clave de localidad", "texto"],
  capa_curt: ["CURT", "texto"],
  // La que reporta la capa del mapa; en Superficies va la que Tasa calcula del polígono.
  // Nombre neutro (nov-2026): lo ve también el comisionista si la organización se lo abre; no nombra la fuente.
  capa_area: ["Superficie según cartografía", "m2"],
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

/** Un valor unitario calculado: va justo después del valor del que sale (`tras`). `porM2` nulo = superficie en 0 o vacía ("—"). */
export type Unitario = { tras: Campo; etiqueta: string; porM2: number | null; /** Solo rústicos: valor ÷ hectáreas. */ porHa?: number | null };

/** "$1,234.56/m²", o "—" sin superficie. */
export const unitarioLegible = (u: Unitario) =>
  u.porM2 === null ? "—" : `$${n2(u.porM2)}/m²${u.porHa ? ` · $${n2(u.porHa)}/ha` : ""}`;

/**
 * Valores unitarios calculados (valor ÷ superficie). Solo con lo que trae la ficha (ya filtrada por rol): si el rol no
 * ve el valor o la superficie, no hay unitario. Nada se inventa:
 * · Predio normal: terreno (valor de terreno ÷ superficie de terreno) y construcción "promedio" (valor de construcción ÷
 *   superficie construida; puede mezclar varios tipos). Baldío (construcción en 0 o sin ella): sin unitario de construcción.
 * · Condominio (trae terreno privativo o indiviso): el de terreno PRIVATIVO (valor privativo ÷ superficie privativa) y el
 *   de construcción privativa. El "proporcional" (valor de terreno ÷ terreno privativo + común) solo si el valor de
 *   terreno es la suma de privativo y común: la fuente a veces trae solo el privativo, y dividirlo entre todo el
 *   terreno daría un unitario falso.
 * · Superficie en 0 o vacía con valor: "—" (no se divide).
 */
export function unitariosCatastrales(c: Record<string, unknown>, rustico = esRustico(c)): Unitario[] {
  const num = (k: string): number | null => {
    const v = c[k];
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replaceAll(",", ""));
    return Number.isFinite(n) ? n : null;
  };
  const dividir = (valor: number, sup: number | null) => (sup && sup > 0 ? Math.round((valor / sup) * 100) / 100 : null);
  const salida: Unitario[] = [];
  const vt = num("valor_terreno"), vc = num("valor_construccion");
  const st = num("sup_terreno"), sc = num("sup_construccion");
  const condominio = num("sup_terreno_privativa") !== null || num("indiviso") !== null || num("valor_terreno_privativo") !== null;

  if (!condominio) {
    // Rústico: también por hectárea (del valor, no del unitario por m² ya redondeado).
    const porHa = rustico && vt !== null ? { porHa: dividir(vt, st === null ? null : st / 10_000) } : {};
    if (vt !== null && vt > 0) salida.push({ tras: "valor_terreno", etiqueta: "Valor unitario de terreno", porM2: dividir(vt, st), ...porHa });
    if (vc !== null && vc > 0) salida.push({ tras: "valor_construccion", etiqueta: "Valor unitario de construcción (promedio)", porM2: dividir(vc, sc) });
    return salida;
  }
  const vtp = num("valor_terreno_privativo"), vtc = num("valor_terreno_comun"), stp = num("sup_terreno_privativa");
  const vcp = num("valor_construccion_privativa"), scp = num("sup_construccion_privativa");
  if (vt !== null && vt > 0 && vtp !== null && vtc !== null && Math.abs(vt - (vtp + vtc)) <= 1) {
    salida.push({ tras: "valor_terreno", etiqueta: "Valor unitario de terreno proporcional (privativo + común)", porM2: dividir(vt, st) });
  }
  if (vtp !== null && vtp > 0) {
    salida.push({ tras: "valor_terreno_privativo", etiqueta: "Valor unitario de terreno privativo", porM2: dividir(vtp, stp) });
  }
  if (vcp !== null && vcp > 0) {
    salida.push({ tras: "valor_construccion_privativa", etiqueta: "Valor unitario de construcción privativa (promedio)", porM2: dividir(vcp, scp) });
  }
  return salida;
}

/** m² → hectáreas con 4 decimales (1 m² = 0.0001 ha). */
const hectareas = (m2: number) => (m2 / 10_000).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** Predio rústico: se trabaja por hectárea. */
/** Predio rústico: se trabaja por hectárea. Con la ficha, también `ficha.rustico` (lo pone el servidor aunque el rol no
 *  vea el campo "Tipo de predio"). */
export const esRustico = (c: Record<string, unknown>, f?: { rustico?: boolean } | null) =>
  f?.rustico === true || String(c.tipo_predio ?? "").toUpperCase() === "RUSTICO";

/** Superficie de un rústico: hectáreas primero (4 decimales) y su equivalente en m². */
export const superficieRustica = (m2: number) => `${hectareas(m2)} ha (${n2(m2)} m²)`;

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

export type IdSeccion = "identificacion" | "ubicacion" | "superficies" | "valores" | "medidas" | "poligono" | "registro" | "propietario" | "historial";

/** Lados del polígono, compactos: etiquetas en orden, todas sin simplificar ("Ver todos los lados"), resumen y nota. */
export type LadosCompactos = { items: string[]; todos?: string[]; resumen: string; nota?: string | null };

/** Una tabla dentro de una sección (medidas y colindancias, lados del polígono). */
export type TablaFicha = {
  encabezados: string[]; filas: string[][]; nota?: string | null; pie?: string | null;
  /** Todas las filas sin simplificar (lados del polígono): la pantalla ofrece "Ver todos los lados"; el PDF no. */
  todas?: string[][];
};

/** Las secciones de la ficha, en orden. `equipo`: se ve plegada por omisión (solo la ve quien tiene esos campos). */
export const SECCIONES: { id: IdSeccion; titulo: string; equipo: boolean; campos: Campo[] }[] = [
  { id: "identificacion", titulo: "Identificación", equipo: false, campos: [] },
  { id: "ubicacion", titulo: "Ubicación", equipo: false, campos: ["ubicacion"] },
  { id: "superficies", titulo: "Superficies", equipo: false,
    campos: ["sup_terreno", "rppc_area_terreno", "capa_area", "sup_construccion", "sup_terreno_privativa", "sup_terreno_comun", "sup_construccion_privativa",
             "sup_construccion_comun", "indiviso"] },
  { id: "valores", titulo: "Valores catastrales", equipo: false,
    campos: ["valor_terreno", "valor_construccion", "valor_catastral_total", "fecha_validez", "codigo_valor", "valor_terreno_privativo",
             "valor_terreno_comun", "valor_construccion_privativa", "valor_construccion_comun", "valor_terreno_anterior",
             "valor_construccion_anterior"] },
  { id: "medidas", titulo: "Medidas y colindancias (Registro Público)", equipo: false, campos: ["rppc_medid_colind", "rppc_medidas"] },
  { id: "poligono", titulo: "Medidas del polígono (cartografía)", equipo: false, campos: [] },
  { id: "registro", titulo: "Datos del registro", equipo: true,
    campos: ["folio_real", "uso", "clasificacion", "clave_anterior", "clave_estandar", "clave_original", "tipo_predio", "estatus",
             "regimen", "tipo_condominio", "nombre_condominio", "fecha_alta", "fecha_mantenimiento", "manzana", "localidad", "calle",
             "num_ext", "num_int", "colonia", "codigo_postal", "superficie", "tipos_construccion", "series_valor", "movimientos",
             "rppc_folio_real", "rppc_tipo", "rppc_estatus", "rppc_ubicacion", "rppc_lote", "rppc_nom_col_bar_otro",
             "capa_folio", "capa_no_oficial", "capa_localidad", "capa_curt", "capa_perimetro", "capa_coor_x", "capa_coor_y",
             "cacoct", "vacopt", "vatrct", "vatrpt"] },
  { id: "propietario", titulo: "Propietario y operación", equipo: true, campos: [] },
  { id: "historial", titulo: "Historial de cambios", equipo: true, campos: [] },
];

export type SeccionLista = {
  id: IdSeccion; titulo: string; equipo: boolean; filas: [string, string][];
  tablas?: TablaFicha[];
  /** Medidas del polígono en formato compacto (etiquetas "N 20.10" en varias columnas). */
  compacto?: LadosCompactos;
  /** Texto plano para el botón "Copiar" (medidas y colindancias, valores). */
  copiar?: string;
  /** Índices de las filas calculadas por Tasa (valores unitarios): se marcan "calculado". */
  calculadas?: number[];
  /** Índices de las filas que se marcan en ámbar (p. ej. polígono y cartografía difieren más de 1 %). */
  alertas?: number[];
  /** Historial: cuántos ajustes del lector hay (se ocultan si no se pidió verlos). */
  ajustes?: number;
};

/**
 * ¿La ficha es de admin_org, finanzas o equipo? La base solo les manda el historial (catastro_veo_privados(), por rol);
 * a los demás, ni la llave.
 */
export function fichaDelEquipo(f: Pick<Ficha, "historial">): boolean {
  return Array.isArray(f.historial);
}

/** Diferencia del polígono contra la cartografía ("+1,234.56 m² (+2.10 %)", sobre la de cartografía); nula si es de 1 % o menos. */
export function diferenciaDeSuperficies(poligono: number, cartografia: number): string | null {
  const d = poligono - cartografia;
  const pct = (d / cartografia) * 100;
  if (!(Math.abs(pct) > 1)) return null;
  const signo = d > 0 ? "+" : "−";
  return `${signo}${n2(Math.abs(d))} m² (${signo}${Math.abs(pct).toFixed(2)} %)`;
}

/** Dirección armada con las piezas, cuando el rol no tiene la dirección completa pero sí sus partes. */
function direccionDePartes(c: Record<string, unknown>): string | null {
  const crudo = (k: string) => (typeof c[k] === "string" || typeof c[k] === "number" ? String(c[k]).trim() : "");
  // "Sin dato" (rústicos) no se mete a media dirección; si no hay nada más, la dirección es "Sin dato".
  const t = (k: string) => (crudo(k) === SIN_DATO ? "" : crudo(k));
  const calle = [t("calle"), t("num_ext"), t("num_int") ? `int. ${t("num_int")}` : ""].filter(Boolean).join(" ");
  const partes = [calle, t("colonia"), t("codigo_postal") ? `CP ${t("codigo_postal")}` : ""].filter(Boolean);
  if (partes.length) return partes.join(", ");
  return ["calle", "colonia", "codigo_postal"].some((k) => crudo(k) === SIN_DATO) ? SIN_DATO : null;
}

/**
 * La ficha por secciones, con sus filas ya escritas. Sin campos vacíos ni secciones vacías. Solo lo que trae la
 * ficha (que ya viene filtrada por rol desde la base).
 */
export function seccionesDeFicha(f: Ficha, { verAjustes = false }: { verAjustes?: boolean } = {}): SeccionLista[] {
  const c: Record<string, unknown> = { ...(f.campos ?? {}) };
  // Predios guardados antes de que existiera el total: si el rol ve terreno y construcción, el total es su suma.
  if (c.valor_catastral_total == null && c.valor_terreno != null && c.valor_construccion != null) {
    const total = Number(c.valor_terreno) + Number(c.valor_construccion);
    if (Number.isFinite(total)) c.valor_catastral_total = total;
  }
  const salida: SeccionLista[] = [];
  for (const s of SECCIONES) {
    let filas: [string, string][] = [];
    const tablas: TablaFicha[] = [];
    let compacto: LadosCompactos | undefined;
    let copiar: string | undefined;
    let titulo = s.titulo;
    let ajustes = 0;
    const calculadas: number[] = [];
    const alertas: number[] = [];
    if (s.id === "medidas") {
      // Tabla Orientación | Medida | Colinda con si se puede leer con seguridad; si no, el texto completo, un renglón por lado.
      const texto = (k: Campo) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
      const mc = texto("rppc_medid_colind");
      const m = texto("rppc_medidas");
      const principal = mc || m;
      if (principal) {
        const r = leerColindancias(principal);
        if (r.seguro) {
          tablas.push({ encabezados: ["Orientación", "Medida (m)", "Colinda con"], nota: r.nota,
            filas: r.filas.map((x) => [x.orientacion, textoMedida(x.medidas), x.colinda || "—"]) });
          copiar = textoParaCopiar(r);
        } else {
          filas.push([ETIQUETAS[mc ? "rppc_medid_colind" : "rppc_medidas"][0], lineasDeColindancias(principal).join("\n")]);
          // Sin ordenar: se copia el texto completo tal cual.
          copiar = principal;
        }
      }
      // Las "medidas" sueltas solo si dicen algo distinto de las medidas y colindancias.
      const igual = (a: string, b: string) => a.replaceAll(" ", "").toUpperCase() === b.replaceAll(" ", "").toUpperCase();
      if (mc && m && !igual(mc, m)) filas.push([ETIQUETAS.rppc_medidas[0], lineasDeColindancias(m).join("\n")]);
    } else if (s.id === "poligono") {
      // De la geometría (UTM de la fuente; si no hay, convertida y marcada aproximada). Solo para quien ve las medidas.
      const p = f.ve_medidas ? ladosDelPoligono(f.geometria, f.geometria_utm) : null;
      if (p) {
        if (p.aprox) titulo = `${s.titulo} (aprox.)`;
        // Compacto: una etiqueta "Rumbo largo" por lado, en orden, y una línea de resumen.
        const etiquetas = (l: typeof p.lados) => l.map((x) => `${x.orientacion} ${n2(x.largo)}`);
        const juntados = p.simplificados.length < p.lados.length;
        const perimetro = p.lados.reduce((a, x) => a + x.largo, 0);
        compacto = {
          items: etiquetas(p.simplificados),
          ...(juntados ? { todos: etiquetas(p.lados), nota: `${p.lados.length} lados originales; el DXF conserva la geometría exacta.` } : {}),
          resumen: [p.superficie ? `Superficie ${n2(p.superficie)} m²` : null, `Perímetro ${n2(perimetro)} m`, `${p.simplificados.length} lados`]
            .filter(Boolean).join(" · "),
        };
      }
    } else if (s.id === "identificacion") {
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
      // Los ajustes del lector (0067) no son cambios de la fuente: ocultos salvo que se pidan.
      for (const h of f.historial ?? []) {
        const ajuste = h.tipo === "ajuste_lector";
        if (ajuste) ajustes += 1;
        if (ajuste && !verAjustes) continue;
        const campos = h.cambios.map((k) => ETIQUETAS[k as Campo]?.[0] ?? (k === "geometria" ? "Polígono" : k)).join(", ");
        filas.push([fechaLegible(h.reemplazada_en), ajuste ? `Ajuste de lector (sin cambio en la fuente): ${campos}` : `Cambió: ${campos}`]);
      }
    } else {
      for (const campo of s.campos) {
        const m2 = campo === "sup_terreno" && esRustico(c, f) ? Number(c[campo]) : NaN;
        const v = Number.isFinite(m2) && m2 > 0 ? superficieRustica(m2) : valorLegible(campo, c[campo]);
        if (v) filas.push([ETIQUETAS[campo][0], v]);
      }
      // La del polígono, después de la de catastro: exacta con la geometría UTM; "aprox." si salió de los grados.
      // Valores unitarios calculados, cada uno junto al valor del que sale; se copian con la sección.
      if (s.id === "valores" && filas.length) {
        for (const u of unitariosCatastrales(c, esRustico(c, f))) {
          const i = filas.findIndex(([e]) => e === ETIQUETAS[u.tras][0]);
          if (i < 0) continue;
          let tras = i + 1;
          while (calculadas.includes(tras)) tras++;
          filas.splice(tras, 0, [u.etiqueta, unitarioLegible(u)]);
          for (let k = 0; k < calculadas.length; k++) if (calculadas[k] >= tras) calculadas[k]++;
          calculadas.push(tras);
        }
        copiar = filas.map(([e, v], k) => `${e}: ${v}${calculadas.includes(k) ? " (calculado)" : ""}`).join("\n");
      }
      const p = s.id === "superficies" ? superficieDelPoligono(f.geometria, f.geometria_utm) : null;
      const carto = Number(c.capa_area);
      const hayCarto = c.capa_area != null && Number.isFinite(carto) && carto > 0;
      // Fuera del equipo, con "Superficie según cartografía" basta: la del polígono sería un duplicado.
      if (p && p.m2 > 0 && (fichaDelEquipo(f) || !hayCarto)) {
        const tras = filas.findIndex(([e]) => e === ETIQUETAS.sup_terreno[0]) + 1;
        filas.splice(tras, 0, [p.aprox ? "Superficie del polígono (aprox.)" : "Superficie del polígono", `${n2(p.m2)} m²`]);
        // Equipo: si las dos difieren más de 1 %, una fila en ámbar con la diferencia, tras la de cartografía.
        const d = hayCarto ? diferenciaDeSuperficies(p.m2, carto) : null;
        if (d) {
          const i = filas.findIndex(([e]) => e === ETIQUETAS.capa_area[0]) + 1;
          filas.splice(i, 0, ["Diferencia polígono vs. cartografía", d]);
          alertas.push(i);
        }
      }
    }
    if (filas.length || tablas.length || compacto || ajustes) {
      salida.push({ id: s.id, titulo, equipo: s.equipo, filas, ...(tablas.length ? { tablas } : {}), ...(compacto ? { compacto } : {}),
        ...(copiar ? { copiar } : {}), ...(calculadas.length ? { calculadas } : {}), ...(alertas.length ? { alertas } : {}),
        ...(s.id === "historial" ? { ajustes } : {}) });
    }
  }
  return salida;
}

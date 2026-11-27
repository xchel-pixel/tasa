import { avisarSiBloqueo } from "./aviso-fuente";
import { aUtm, contiene, geometriaValida } from "./geo";
import { capaPorId } from "./capas";

/**
 * La parcela ejidal en un punto (capa de ejidos, solo para el equipo). LISTA BLANCA: de lo que trae la fuente solo
 * pasan ejido, número de parcela y superficie. Lo demás —fecha de nacimiento del ejidatario (FNACIM), folio de su
 * certificado (NFOLIODER) y cualquier otro campo— se descarta aquí mismo: no llega al navegador, no se guarda en la
 * base y no se escribe en registros. La fuente no trae el nombre del ejidatario.
 * Se consulta en el momento, sin caché.
 */

const BASE = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms";
const LIMITE_MS = 12_000;

export type Parcela = {
  ejido: string | null;
  /** Número de parcela; nulo si la fuente no trae una (tierra de uso común, zona urbana del ejido). */
  parcela: number | null;
  /** En m² (de hectáreas-áreas-centiáreas; si vienen en cero, del polígono). */
  superficie_m2: number | null;
};

const CAMPOS_PARCELA = ["ejido", "parcela", "superficie_m2"] as const;

export function urlParcela(lat: number, lon: number): string {
  const capas = capaPorId("ejidos")!.fuente;
  const [x, y] = aUtm(lat, lon);
  const bbox = [x - 5, y - 5, x + 5, y + 5].map((v) => v.toFixed(2)).join(",");
  return `${BASE}?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=${capas}&query_layers=${capas}`
    + `&srs=EPSG:32614&bbox=${bbox}&width=101&height=101&x=50&y=50&info_format=application/json&feature_count=5`;
}

const numero = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Las propiedades de la fuente → solo los tres datos de la parcela. */
export function datosDeParcela(propiedades: unknown): Parcela {
  const p = propiedades && typeof propiedades === "object" ? (propiedades as Record<string, unknown>) : {};
  const ejido = typeof p.NOM_EJI === "string" && p.NOM_EJI.trim() ? p.NOM_EJI.trim().slice(0, 120) : null;
  // CVE_PARC: estado (2) + municipio (3) + ejido (4) + parcela (5). "22014001000089" → parcela 89.
  const cve = typeof p.CVE_PARC === "string" && /^[0-9]{14}$/.test(p.CVE_PARC) ? Number(p.CVE_PARC.slice(9)) : 0;
  const [ha, a, ca] = [numero(p.AREA1) ?? 0, numero(p.AREA2) ?? 0, numero(p.AREA3) ?? 0];
  const deTitulo = ha * 10_000 + a * 100 + ca;
  const delPoligono = numero(p.SHAPE_AREA);
  const sup = deTitulo > 0 ? deTitulo : delPoligono;
  const salida: Parcela = { ejido, parcela: cve > 0 ? cve : null, superficie_m2: sup === null ? null : Math.round(sup * 100) / 100 };
  // Cinturón y tirantes: exactamente estas llaves, nada más.
  return Object.fromEntries(CAMPOS_PARCELA.map((k) => [k, salida[k]])) as Parcela;
}

export type RespuestaParcela = { ok: true; parcela: Parcela | null } | { ok: false };

export async function consultarParcela(lat: number, lon: number): Promise<RespuestaParcela> {
  const [x, y] = aUtm(lat, lon);
  try {
    const r = await fetch(urlParcela(lat, lon), { cache: "no-store", signal: AbortSignal.timeout(LIMITE_MS) });
    if (!r.ok) {
      await avisarSiBloqueo("parcela", r.status);
      throw new Error(`HTTP${r.status}`);
    }
    const j = (await r.json()) as { features?: { id?: unknown; geometry?: unknown; properties?: unknown }[] };
    const delEjido = (j.features ?? []).filter((f) => /^RAN_M(0[1-9]|1[0-8])[.]/.test(String(f.id ?? "")));
    const elegida = delEjido.find((f) => { const g = geometriaValida(f.geometry); return g && contiene(g, [x, y]); });
    return { ok: true, parcela: elegida ? datosDeParcela(elegida.properties) : null };
  } catch (e) {
    console.warn(`Parcela ejidal: ${e instanceof Error ? e.name : "error"}`);
    return { ok: false };
  }
}

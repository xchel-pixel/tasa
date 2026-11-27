"use client";

import type { GeoJSONSource, Map as MapaGL, MapMouseEvent } from "maplibre-gl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { aLonLat, aUtm } from "@/lib/catastro/geo";

/**
 * Descarga por zona (0098): dos toques en el mapa marcan las esquinas de un rectángulo (alineado a la cuadrícula UTM:
 * lo que se ve es lo que se pide). Mientras se dibuja, el área en hectáreas; si pasa de 25 ha (500 m por lado), aviso
 * y el botón no se activa. El servidor lo vuelve a revisar todo.
 */

export type EstadoZona = { puede: boolean; hoy_persona: number; hoy_org: number; tope_persona: number; tope_org: number; costo_dxf: number };

const LADO_MAX = 500;
const vacio = { type: "FeatureCollection" as const, features: [] };
type Rect = { x0: number; y0: number; x1: number; y1: number };

function rectDe(a: { lng: number; lat: number }, b: { lng: number; lat: number }): Rect {
  const [xa, ya] = aUtm(a.lat, a.lng), [xb, yb] = aUtm(b.lat, b.lng);
  return { x0: Math.min(xa, xb), y0: Math.min(ya, yb), x1: Math.max(xa, xb), y1: Math.max(ya, yb) };
}

function poligono(r: Rect) {
  const anillo = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0]].map(([x, y]) => aLonLat(x, y));
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [anillo] } };
}

const m2 = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 0 });

export function DescargaZona({ mapa, listo, alDibujar, estado, sinLimite, saldo, color }: {
  mapa: RefObject<MapaGL | null>; listo: boolean;
  /** Mientras se dibuja, el toque del mapa no consulta predios. */
  alDibujar: (si: boolean) => void;
  estado: EstadoZona; sinLimite: boolean; saldo: number | null; color: string;
}) {
  const router = useRouter();
  const [activo, setActivo] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cerrado, setCerrado] = useState(false);
  const [bajando, setBajando] = useState(false);
  const [aviso, setAviso] = useState<{ error: boolean; texto: string } | null>(null);
  const esquina = useRef<{ lng: number; lat: number } | null>(null);

  // La capa del rectángulo, una vez que el mapa está listo.
  useEffect(() => {
    const m = mapa.current;
    if (!listo || !m || m.getSource("zona")) return;
    m.addSource("zona", { type: "geojson", data: vacio });
    m.addLayer({ id: "zona-relleno", type: "fill", source: "zona", paint: { "fill-color": color, "fill-opacity": 0.12 } });
    m.addLayer({ id: "zona-borde", type: "line", source: "zona", paint: { "line-color": color, "line-width": 2, "line-dasharray": [2, 1] } });
  }, [listo, mapa, color]);

  // Dos toques: esquina y esquina opuesta. El rectángulo se ve mientras se mueve el ratón.
  useEffect(() => {
    const m = mapa.current;
    if (!activo || !m) return;
    const pintar = (r: Rect | null) => (m.getSource("zona") as GeoJSONSource | undefined)?.setData(r ? poligono(r) : vacio);
    const alTocar = (e: MapMouseEvent) => {
      if (!esquina.current || cerrado) {
        esquina.current = e.lngLat;
        setCerrado(false);
        setRect(null);
        pintar(null);
        return;
      }
      const r = rectDe(esquina.current, e.lngLat);
      setRect(r);
      setCerrado(true);
      esquina.current = null;
      pintar(r);
    };
    const alMover = (e: MapMouseEvent) => {
      if (!esquina.current) return;
      const r = rectDe(esquina.current, e.lngLat);
      setRect(r);
      pintar(r);
    };
    m.on("click", alTocar);
    m.on("mousemove", alMover);
    return () => {
      m.off("click", alTocar);
      m.off("mousemove", alMover);
    };
  }, [activo, cerrado, mapa]);

  function empezar() {
    alDibujar(true);
    esquina.current = null;
    setActivo(true);
    setCerrado(false);
    setRect(null);
    setAviso(null);
    (mapa.current?.getSource("zona") as GeoJSONSource | undefined)?.setData(vacio);
  }

  function terminar() {
    alDibujar(false);
    esquina.current = null;
    setActivo(false);
    setCerrado(false);
    setRect(null);
    (mapa.current?.getSource("zona") as GeoJSONSource | undefined)?.setData(vacio);
  }

  const ancho = rect ? rect.x1 - rect.x0 : 0, alto = rect ? rect.y1 - rect.y0 : 0;
  const ha = (ancho * alto) / 10000;
  const excede = ancho > LADO_MAX || alto > LADO_MAX;
  const chica = Boolean(rect) && (ancho < 5 || alto < 5);
  const topePersona = estado.hoy_persona >= estado.tope_persona, topeOrg = estado.hoy_org >= estado.tope_org;
  const sinSaldo = !sinLimite && (saldo ?? 0) < estado.costo_dxf;

  async function bajar() {
    if (!rect) return;
    setBajando(true);
    setAviso(null);
    try {
      const q = new URLSearchParams({ x0: rect.x0.toFixed(2), y0: rect.y0.toFixed(2), x1: rect.x1.toFixed(2), y1: rect.y1.toFixed(2) });
      const r = await fetch(`/mapa-catastral/zona?${q}`);
      if (!r.ok) {
        setAviso({ error: true, texto: (await r.text()).trim() || "No se pudo bajar la zona." });
        router.refresh();
        return;
      }
      const nombre = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") ?? "")?.[1] ?? "zona.dxf";
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      const datos = Object.fromEntries((r.headers.get("X-Zona") ?? "").split(";").map((p) => p.split(":")));
      const rotos = datos.rotos ? ` Sin construcciones de los municipios ${datos.rotos.split(",").join(", ")}: su capa falla en la cartografía.` : "";
      const lineas = r.headers.get("X-Zona-Lineas");
      setAviso({ error: false, texto: `Zona bajada: ${datos.predios ?? 0} predios y ${datos.construcciones ?? 0} construcciones.${lineas ? ` ${decodeURIComponent(lineas)}.` : ""}${rotos}` });
      terminar();
      router.refresh();
    } catch {
      setAviso({ error: true, texto: "No se pudo bajar la zona. Revisa tu conexión e intenta de nuevo." });
    } finally {
      setBajando(false);
    }
  }

  return (
    <section aria-label="Descarga por zona" className="mt-1 rounded-lg border border-linea bg-fondo px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.9375rem] font-semibold">DXF por zona</span>
        <span className="text-[0.8125rem] text-secundario">
          Hoy: {estado.hoy_persona} de {estado.tope_persona} tuyas · {estado.hoy_org} de {estado.tope_org} de la organización
          {sinLimite ? "" : ` · cuesta ${estado.costo_dxf} DXF`}
        </span>
      </div>
      {!activo ? (
        <button type="button" onClick={empezar} disabled={topePersona || topeOrg || sinSaldo}
          className="toque mt-1 text-[0.9375rem] font-semibold text-acento underline underline-offset-4 disabled:text-secundario disabled:no-underline">
          Dibujar zona
        </button>
      ) : (
        <div className="mt-1 flex flex-col gap-2">
          <p className="text-[0.875rem] text-secundario">
            {!rect ? "Toca una esquina de la zona en el mapa." : cerrado ? "Zona lista. Tócala otra vez en el mapa para empezar de nuevo." : "Toca la esquina opuesta."}
          </p>
          {rect ? (
            <p className={`text-[0.9375rem] ${excede ? "font-semibold text-error" : ""}`} role="status">
              {ha.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha · {m2(ancho)} × {m2(alto)} m
            </p>
          ) : null}
          {excede ? (
            <p className="rounded bg-error-fondo px-3 py-2 text-[0.875rem] text-error">
              Pasa del máximo: hasta 25 ha, con cada lado de hasta 500 m. Dibuja una zona más chica.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={bajar} disabled={!cerrado || excede || chica || bajando}
              className="min-h-11 rounded-lg bg-primario px-4 font-semibold text-sobre-primario disabled:opacity-50">
              {bajando ? "Bajando zona… (unos segundos)" : "Descargar zona"}
            </button>
            <button type="button" onClick={terminar} disabled={bajando} className="min-h-11 rounded-lg border border-borde-campo px-4 font-semibold">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {topePersona || topeOrg ? (
        <p className="mt-1 text-[0.8125rem] text-secundario">{topePersona ? "Llegaste a tus 5 zonas de hoy." : "La organización llegó a sus 20 zonas de hoy."} Mañana se reinicia.</p>
      ) : sinSaldo ? <p className="mt-1 text-[0.8125rem] text-secundario">Una zona cuesta {estado.costo_dxf} DXF y te quedan {saldo ?? 0}.</p> : null}
      {aviso ? (
        <p role="status" className={`mt-2 rounded px-3 py-2 text-[0.875rem] ${aviso.error ? "bg-error-fondo text-error" : "bg-tinte"}`}>{aviso.texto}</p>
      ) : null}
    </section>
  );
}

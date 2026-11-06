"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import type { Map as MapaGL, GeoJSONSource, Marker } from "maplibre-gl";
import { useEffect, useRef, useState, useTransition } from "react";
import { camposEnOrden, valorLegible } from "@/lib/catastro/etiquetas";
import { caja, ligaMaps, ligaVisor, type Geometria } from "@/lib/catastro/geo";
import { NOTA_FUENTE } from "@/lib/catastro/textos";
import type { Ficha, Resultado } from "@/lib/catastro/servicio";
import { municipioPorClave } from "@/lib/traslado/calculo";
import { buscarClave, picarMapa } from "./acciones";

const CENTRO: [number, number] = [-100.3899, 20.5888]; // Querétaro
const ZOOM_PREDIOS = 17;
const CAPAS = Array.from({ length: 18 }, (_, i) => `queretaro:M${String(i + 1).padStart(2, "0")}_PA`).join(",");
const WMS = "https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms?service=WMS&version=1.1.1&request=GetMap"
  + `&layers=${CAPAS}&styles=&format=image/png&transparent=true&srs=EPSG:3857&bbox={bbox-epsg-3857}&width=512&height=512`;
const ENTRADA = "w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const BOTON = "flex min-h-11 items-center justify-center rounded-lg border border-linea bg-fondo px-3 text-center text-[0.9375rem] font-semibold";

/** Un color del tema (globals.css), para pintar el polígono con la paleta y no con un hex suelto. */
function token(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || "currentColor";
}

const vacio = { type: "FeatureCollection" as const, features: [] };

export function MapaCatastral({ token: tokenMapbox, claveInicial, puedeCotizar, calculadora, veVisor }: {
  token: string; claveInicial: string | null; puedeCotizar: boolean; calculadora: boolean;
  /** El visor de la fuente: solo admin_org, finanzas y equipo. */
  veVisor: boolean;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaGL | null>(null);
  const marcador = useRef<Marker | null>(null);
  const [listo, setListo] = useState(false);
  const [zoom, setZoom] = useState(13);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clave, setClave] = useState(claveInicial ?? "");
  const [ocupado, empezar] = useTransition();

  function pintar(g: Geometria | null | undefined, centrar: boolean, punto?: { lat: number; lon: number } | null) {
    const m = mapa.current;
    if (!m) return;
    (m.getSource("seleccion") as GeoJSONSource | undefined)?.setData(g ? { type: "Feature", geometry: g, properties: {} } : vacio);
    if (!centrar) return;
    if (g) {
      // Que el predio quepa entero, con aire alrededor (y sin pasar del zoom útil).
      const [lat0, lat1, lon0, lon1] = caja(g);
      m.fitBounds([[lon0, lat0], [lon1, lat1]], { padding: 60, maxZoom: 19, duration: 800 });
    } else if (punto) {
      m.flyTo({ center: [punto.lon, punto.lat], zoom: 18 });
    }
  }

  function mostrar(r: Resultado, centrar: boolean) {
    if (r.ok) {
      setFicha(r.ficha);
      setAviso(r.aviso);
      setError(null);
      setClave(r.ficha.clave);
      pintar(r.ficha.geometria, centrar, r.ficha.latitud && r.ficha.longitud ? { lat: Number(r.ficha.latitud), lon: Number(r.ficha.longitud) } : null);
    } else {
      setFicha(null);
      setAviso(null);
      setError(r.error);
      pintar(r.geometria ?? null, false);
    }
  }

  const buscar = (forzar: boolean, texto = clave) =>
    empezar(async () => mostrar(await buscarClave(texto, forzar), true));

  useEffect(() => {
    let vivo = true;
    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (!vivo || !contenedor.current) return;
      const m = new maplibregl.Map({
        container: contenedor.current,
        center: CENTRO,
        zoom: 13,
        maxZoom: 21,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            satelite: {
              type: "raster",
              tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${tokenMapbox}`],
              tileSize: 512,
              maxzoom: 19,
              attribution: "© Mapbox © Maxar",
            },
            // La capa de predios de la fuente, directo del navegador y solo a nivel de calle (no cargar su servidor).
            // Sin atribución con su nombre: el comisionista no ve de dónde viene.
            predios: { type: "raster", tiles: [WMS], tileSize: 512, minzoom: ZOOM_PREDIOS, maxzoom: 20 },
            seleccion: { type: "geojson", data: vacio },
          },
          layers: [
            // Sin fundido: cada mosaico se ve en cuanto llega (la capa de predios tarda el doble que el satélite).
            { id: "satelite", type: "raster", source: "satelite", paint: { "raster-fade-duration": 0 } },
            { id: "predios", type: "raster", source: "predios", minzoom: ZOOM_PREDIOS, paint: { "raster-fade-duration": 0 } },
            { id: "seleccion-relleno", type: "fill", source: "seleccion", paint: { "fill-color": token("--acento"), "fill-opacity": 0.25 } },
            { id: "seleccion-borde", type: "line", source: "seleccion", paint: { "line-color": token("--acento"), "line-width": 3 } },
          ],
        },
      });
      m.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      m.on("zoomend", () => setZoom(m.getZoom()));
      m.on("click", (e) => {
        if (m.getZoom() < 16) {
          m.flyTo({ center: e.lngLat, zoom: 18 });
          return;
        }
        const { lat, lng } = e.lngLat;
        empezar(async () => mostrar(await picarMapa(lat, lng), false));
      });
      m.on("load", () => {
        mapa.current = m;
        setListo(true);
      });
      marcador.current = new maplibregl.Marker({ color: token("--primario") });
    })();
    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
    };
    // El mapa se crea una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?clave= en la liga: se busca al abrir.
  const yaBuscada = useRef(false);
  useEffect(() => {
    if (listo && claveInicial && !yaBuscada.current) {
      yaBuscada.current = true;
      buscar(false, claveInicial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo, claveInicial]);

  function miUbicacion() {
    if (!navigator.geolocation) {
      setError("Este navegador no da la ubicación.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const centro: [number, number] = [p.coords.longitude, p.coords.latitude];
        if (mapa.current && marcador.current) marcador.current.setLngLat(centro).addTo(mapa.current);
        mapa.current?.flyTo({ center: centro, zoom: 18 });
      },
      () => setError("No se pudo leer tu ubicación. Revisa el permiso de ubicación del navegador."),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  const punto = ficha?.latitud && ficha.longitud ? { lat: Number(ficha.latitud), lon: Number(ficha.longitud) } : null;
  const municipio = ficha ? municipioPorClave(ficha.clave) ?? ficha.municipio : null;
  const textoCompartir = ficha
    ? [`Predio con clave catastral ${ficha.clave}`, municipio ? `Municipio: ${municipio}` : null,
       typeof ficha.campos.ubicacion === "string" ? `Dirección: ${ficha.campos.ubicacion}` : null,
       punto ? `Ubicación: ${ligaMaps(punto.lat, punto.lon)}` : null, "Información de fuente pública externa, sin validez oficial."].filter(Boolean).join("\n")
    : "";
  const ubicacionTexto = typeof ficha?.campos.ubicacion === "string" ? ficha.campos.ubicacion : "";
  // Valor catastral total para la calculadora (si el rol lo ve).
  const valorTotal = ficha ? Number(ficha.campos.valor_catastral_total ?? (Number(ficha.campos.valor_terreno ?? 0) + Number(ficha.campos.valor_construccion ?? 0))) : 0;
  const descripcionSolicitud = ficha
    ? [`Desde el Mapa catastral: clave ${ficha.clave}`, ubicacionTexto ? `Ubicación: ${ubicacionTexto}` : null,
       punto ? `Mapa: ${ligaMaps(punto.lat, punto.lon)}` : null].filter(Boolean).join("\n")
    : "";

  return (
    <section className="mt-4">
      <form onSubmit={(e) => { e.preventDefault(); buscar(false); }} className="flex gap-2 px-2">
        <label htmlFor="clave" className="sr-only">Clave catastral</label>
        <input id="clave" value={clave} onChange={(e) => setClave(e.target.value)} inputMode="numeric" maxLength={30}
          placeholder="Clave catastral (15 dígitos)" className={ENTRADA} />
        <button type="submit" disabled={ocupado} className="min-h-11 shrink-0 rounded-lg bg-primario px-4 font-semibold text-sobre-primario disabled:opacity-60">Buscar</button>
      </form>
      <div className="mt-2 flex items-center justify-between gap-2 px-2">
        <button type="button" onClick={miUbicacion} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mi ubicación</button>
        <span className="text-[0.8125rem] text-secundario">
          {ocupado ? "Consultando…" : zoom < ZOOM_PREDIOS ? "Acércate para ver los predios" : "Pica un predio"}
        </span>
      </div>

      <div ref={contenedor} className="mt-2 h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-linea bg-alterno" aria-label="Mapa satelital" />
      {!tokenMapbox ? <p className="mt-2 px-2 text-[0.875rem] text-error">Falta configurar el mapa satelital.</p> : null}
      <p className="mt-2 rounded-lg bg-tinte px-3 py-2 text-[0.875rem] font-semibold leading-5">{NOTA_FUENTE}</p>

      {error ? <p role="alert" className="mt-3 rounded-xl bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6 text-error">{error}</p> : null}
      {aviso ? <p role="status" className="mt-3 rounded-xl bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">{aviso}</p> : null}

      {ficha ? (
        <article className="mt-3 rounded-xl border border-linea bg-fondo px-4 py-4">
          <h2 className="text-[1.125rem] font-bold">Clave {ficha.clave}</h2>
          <p className="text-[0.9375rem] text-secundario">
            {municipio}{ficha.expediente === "pendiente" ? " · expediente pendiente" : ""} · consultado el{" "}
            {new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long" }).format(new Date(ficha.consultado_en))}
          </p>

          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
            {camposEnOrden(ficha.campos).map(([c, etiqueta, valor]) => (
              <div key={c}>
                <dt className="text-[0.8125rem] text-secundario">{etiqueta}</dt>
                <dd className="whitespace-pre-line text-[0.9375rem]">{valor}</dd>
              </div>
            ))}
          </dl>

          {ficha.privados ? (
            <section className="mt-4 border-t border-linea pt-3">
              <h3 className="font-semibold">Propietario y operación <span className="text-[0.8125rem] font-normal text-secundario">(solo el equipo)</span></h3>
              <ul className="mt-1 text-[0.9375rem]">
                {ficha.privados.propietarios.map((p, i) => (
                  <li key={i}>{p.nombre}{p.porcentaje !== null ? ` · ${p.porcentaje} %` : ""} · {p.origen === "rppc" ? "Registro Público" : "Catastro"}{p.tipo_adquisicion ? ` · ${p.tipo_adquisicion}` : ""}</li>
                ))}
              </ul>
              <dl className="mt-2 grid grid-cols-1 gap-2 text-[0.9375rem] sm:grid-cols-2">
                {[["Valor de operación", valorLegible("valor_terreno", ficha.privados.valor_operacion)], ["Escritura", ficha.privados.escritura],
                  ["Notario", ficha.privados.notario], ["Contrato", ficha.privados.numero_contrato]]
                  .filter(([, v]) => v).map(([e, v]) => (
                    <div key={e}><dt className="text-[0.8125rem] text-secundario">{e}</dt><dd>{v}</dd></div>
                  ))}
              </dl>
            </section>
          ) : null}

          {ficha.historial?.length ? (
            <section className="mt-4 border-t border-linea pt-3">
              <h3 className="font-semibold">Kardex</h3>
              <ul className="mt-1 text-[0.875rem] text-secundario">
                {ficha.historial.map((h, i) => (
                  <li key={i}>
                    {new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium" }).format(new Date(h.reemplazada_en))}:
                    {" "}cambió {h.cambios.join(", ")}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2">
            {punto ? <a href={ligaMaps(punto.lat, punto.lon)} target="_blank" rel="noopener noreferrer" className={BOTON}>Google Maps</a> : null}
            <a href={`https://wa.me/?text=${encodeURIComponent(textoCompartir)}`} target="_blank" rel="noopener noreferrer" className={BOTON}>Compartir por WhatsApp</a>
            {veVisor ? <a href={ligaVisor(ficha.clave)} target="_blank" rel="noopener noreferrer" className={BOTON}>Visor oficial</a> : null}
            <a href={`/mapa-catastral/pdf?clave=${ficha.clave}`} target="_blank" rel="noopener" className={BOTON}>Descargar PDF</a>
            {puedeCotizar ? (
              <Link href={`/solicitudes/nueva?${new URLSearchParams({ clave: ficha.clave, municipio: municipio ?? "", direccion: ubicacionTexto, nota: descripcionSolicitud })}`} className={BOTON}>
                Cotizar avalúo
              </Link>
            ) : null}
            {calculadora ? (
              <Link href={`/calculadora?${new URLSearchParams({ clave: ficha.clave, municipio: municipio ?? "", ...(valorTotal > 0 ? { valor_catastral: valorTotal.toFixed(2) } : {}) })}`} className={BOTON}>
                Calculadora de traslado
              </Link>
            ) : null}
            <button type="button" disabled={ocupado} onClick={() => buscar(true, ficha.clave)} className={BOTON}>
              Actualizar información
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

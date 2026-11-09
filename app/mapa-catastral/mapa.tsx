"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Map as MapaGL, GeoJSONSource, Marker } from "maplibre-gl";
import { useEffect, useRef, useState, useTransition } from "react";
import { fechaLegible, seccionesDeFicha } from "@/lib/catastro/etiquetas";
import { estiloMapa, ZOOM_PREDIOS } from "@/lib/catastro/estilo";
import { caja, ligaMaps, ligaVisor, type Geometria } from "@/lib/catastro/geo";
import { NOTA_FUENTE } from "@/lib/catastro/textos";
import type { Ficha, Resultado } from "@/lib/catastro/servicio";
import { municipioPorClave } from "@/lib/traslado/calculo";
import { PedirMasDxf } from "@/components/formularios-dxf";
import { buscarClave, picarMapa } from "./acciones";

const CENTRO: [number, number] = [-100.3899, 20.5888]; // Querétaro
const ENTRADA = "w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const BOTON = "flex min-h-11 items-center justify-center rounded-lg border border-linea bg-fondo px-3 text-center text-[0.9375rem] font-semibold";

/** Un color del tema (globals.css), para pintar el polígono con la paleta y no con un hex suelto. */
function token(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || "currentColor";
}

const vacio = { type: "FeatureCollection" as const, features: [] };

/** DXF (0065): si está autorizada y cuánto le queda; saldo nulo = sin límite. */
type Dxf = { autorizado: boolean; sin_limite: boolean; saldo: number | null };

export function MapaCatastral({ token: tokenMapbox, claveInicial, puedeCotizar, calculadora, veVisor, lineas, dxf }: {
  token: string; claveInicial: string | null; puedeCotizar: boolean; calculadora: boolean; dxf: Dxf;
  /** El visor de la fuente: solo admin_org, finanzas y equipo. */
  veVisor: boolean;
  /** Líneas y claves de los predios: solo admin_org, finanzas y equipo (la ruta de mosaicos también lo revisa). */
  lineas: boolean;
}) {
  const [verLineas, setVerLineas] = useState(true);
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
  const router = useRouter();
  const [verAjustes, setVerAjustes] = useState(false);
  const sinDxf = !dxf.sin_limite && (dxf.saldo ?? 0) <= 0;
  const textoDxf = dxf.sin_limite ? "DXF sin límite" : dxf.saldo === 1 ? "Te queda 1 DXF" : `Te quedan ${dxf.saldo ?? 0} DXF`;
  const [copiada, setCopiada] = useState(false);

  function copiar(texto: string) {
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    }, () => {});
  }

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
        // La atribución la pone la pantalla (solo © Mapbox © Maxar), sin el control de MapLibre.
        attributionControl: false,
        style: estiloMapa({ token: tokenMapbox, lineas, origen: location.origin, contorno: token("--acento"), relleno: token("--mapa-relleno") }),
      });
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

  // Interruptor "Líneas de predios" (solo el equipo la tiene en el estilo).
  useEffect(() => {
    if (listo && lineas) mapa.current?.setLayoutProperty("predios", "visibility", verLineas ? "visible" : "none");
  }, [listo, lineas, verLineas]);

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
          {ocupado ? "Consultando…" : lineas && verLineas && zoom < ZOOM_PREDIOS ? "Acércate para ver las líneas" : zoom < 16 ? "Acércate y pica un terreno" : "Pica un terreno"}
        </span>
      </div>
      {lineas ? (
        <label className="mt-1 flex items-center gap-2 px-2 text-[0.9375rem]">
          <input type="checkbox" checked={verLineas} onChange={(e) => setVerLineas(e.target.checked)} className="h-5 w-5 accent-primario" />
          Líneas de predios
        </label>
      ) : null}

      <div className="relative mt-2">
        <div ref={contenedor} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-linea bg-alterno" aria-label="Mapa satelital" />
        <span className="pointer-events-none absolute bottom-1 right-2 rounded bg-fondo/80 px-1.5 text-[0.6875rem] text-secundario">© Mapbox © Maxar</span>
      </div>
      {!tokenMapbox ? <p className="mt-2 px-2 text-[0.875rem] text-error">Falta configurar el mapa satelital.</p> : null}
      <p className="mt-2 rounded-lg bg-tinte px-3 py-2 text-[0.875rem] font-semibold leading-5">{NOTA_FUENTE}</p>

      {error ? <p role="alert" className="mt-3 rounded-xl bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6 text-error">{error}</p> : null}
      {aviso ? <p role="status" className="mt-3 rounded-xl bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">{aviso}</p> : null}

      {ficha ? (
        <article className="mt-3 flex flex-col gap-3">
          <header className="px-1">
            <h2 className="text-[1.125rem] font-bold">Clave {ficha.clave}</h2>
            <p className="text-[0.875rem] text-secundario">
              Consultado el {fechaLegible(ficha.consultado_en)}{ficha.expediente === "pendiente" ? " · expediente incompleto" : ""}
            </p>
          </header>

          {seccionesDeFicha(ficha, { verAjustes }).map((s) => {
            const filas = (
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                {s.filas.map(([etiqueta, valor], i) => (
                  <div key={i} className={valor.length > 60 || valor.includes("\n") ? "sm:col-span-2" : ""}>
                    <dt className="text-[0.8125rem] text-secundario">{etiqueta}</dt>
                    <dd className="whitespace-pre-line text-[0.9375rem]">
                      {valor}
                      {s.id === "identificacion" && i === 0 ? (
                        <button type="button" onClick={() => copiar(ficha.clave)} className="ml-2 align-middle text-[0.8125rem] font-semibold text-acento underline underline-offset-4">
                          {copiada ? "Copiada" : "Copiar"}
                        </button>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            );
            const maps = s.id === "ubicacion" && punto ? (
              <a href={ligaMaps(punto.lat, punto.lon)} target="_blank" rel="noopener noreferrer" className={`mt-3 ${BOTON}`}>Abrir en Google Maps</a>
            ) : null;
            return s.equipo ? (
              <details key={s.id} className="rounded-xl border border-linea bg-fondo px-4 py-3">
                <summary className="cursor-pointer font-semibold">{s.titulo} <span className="text-[0.8125rem] font-normal text-secundario">(solo el equipo)</span></summary>
                {s.filas.length ? filas : <p className="mt-2 text-[0.9375rem] text-secundario">Sin cambios de la fuente.</p>}
                {s.ajustes ? (
                  <button type="button" onClick={() => setVerAjustes((v) => !v)} className="mt-2 text-[0.875rem] font-semibold text-acento underline underline-offset-4">
                    {verAjustes ? "Ocultar ajustes de lector" : `Mostrar ajustes de lector (${s.ajustes})`}
                  </button>
                ) : null}
              </details>
            ) : (
              <section key={s.id} className="rounded-xl border border-linea bg-fondo px-4 py-3">
                <h3 className="font-semibold">{s.titulo}</h3>
                {filas}
                {maps}
              </section>
            );
          })}
          {/* Sin dirección visible pero con punto: la liga de Maps no se pierde. */}
          {punto && !seccionesDeFicha(ficha).some((s) => s.id === "ubicacion") ? (
            <section className="rounded-xl border border-linea bg-fondo px-4 py-3">
              <h3 className="font-semibold">Ubicación</h3>
              <a href={ligaMaps(punto.lat, punto.lon)} target="_blank" rel="noopener noreferrer" className={`mt-3 ${BOTON}`}>Abrir en Google Maps</a>
            </section>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(textoCompartir)}`} target="_blank" rel="noopener noreferrer" className={BOTON}>Compartir por WhatsApp</a>
            <a href={`/mapa-catastral/pdf?clave=${ficha.clave}`} target="_blank" rel="noopener" className={BOTON}>Descargar PDF</a>
            {dxf.autorizado ? (
              <div className="col-span-2 flex flex-col gap-2">
                <div className="grid grid-cols-2 items-center gap-2">
                  {sinDxf ? (
                    <button type="button" disabled className={`${BOTON} cursor-not-allowed text-secundario`}>Descargar DXF</button>
                  ) : (
                    // Al volver, el saldo se actualiza (el mismo predio otra vez no resta).
                    <a href={`/mapa-catastral/dxf?clave=${ficha.clave}`} target="_blank" rel="noopener" onClick={() => setTimeout(() => router.refresh(), 2500)}
                      className={BOTON}>Descargar DXF</a>
                  )}
                  <span className="text-[0.875rem] text-secundario">{textoDxf}</span>
                </div>
                {sinDxf ? <PedirMasDxf /> : null}
              </div>
            ) : null}
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
            {veVisor ? <a href={ligaVisor(ficha.clave)} target="_blank" rel="noopener noreferrer" className={BOTON}>Visor oficial</a> : null}
            <button type="button" disabled={ocupado} onClick={() => buscar(true, ficha.clave)} className={BOTON}>
              Actualizar información
            </button>
          </div>
        </article>
      ) : null}
    </section>
  );
}

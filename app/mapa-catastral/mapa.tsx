"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Map as MapaGL, GeoJSONSource, Marker } from "maplibre-gl";
import { useEffect, useRef, useState, useTransition } from "react";
import { fechaLegible, seccionesDeFicha } from "@/lib/catastro/etiquetas";
import { detectarBusqueda, enQueretaro, SUBDIRECCIONES, textoDelTipo } from "@/lib/catastro/busqueda";
import { CAPAS_NOMBRES, estiloMapa, ZOOM_PREDIOS } from "@/lib/catastro/estilo";
import { caja, ligaMaps, ligaVisor, type Geometria } from "@/lib/catastro/geo";
import { NOTA_FUENTE } from "@/lib/catastro/textos";
import type { Ficha, Resultado } from "@/lib/catastro/servicio";
import { municipioPorClave } from "@/lib/traslado/calculo";
import { PedirMasDxf } from "@/components/formularios-dxf";
import { buscarClave, buscarEnMapa, picarMapa, registrarBusquedaDomicilio, type ResultadoBusqueda } from "./acciones";

const CENTRO: [number, number] = [-100.3899, 20.5888]; // Querétaro
const ENTRADA = "w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const BOTON = "flex min-h-11 items-center justify-center rounded-lg border border-linea bg-fondo px-3 text-center text-[0.9375rem] font-semibold";

/** Un color del tema (globals.css), para pintar el polígono con la paleta y no con un hex suelto. */
function token(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || "currentColor";
}

const vacio = { type: "FeatureCollection" as const, features: [] };

/** Una sugerencia de domicilio (Mapbox Geocoding v6): solo para centrar el mapa, no se guarda. */
type Sugerencia = { id: string; nombre: string; detalle: string; lat: number; lon: number };
const GUARDA_CALLES = "tasa.mapa.nombres_de_calles";

/** Domicilios en Querétaro mientras escribe (con pausa: no pide con cada letra). Sin texto guardado en ningún lado. */
async function sugerirDomicilios(texto: string, token: string, senal: AbortSignal): Promise<Sugerencia[]> {
  const q = new URLSearchParams({ q: texto, autocomplete: "true", country: "mx", language: "es", limit: "5",
    bbox: "-100.6,20.0,-99.0,21.7", proximity: "-100.3899,20.5888", access_token: token });
  const r = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${q}`, { signal: senal });
  if (!r.ok) throw new Error(`HTTP${r.status}`);
  const j = (await r.json()) as { features?: { id?: string; properties?: { name?: string; place_formatted?: string; full_address?: string;
    coordinates?: { latitude?: number; longitude?: number } } }[] };
  return (j.features ?? []).flatMap((x, i) => {
    const c = x.properties?.coordinates;
    const lat = Number(c?.latitude);
    const lon = Number(c?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !enQueretaro(lat, lon)) return [];
    return [{ id: x.id ?? String(i), nombre: x.properties?.name ?? x.properties?.full_address ?? "", detalle: x.properties?.place_formatted ?? "", lat, lon }];
  });
}

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
  const [verCalles, setVerCalles] = useState(true);
  const [subdireccion, setSubdireccion] = useState("14");
  const [buscadas, setBuscadas] = useState<{ para: string; lista: Sugerencia[] }>({ para: "", lista: [] });
  const [folioNoEncontrado, setFolioNoEncontrado] = useState(false);
  const selectorSub = useRef<HTMLSelectElement>(null);
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

  const tipo = detectarBusqueda(clave);

  // La caja única: el domicilio va por sugerencias; lo demás lo resuelve el servidor.
  function buscarCaja() {
    setFolioNoEncontrado(false);
    if (tipo.tipo === "domicilio") {
      if (sugerencias[0]) elegir(sugerencias[0]);
      else setError("No encontré ese domicilio en Querétaro. Revisa cómo está escrito o pica el terreno en el mapa.");
      return;
    }
    empezar(async () => {
      const r: ResultadoBusqueda = await buscarEnMapa(clave, subdireccion);
      const m = mapa.current;
      if (m && r.punto && enQueretaro(r.punto.lat, r.punto.lon)) {
        marcador.current?.setLngLat([r.punto.lon, r.punto.lat]).addTo(m);
        if (!r.ok) m.flyTo({ center: [r.punto.lon, r.punto.lat], zoom: 18 });
      }
      setFolioNoEncontrado(Boolean(r.folioNoEncontrado));
      mostrar(r, true);
    });
  }

  function elegir(s: Sugerencia) {
    setBuscadas({ para: "", lista: [] });
    setClave([s.nombre, s.detalle].filter(Boolean).join(", "));
    setFicha(null);
    setError(null);
    setAviso("Toca el terreno para consultarlo.");
    const m = mapa.current;
    if (m) {
      marcador.current?.setLngLat([s.lon, s.lat]).addTo(m);
      m.flyTo({ center: [s.lon, s.lat], zoom: 18 });
    }
    registrarBusquedaDomicilio().catch(() => {});
  }

  // Sugerencias de domicilio mientras escribe: 3 letras o más y una pausa de 350 ms.
  const textoDomicilio = tipo.tipo === "domicilio" && tipo.texto.length >= 3 ? tipo.texto : "";
  // Solo se muestran las sugerencias del texto que está escrito (las de un texto anterior se ignoran).
  const sugerencias = buscadas.para === textoDomicilio && textoDomicilio ? buscadas.lista : [];
  useEffect(() => {
    if (!textoDomicilio || !tokenMapbox) return;
    const corte = new AbortController();
    const espera = setTimeout(() => {
      sugerirDomicilios(textoDomicilio, tokenMapbox, corte.signal)
        .then((lista) => setBuscadas({ para: textoDomicilio, lista }), () => setBuscadas({ para: textoDomicilio, lista: [] }));
    }, 350);
    return () => {
      clearTimeout(espera);
      corte.abort();
    };
  }, [textoDomicilio, tokenMapbox]);

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
        // La atribución la pone la pantalla (© Mapbox © OpenStreetMap © Maxar), sin el control de MapLibre.
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
        try {
          if (localStorage.getItem(GUARDA_CALLES) === "no") setVerCalles(false);
        } catch {
          // Sin almacenamiento (ventana privada): se queda encendido.
        }
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

  // "Nombres de calles": encendido por omisión; la elección se recuerda en este navegador (se lee al cargar el mapa).
  useEffect(() => {
    if (!listo) return;
    for (const capa of CAPAS_NOMBRES) mapa.current?.setLayoutProperty(capa, "visibility", verCalles ? "visible" : "none");
  }, [listo, verCalles]);
  function cambiarCalles(si: boolean) {
    setVerCalles(si);
    try {
      localStorage.setItem(GUARDA_CALLES, si ? "si" : "no");
    } catch {
      // Sin almacenamiento: vale solo para esta visita.
    }
  }

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
      <form onSubmit={(e) => { e.preventDefault(); buscarCaja(); }} className="relative px-2">
        <div className="flex gap-2">
          <label htmlFor="clave" className="sr-only">Buscar en el mapa</label>
          <input id="clave" value={clave} onChange={(e) => { setClave(e.target.value); setFolioNoEncontrado(false); }} maxLength={2000}
            autoComplete="off" enterKeyHint="search" placeholder="Clave, domicilio, coordenadas, liga de Maps o folio" className={ENTRADA} />
          <button type="submit" disabled={ocupado} className="min-h-11 shrink-0 rounded-lg bg-primario px-4 font-semibold text-sobre-primario disabled:opacity-60">Buscar</button>
        </div>
        {sugerencias.length ? (
          <ul className="absolute left-2 right-2 z-20 mt-1 overflow-hidden rounded-xl border border-linea bg-fondo shadow-lg" aria-label="Domicilios sugeridos">
            {sugerencias.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => elegir(s)} className="w-full border-b border-linea px-3 py-2 text-left">
                  <span className="block text-[0.9375rem] font-semibold">{s.nombre}</span>
                  {s.detalle ? <span className="block text-[0.8125rem] text-secundario">{s.detalle}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {textoDelTipo(tipo) ? <p className="mt-1 text-[0.8125rem] text-secundario">Se busca como: {textoDelTipo(tipo)}</p> : null}
        {tipo.tipo === "folio" ? (
          <label className="mt-2 flex items-center gap-2 text-[0.9375rem]">
            Subdirección
            <select ref={selectorSub} value={subdireccion} onChange={(e) => { setSubdireccion(e.target.value); setFolioNoEncontrado(false); }}
              className="min-h-11 flex-1 rounded-lg border border-borde-campo bg-fondo px-3 text-[1rem]">
              {SUBDIRECCIONES.map((s) => <option key={s.clave} value={s.clave}>{s.nombre}</option>)}
            </select>
          </label>
        ) : null}
      </form>
      <div className="mt-2 flex items-center justify-between gap-2 px-2">
        <button type="button" onClick={miUbicacion} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Mi ubicación</button>
        <span className="text-[0.8125rem] text-secundario">
          {ocupado ? "Consultando…" : lineas && verLineas && zoom < ZOOM_PREDIOS ? "Acércate para ver las líneas" : zoom < 16 ? "Acércate y pica un terreno" : "Pica un terreno"}
        </span>
      </div>
      <label className="mt-1 flex items-center gap-2 px-2 text-[0.9375rem]">
        <input type="checkbox" checked={verCalles} onChange={(e) => cambiarCalles(e.target.checked)} className="h-5 w-5 accent-primario" />
        Nombres de calles
      </label>
      {lineas ? (
        <label className="mt-1 flex items-center gap-2 px-2 text-[0.9375rem]">
          <input type="checkbox" checked={verLineas} onChange={(e) => setVerLineas(e.target.checked)} className="h-5 w-5 accent-primario" />
          Líneas de predios
        </label>
      ) : null}

      <div className="relative mt-2">
        <div ref={contenedor} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-xl border border-linea bg-alterno" aria-label="Mapa satelital" />
        <span className="absolute bottom-1 right-2 rounded bg-fondo/80 px-1.5 text-[0.6875rem] text-secundario">
          <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener noreferrer">© Mapbox</a>{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a> © Maxar
        </span>
      </div>
      {!tokenMapbox ? <p className="mt-2 px-2 text-[0.875rem] text-error">Falta configurar el mapa satelital.</p> : null}
      <p className="mt-2 rounded-lg bg-tinte px-3 py-2 text-[0.875rem] font-semibold leading-5">{NOTA_FUENTE}</p>

      {error ? <p role="alert" className="mt-3 rounded-xl bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6 text-error">{error}</p> : null}
      {folioNoEncontrado ? (
        <button type="button" onClick={() => { selectorSub.current?.scrollIntoView({ block: "center" }); selectorSub.current?.focus(); }}
          className={`mt-2 w-full ${BOTON}`}>
          Buscar en otra subdirección
        </button>
      ) : null}
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
              <Link href={`/solicitudes/nueva?${new URLSearchParams({ clave: ficha.clave, municipio: municipio ?? "", direccion: ubicacionTexto, nota: descripcionSolicitud, desde: "mapa" })}`} className={BOTON}>
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

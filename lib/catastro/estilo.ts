import type { StyleSpecification } from "maplibre-gl";

/**
 * El estilo del Mapa catastral (sin directiva: lo usa la pantalla y lo revisan las pruebas).
 * - Satélite de Mapbox para todos.
 * - Líneas y claves de los predios (pasan por Tasa) SOLO para admin_org, finanzas y equipo: para los demás ni
 *   siquiera existe la fuente en el estilo, así que el navegador nunca pide esos mosaicos.
 * - El predio elegido, con los colores de Tasa: contorno = --acento, relleno = --mapa-relleno.
 * - Nombres de calles (desde zoom 15) y de colonias (desde zoom 14), en español, de mapbox-streets: SOLO las
 *   etiquetas (texto blanco con contorno oscuro), sin dibujar calles. Encima del satélite y de las líneas, debajo del
 *   predio elegido. La fuente no pide mosaicos abajo de zoom 14 ni arriba de 16 (de ahí en adelante reusa los de 16).
 * Sin atribución de la fuente catastral; la de Mapbox la pone la pantalla (© Mapbox © OpenStreetMap © Maxar).
 */

export const ZOOM_PREDIOS = 17;
export const RUTA_PREDIOS = "/mapa-catastral/predios/{z}/{x}/{y}";
export const ROLES_CON_LINEAS = ["admin_org", "finanzas", "equipo"] as const;
export const CAPAS_NOMBRES = ["nombres-colonias", "nombres-calles"] as const;

const LETRA = ["DIN Pro Medium", "Arial Unicode MS Regular"];
const NOMBRE = ["coalesce", ["get", "name_es"], ["get", "name"]];
// Texto blanco con contorno oscuro: se lee sobre el satélite de día y de noche (no depende del tema de la app).
const PINTURA = { "text-color": "#ffffff", "text-halo-color": "rgba(0, 0, 0, 0.85)", "text-halo-width": 1.6, "text-halo-blur": 0.4 };

export function estiloMapa(o: { token: string; lineas: boolean; origen: string; contorno: string; relleno: string }): StyleSpecification {
  return {
    version: 8,
    glyphs: `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${o.token}`,
    sources: {
      satelite: {
        type: "raster",
        tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${o.token}`],
        tileSize: 512,
        maxzoom: 19,
      },
      ...(o.lineas ? { predios: { type: "raster" as const, tiles: [o.origen + RUTA_PREDIOS], tileSize: 512, minzoom: ZOOM_PREDIOS, maxzoom: 20 } } : {}),
      calles: {
        type: "vector",
        tiles: [`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token=${o.token}`],
        minzoom: 14,
        maxzoom: 16,
      },
      seleccion: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      // Sin fundido: cada mosaico se ve en cuanto llega.
      { id: "satelite", type: "raster", source: "satelite", paint: { "raster-fade-duration": 0 } },
      ...(o.lineas
        ? [{ id: "predios", type: "raster" as const, source: "predios", minzoom: ZOOM_PREDIOS, paint: { "raster-fade-duration": 0 } }]
        : []),
      {
        id: "nombres-colonias", type: "symbol", source: "calles", "source-layer": "place_label", minzoom: 14,
        filter: ["in", ["get", "class"], ["literal", ["settlement_subdivision"]]],
        layout: { "text-field": NOMBRE as never, "text-font": LETRA, "text-size": 12, "text-transform": "uppercase", "text-letter-spacing": 0.08,
                  "text-max-width": 8 },
        paint: PINTURA,
      },
      {
        id: "nombres-calles", type: "symbol", source: "calles", "source-layer": "road", minzoom: 15,
        filter: ["all", ["has", "name"], ["in", ["get", "class"], ["literal",
          ["motorway", "trunk", "primary", "secondary", "tertiary", "street", "street_limited", "primary_link", "secondary_link", "tertiary_link",
           "service", "pedestrian"]]]],
        layout: { "symbol-placement": "line", "text-field": NOMBRE as never, "text-font": LETRA,
                  "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 18, 14] as never, "text-max-angle": 30, "text-padding": 2 },
        paint: PINTURA,
      },
      { id: "seleccion-relleno", type: "fill", source: "seleccion", paint: { "fill-color": o.relleno, "fill-opacity": 0.35 } },
      { id: "seleccion-borde", type: "line", source: "seleccion", paint: { "line-color": o.contorno, "line-width": 3 } },
    ],
  };
}

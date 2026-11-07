import type { StyleSpecification } from "maplibre-gl";

/**
 * El estilo del Mapa catastral (sin directiva: lo usa la pantalla y lo revisan las pruebas).
 * - Satélite de Mapbox para todos.
 * - Líneas y claves de los predios (pasan por Tasa) SOLO para admin_org, finanzas y equipo: para los demás ni
 *   siquiera existe la fuente en el estilo, así que el navegador nunca pide esos mosaicos.
 * - El predio elegido, con los colores de Tasa: contorno = --acento, relleno = --mapa-relleno.
 * Sin atribución de la fuente catastral; la del satélite la pone la pantalla (© Mapbox © Maxar).
 */

export const ZOOM_PREDIOS = 17;
export const RUTA_PREDIOS = "/mapa-catastral/predios/{z}/{x}/{y}";
export const ROLES_CON_LINEAS = ["admin_org", "finanzas", "equipo"] as const;

export function estiloMapa(o: { token: string; lineas: boolean; origen: string; contorno: string; relleno: string }): StyleSpecification {
  return {
    version: 8,
    sources: {
      satelite: {
        type: "raster",
        tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${o.token}`],
        tileSize: 512,
        maxzoom: 19,
      },
      ...(o.lineas ? { predios: { type: "raster" as const, tiles: [o.origen + RUTA_PREDIOS], tileSize: 512, minzoom: ZOOM_PREDIOS, maxzoom: 20 } } : {}),
      seleccion: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      // Sin fundido: cada mosaico se ve en cuanto llega.
      { id: "satelite", type: "raster", source: "satelite", paint: { "raster-fade-duration": 0 } },
      ...(o.lineas
        ? [{ id: "predios", type: "raster" as const, source: "predios", minzoom: ZOOM_PREDIOS, paint: { "raster-fade-duration": 0 } }]
        : []),
      { id: "seleccion-relleno", type: "fill", source: "seleccion", paint: { "fill-color": o.relleno, "fill-opacity": 0.35 } },
      { id: "seleccion-borde", type: "line", source: "seleccion", paint: { "line-color": o.contorno, "line-width": 3 } },
    ],
  };
}

import { describe, expect, test } from "vitest";
import { detectarBusqueda, esHostDeGoogle, enQueretaro, puntoDeLigaGoogle } from "@/lib/catastro/busqueda";
import { folioDeRespuesta } from "@/lib/catastro/idecatq";

/** La caja única del Mapa catastral reconoce el tipo por la forma y el largo. */
describe("caja de búsqueda del Mapa catastral", () => {
  test("clave catastral (con o sin separadores) y clave inválida", () => {
    expect(detectarBusqueda("060100102583007")).toEqual({ tipo: "clave", clave: "060100102583007" });
    expect(detectarBusqueda("06-01-001-02-583-007")).toEqual({ tipo: "clave", clave: "060100102583007" });
    expect(detectarBusqueda("990100102583007")).toEqual({ tipo: "clave_invalida" });
    expect(detectarBusqueda("0601001025830")).toEqual({ tipo: "clave_invalida" });
  });

  test("folio real: solo dígitos, de 1 a 10, o con la palabra folio", () => {
    expect(detectarBusqueda("489527")).toEqual({ tipo: "folio", folio: "489527" });
    expect(detectarBusqueda("Folio real: 0489527")).toEqual({ tipo: "folio", folio: "489527" });
  });

  test("coordenadas decimales, en cualquier orden y sin el signo de la longitud", () => {
    expect(detectarBusqueda("20.5888, -100.3899")).toEqual({ tipo: "coordenadas", lat: 20.5888, lon: -100.3899, forma: "decimal" });
    expect(detectarBusqueda("20.5888 -100.3899")).toMatchObject({ tipo: "coordenadas", lat: 20.5888, lon: -100.3899 });
    expect(detectarBusqueda("-100.3899, 20.5888")).toMatchObject({ lat: 20.5888, lon: -100.3899 });
    expect(detectarBusqueda("20.5888, 100.3899")).toMatchObject({ lat: 20.5888, lon: -100.3899 });
  });

  test("grados, minutos y segundos", () => {
    const r = detectarBusqueda(`20°35'19.7"N 100°23'23.6"W`);
    expect(r).toMatchObject({ tipo: "coordenadas", forma: "gms" });
    if (r.tipo !== "coordenadas") throw new Error();
    expect(r.lat).toBeCloseTo(20.58881, 4);
    expect(r.lon).toBeCloseTo(-100.38989, 4);
    expect(detectarBusqueda("20º 35′ 19.7″ N, 100º 23′ 23.6″ O")).toMatchObject({ tipo: "coordenadas", forma: "gms" });
  });

  test("UTM zona 14N (x, y en cualquier orden)", () => {
    const r = detectarBusqueda("355497, 2277158");
    expect(r).toMatchObject({ tipo: "coordenadas", forma: "utm" });
    if (r.tipo !== "coordenadas") throw new Error();
    expect(enQueretaro(r.lat, r.lon)).toBe(true);
    expect(detectarBusqueda("2277158 355497")).toMatchObject({ tipo: "coordenadas", forma: "utm" });
  });

  test("ligas de Google Maps: larga (!3d!4d, q=, @) y corta", () => {
    expect(puntoDeLigaGoogle("https://www.google.com/maps/place/Algo/@20.59,-100.39,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d20.5888!4d-100.3899"))
      .toEqual({ lat: 20.5888, lon: -100.3899 });
    expect(detectarBusqueda("https://maps.google.com/?q=20.5888,-100.3899")).toEqual({ tipo: "liga_google", lat: 20.5888, lon: -100.3899 });
    expect(detectarBusqueda("https://www.google.com/maps/@20.5888,-100.3899,18z")).toEqual({ tipo: "liga_google", lat: 20.5888, lon: -100.3899 });
    expect(detectarBusqueda("https://maps.app.goo.gl/AbCdEf123")).toEqual({ tipo: "liga_corta", url: "https://maps.app.goo.gl/AbCdEf123" });
    expect(detectarBusqueda("https://www.google.com/maps")).toEqual({ tipo: "liga_sin_punto" });
    // Otro dominio no es liga de Google: se toma como texto (y no se sigue nunca).
    expect(detectarBusqueda("https://maps.app.goo.gl.evil.com/x").tipo).not.toBe("liga_corta");
    expect(esHostDeGoogle("evil.com")).toBe(false);
  });

  test("domicilio: lo que tiene letras", () => {
    expect(detectarBusqueda("Av. Constituyentes 20, Centro")).toEqual({ tipo: "domicilio", texto: "Av. Constituyentes 20, Centro" });
    expect(detectarBusqueda("   ")).toEqual({ tipo: "vacio" });
  });

  test("folio real: de la respuesta de la fuente solo se toma la clave", () => {
    const respuesta = { ok: true, nombre_completo: "PERSONA", medid_colind: "AL NORTE…", clave_catastral: "060100102583007", area_terreno: "197.5" };
    expect(folioDeRespuesta(respuesta)).toEqual({ ok: true, clave: "060100102583007" });
    expect(folioDeRespuesta({ ok: false })).toEqual({ ok: true, clave: null });
    expect(folioDeRespuesta({ ok: true, clave_catastral: "no-es-clave" })).toEqual({ ok: true, clave: null });
    expect(folioDeRespuesta("<html>")).toEqual({ ok: false });
  });
});

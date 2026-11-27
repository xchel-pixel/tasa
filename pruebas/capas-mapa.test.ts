import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { CAPAS, capaPorId, CONSTRUCCIONES_ROTAS } from "@/lib/catastro/capas";
import { CAPAS_DE_PREDIOS } from "@/lib/catastro/idecatq";
import { CACHE_MOSAICO_S, mosaicoDeCapa } from "@/lib/catastro/mosaicos";
import { consultarParcela, datosDeParcela, urlParcela } from "@/lib/catastro/ejidos";
import { estiloMapa } from "@/lib/catastro/estilo";

/**
 * Capas del mapa para el equipo (nov-2026): lista fija, zoom mínimo por capa, la caché (llave = capa, zoom y posición) y
 * los ejidos sin datos personales. El permiso por rol y el límite por capa los prueba verificaciones.sql (0095).
 */

const permiso = { valor: "ok" as string };
vi.mock("@/lib/supabase/server", () => ({
  crearClienteServidor: async () => ({ rpc: async (fn: string) => ({ data: fn === "catastro_permiso_mosaico" ? permiso.valor : null }) }),
  encabezadoHumo: async () => null,
}));
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

const vacia = new URLSearchParams();
// Una parcela ejidal REAL de El Marqués (forma de la respuesta de la fuente), con sus datos personales.
const PARCELA_FUENTE = {
  OBJECTID: 77064, CLAVE: "0100000700000265000", TIPO_PRED: 5, USO_SUELO: "A", CLASE_TIER: "T", AFECTACION: "0", NUM_EDO: "22",
  NOM_EDO: "QUERETARO", NUM_MUN: "011", NOM_MUN: "EL MARQUES", CVE_EJPR: "0029", CVE_EJRA: "0011", CVE_PARC: "22011001100265",
  CVE_EJID: "220110011", NOM_EJI: "PALO ALTO", AREA1: 0, AREA2: 34, AREA3: 47.37, NFOLIODER: "22FD00018078", TIPOPARC: "INDIVIDUAL",
  FNACIM: 19570630, SHAPE_AREA: 3447.3652342, SHAPE_LEN: 255.782857681,
};
const PERSONALES = ["FNACIM", "19570630", "NFOLIODER", "22FD00018078", "TIPOPARC"];

afterEach(() => vi.restoreAllMocks());

describe("Lista fija de capas", () => {
  test("las aprobadas, con su zoom; predios prendida y las demás apagadas", () => {
    expect(CAPAS.map((c) => [c.id, c.zoomMin, c.encendida])).toEqual([
      ["uso_suelo", 13, false], ["colonias", 14, false], ["ejidos", 14, false], ["manzanas", 16, false],
      ["construcciones", 17, false], ["predios", 17, true],
    ]);
    expect(capaPorId("predios")!.fuente).toBe(CAPAS_DE_PREDIOS);
    // 90 menos las 4 que la fuente no puede dibujar (si una va en la lista, falla el mosaico entero).
    expect(capaPorId("construcciones")!.fuente.split(",")).toHaveLength(86);
    for (const rota of CONSTRUCCIONES_ROTAS) expect(capaPorId("construcciones")!.fuente).not.toContain(rota);
    expect(capaPorId("uso_suelo")!.leyenda).toMatch(/Corregidora, El Marqués y San Juan del Río/);
    // Las que no se aprobaron no existen.
    for (const no of ["calles", "CENCAL", "PDAS", "LMA", "CIRA", "queretaro:M14_PA"]) expect(capaPorId(no), no).toBeNull();
    expect(CAPAS.map((c) => c.fuente).join(",")).not.toMatch(/CENCAL|PDAS|LMA|CIRA|LESTATAL/);
  });

  test("zoom: desde el mínimo de cada capa hasta 20; nada fuera de Querétaro ni con parámetros", () => {
    const qro = (z: number) => {
      const n = 2 ** z;
      return { z: String(z), x: String(Math.floor(((-100.3899 + 180) / 360) * n)),
        y: String(Math.floor(((1 - Math.log(Math.tan((20.5888 * Math.PI) / 180) + 1 / Math.cos((20.5888 * Math.PI) / 180)) / Math.PI) / 2) * n)) };
    };
    for (const c of CAPAS) {
      expect(mosaicoDeCapa(c, qro(c.zoomMin), vacia), `${c.id} en su zoom`).not.toBeNull();
      expect(mosaicoDeCapa(c, qro(c.zoomMin - 1), vacia), `${c.id} abajo de su zoom`).toBeNull();
      expect(mosaicoDeCapa(c, qro(21), vacia), `${c.id} en 21`).toBeNull();
      expect(mosaicoDeCapa(c, qro(c.zoomMin), new URLSearchParams("layers=queretaro:RAN_M14")), `${c.id} con parámetros`).toBeNull();
    }
  });

  test("(a) un mosaico es solo imagen con el estilo de la fuente: sin campos, sin consulta de atributos ni estilo propio", () => {
    for (const c of CAPAS) {
      const m = mosaicoDeCapa(c, { z: "17", x: "29021", y: "57873" }, vacia)!;
      const q = new URL(m.url).searchParams;
      expect(q.get("request")).toBe("GetMap");
      expect(q.get("format")).toBe("image/png");
      expect(q.get("styles")).toBe("");
      expect(q.get("layers")).toBe(c.fuente);
      for (const k of ["query_layers", "info_format", "sld", "sld_body", "propertyname", "cql_filter"]) {
        expect([...q.keys()].map((x) => x.toLowerCase()), `${c.id}: ${k}`).not.toContain(k);
      }
      // La llave y la etiqueta de la caché: capa, zoom y posición. Nada de la persona.
      expect(m.etiqueta).toBe(`mosaico:${c.id}:17:29021:57873`);
    }
  });

  test("el estilo: las capas del equipo apagadas al cargar (no piden mosaicos) y ninguna para quien no tiene líneas", () => {
    const con = estiloMapa({ token: "t", lineas: true, origen: "https://x", contorno: "#00f", relleno: "#00f" });
    for (const c of CAPAS.filter((c) => c.id !== "predios")) {
      expect(con.layers.find((l) => l.id === c.id)?.layout, c.id).toEqual({ visibility: "none" });
      expect((con.sources[c.id] as { tiles: string[] }).tiles[0]).toBe(`https://x/mapa-catastral/capas/${c.id}/{z}/{x}/{y}`);
    }
    const sin = estiloMapa({ token: "t", lineas: false, origen: "https://x", contorno: "#00f", relleno: "#00f" });
    for (const c of CAPAS) expect(sin.sources[c.id], c.id).toBeUndefined();
  });
});

describe("La ruta: permiso en cada petición, después la caché", () => {
  const pedir = async (capa: string) => {
    const { servirMosaico } = await import("@/lib/catastro/servir-mosaico");
    return servirMosaico(capa, { z: "15", x: "7255", y: "14468" }, new NextRequest("https://tasa.test/mapa-catastral/capas/x/15/7255/14468"));
  };
  beforeEach(() => {
    permiso.valor = "ok";
    revalidateTag.mockClear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("sin permiso (comisionista): 403 y NO se toca la caché ni la fuente", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    permiso.valor = "rol";
    expect((await pedir("ejidos")).status).toBe(403);
    // Los 429 dicen cuál límite fue, para el aviso de la pantalla.
    permiso.valor = "limite";
    const hora = await pedir("ejidos");
    expect([hora.status, await hora.text()]).toEqual([429, "hora"]);
    permiso.valor = "tope_dia";
    const dia = await pedir("ejidos");
    expect([dia.status, await dia.text()]).toEqual([429, "dia"]);
    expect(f).not.toHaveBeenCalled();
  });

  test("con permiso: se pide a la caché de Vercel por una semana, con la etiqueta de capa/zoom/posición; al navegador, private", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }));
    const r = await pedir("ejidos");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("private, max-age=86400");
    const [, init] = f.mock.calls[0] as [string, RequestInit & { next: { revalidate: number; tags: string[] } }];
    expect(init.next).toEqual({ revalidate: CACHE_MOSAICO_S, tags: ["mosaico:ejidos:15:7255:14468"] });
    expect(CACHE_MOSAICO_S).toBe(604800);
  });

  test("si la fuente no manda PNG (error, página de bloqueo): no se sirve y se borra de la caché", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }));
    const r = await pedir("colonias");
    expect(r.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledWith("mosaico:colonias:15:7255:14468", { expire: 0 });
  });

  test("una capa fuera de la lista o fuera de zoom: 400, sin preguntar permiso ni a la fuente", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    expect((await pedir("CIRA")).status).toBe(400);
    expect((await pedir("construcciones")).status).toBe(400); // zoom 15 < 17
    expect(f).not.toHaveBeenCalled();
  });
});

describe("Ejidos: solo ejido, parcela y superficie", () => {
  test("de la fuente pasan exactamente tres datos; los de la persona nunca", () => {
    const p = datosDeParcela(PARCELA_FUENTE);
    expect(p).toEqual({ ejido: "PALO ALTO", parcela: 265, superficie_m2: 3447.37 });
    expect(Object.keys(p)).toEqual(["ejido", "parcela", "superficie_m2"]);
    const texto = JSON.stringify(p);
    for (const x of PERSONALES) expect(texto, x).not.toContain(x);
  });

  test("hectáreas-áreas-centiáreas: 8-41-13.94 = 84,113.94 m²; sin número de parcela (uso común) → nulo; en cero, del polígono", () => {
    expect(datosDeParcela({ ...PARCELA_FUENTE, AREA1: 8, AREA2: 41, AREA3: 13.94 }).superficie_m2).toBe(84113.94);
    expect(datosDeParcela({ ...PARCELA_FUENTE, CVE_PARC: "22011001100000" }).parcela).toBeNull();
    expect(datosDeParcela({ ...PARCELA_FUENTE, AREA1: 0, AREA2: 0, AREA3: 0, SHAPE_AREA: 39028.0759 }).superficie_m2).toBe(39028.08);
    // Un campo nuevo que algún día agregue la fuente (p. ej. un nombre) tampoco pasa.
    expect(Object.keys(datosDeParcela({ ...PARCELA_FUENTE, NOMBRE: "Fulano", EJIDATARIO: "Fulano" }))).toEqual(["ejido", "parcela", "superficie_m2"]);
  });

  test("la consulta en el momento: solo capas de ejidos, sin caché, y lo que regresa no trae datos personales", async () => {
    const q = new URL(urlParcela(20.55, -100.25)).searchParams;
    expect(q.get("query_layers")).toBe(capaPorId("ejidos")!.fuente);
    const { aUtm } = await import("@/lib/catastro/geo");
    const [x, y] = aUtm(20.55, -100.25);
    const cuadro = { type: "Polygon", coordinates: [[[x - 50, y - 50], [x + 50, y - 50], [x + 50, y + 50], [x - 50, y + 50], [x - 50, y - 50]]] };
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      features: [{ id: "RAN_M11.fid-1", geometry: cuadro, properties: PARCELA_FUENTE }],
    }), { status: 200 }));
    const r = await consultarParcela(20.55, -100.25);
    expect(r).toEqual({ ok: true, parcela: { ejido: "PALO ALTO", parcela: 265, superficie_m2: 3447.37 } });
    expect((f.mock.calls[0][1] as RequestInit).cache).toBe("no-store");
    for (const x of PERSONALES) expect(JSON.stringify(r), x).not.toContain(x);
  });
});

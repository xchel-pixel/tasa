import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CAPAS_PREDIOS, peticionDeMosaico } from "@/lib/catastro/mosaicos";

/**
 * La ruta de mosaicos de líneas de predios no es un proxy abierto: solo número de mosaico de nivel de calle dentro de
 * Querétaro, sin parámetros; host, capas, formato, proyección y tamaño fijos. 403 por rol/herramienta y 429 por el
 * límite de 600 por hora los decide la base (catastro_permiso_mosaico, probada en verificaciones.sql).
 */

const QRO = { z: "18", x: "57968", y: "115743" }; // centro de Querétaro
const vacia = new URLSearchParams();

describe("La petición se arma en el servidor", () => {
  test("un mosaico de Querétaro: host, capas M01_PA…M18_PA, png, EPSG:3857 y 512×512 fijos", () => {
    const url = new URL(peticionDeMosaico(QRO, vacia)!);
    expect(url.origin + url.pathname).toBe("https://catastroedo.queretaro.gob.mx/geoserver/queretaro/wms");
    const q = Object.fromEntries(url.searchParams);
    expect(q).toEqual({
      service: "WMS", version: "1.1.1", request: "GetMap", layers: CAPAS_PREDIOS, styles: "", format: "image/png", transparent: "true",
      srs: "EPSG:3857", bbox: expect.stringMatching(/^-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2},-?\d+\.\d{2}$/), width: "512", height: "512",
    });
    expect(CAPAS_PREDIOS.split(",")).toHaveLength(18);
    expect(CAPAS_PREDIOS.split(",").every((c) => /^queretaro:M(0[1-9]|1[0-8])_PA$/.test(c))).toBe(true);
    expect(peticionDeMosaico({ ...QRO, y: "115743.png" }, vacia)).not.toBeNull();
  });

  test("cualquier parámetro del navegador, fuera de rango o fuera de Querétaro → inválida (400)", () => {
    const con = (s: string) => new URLSearchParams(s);
    for (const extra of ["layers=queretaro:M14_MA", "width=2048", "bbox=1,2,3,4", "url=https://otro.sitio", "a=1"]) {
      expect(peticionDeMosaico(QRO, con(extra)), extra).toBeNull();
    }
    for (const malo of [{ z: "16" }, { z: "21" }, { x: "-1" }, { x: "1e5" }, { y: "abc" }, { x: "57968.5" }, { z: "18", x: "999999" }]) {
      expect(peticionDeMosaico({ ...QRO, ...malo }, vacia), JSON.stringify(malo)).toBeNull();
    }
    // Fuera de Querétaro: Ciudad de México (z18) y el meridiano 0.
    expect(peticionDeMosaico({ z: "18", x: "58880", y: "116640" }, vacia)).toBeNull();
    expect(peticionDeMosaico({ z: "18", x: "131072", y: "115743" }, vacia)).toBeNull();
  });
});

// ------------------------------------------------------------- la ruta, con la base y la fuente simuladas

const { estado } = vi.hoisted(() => ({ estado: { permiso: "ok" as string | null } }));
vi.mock("@/lib/supabase/server", () => ({
  crearClienteServidor: async () => ({ rpc: async (fn: string) => ({ data: fn === "catastro_permiso_mosaico" ? estado.permiso : null, error: null }) }),
}));

describe("La ruta responde 400, 403, 429 o el mosaico", () => {
  const pedir = async (consulta = "", p = QRO) => {
    const { GET } = await import("@/app/mapa-catastral/predios/[z]/[x]/[y]/route");
    const { NextRequest } = await import("next/server");
    return GET(new NextRequest(`https://tasa.xgplataform.com/mapa-catastral/predios/${p.z}/${p.x}/${p.y}${consulta}`), { params: Promise.resolve(p) });
  };
  let fuente: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    estado.permiso = "ok";
    fuente = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fuente);
  });
  afterEach(() => vi.unstubAllGlobals());

  test("equipo con el mapa: el mosaico, private por un día", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(String(fuente.mock.calls[0][0])).toContain("srs=EPSG:3857");
  });

  test("con parámetros o fuera de rango: 400 sin preguntar a la fuente", async () => {
    expect((await pedir("?layers=queretaro:M14_MA")).status).toBe(400);
    expect((await pedir("", { ...QRO, z: "15" })).status).toBe(400);
    expect(fuente).not.toHaveBeenCalled();
  });

  test("comisionista o admin_marca (rol) y equipo sin el mapa: 403; pasado el límite: 429", async () => {
    for (const [permiso, status] of [["rol", 403], ["sin_herramienta", 403], [null, 403], ["limite", 429]] as const) {
      estado.permiso = permiso;
      const r = await pedir();
      expect(r.status, String(permiso)).toBe(status);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(fuente).not.toHaveBeenCalled();
  });
});

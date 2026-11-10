import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { aLonLat, aUtm, caja, centroide, contiene, geometriaValida, ligaMaps, puntoInterior, utmAGeografica, type Geometria } from "@/lib/catastro/geo";
import { CAMPOS, centroideDelExpediente, datosDeCapa, limpiarExpediente, tieneLlaveProhibida } from "@/lib/catastro/limpiar";
import { ETIQUETAS, fechaLegible, lineasDeColindancias, SECCIONES, seccionesDeFicha, valorLegible } from "@/lib/catastro/etiquetas";
import type { Ficha } from "@/lib/catastro/servicio";

/**
 * Mapa catastral (0059). Respuestas de IDECATQ INVENTADAS con la misma forma que las reales (nombres de campos
 * vistos en la Fase 0), con datos personales falsos para comprobar que nunca pasan la lista blanca.
 */

const PERSONALES = ["XAXX010101000", "XEXX900101HQTXXX09", "4421234567", "Calle del Dueño 99", "Fulana Ejemplo"];

const propietario = {
  nombre: "Fulana", paterno: "Ejemplo", materno: "Prueba", razonSocial: "", nombreComercial: "", rfc: "XAXX010101000", rfcAlfa: "XAXX",
  rfcFecha: "010101", rfcFechaLetra: "", rfcHomo: "000", curp: "XEXX900101HQTXXX09", telefono: "4421234567", sexo: "F",
  fechaDefuncion: "", isFisica: true, noPersonaFis: 123, noPersonaMor: 0, porcentaje: "100", estatus: "A", fechaCierra: "",
  origenDatos: "x", direccion: { calle: "Calle del Dueño 99", colonia: "Otra", codigoPostal: "76000", municipio: "Querétaro" },
};

const normal = {
  cantidad: 1, ok: true,
  predio: {
    claveCatastral: "060102801101026", claveAnterior: "06-01", claveEstandar: "220060102801101026", estatus: "ACTIVO", tipoPredio: "URBANO",
    desClasificacion: "HABITACIONAL", manzana: "011", fechaAlta: "2001-01-01", fechaMantenimiento: "2025-03-01", fechaValidez: "2026",
    codigoValor: "A1", valorActTer: "1,234,567.50", valorActCon: 800000, valorAntTer: 1000000, valorAntCon: 700000,
    areaTotalTerreno: "160.00", areaTotalConstruccion: 211.02, superficie: 160, tiposConstruccion: ["H2", "H3"],
    numeroEscritura: "4567", fedatario: "Notaría 5", numeroContrato: "C-77", numeroTitulo: "", dependencia: "", origenDatos: "x",
    folioReal: ["00123456"], usosPredio: { clave: "H", des: "HABITACIONAL" },
    movimientos: [{ descripcion: "ALTA", clave: "01", curp: "NO DEBE PASAR" }],
    seriesValor: [{ area: 100, tipo: "H2", areaCons: 100, serie: 1, areaT: 160, factor: 1, nivel: 1, rfc: "XAXX010101000" }],
    centroide: { x: 352000.5, y: 2271000.25 },
    ubicacion: { calle: "Hidalgo", exterior: "10", interior: "", letra: "", tipoCalle: "CALLE", colonia: "El Pueblito", tipoColonia: "COL",
      codigoPostal: "76900", municipio: "Corregidora", localidad: "El Pueblito", manzana: "", lote: "", frente: "", micro: "", referencia: "", estado: "QRO" },
    propietarios: [propietario],
    datosRPPC: {
      ubicacion_especifica: "Hidalgo 10", clave_catastral: "060102801101026", folio_real: "00123456", tipo: "URBANO", area_terreno: "160",
      medidas: "10 x 16", medid_colind: "Al norte 10 m con calle Hidalgo", estatus: "VIGENTE", valor_oper: "1,500,000.00", lote: "7",
      nom_col_bar_otro: "El Pueblito", identificador: "", ok: true,
      propietariosR: [{ nombre_completo: "Fulana Ejemplo Prueba", tipo_adquisicion: "COMPRAVENTA", porcentaje_copropiedad: "100", rfc: "XAXX010101000" }],
    },
  },
};

const condominio = {
  cantidad: 1, ok: true,
  predio: {
    claveCatastral: "060100113059119", tipoPredio: "CONDOMINIO", claCondominio: "CONDOMINIO", tipoCondominio: "VERTICAL",
    nombreCondominio: "Torre Ejemplo", claveOriginal: "060100113059001", indiviso: "1.2345", areaTerrPri: "0", areaTerrCom: "45.5",
    areaConsPri: "85.2", areaConsCom: "12.1", valorTerPri: 0, valorTerCom: 300000, valorConsPri: 900000, valorConsCom: 100000,
    cacoct: "1", vacopt: "0", vatrct: "3", vatrpt: "4", areaTotalTerreno: 45.5, areaTotalConstruccion: 97.3,
    ubicacion: { calle: "Constituyentes", exterior: "200", interior: "301", colonia: "Centro", municipio: "Corregidora" },
    propietarios: [{ ...propietario, razonSocial: "Ejemplo SA de CV" }],
    datosRPPC: { ok: true, propietariosR: [] },
  },
};

describe("Lista blanca", () => {
  test("los campos son los mismos que catastro_campos() de la base", () => {
    // La definición vigente: la de la última migración que la reescribe.
    const dir = join(import.meta.dirname, "..", "supabase", "migrations");
    const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((t) => /function catastro_campos\(\)/.test(t)).at(-1)!;
    const cuerpo = /function catastro_campos\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql)![1];
    const enBase = [...cuerpo.replace(/--.*$/gm, "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(enBase).toEqual([...CAMPOS]);
    expect(Object.keys(ETIQUETAS).sort()).toEqual([...CAMPOS].sort());
  });

  test("ningún dato personal pasa, a ninguna profundidad", () => {
    for (const r of [normal, condominio]) {
      const l = limpiarExpediente(r)!;
      expect(tieneLlaveProhibida(l.datos)).toBe(false);
      // "propietarios" es la columna de la tabla privada; lo que va dentro, sin llaves personales.
      expect(tieneLlaveProhibida(l.privados.propietarios)).toBe(false);
      const texto = JSON.stringify(l.datos);
      for (const p of PERSONALES) expect(texto).not.toContain(p);
      expect(Object.keys(l.datos).every((k) => (CAMPOS as readonly string[]).includes(k))).toBe(true);
      for (const p of l.privados.propietarios) {
        expect(Object.keys(p).every((k) => ["nombre", "porcentaje", "origen", "tipo_adquisicion"].includes(k))).toBe(true);
        const t = JSON.stringify(p);
        for (const x of ["XAXX010101000", "XEXX900101HQTXXX09", "4421234567", "Calle del Dueño"]) expect(t).not.toContain(x);
      }
    }
  });

  test("un apóstrofo suelto en vez de dato cuenta como vacío, igual que los guiones", () => {
    for (const vacio of ["'", " ' ", "’", "---"]) {
      const { datos } = limpiarExpediente({ ...normal, predio: { ...normal.predio, desClasificacion: vacio, claveClasificacion: "" } })!;
      expect(datos.clasificacion, JSON.stringify(vacio)).toBeUndefined();
    }
    const { datos } = limpiarExpediente({ ...normal, predio: { ...normal.predio, desClasificacion: "D'Angelo" } })!;
    expect(datos.clasificacion).toBe("D'Angelo");
  });

  test("predio normal: superficies, valores, Registro Público y lo privado aparte", () => {
    const { datos, privados } = limpiarExpediente(normal)!;
    expect(datos).toMatchObject({
      colonia: "El Pueblito", sup_terreno: 160, sup_construccion: 211.02, valor_terreno: 1234567.5, valor_catastral_total: 2034567.5, folio_real: "00123456",
      uso: "HABITACIONAL", rppc_lote: "7", rppc_medid_colind: "Al norte 10 m con calle Hidalgo", rppc_nom_col_bar_otro: "El Pueblito",
      ubicacion: "CALLE Hidalgo 10, COL El Pueblito, CP 76900, El Pueblito, Corregidora",
    });
    expect(datos.series_valor).toEqual([{ nivel: 1, tipo: "H2", serie: 1, area: 100, areaCons: 100, areaT: 160, factor: 1 }]);
    expect(privados).toEqual({
      propietarios: [
        { nombre: "Fulana Ejemplo Prueba", porcentaje: 100, origen: "catastro" },
        { nombre: "Fulana Ejemplo Prueba", porcentaje: 100, origen: "rppc", tipo_adquisicion: "COMPRAVENTA" },
      ],
      valor_operacion: 1500000, escritura: "4567", notario: "Notaría 5", numero_contrato: "C-77",
    });
    expect(centroideDelExpediente(normal)).toEqual([352000.5, 2271000.25]);
  });

  test("condominio: privativas, comunes, indiviso y los cuatro sin etiqueta con su nombre", () => {
    const { datos, privados } = limpiarExpediente(condominio)!;
    expect(datos).toMatchObject({
      regimen: "CONDOMINIO", tipo_condominio: "VERTICAL", nombre_condominio: "Torre Ejemplo", clave_original: "060100113059001",
      indiviso: 1.2345, sup_terreno_privativa: 0, sup_terreno_comun: 45.5, sup_construccion_privativa: 85.2, sup_construccion_comun: 12.1,
      valor_terreno_comun: 300000, valor_construccion_privativa: 900000, cacoct: 1, vacopt: 0, vatrct: 3, vatrpt: 4,
    });
    expect(privados.propietarios).toEqual([{ nombre: "Ejemplo SA de CV", porcentaje: 100, origen: "catastro" }]);
  });

  test("la capa del mapa: COOR_X/COOR_Y si vienen, sin depender de ellos", () => {
    expect(datosDeCapa({ DGR_CVECAT: "x", FOLIOINMB: "F1", SHAPE_AREA: 160.2, SHAPE_LEN: 52, CVE_MUN: null })).toEqual({
      capa_folio: "F1", capa_area: 160.2, capa_perimetro: 52,
    });
    expect(datosDeCapa({ COOR_X: "352000.1", COOR_Y: 2271000 })).toEqual({ capa_coor_x: 352000.1, capa_coor_y: 2271000 });
  });

  test("una respuesta sin predio (como el mensaje que regresó desde Vercel) no es un expediente", () => {
    expect(limpiarExpediente({ mensaje: "Sin resultados", ok: false })).toBeNull();
  });
});

describe("Geometría", () => {
  const cuadro = (x: number, y: number, l: number): [number, number][] => [[x, y], [x + l, y], [x + l, y + l], [x, y + l], [x, y]];

  test("UTM 14N ida y vuelta (centro de Querétaro)", () => {
    const [x, y] = aUtm(20.5926, -100.392);
    expect(x).toBeCloseTo(354931.4, 0);
    expect(y).toBeCloseTo(2277680.5, 0);
    const [lon, lat] = aLonLat(x, y);
    expect(lat).toBeCloseTo(20.5926, 6);
    expect(lon).toBeCloseTo(-100.392, 6);
  });

  test("Polygon y MultiPolygon: centroide, caja y si contiene un punto", () => {
    const pol: Geometria = { type: "Polygon", coordinates: [cuadro(0, 0, 10)] };
    expect(centroide(pol)).toEqual([5, 5]);
    const multi: Geometria = { type: "MultiPolygon", coordinates: [[cuadro(0, 0, 10)], [cuadro(20, 0, 10)]] };
    expect(centroide(multi)).toEqual([15, 5]);
    expect(contiene(multi, [25, 5])).toBe(true);
    expect(contiene(multi, [15, 5])).toBe(false);
    // Con hueco
    const conHueco: Geometria = { type: "Polygon", coordinates: [cuadro(0, 0, 10), cuadro(4, 4, 2)] };
    expect(contiene(conHueco, [5, 5])).toBe(false);
    expect(contiene(conHueco, [1, 1])).toBe(true);
    expect(caja(multi)).toEqual([0, 10, 0, 30]);
  });

  test("solo acepta Polygon o MultiPolygon y los pasa a latitud/longitud", () => {
    expect(geometriaValida({ type: "Point", coordinates: [1, 2] })).toBeNull();
    expect(geometriaValida({ type: "Polygon", coordinates: [[[1, 2], [3, "x"]]] })).toBeNull();
    const [x, y] = aUtm(20.5926, -100.392);
    const g = geometriaValida({ type: "MultiPolygon", coordinates: [[cuadro(x, y, 20)]] })!;
    const geo = utmAGeografica(g);
    expect(geo.type).toBe("MultiPolygon");
    const [lon, lat] = (geo as { coordinates: [number, number][][][] }).coordinates[0][0][0];
    expect(lat).toBeCloseTo(20.5926, 5);
    expect(lon).toBeCloseTo(-100.392, 5);
  });
});

// ------------------------------------------------------------- el servidor, con IDECATQ y la base simulados

const llamadas: { fn: string; args: Record<string, unknown> }[] = [];
let fichaGuardada: Record<string, unknown> | null = null;

// La sesión del usuario (leer) y la llave de servicio (escribir) comparten esta base simulada.
const { rpc } = vi.hoisted(() => ({ rpc: { fn: null as null | ((fn: string, args?: Record<string, unknown>) => Promise<unknown>) } }));
vi.mock("@/lib/supabase/servicio", () => ({ clienteDeServicio: () => ({ rpc: (fn: string, args?: Record<string, unknown>) => rpc.fn!(fn, args) }) }));
vi.mock("@/lib/supabase/server", () => ({
  encabezadoHumo: async () => null,
  crearClienteServidor: async () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      if (["catastro_guardar", "catastro_registrar_falla"].includes(fn)) throw new Error(`${fn} con la sesión del usuario: solo con la llave de servicio`);
      return rpc.fn!(fn, args);
    },
  }),
}));
rpc.fn = async (fn: string, args: Record<string, unknown> = {}) => {
      llamadas.push({ fn, args });
      if (fn === "catastro_candidatos") return { data: [], error: null };
      if (fn === "catastro_impedimento") return { data: null, error: null };
      if (fn === "catastro_guardar") {
        fichaGuardada = { clave: args.p_clave, municipio: String(args.p_clave).slice(0, 2), geometria: args.p_geometria, latitud: args.p_latitud,
          longitud: args.p_longitud, consultado_en: new Date().toISOString(), expediente: args.p_expediente, campos: args.p_datos };
        return { data: null, error: null };
      }
      if (fn === "catastro_ficha") return { data: fichaGuardada, error: null };
      return { data: null, error: null };
};
const QUIEN = { persona: "11111111-1111-4111-8111-111111111111", organizacion: "22222222-2222-4222-8222-222222222222" };

describe("Si BuscaDatos falla", () => {
  const [x, y] = aUtm(20.5351159, -100.4049751);
  const gfi = {
    features: [{
      id: "M06_PA.123",
      geometry: { type: "Polygon", coordinates: [[[x - 10, y - 10], [x + 10, y - 10], [x + 10, y + 10], [x - 10, y + 10], [x - 10, y - 10]]] },
      properties: { DGR_CVECAT: "060102801101026", CVE_MUN: null, SHAPE_AREA: 400, FOLIOINMB: "F9" },
    }],
  };

  beforeEach(() => {
    llamadas.length = 0;
    fichaGuardada = null;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test("se muestra lo de la capa con aviso, se guarda pendiente (no cuenta) y se anota la falla", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("BuscaDatos")
        ? new Response(JSON.stringify({ mensaje: "error", ok: false }), { status: 200 })
        : new Response(JSON.stringify(gfi), { status: 200 }));
    const { consultarPunto } = await import("@/lib/catastro/servicio");
    const r = await consultarPunto(QUIEN, 20.5351159, -100.4049751);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toMatch(/No se pudo traer el expediente completo/);
    expect(r.aviso).not.toMatch(/IDECATQ|visor|gobierno/i);
    expect(r.ficha.clave).toBe("060102801101026");
    expect(r.ficha.municipio).toBe("06");
    expect(r.ficha.geometria?.type).toBe("Polygon");
    const guardado = llamadas.find((l) => l.fn === "catastro_guardar")!;
    expect(guardado.args.p_expediente).toBe("pendiente");
    expect([guardado.args.p_persona, guardado.args.p_org]).toEqual([QUIEN.persona, QUIEN.organizacion]);
    expect(guardado.args.p_privados).toBeNull();
    expect(guardado.args.p_datos).toEqual({ capa_folio: "F9", capa_area: 400 });
    expect(llamadas.find((l) => l.fn === "catastro_registrar_falla")?.args).toEqual({ p_org: QUIEN.organizacion, p_persona: QUIEN.persona, p_servicio: "expediente" });
  });

  test("si tampoco responde el mapa: un error claro, sin guardar nada", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const { consultarPunto } = await import("@/lib/catastro/servicio");
    const r = await consultarPunto(QUIEN, 20.5351159, -100.4049751);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/^No se pudo consultar la fuente externa en este momento/) });
    expect(llamadas.some((l) => l.fn === "catastro_guardar")).toBe(false);
    expect(llamadas.find((l) => l.fn === "catastro_registrar_falla")?.args).toEqual({ p_org: QUIEN.organizacion, p_persona: QUIEN.persona, p_servicio: "mapa" });
  });

  test("con el expediente: se guarda completo, con lo privado aparte y sin datos personales", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("BuscaDatos") ? new Response(JSON.stringify(normal), { status: 200 }) : new Response(JSON.stringify(gfi), { status: 200 }));
    const { consultarPunto } = await import("@/lib/catastro/servicio");
    const r = await consultarPunto(QUIEN, 20.5351159, -100.4049751);
    expect(r.ok && r.aviso).toBe(null);
    const guardado = llamadas.find((l) => l.fn === "catastro_guardar")!;
    expect(guardado.args.p_expediente).toBe("completo");
    expect(tieneLlaveProhibida(guardado.args.p_datos)).toBe(false);
    const todo = JSON.stringify(guardado.args);
    for (const p of ["XAXX010101000", "XEXX900101HQTXXX09", "4421234567", "Calle del Dueño 99"]) expect(todo).not.toContain(p);
  });
});

describe("La llave de servicio no llega al navegador", () => {
  test("ningún archivo \"use client\" importa el cliente de servicio ni el código que lo usa (solo tipos)", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const raiz = join(import.meta.dirname, "..");
    const archivos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => { const r = join(dir, n); return statSync(r).isDirectory() ? archivos(r) : /\.(ts|tsx)$/.test(n) ? [r] : []; });
    const malos = ["app", "components", "lib"].flatMap((c) => archivos(join(raiz, c))).filter((f) => {
      const t = readFileSync(f, "utf8");
      return /^\s*["']use client["']/.test(t)
        && /^import (?!type )[^;]*from "@\/lib\/(supabase\/servicio|catastro\/servicio|catastro\/idecatq)"/m.test(t);
    });
    expect(malos).toEqual([]);
  });
});

describe("Punto del predio, secciones y prellenado", () => {
  // Coordenadas reales de Querétaro (en grados), donde el centroide calculado sin cuidado se iba hasta 150 m.
  const L = (x: number, y: number) => [-100.3637 + x * 1e-5, 20.5723 + y * 1e-5] as [number, number];
  const casos: Geometria[] = [
    { type: "Polygon", coordinates: [[L(0, 0), L(10, 0), L(10, 18), L(0, 18), L(0, 0)]] },
    // En L: el centroide cae fuera.
    { type: "Polygon", coordinates: [[L(0, 0), L(30, 0), L(30, 4), L(4, 4), L(4, 30), L(0, 30), L(0, 0)]] },
    // En U (cóncavo) y con hueco en medio.
    { type: "Polygon", coordinates: [[L(0, 0), L(30, 0), L(30, 30), L(24, 30), L(24, 6), L(6, 6), L(6, 30), L(0, 30), L(0, 0)]] },
    { type: "Polygon", coordinates: [[L(0, 0), L(20, 0), L(20, 20), L(0, 20), L(0, 0)], [L(5, 5), L(15, 5), L(15, 15), L(5, 15), L(5, 5)]] },
    // Condominio: la unidad y un cajón aparte, lejos.
    { type: "MultiPolygon", coordinates: [[[L(0, 0), L(12, 0), L(12, 10), L(0, 10), L(0, 0)]], [[L(400, 0), L(402, 0), L(402, 5), L(400, 5), L(400, 0)]]] },
  ];

  test("el punto de la liga, el QR y el prellenado siempre cae dentro del polígono (Polygon y MultiPolygon)", () => {
    for (const g of casos) {
      const p = puntoInterior(g);
      expect(contiene(g, p), JSON.stringify(g).slice(0, 60)).toBe(true);
      expect(ligaMaps(p[1], p[0])).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d+\.\d{6},-?\d+\.\d{6}$/);
    }
    // En el condominio, en la unidad (el polígono grande), no en el cajón.
    expect(puntoInterior(casos[4])[0]).toBeLessThan(L(12, 0)[0]);
  });

  test("el centroide en grados ya no pierde precisión (rectángulo: al centro)", () => {
    const [lon, lat] = centroide(casos[0]);
    expect(lon).toBeCloseTo(L(5, 9)[0], 8);
    expect(lat).toBeCloseTo(L(5, 9)[1], 8);
  });

  test("formato: m² y pesos con miles y 2 decimales, indiviso en %, fechas dd/mmm/aaaa, colindancias por lado", () => {
    expect(valorLegible("sup_terreno", 1234.5)).toBe("1,234.50 m²");
    expect(valorLegible("valor_catastral_total", 1234567.891)).toBe("$1,234,567.89");
    expect(valorLegible("indiviso", "1.2345")).toBe("1.2345 %");
    expect(valorLegible("fecha_alta", "2001-03-05")).toBe("05/mar/2001");
    expect(valorLegible("fecha_mantenimiento", "05/11/2025")).toBe("05/nov/2025");
    expect(fechaLegible("2026-11-06T23:20:27.923Z")).toBe("06/nov/2026");
    expect(lineasDeColindancias("AL NORTE 10.00 M CON CALLE HIDALGO AL SUR 10.00 M CON LOTE 8, AL ORIENTE 16 M CON LOTE 6; al poniente 16 m con lote 4"))
      .toEqual(["AL NORTE 10.00 M CON CALLE HIDALGO", "AL SUR 10.00 M CON LOTE 8", "AL ORIENTE 16 M CON LOTE 6", "al poniente 16 m con lote 4"]);
    expect(valorLegible("series_valor", [{ nivel: 1, areaCons: 100 }])).toBe("Nivel 1 · Construcción 100");
    expect(valorLegible("ubicacion", "")).toBeNull();
    expect(valorLegible("ubicacion", "PROL. TRUCHUELO 1004 int. 102 A, CONDOMINIO PUNTA DEL ESTE, CP --, EL PUEBLITO, CORREGIDORA"))
      .toBe("PROL. TRUCHUELO 1004 int. 102 A, CONDOMINIO PUNTA DEL ESTE, EL PUEBLITO, CORREGIDORA");
    // Guardado antes del total: se suma al mostrar.
    const viejo = { clave: "140100136031048", municipio: "14", consultado_en: "2026-11-06T18:00:00Z", expediente: "completo", geometria: null,
      latitud: null, longitud: null, campos: { valor_terreno: 100, valor_construccion: 50.5 } } as unknown as Ficha;
    expect(seccionesDeFicha(viejo).find((s) => s.id === "valores")!.filas.at(-1)).toEqual(["Total", "$150.50"]);
  });

  test("cada campo del catálogo está en una sección, y las secciones van en el orden pedido", () => {
    const enSecciones = SECCIONES.flatMap((s) => s.campos);
    expect([...enSecciones].sort()).toEqual([...CAMPOS].sort());
    expect(new Set(enSecciones).size).toBe(enSecciones.length);
    expect(SECCIONES.map((s) => s.titulo)).toEqual(["Identificación", "Ubicación", "Superficies", "Valores catastrales", "Medidas y colindancias",
      "Datos del registro", "Propietario y operación", "Historial de cambios"]);
  });

  test("lo del comisionista: sin campos vacíos ni secciones vacías; nada de equipo", () => {
    const f = { clave: "060100113059119", municipio: "06", consultado_en: "2026-11-06T18:00:00Z", expediente: "completo", geometria: null,
      latitud: null, longitud: null,
      campos: { ubicacion: "Constituyentes 200 int. 301, Centro", sup_terreno: 45.5, sup_construccion: 97.3, indiviso: 1.2345, sup_terreno_privativa: 0,
        valor_terreno: 300000, valor_construccion: 900000, valor_catastral_total: 1200000, rppc_medid_colind: "" } } as unknown as Ficha;
    const s = seccionesDeFicha(f);
    expect(s.map((x) => x.id)).toEqual(["identificacion", "ubicacion", "superficies", "valores"]);
    expect(s[0].filas).toEqual([["Clave catastral", "060100113059119"], ["Municipio", "Corregidora"]]);
    expect(s[2].filas.map(([e]) => e)).toEqual(["Superficie de terreno (catastro)", "Construcción total", "Terreno privativo", "Indiviso"]);
    expect(s[3].filas).toEqual([["Terreno", "$300,000.00"], ["Construcción", "$900,000.00"], ["Total", "$1,200,000.00"]]);
  });

  test("prellenado: la calculadora recibe clave, municipio y valor catastral total; la solicitud, la clave", async () => {
    const { inicialCalculadora, inicialSolicitudDelMapa } = await import("@/lib/catastro/prellenado");
    const municipios = ["Corregidora", "Querétaro"];
    expect(inicialCalculadora({ clave: "140100136031048", municipio: "Querétaro", valor_catastral: "3584484.90" }, municipios))
      .toEqual({ clave_catastral: "140100136031048", municipio: "Querétaro", valor_catastral: "3584484.90" });
    expect(inicialCalculadora({ clave: "14 01 001", municipio: "Marte", valor_catastral: "abc" }, municipios)).toEqual({ clave_catastral: "1401001" });
    expect(inicialSolicitudDelMapa({ clave: "140100136031048", municipio: "Querétaro", direccion: "Calle 1" }))
      .toEqual({ clave: "140100136031048", municipio: "Querétaro", direccion: "Calle 1", descripcion: "" });
  });
});

describe("Fuente sin nombrar y PDF", () => {
  const fichaCompleta = (privados: boolean): Ficha => ({
    clave: "060100113059119", municipio: "06", consultado_en: "2026-11-06T18:00:00Z", expediente: "completo" as const,
    latitud: 20.5362814, longitud: -100.3865429,
    geometria: { type: "MultiPolygon" as const, coordinates: [[[[-100.3866, 20.5362], [-100.3864, 20.5362], [-100.3864, 20.5364], [-100.3866, 20.5364], [-100.3866, 20.5362]]],
      [[[-100.3863, 20.5362], [-100.38625, 20.5362], [-100.38625, 20.53625], [-100.3863, 20.53625], [-100.3863, 20.5362]]]] },
    campos: {
      ...Object.fromEntries((CAMPOS as readonly string[]).map((c) => [c, ETIQUETAS[c as keyof typeof ETIQUETAS][1] === "texto" ? "Texto de ejemplo ñ á é" : 123.45])),
      series_valor: [{ nivel: 1, tipo: "H2", area: 100 }], movimientos: [{ clave: "01", descripcion: "ALTA" }],
      // Llaves fuera del catálogo: nunca se imprimen.
      curp: "XEXX900101HQTXXX09", telefono: "4421234567",
    },
    privados: privados ? { propietarios: [{ nombre: "Propietaria Ejemplo", porcentaje: 100, origen: "rppc" as const, tipo_adquisicion: "COMPRAVENTA" }],
      valor_operacion: 2900000, escritura: "123", notario: "Notaría 1", numero_contrato: "C-1", actualizado_en: "2026-11-06T18:00:00Z" } : undefined,
  }) as unknown as Ficha;

  test("el texto del PDF y de la pantalla no nombra la fuente", async () => {
    const { contenidoPdf } = await import("@/lib/catastro/pdf");
    const { NOTA_FUENTE } = await import("@/lib/catastro/textos");
    expect(NOTA_FUENTE).toBe("La información proviene de una fuente pública externa a Tasa, puede cambiar o no estar disponible, y no tiene validez oficial. Para trámites, verifica con la autoridad correspondiente.");
    const todo = JSON.stringify(contenidoPdf(fichaCompleta(true)));
    expect(todo).not.toMatch(/IDECATQ|catastroedo|visor|gobierno/i);
    const pantalla = readFileSync(join(import.meta.dirname, "..", "app", "mapa-catastral", "mapa.tsx"), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*|const WMS|\+ `&layers)/.test(l)).join("\n");
    expect(pantalla).not.toMatch(/IDECATQ|gobierno/i);
  });

  test("el PDF del comisionista: sin propietario ni operación y sin llaves fuera del catálogo", async () => {
    const { contenidoPdf } = await import("@/lib/catastro/pdf");
    const c = contenidoPdf(fichaCompleta(false));
    expect(c.secciones.map((s) => s.id)).not.toContain("propietario");
    const texto = JSON.stringify(c);
    for (const x of ["Propietari", "XEXX900101HQTXXX09", "4421234567", "Notaría", "2,900,000"]) expect(texto).not.toContain(x);
    const conEquipo = contenidoPdf(fichaCompleta(true)).secciones.find((s) => s.id === "propietario")!;
    expect(conEquipo.filas[0]).toEqual(["Propietario (Registro Público)", "Propietaria Ejemplo · 100 % · COMPRAVENTA"]);
  });

  test("ningún texto del PDF usa un símbolo que la tipografía no tenga, y el PDF se arma (croquis, QR)", async () => {
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const { PDFDocument } = await import("pdf-lib");
    const { contenidoPdf, pdfPredio } = await import("@/lib/catastro/pdf");
    const { fuentesDe } = await import("@/lib/fuentes-pdf");
    const f = fontkit.create(readFileSync(join(import.meta.dirname, "..", "assets", "fuentes", "manrope-400.ttf"))) as unknown as { hasGlyphForCodePoint: (c: number) => boolean };
    const c = contenidoPdf(fichaCompleta(true));
    const textos = [c.titulo, c.subtitulo, c.croquis, c.sinPoligono, c.ligaTitulo, c.liga ?? "", c.nota, "Hoja 1 de 2", "N", "0", "10 m",
      ...c.secciones.flatMap((s) => [s.titulo, ...s.filas.flat()]), ...Object.values(ETIQUETAS).map(([e]) => e)];
    const faltan = textos.flatMap((t) => [...t].filter((ch) => !f.hasGlyphForCodePoint(ch.codePointAt(0)!)).map((ch) => `${ch} en "${t.slice(0, 50)}"`));
    expect(faltan).toEqual([]);
    const pdf = await PDFDocument.load(await pdfPredio(fichaCompleta(true), await fuentesDe("manrope")));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    const sinPoligono = await PDFDocument.load(await pdfPredio({ ...fichaCompleta(false), geometria: null, latitud: null, longitud: null,
      campos: { colonia: "Centro", ubicacion: "Calle 1, Centro", sup_terreno: 160, sup_construccion: 211.02, indiviso: 1.2345 } }, await fuentesDe("manrope")));
    // Lo del comisionista (lo básico) cabe en una hoja.
    expect(sinPoligono.getPageCount()).toBe(1);
  });

  test("escala gráfica con números redondos", async () => {
    const { escalaRedonda } = await import("@/lib/catastro/pdf");
    expect([escalaRedonda(7), escalaRedonda(13), escalaRedonda(38), escalaRedonda(160)]).toEqual([5, 10, 50, 200]);
  });
});

describe("Capa de predios solo para el equipo", () => {
  const base = { token: "tok", origen: "https://tasa.xgplataform.com", contorno: "#006db3", relleno: "#5aa9e6" };

  test("comisionista y admin_marca: el estilo del mapa no tiene la capa, así que el navegador nunca pide sus mosaicos", async () => {
    const { estiloMapa } = await import("@/lib/catastro/estilo");
    const e = estiloMapa({ ...base, lineas: false });
    expect(Object.keys(e.sources)).toEqual(["satelite", "seleccion"]);
    expect(e.layers.map((l) => l.id)).toEqual(["satelite", "seleccion-relleno", "seleccion-borde"]);
    const texto = JSON.stringify(e);
    for (const x of ["/mapa-catastral/predios", "catastroedo", "IDECATQ", "attribution"]) expect(texto).not.toContain(x);
  });

  test("equipo: con la capa (por Tasa); el predio elegido con los colores de Tasa", async () => {
    const { estiloMapa } = await import("@/lib/catastro/estilo");
    const e = estiloMapa({ ...base, lineas: true });
    expect(JSON.stringify(e.sources)).toContain("https://tasa.xgplataform.com/mapa-catastral/predios/{z}/{x}/{y}");
    expect(JSON.stringify(e)).not.toContain("catastroedo");
    const relleno = e.layers.find((l) => l.id === "seleccion-relleno") as { paint: Record<string, unknown> };
    const borde = e.layers.find((l) => l.id === "seleccion-borde") as { paint: Record<string, unknown> };
    expect([relleno.paint["fill-color"], borde.paint["line-color"]]).toEqual(["#5aa9e6", "#006db3"]);
    // Y en el tema: el contorno es --acento y el relleno --mapa-relleno.
    const css = readFileSync(join(import.meta.dirname, "..", "app", "globals.css"), "utf8");
    expect(css).toMatch(/--acento:\s*#006db3/i);
    expect(css).toMatch(/--mapa-relleno:\s*#5aa9e6/i);
  });

  test("la pantalla del mapa no nombra la fuente ni usa el control de atribución de MapLibre", () => {
    const pantalla = readFileSync(join(import.meta.dirname, "..", "app", "mapa-catastral", "mapa.tsx"), "utf8");
    expect(pantalla).not.toMatch(/catastroedo|IDECATQ|AttributionControl/);
    expect(pantalla).toContain("© Mapbox © Maxar");
    const pagina = readFileSync(join(import.meta.dirname, "..", "app", "mapa-catastral", "page.tsx"), "utf8");
    expect(pagina).not.toMatch(/IDECATQ|catastroedo|Consultas a catastro/);
  });
});

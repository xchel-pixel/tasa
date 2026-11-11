/* eslint-disable @typescript-eslint/no-explicit-any -- las respuestas de Notion se revisan campo por campo en las aserciones */
import { describe, expect, test } from "vitest";
import { conectorNotion, descripcionesDePago, fallaDeNotion, leerPagina, prefijoDelDia, propiedadesDeTramite, siguienteConsecutivo } from "@/lib/conectores/notion";
import type { ConfigConector, TramitePorCrear } from "@/lib/conectores/tipos";

/**
 * El conector Notion sin red: un `fetch` falso que responde como Notion.
 * Lo que se prueba es lo que escribimos y cómo leemos, con los nombres
 * reales de la base de Trámites.
 */

const config: ConfigConector = {
  id: "c2",
  organizacion_id: "xg",
  tipo: "notion",
  configuracion: { base_de_datos: "db1", valor_cancelado: "Cancelado", etapa_inicial: "Por asignar", clasificacion: "Trámite", medio: "Tasa" },
  mapeo_campos: {
    titulo: "Projects", etapa: "Etapa", fecha_visita: "Fecha de visita", tipo_tramite: "Tipo de Trámite",
    clasificacion: "Clasificación", medio: "Medio de solicitud", fecha_aceptacion: "Fecha de aceptación",
    requiere_factura: "Requiere factura", solicitado_por: "Solicitado por", clave_catastral: "Clave Catastral",
    descripcion: "Descripción", contacto_nombre: "Nombre Contacto", contacto_telefono: "# Contacto",
    contacto_correo: "Correro Contacto", cotizacion: "Cotización",
  },
  ultimo_sync: null,
  prefijo_folio: "MGP",
};

const tramite: TramitePorCrear = {
  solicitud_id: "s1",
  cliente_nombre: "Laura Méndez",
  cliente_telefono: "4421111111",
  cliente_correo: null,
  servicio: "Avalúo Comercial",
  inmueble_direccion: "Av. Zaragoza 120",
  inmueble_municipio: "Querétaro",
  inmueble_clave_catastral: "060100101404002",
  inmueble_descripcion: null,
  requiere_factura: true,
  monto_honorarios: 12000,
  monto_terceros: 1500,
  aceptada_en: "2026-10-28T17:00:00Z",
  comisionista: "Beto Prueba",
  marca: "MGP",
};

describe("conector Notion", () => {
  test("la página nueva: honorarios sin IVA en Cotización, terceros solo en la descripción, nunca Honorario", () => {
    const p = propiedadesDeTramite(tramite, config.mapeo_campos, config.configuracion) as Record<string, any>;
    expect(p["Projects"].title[0].text.content).toBe("Pendiente de folio – Laura Méndez");
    expect(p["Etapa"].select.name).toBe("Por asignar");
    expect(p["Medio de solicitud"].select.name).toBe("Tasa");
    expect(p["Tipo de Trámite"].select.name).toBe("Avalúo Comercial");
    expect(p["Cotización"].number).toBe(12000);
    expect(p["Requiere factura"].checkbox).toBe(true);
    expect(p["Descripción"].rich_text[0].text.content).toContain("Derechos y terceros");
    expect(p["Honorario"]).toBeUndefined();
    expect(p["Correro Contacto"]).toBeUndefined(); // sin correo, no se escribe
  });

  test("lee folio del título, etapa y fecha de visita", () => {
    const l = leerPagina(
      {
        id: "p1",
        properties: {
          Projects: { type: "title", title: [{ plain_text: "MGP-2026-0701 " }, { plain_text: "Laura Méndez" }] },
          Etapa: { type: "select", select: { name: "En proceso" } },
          "Fecha de visita": { type: "date", date: { start: "2026-11-03T10:00:00.000-06:00" } },
        },
      },
      config.mapeo_campos
    );
    expect(l).toEqual({ externo_id: "p1", titulo: "MGP-2026-0701 Laura Méndez", etapa: "En proceso", fecha_visita: "2026-11-03" });
  });

  test("traduce los errores de Notion a fallas que admin_org entiende", () => {
    expect(fallaDeNotion(401, { code: "unauthorized" }).codigo).toBe("credencial_invalida");
    expect(fallaDeNotion(404, { code: "object_not_found" }).codigo).toBe("inaccesible");
    expect(fallaDeNotion(429, { code: "rate_limited" }).codigo).toBe("limite");
    expect(fallaDeNotion(400, { code: "validation_error", message: "Etapa is not a property that exists." }).codigo).toBe(
      "propiedad_no_encontrada"
    );
  });

  test("probar avisa qué propiedad falta; leer recorre todas las páginas con el filtro de Tasa", async () => {
    const llamadas: { url: string; cuerpo: any }[] = [];
    const respuestas: Record<string, any[]> = {
      "/databases/db1": [{ properties: { Projects: { type: "title" }, Etapa: { type: "select" } } }],
      "/databases/db1/query": [
        { results: [{ id: "a", properties: {} }], has_more: true, next_cursor: "k2" },
        { results: [{ id: "b", properties: {} }], has_more: false, next_cursor: null },
      ],
    };
    const falso = (async (url: string, init?: RequestInit) => {
      const ruta = url.replace("https://api.notion.com/v1", "");
      llamadas.push({ url: ruta, cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(respuestas[ruta].shift()), { status: 200 });
    }) as typeof fetch;

    const notion = conectorNotion(config, "ntn_x", falso);
    await expect(notion.probar()).rejects.toThrow('No existe la propiedad "Fecha de visita"');

    const lecturas = await notion.leerCambios(new Date("2026-10-01T00:00:00Z"));
    expect(lecturas.map((l) => l.externo_id)).toEqual(["a", "b"]);
    const primera = llamadas.find((l) => l.url === "/databases/db1/query")!.cuerpo;
    expect(primera.filter.and).toContainEqual({ property: "Medio de solicitud", select: { equals: "Tasa" } });
    expect(llamadas.filter((l) => l.url === "/databases/db1/query")[1].cuerpo.start_cursor).toBe("k2");
  });
});

describe("Cancelar y páginas borradas", () => {
  /** Un fetch falso que responde por ruta y método, y anota lo que se mandó. */
  function notionFalso(respuestas: Record<string, { status: number; cuerpo: unknown }>) {
    const llamadas: { metodo: string; ruta: string; cuerpo: any }[] = [];
    const falso = (async (url: string, init?: RequestInit) => {
      const ruta = url.replace("https://api.notion.com/v1", "");
      const metodo = init?.method ?? "GET";
      llamadas.push({ metodo, ruta, cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      const r = respuestas[`${metodo} ${ruta}`] ?? { status: 404, cuerpo: { code: "object_not_found" } };
      return new Response(JSON.stringify(r.cuerpo), { status: r.status });
    }) as typeof fetch;
    return { notion: conectorNotion(config, "ntn_x", falso), llamadas };
  }

  test("cancelar en Tasa escribe la Etapa \"Cancelado\" en la página", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /pages/p1": { status: 200, cuerpo: { id: "p1", archived: false, in_trash: false } },
      "PATCH /pages/p1": { status: 200, cuerpo: { id: "p1" } },
    });
    expect(await notion.marcarCancelado("p1", "Cancelado")).toBe(true);
    const parche = llamadas.find((l) => l.metodo === "PATCH")!;
    expect(parche.cuerpo).toEqual({ properties: { Etapa: { select: { name: "Cancelado" } } } });
  });

  test("una página borrada, archivada o en la papelera ya no existe (y no se le escribe)", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /pages/archivada": { status: 200, cuerpo: { id: "archivada", archived: true } },
      "GET /pages/papelera": { status: 200, cuerpo: { id: "papelera", in_trash: true } },
      "GET /pages/viva": { status: 200, cuerpo: { id: "viva", archived: false } },
    });
    expect(await notion.existe("borrada")).toBe(false);
    expect(await notion.existe("archivada")).toBe(false);
    expect(await notion.existe("papelera")).toBe(false);
    expect(await notion.existe("viva")).toBe(true);
    expect(await notion.marcarCancelado("borrada", "Cancelado")).toBe(false);
    expect(llamadas.some((l) => l.metodo === "PATCH")).toBe(false);
  });

  test("al fijar el honorario final de un estimado, se reescribe Cotización", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /pages/p2": { status: 200, cuerpo: { id: "p2", archived: false } },
      "PATCH /pages/p2": { status: 200, cuerpo: { id: "p2" } },
    });
    expect(await notion.actualizarMonto("p2", 4000)).toBe(true);
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).toEqual({ properties: { [config.mapeo_campos.cotizacion]: { number: 4000 } } });
    expect(await notion.actualizarMonto("borrada", 4000)).toBe(false);
  });

  test("al asignar comisionista se reescribe SOLO Solicitado por", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /pages/p3": { status: 200, cuerpo: { id: "p3", archived: false } },
      "PATCH /pages/p3": { status: 200, cuerpo: { id: "p3" } },
    });
    expect(await notion.actualizarSolicitadoPor("p3", "Beto Prueba")).toBe(true);
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).toEqual({
      properties: { "Solicitado por": { rich_text: [{ type: "text", text: { content: "Beto Prueba" } }] } },
    });
    expect(await notion.actualizarSolicitadoPor("borrada", "Beto Prueba")).toBe(false);
    expect(llamadas.filter((l) => l.metodo === "PATCH")).toHaveLength(1);
  });
});

describe("Comisiones, bono y pagos (0052)", () => {
  const conComisiones: ConfigConector = {
    ...config,
    configuracion: {
      ...config.configuracion,
      base_comisionistas: "ds_com", base_pagos: "ds_pagos", base_cuentas: "ds_cuentas", base_categorias: "ds_cat",
      categoria_pagos: "Tasa", entidad_pagos: "ROMI/MGP",
    },
    mapeo_campos: {
      ...config.mapeo_campos,
      ext_comisionista: "Ext Comisionista", ext_comision: "Ext Comisión", ref_comisionista: "Ref Comisionista", ref_bono: "Ref Bono",
    },
  };

  function notionFalso(respuestas: Record<string, (cuerpo: any) => { status: number; cuerpo: unknown }>) {
    const llamadas: { metodo: string; ruta: string; version: string; cuerpo: any }[] = [];
    let n = 0;
    const falso = (async (url: string, init?: RequestInit) => {
      const ruta = url.replace("https://api.notion.com/v1", "");
      const metodo = init?.method ?? "GET";
      const cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
      llamadas.push({ metodo, ruta, version: (init?.headers as Record<string, string>)["Notion-Version"], cuerpo });
      const f = respuestas[`${metodo} ${ruta}`];
      const r = f ? f(cuerpo) : metodo === "POST" && ruta === "/pages" ? { status: 200, cuerpo: { id: `nueva-${++n}` } } : { status: 404, cuerpo: { code: "object_not_found" } };
      return new Response(JSON.stringify(r.cuerpo), { status: r.status });
    }) as typeof fetch;
    return { notion: conectorNotion(conComisiones, "ntn_x", falso), llamadas };
  }
  const titulo = (prop: string) => () => ({ status: 200, cuerpo: { properties: { [prop]: { type: "title" } } } });
  const filas = (prop: string, nombres: string[]) => () => ({
    status: 200,
    cuerpo: { results: nombres.map((t, i) => ({ id: `0000000${i}-aaaa-bbbb-cccc-dddddddddddd`, properties: { [prop]: { title: [{ plain_text: t }] } } })) },
  });

  test("Ext Comisión y Ext Comisionista; sin página, la relación queda vacía", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /pages/p1": () => ({ status: 200, cuerpo: { id: "p1" } }),
      "PATCH /pages/p1": () => ({ status: 200, cuerpo: { id: "p1" } }),
    });
    expect(await notion.actualizarComision("p1", 2006.724, "22bf127050c080a7a0dcdf4e9c734734")).toBe(true);
    expect(await notion.actualizarReferido("p1", 0, null)).toBe(true);
    const parches = llamadas.filter((l) => l.metodo === "PATCH").map((l) => l.cuerpo.properties);
    expect(parches[0]).toEqual({ "Ext Comisión": { number: 2006.72 }, "Ext Comisionista": { relation: [{ id: "22bf127050c080a7a0dcdf4e9c734734" }] } });
    expect(parches[1]).toEqual({ "Ref Bono": { number: 0 }, "Ref Comisionista": { relation: [] } });
  });

  test("Crédito Tasa y Costo crédito: sin las dos propiedades en el mapeo no se escribe nada", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /pages/p1": () => ({ status: 200, cuerpo: { id: "p1" } }),
      "PATCH /pages/p1": () => ({ status: 200, cuerpo: { id: "p1" } }),
    });
    await expect(notion.actualizarCredito("p1", 3850, 350)).rejects.toThrow("credito_tasa");
    expect(llamadas.filter((l) => l.metodo === "PATCH")).toEqual([]);
    const conCredito = { ...conComisiones, mapeo_campos: { ...conComisiones.mapeo_campos, credito_tasa: "Crédito Tasa", costo_credito: "Costo crédito" } };
    const llamadas2: { metodo: string; cuerpo: any }[] = [];
    const falso2 = (async (_url: string, init?: RequestInit) => {
      llamadas2.push({ metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "p1" }), { status: 200 });
    }) as typeof fetch;
    expect(await conectorNotion(conCredito, "ntn_x", falso2).actualizarCredito("p1", 3850.004, 349.996)).toBe(true);
    expect(llamadas2.find((l) => l.metodo === "PATCH")?.cuerpo.properties).toEqual({ "Crédito Tasa": { number: 3850 }, "Costo crédito": { number: 350 } });
  });

  test("Honorarios estatus: sin la propiedad en el mapeo no escribe; con ella, la selección", async () => {
    const { notion, llamadas } = notionFalso({ "GET /pages/p1": () => ({ status: 200, cuerpo: { id: "p1" } }) });
    await expect(notion.actualizarHonorariosEstatus("p1", "Pagado")).rejects.toThrow("honorarios_estatus");
    expect(llamadas.filter((l) => l.metodo === "PATCH")).toEqual([]);
    const conEstatus = { ...conComisiones, mapeo_campos: { ...conComisiones.mapeo_campos, honorarios_estatus: "Honorarios estatus" } };
    const llamadas2: { metodo: string; cuerpo: any }[] = [];
    const falso2 = (async (_url: string, init?: RequestInit) => {
      llamadas2.push({ metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ id: "p1" }), { status: 200 });
    }) as typeof fetch;
    expect(await conectorNotion(conEstatus, "ntn_x", falso2).actualizarHonorariosEstatus("p1", "No Pagado 🔥")).toBe(true);
    expect(llamadas2.find((l) => l.metodo === "PATCH")?.cuerpo.properties).toEqual({ "Honorarios estatus": { select: { name: "No Pagado 🔥" } } });
  });

  test("el consecutivo del día y las descripciones", () => {
    expect(prefijoDelDia("2026-11-10")).toBe("26/11/10-");
    expect(siguienteConsecutivo(["26/11/10-002", "26/11/10-010", "26/11/09-099", "otro"], "26/11/10-")).toBe(11);
    expect(siguienteConsecutivo([], "26/11/10-")).toBe(1);
    const d = descripcionesDePago({
      pago_id: "g", anular: false, fecha: "2026-11-10", monto: 2306.72, bono: 300, comisionista: "Mitzi Correa", pagina: null,
      cuenta: null, origen: "Scotiabank XG", referencia: "SPEI 1", folios: "MGP-2026-0671", registro: "Gaby",
    });
    expect(d.comision).toBe("Pago de comisión externa a Mitzi Correa: MGP-2026-0671 · Scotiabank XG · ref. SPEI 1 · Registrado desde Tasa por Gaby");
    expect(d.bono).toContain("Bono de referido pagado a Mitzi Correa");
  });

  test("un pago con bono: dos movimientos en Cobros y Gastos, el bono sin relación; anularlo los pone en negativo", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /data_sources/ds_pagos": titulo("Projects"),
      "GET /data_sources/ds_cuentas": titulo("Projects"),
      "GET /data_sources/ds_cat": titulo("Name"),
      "POST /data_sources/ds_pagos/query": filas("Projects", ["26/11/10-001", "26/11/10-002"]),
      "POST /data_sources/ds_cuentas/query": filas("Projects", ["Scotiabank XG 4246"]),
      "POST /data_sources/ds_cat/query": filas("Name", ["Tasa"]),
    });
    const pago = {
      pago_id: "g1", anular: false, fecha: "2026-11-10", monto: 2306.72, bono: 300, comisionista: "Mitzi Correa",
      pagina: "22bf127050c080a7a0dcdf4e9c734734", cuenta: "Scotiabank XG 4246", origen: "Scotiabank XG", referencia: null,
      folios: "MGP-2026-0671", registro: "Gaby",
    };
    const r = await notion.registrarPago(pago);
    expect(r).toEqual({ ids: ["nueva1", "nueva2"], avisos: null });
    const creadas = llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/pages");
    expect(creadas.every((l) => l.version === "2025-09-03" && l.cuerpo.parent.data_source_id === "ds_pagos")).toBe(true);
    const [comision, bono] = creadas.map((l) => l.cuerpo.properties);
    expect(comision["Projects"].title[0].text.content).toBe("26/11/10-003");
    expect(bono["Projects"].title[0].text.content).toBe("26/11/10-004");
    expect(comision["Monto Reportado"]).toEqual({ number: 2006.72 });
    expect(comision["Ext Comisionista"]).toEqual({ relation: [{ id: "22bf127050c080a7a0dcdf4e9c734734" }] });
    expect(comision["Tipo de cuenta"]).toEqual({ select: { name: "Gasto" } });
    expect(comision["Entidad"]).toEqual({ select: { name: "ROMI/MGP" } });
    expect(comision["Fecha del Movimiento"]).toEqual({ date: { start: "2026-11-10" } });
    expect(comision["Cuenta"]).toEqual({ relation: [{ id: "00000000aaaabbbbccccdddddddddddd" }] });
    expect(comision["Categoría"]).toEqual({ relation: [{ id: "00000000aaaabbbbccccdddddddddddd" }] });
    expect(comision["Trámite"]).toBeUndefined();
    expect(bono["Monto Reportado"]).toEqual({ number: 300 });
    expect(bono["Ext Comisionista"]).toEqual({ relation: [] });

    const anulado = await notion.registrarPago({ ...pago, anular: true, bono: 0 });
    const [neg] = llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/pages").slice(2).map((l) => l.cuerpo.properties);
    expect(anulado.ids).toHaveLength(1);
    expect(neg["Monto Reportado"]).toEqual({ number: -2306.72 });
    expect(neg["Descripción"].rich_text[0].text.content.startsWith("ANULACIÓN · ")).toBe(true);
  });

  test("sin cuenta de Notion o sin página: se escribe igual y avisa qué faltó", async () => {
    const { notion } = notionFalso({
      "GET /data_sources/ds_pagos": titulo("Projects"),
      "GET /data_sources/ds_cat": titulo("Name"),
      "POST /data_sources/ds_pagos/query": filas("Projects", []),
      "POST /data_sources/ds_cat/query": filas("Name", ["Tasa"]),
    });
    const r = await notion.registrarPago({
      pago_id: "g2", anular: false, fecha: "2026-11-10", monto: 500, bono: 0, comisionista: "Beto", pagina: null,
      cuenta: null, origen: "Otra", referencia: null, folios: null, registro: null,
    });
    expect(r.ids).toHaveLength(1);
    expect(r.avisos).toBe("sin Cuenta (el origen del pago no tiene cuenta de Notion), sin Ext Comisionista (no tiene Página en Notion)");
  });

  test("buscar y crear en la base de comisionistas", async () => {
    const { notion, llamadas } = notionFalso({
      "GET /data_sources/ds_com": titulo("Name"),
      "POST /data_sources/ds_com/query": filas("Name", ["Mitzi Correa"]),
    });
    expect(await notion.buscarComisionistas("Mitzi")).toEqual([{ id: "00000000aaaabbbbccccdddddddddddd", nombre: "Mitzi Correa" }]);
    const nueva = await notion.crearComisionista(" Ana Prueba ");
    expect(nueva).toEqual({ id: "nueva1", nombre: "Ana Prueba" });
    const creada = llamadas.find((l) => l.ruta === "/pages")!;
    expect(creada.cuerpo).toEqual({ parent: { type: "data_source_id", data_source_id: "ds_com" }, properties: { Name: { title: [{ type: "text", text: { content: "Ana Prueba" } }] } } });
  });
});

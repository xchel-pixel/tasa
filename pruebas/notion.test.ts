/* eslint-disable @typescript-eslint/no-explicit-any -- las respuestas de Notion se revisan campo por campo en las aserciones */
import { describe, expect, test } from "vitest";
import { conectorNotion, fallaDeNotion, leerPagina, propiedadesDeTramite } from "@/lib/conectores/notion";
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

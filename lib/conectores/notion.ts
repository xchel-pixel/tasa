import { FallaConector, type ConfigConector, type Conector, type Lectura, type TramitePorCrear } from "./tipos";

/**
 * Conector Notion, con `fetch` y sin librerías. Usa la versión
 * 2022-06-28 de la API, que sigue funcionando con bases de una sola
 * fuente de datos como Trámites.
 *
 * Qué escribe al crear: lo que diga `mapeo_campos` (una propiedad vacía
 * no se escribe). Qué lee: título (folio), etapa y fecha de visita, solo
 * de las páginas cuyo "medio" es el de Tasa.
 */

const API = "https://api.notion.com/v1";
const VERSION = "2022-06-28";

type Propiedades = Record<string, unknown>;

const texto = (contenido: string) => [{ type: "text", text: { content: contenido.slice(0, 2000) } }];

const pesos = (n: number) =>
  n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * Las propiedades de la página nueva. Los honorarios van SIN IVA en
 * "Cotización" (Notion calcula su IVA sobre ella, igual que Tasa); los
 * terceros solo en la descripción. Nunca "Honorario" (costo interno).
 */
export function propiedadesDeTramite(t: TramitePorCrear, mapeo: Record<string, string>, config: Record<string, string>): Propiedades {
  const p: Propiedades = {};
  const poner = (clave: string, valor: unknown) => {
    const nombre = mapeo[clave]?.trim();
    if (nombre && valor !== undefined && valor !== null && valor !== "") p[nombre] = valor;
  };

  poner("titulo", { title: texto(`Pendiente de folio – ${t.cliente_nombre}`) });
  if (config.etapa_inicial) poner("etapa", { select: { name: config.etapa_inicial } });
  // Solo una opción que ya existe en Notion: sin nombre en Notion, no se manda.
  if (t.servicio) poner("tipo_tramite", { select: { name: t.servicio } });
  if (config.clasificacion) poner("clasificacion", { select: { name: config.clasificacion } });
  if (config.medio) poner("medio", { select: { name: config.medio } });
  poner("fecha_aceptacion", { date: { start: t.aceptada_en.slice(0, 10) } });
  poner("requiere_factura", { checkbox: t.requiere_factura });
  poner("solicitado_por", { rich_text: texto(t.comisionista) });
  if (t.inmueble_clave_catastral) poner("clave_catastral", { rich_text: texto(t.inmueble_clave_catastral) });

  const descripcion = [
    [t.inmueble_direccion, t.inmueble_municipio].filter(Boolean).join(", "),
    t.inmueble_descripcion,
    t.monto_terceros > 0 ? `Derechos y terceros: ${pesos(t.monto_terceros)}` : null,
    `Desde Tasa · ${t.comisionista}${t.marca ? ` · ${t.marca}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  poner("descripcion", { rich_text: texto(descripcion) });

  poner("contacto_nombre", { rich_text: texto(t.cliente_nombre) });
  if (t.cliente_telefono) poner("contacto_telefono", { phone_number: t.cliente_telefono });
  if (t.cliente_correo) poner("contacto_correo", { email: t.cliente_correo });
  poner("cotizacion", { number: Number(t.monto_honorarios) });
  return p;
}

type PaginaNotion = { id: string; properties: Record<string, { type: string; [k: string]: unknown }> };

/** Título, etapa y fecha de visita de una página, según el mapeo. */
export function leerPagina(pagina: PaginaNotion, mapeo: Record<string, string>): Lectura {
  const prop = (clave: string) => (mapeo[clave] ? pagina.properties[mapeo[clave]] : undefined);
  const titulo = prop("titulo") as { title?: { plain_text: string }[] } | undefined;
  const etapa = prop("etapa") as { select?: { name: string } | null; status?: { name: string } | null } | undefined;
  const visita = prop("fecha_visita") as { date?: { start: string } | null } | undefined;
  return {
    externo_id: pagina.id,
    titulo: (titulo?.title ?? []).map((t) => t.plain_text).join(""),
    etapa: etapa?.select?.name ?? etapa?.status?.name ?? null,
    fecha_visita: visita?.date?.start?.slice(0, 10) ?? null,
  };
}

/** De la respuesta de error de Notion a una falla que admin_org entienda. */
export function fallaDeNotion(status: number, cuerpo: { code?: string; message?: string }): FallaConector {
  const mensaje = cuerpo.message ?? `Notion respondió ${status}`;
  if (status === 401 || cuerpo.code === "unauthorized") {
    return new FallaConector("credencial_invalida", "Notion rechazó la credencial: revisa el secreto de la integración.");
  }
  if (status === 404 || status === 403 || cuerpo.code === "object_not_found" || cuerpo.code === "restricted_resource") {
    return new FallaConector("inaccesible", "La integración no ve la base de Trámites: conéctala en Notion (⋯ → Conexiones).");
  }
  if (status === 429 || cuerpo.code === "rate_limited") {
    return new FallaConector("limite", "Notion pidió esperar (límite de llamadas). Se reintenta en la siguiente vuelta.");
  }
  if (cuerpo.code === "validation_error" && /property|propiedad/i.test(mensaje)) {
    return new FallaConector("propiedad_no_encontrada", `Notion: ${mensaje}`);
  }
  return new FallaConector("otro", `Notion: ${mensaje}`);
}

export function conectorNotion(config: ConfigConector, credencial: string, llamar: typeof fetch = fetch): Conector {
  const base = config.configuracion.base_de_datos;
  const mapeo = config.mapeo_campos;

  async function notion<T>(ruta: string, metodo: "GET" | "POST", cuerpo?: unknown): Promise<T> {
    const r = await llamar(`${API}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${credencial}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw fallaDeNotion(r.status, json as { code?: string; message?: string });
    return json as T;
  }

  return {
    async probar() {
      if (!base) throw new FallaConector("inaccesible", "Falta la base de datos en la configuración del conector.");
      const db = await notion<{ properties: Record<string, { type: string }> }>(`/databases/${base}`, "GET");
      const esperados: [string, string[]][] = [
        ["titulo", ["title"]],
        ["etapa", ["select", "status"]],
        ["fecha_visita", ["date"]],
      ];
      for (const [clave, tipos] of esperados) {
        const nombre = mapeo[clave];
        if (!nombre) continue;
        const prop = db.properties[nombre];
        if (!prop) throw new FallaConector("propiedad_no_encontrada", `No existe la propiedad "${nombre}" en la base.`);
        if (!tipos.includes(prop.type)) {
          throw new FallaConector("propiedad_no_encontrada", `La propiedad "${nombre}" es de tipo ${prop.type}, se esperaba ${tipos.join(" o ")}.`);
        }
      }
      for (const [clave, nombre] of Object.entries(mapeo)) {
        if (nombre && !db.properties[nombre]) {
          throw new FallaConector("propiedad_no_encontrada", `No existe la propiedad "${nombre}" (${clave}) en la base.`);
        }
      }
    },

    async crearRegistro(t) {
      const pagina = await notion<{ id: string }>("/pages", "POST", {
        parent: { database_id: base },
        properties: propiedadesDeTramite(t, mapeo, config.configuracion),
      });
      return pagina.id;
    },

    async leerCambios(desde) {
      const filtros: unknown[] = [{ timestamp: "last_edited_time", last_edited_time: { on_or_after: desde.toISOString() } }];
      if (mapeo.medio && config.configuracion.medio) {
        filtros.push({ property: mapeo.medio, select: { equals: config.configuracion.medio } });
      }
      const lecturas: Lectura[] = [];
      let cursor: string | undefined;
      do {
        const r = await notion<{ results: PaginaNotion[]; has_more: boolean; next_cursor: string | null }>(
          `/databases/${base}/query`,
          "POST",
          { filter: { and: filtros }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }
        );
        lecturas.push(...r.results.map((p) => leerPagina(p, mapeo)));
        cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return lecturas;
    },
  };
}

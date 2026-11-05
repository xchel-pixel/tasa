import {
  FallaConector,
  type ConfigConector,
  type Conector,
  type Lectura,
  type PaginaComisionista,
  type PagoPorRegistrar,
  type TramiteExterno,
  type TramitePorCrear,
} from "./tipos";

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
/** Para las bases que se leen por su fuente de datos (comisionistas, Cobros y Gastos, cuentas, categorías). */
const VERSION_FUENTES = "2025-09-03";

/**
 * Cobros y Gastos: los nombres de sus propiedades, como las captura el equipo. La base y las de
 * comisionistas, cuentas y categorías van en la configuración del conector (`base_pagos`,
 * `base_comisionistas`, `base_cuentas`, `base_categorias`, `categoria_pagos`, `entidad_pagos`).
 */
const COBROS = {
  tipo: "Tipo de cuenta",
  entidad: "Entidad",
  descripcion: "Descripción",
  monto: "Monto Reportado",
  fecha: "Fecha del Movimiento",
  comisionista: "Ext Comisionista",
  cuenta: "Cuenta",
  categoria: "Categoría",
} as const;

/** Notion da ids con guiones; Tasa los guarda sin ellos. */
export const sinGuiones = (id: string) => id.replace(/-/g, "").toLowerCase();

const dosDecimales = (n: number) => Math.round(n * 100) / 100;

/** "26/11/10-": el prefijo del título de los movimientos del día, como los numera el equipo. */
export function prefijoDelDia(fecha: string): string {
  const [a, m, d] = fecha.slice(0, 10).split("-");
  return `${a.slice(2)}/${m}/${d}-`;
}

/** El siguiente consecutivo del día a partir de los títulos que ya existen ("26/11/10-003" → 4). */
export function siguienteConsecutivo(titulos: string[], prefijo: string): number {
  let mayor = 0;
  for (const t of titulos) {
    if (!t.startsWith(prefijo)) continue;
    const n = Number(t.slice(prefijo.length).match(/^\d+/)?.[0]);
    if (Number.isFinite(n) && n > mayor) mayor = n;
  }
  return mayor + 1;
}

/** Las descripciones de los movimientos del pago (y de su anulación). */
export function descripcionesDePago(p: PagoPorRegistrar): { comision: string; bono: string } {
  const detalle = [p.folios, p.origen, p.referencia ? `ref. ${p.referencia}` : null].filter(Boolean).join(" · ");
  const pie = `Registrado desde Tasa${p.registro ? ` por ${p.registro}` : ""}`;
  const anulado = p.anular ? "ANULACIÓN · " : "";
  return {
    comision: `${anulado}Pago de comisión externa a ${p.comisionista}${detalle ? `: ${detalle}` : ""} · ${pie}`,
    bono: `${anulado}Bono de referido pagado a ${p.comisionista} (no entra en su Saldo de comisiones)${detalle ? `: ${detalle}` : ""} · ${pie}`,
  };
}

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

/** Todo lo que "Traer trámite" muestra de una página, según el mapeo. */
export function leerTramiteExterno(pagina: PaginaNotion, mapeo: Record<string, string>): TramiteExterno {
  const prop = (clave: string) => (mapeo[clave] ? pagina.properties[mapeo[clave]] : undefined) as Record<string, unknown> | undefined;
  const textoDe = (clave: string): string | null => {
    const p = prop(clave);
    if (!p) return null;
    const partes = (p.rich_text ?? p.title) as { plain_text: string }[] | undefined;
    if (partes) return partes.map((t) => t.plain_text).join("").trim() || null;
    if (typeof p.phone_number === "string") return p.phone_number;
    if (typeof p.email === "string") return p.email;
    return null;
  };
  const base = leerPagina(pagina, mapeo);
  const tipo = prop("tipo_tramite") as { select?: { name: string } | null } | undefined;
  const cotizacion = prop("cotizacion") as { number?: number | null } | undefined;
  const aceptacion = prop("fecha_aceptacion") as { date?: { start: string } | null } | undefined;
  const factura = prop("requiere_factura") as { checkbox?: boolean } | undefined;
  return {
    externo_id: base.externo_id,
    titulo: base.titulo,
    etapa: base.etapa,
    tipo: tipo?.select?.name ?? null,
    cotizacion: typeof cotizacion?.number === "number" ? cotizacion.number : null,
    fecha_aceptacion: aceptacion?.date?.start?.slice(0, 10) ?? null,
    cliente_nombre: textoDe("contacto_nombre"),
    cliente_telefono: textoDe("contacto_telefono"),
    cliente_correo: textoDe("contacto_correo"),
    clave_catastral: textoDe("clave_catastral"),
    descripcion: textoDe("descripcion"),
    requiere_factura: Boolean(factura?.checkbox),
  };
}

/** De la respuesta de error de Notion a una falla que admin_org entienda. */
export function fallaDeNotion(status: number, cuerpo: { code?: string; message?: string }, base = "Trámites"): FallaConector {
  const mensaje = cuerpo.message ?? `Notion respondió ${status}`;
  if (status === 401 || cuerpo.code === "unauthorized") {
    return new FallaConector("credencial_invalida", "Notion rechazó la credencial: revisa el secreto de la integración.");
  }
  if (status === 404 || status === 403 || cuerpo.code === "object_not_found" || cuerpo.code === "restricted_resource") {
    return new FallaConector("inaccesible", `La integración no ve la base de ${base}: conéctala en Notion (⋯ → Conexiones).`);
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

  async function notion<T>(ruta: string, metodo: "GET" | "POST" | "PATCH", cuerpo?: unknown, version = VERSION, que = "Trámites"): Promise<T> {
    const r = await llamar(`${API}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${credencial}`, "Notion-Version": version, "Content-Type": "application/json" },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw fallaDeNotion(r.status, json as { code?: string; message?: string }, que);
    return json as T;
  }

  /** Una base leída por su fuente de datos (`configuracion[clave]`). */
  function fuente(clave: string, que: string) {
    const id = config.configuracion[clave]?.trim();
    if (!id) throw new FallaConector("inaccesible", `Falta la base de ${que} en la configuración del conector (${clave}).`);
    let titulo: string | null = null;
    const llamarFuente = <T>(ruta: string, metodo: "GET" | "POST" | "PATCH", cuerpo?: unknown) =>
      notion<T>(ruta, metodo, cuerpo, VERSION_FUENTES, que);
    return {
      id,
      llamar: llamarFuente,
      /** El nombre de su propiedad de título (Name, Projects…). */
      async titulo() {
        if (!titulo) {
          const ds = await llamarFuente<{ properties: Record<string, { type: string }> }>(`/data_sources/${id}`, "GET");
          titulo = Object.entries(ds.properties).find(([, p]) => p.type === "title")?.[0] ?? null;
          if (!titulo) throw new FallaConector("propiedad_no_encontrada", `La base de ${que} no tiene título.`);
        }
        return titulo;
      },
      async buscar(filtroTitulo: Record<string, string>, maximo = 100): Promise<{ id: string; titulo: string }[]> {
        const prop = await this.titulo();
        const r = await llamarFuente<{ results: { id: string; properties: Record<string, { title?: { plain_text: string }[] }> }[] }>(
          `/data_sources/${id}/query`, "POST", { filter: { property: prop, title: filtroTitulo }, page_size: maximo });
        return r.results.map((p) => ({ id: sinGuiones(p.id), titulo: (p.properties[prop]?.title ?? []).map((x) => x.plain_text).join("") }));
      },
    };
  }

  /** La página cuyo título es exactamente ese nombre (cuentas, categorías). */
  async function porNombre(clave: string, que: string, nombre: string | null | undefined): Promise<string | null> {
    if (!nombre?.trim()) return null;
    const exacto = nombre.trim().toLowerCase();
    return (await fuente(clave, que).buscar({ equals: nombre.trim() }, 10)).find((p) => p.titulo.trim().toLowerCase() === exacto)?.id ?? null;
  }

  /** Escribe un número y una relación del trámite (comisión directa o bono de referido). */
  async function escribirMontoYRelacion(externoId: string, claveMonto: string, claveRelacion: string, monto: number, pagina: string | null) {
    const nMonto = mapeo[claveMonto]?.trim();
    const nRelacion = mapeo[claveRelacion]?.trim();
    if (!nMonto || !nRelacion) {
      throw new FallaConector("propiedad_no_encontrada", `Faltan "${claveMonto}" y "${claveRelacion}" en el mapeo del conector.`);
    }
    if (!(await existe(externoId))) return false;
    await notion(`/pages/${externoId}`, "PATCH", {
      properties: { [nMonto]: { number: dosDecimales(monto) }, [nRelacion]: { relation: pagina ? [{ id: pagina }] : [] } },
    });
    return true;
  }

  /** Borrada (404) o en la papelera / archivada: para Tasa ya no existe. */
  async function existe(externoId: string): Promise<boolean> {
    const r = await llamar(`${API}/pages/${externoId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${credencial}`, "Notion-Version": VERSION },
    });
    if (r.status === 404) return false;
    const json = (await r.json().catch(() => ({}))) as { archived?: boolean; in_trash?: boolean; code?: string; message?: string };
    if (!r.ok) throw fallaDeNotion(r.status, json);
    return !json.archived && !json.in_trash;
  }

  return {
    existe,

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

    async marcarCancelado(externoId, etapa) {
      const nombre = mapeo.etapa?.trim();
      if (!nombre) throw new FallaConector("propiedad_no_encontrada", "Falta la propiedad de etapa en el mapeo del conector.");
      if (!(await existe(externoId))) return false;
      await notion(`/pages/${externoId}`, "PATCH", { properties: { [nombre]: { select: { name: etapa } } } });
      return true;
    },

    async actualizarMonto(externoId, monto) {
      const nombre = mapeo.cotizacion?.trim();
      // Sin la propiedad en el mapeo no hay nada que actualizar afuera.
      if (!nombre) return true;
      if (!(await existe(externoId))) return false;
      await notion(`/pages/${externoId}`, "PATCH", { properties: { [nombre]: { number: monto } } });
      return true;
    },

    async actualizarSolicitadoPor(externoId, nombreComisionista) {
      const nombre = mapeo.solicitado_por?.trim();
      if (!nombre) throw new FallaConector("propiedad_no_encontrada", "Falta la propiedad \"Solicitado por\" en el mapeo del conector.");
      if (!(await existe(externoId))) return false;
      await notion(`/pages/${externoId}`, "PATCH", { properties: { [nombre]: { rich_text: texto(nombreComisionista) } } });
      return true;
    },

    actualizarComision(externoId, monto, pagina) {
      return escribirMontoYRelacion(externoId, "ext_comision", "ext_comisionista", monto, pagina);
    },

    actualizarReferido(externoId, monto, pagina) {
      return escribirMontoYRelacion(externoId, "ref_bono", "ref_comisionista", monto, pagina);
    },

    async buscarComisionistas(nombre) {
      const r = await fuente("base_comisionistas", "comisionistas").buscar({ contains: nombre.trim() }, 20);
      return r.map((p): PaginaComisionista => ({ id: p.id, nombre: p.titulo }));
    },

    async crearComisionista(nombre) {
      const base = fuente("base_comisionistas", "comisionistas");
      const pagina = await base.llamar<{ id: string }>("/pages", "POST", {
        parent: { type: "data_source_id", data_source_id: base.id },
        properties: { [await base.titulo()]: { title: texto(nombre.trim()) } },
      });
      return { id: sinGuiones(pagina.id), nombre: nombre.trim() };
    },

    async registrarPago(p) {
      const cobros = fuente("base_pagos", "Cobros y Gastos");
      const [cuenta, categoria, prop] = await Promise.all([
        porNombre("base_cuentas", "cuentas", p.cuenta),
        porNombre("base_categorias", "categorías", config.configuracion.categoria_pagos),
        cobros.titulo(),
      ]);
      const prefijo = prefijoDelDia(p.fecha);
      let n = siguienteConsecutivo((await cobros.buscar({ starts_with: prefijo })).map((x) => x.titulo), prefijo);
      const signo = p.anular ? -1 : 1;
      const desc = descripcionesDePago(p);
      const comision = dosDecimales(p.monto - p.bono);
      const movimientos = [
        { monto: comision, relacion: p.pagina, descripcion: desc.comision },
        { monto: dosDecimales(p.bono), relacion: null, descripcion: desc.bono },
      ].filter((m) => m.monto > 0);

      const ids: string[] = [];
      for (const m of movimientos) {
        const pagina = await cobros.llamar<{ id: string }>("/pages", "POST", {
          parent: { type: "data_source_id", data_source_id: cobros.id },
          properties: {
            [prop]: { title: texto(`${prefijo}${String(n++).padStart(3, "0")}`) },
            [COBROS.tipo]: { select: { name: "Gasto" } },
            ...(config.configuracion.entidad_pagos ? { [COBROS.entidad]: { select: { name: config.configuracion.entidad_pagos } } } : {}),
            [COBROS.descripcion]: { rich_text: texto(m.descripcion) },
            [COBROS.monto]: { number: signo * m.monto },
            [COBROS.fecha]: { date: { start: p.fecha.slice(0, 10) } },
            [COBROS.comisionista]: { relation: m.relacion ? [{ id: m.relacion }] : [] },
            [COBROS.cuenta]: { relation: cuenta ? [{ id: cuenta }] : [] },
            [COBROS.categoria]: { relation: categoria ? [{ id: categoria }] : [] },
          },
        });
        ids.push(sinGuiones(pagina.id));
      }
      const faltas = [
        cuenta ? null : p.cuenta ? `sin Cuenta (no encontré "${p.cuenta}" en Cuentas MGP)` : "sin Cuenta (el origen del pago no tiene cuenta de Notion)",
        p.pagina || comision <= 0 ? null : "sin Ext Comisionista (no tiene Página en Notion)",
        categoria || !config.configuracion.categoria_pagos ? null : `sin Categoría (no encontré "${config.configuracion.categoria_pagos}")`,
      ].filter(Boolean);
      return { ids, avisos: faltas.length ? faltas.join(", ") : null };
    },

    async buscarPorFolio(folio) {
      const nombre = mapeo.titulo?.trim();
      if (!nombre) throw new FallaConector("propiedad_no_encontrada", "Falta la propiedad del título (folio) en el mapeo del conector.");
      const r = await notion<{ results: PaginaNotion[] }>(`/databases/${base}/query`, "POST", {
        filter: { property: nombre, title: { contains: folio } },
        page_size: 10,
      });
      // "contains" también encuentra MGP-2026-01234: se exige el folio completo (ya validado: letras, números y guiones).
      const exacto = new RegExp(`(^|[^0-9A-Z])${folio}($|[^0-9])`);
      const pagina = r.results.find((p) => exacto.test(leerPagina(p, mapeo).titulo));
      return pagina ? leerTramiteExterno(pagina, mapeo) : null;
    },

    async leerCambios(desde, importados = false) {
      const filtros: unknown[] = [{ timestamp: "last_edited_time", last_edited_time: { on_or_after: desde.toISOString() } }];
      if (mapeo.medio && config.configuracion.medio && !importados) {
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

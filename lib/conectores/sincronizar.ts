import type { SupabaseClient } from "@supabase/supabase-js";
import { conectorNotion } from "./notion";
import { FallaConector, type ConfigConector, type Conector, type PagoPorRegistrar, type TramitePorCrear } from "./tipos";

/**
 * Una vuelta del cron para un conector: crear lo nuevo afuera, leer lo
 * que cambió y dejar el conector en "activo" o en "error" (con alerta).
 * Nunca falla en silencio: cualquier error termina en
 * `registrar_error_conector`.
 *
 * Recibe el cliente con la llave secreta: solo lo construye `/api/cron`.
 */

export type ResultadoSync = {
  conector: string;
  creados: number;
  leidos: number;
  actualizados: number;
  error: string | null;
};

function construir(config: ConfigConector, credencial: string): Conector {
  if (config.tipo === "notion") return conectorNotion(config, credencial);
  throw new FallaConector("otro", `El conector "${config.tipo}" todavía no existe.`);
}

export async function sincronizarConector(
  supabase: SupabaseClient,
  config: ConfigConector,
  { soloProbar = false }: { soloProbar?: boolean } = {}
): Promise<ResultadoSync> {
  const resultado: ResultadoSync = { conector: config.id, creados: 0, leidos: 0, actualizados: 0, error: null };
  try {
    const { data: credencial, error: errorCred } = await supabase.rpc("credencial_conector", { p_conector: config.id });
    if (errorCred) throw new Error(errorCred.message);
    if (!credencial) throw new FallaConector("credencial_invalida", "Falta la credencial del conector.");
    const conector = construir(config, credencial as string);

    await conector.probar();
    if (soloProbar) {
      await registrar(supabase, "registrar_sync_ok", { p_conector: config.id });
      return resultado;
    }

    // 1. Lo aceptado que aún no existe afuera.
    const { data: porCrear, error: errorReclamo } = await supabase.rpc("reclamar_por_crear", { p_conector: config.id });
    if (errorReclamo) throw new Error(errorReclamo.message);
    for (const t of (porCrear ?? []) as TramitePorCrear[]) {
      try {
        const externo = await conector.crearRegistro(t);
        await registrar(supabase, "registrar_registro_externo", { p_conector: config.id, p_solicitud: t.solicitud_id, p_externo_id: externo });
        resultado.creados++;
      } catch (falla) {
        await supabase.rpc("liberar_por_crear", { p_conector: config.id, p_solicitud: t.solicitud_id });
        throw falla;
      }
    }

    // 2. Lo que cambió afuera (con margen, por si el reloj de Notion va distinto).
    const desde = config.ultimo_sync
      ? new Date(new Date(config.ultimo_sync).getTime() - 60 * 60 * 1000)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    // Con trámites traídos de Notion se leen todas las páginas editadas: las suyas no son del medio de Tasa.
    const { data: importados, error: errorImportados } = await supabase.rpc("tiene_importados", { p_conector: config.id });
    if (errorImportados) throw new Error(errorImportados.message);
    for (const l of await conector.leerCambios(desde, Boolean(importados))) {
      const { data: que, error } = await supabase.rpc("registrar_lectura", {
        p_conector: config.id,
        p_externo_id: l.externo_id,
        p_titulo: l.titulo,
        p_etapa: l.etapa,
        p_fecha_visita: l.fecha_visita,
      });
      if (error) throw new Error(error.message);
      resultado.leidos++;
      if (que === "actualizado" || que === "alerta") resultado.actualizados++;
    }

    // 3. Lo cancelado en Tasa: se escribe la etapa de cancelado afuera (nunca al revés).
    const { data: porCancelar, error: errorCancelar } = await supabase.rpc("por_cancelar_afuera", { p_conector: config.id });
    if (errorCancelar) throw new Error(errorCancelar.message);
    for (const c of (porCancelar ?? []) as { solicitud_id: string; externo_id: string; etapa: string }[]) {
      if (await conector.marcarCancelado(c.externo_id, c.etapa)) {
        await registrar(supabase, "registrar_cancelado_afuera", { p_conector: config.id, p_solicitud: c.solicitud_id });
      } else {
        await registrar(supabase, "registrar_revision_externa", { p_conector: config.id, p_solicitud: c.solicitud_id, p_existe: false });
      }
    }

    // 4. Páginas borradas o archivadas: cada trabajo vivo se revisa una vez por hora.
    const { data: porRevisar, error: errorRevisar } = await supabase.rpc("por_revisar_afuera", { p_conector: config.id });
    if (errorRevisar) throw new Error(errorRevisar.message);
    for (const p of (porRevisar ?? []) as { solicitud_id: string; externo_id: string }[]) {
      const existe = await conector.existe(p.externo_id);
      await registrar(supabase, "registrar_revision_externa", { p_conector: config.id, p_solicitud: p.solicitud_id, p_existe: existe });
    }

    // 5. Estimados con honorario final ya fijado: se reescribe "Cotización" afuera.
    const { data: porMonto, error: errorMonto } = await supabase.rpc("por_actualizar_monto_afuera", { p_conector: config.id });
    if (errorMonto) throw new Error(errorMonto.message);
    for (const m of (porMonto ?? []) as { solicitud_id: string; externo_id: string; monto: string | number }[]) {
      if (await conector.actualizarMonto(m.externo_id, Number(m.monto))) {
        await registrar(supabase, "registrar_monto_afuera", { p_conector: config.id, p_solicitud: m.solicitud_id });
      } else {
        await registrar(supabase, "registrar_revision_externa", { p_conector: config.id, p_solicitud: m.solicitud_id, p_existe: false });
      }
    }

    // 6. Comisionista asignado o cambiado en Tasa: se reescribe SOLO "Solicitado por". Si la página ya no
    //    existe o Notion la rechaza, alerta para admin_org y sigue (el cambio en Tasa no espera a Notion).
    const { data: porSolicitado, error: errorSolicitado } = await supabase.rpc("por_actualizar_solicitado_afuera", { p_conector: config.id });
    if (errorSolicitado) throw new Error(errorSolicitado.message);
    for (const x of (porSolicitado ?? []) as { solicitud_id: string; externo_id: string; nombre: string }[]) {
      let error: string | null = null;
      try {
        if (!(await conector.actualizarSolicitadoPor(x.externo_id, x.nombre))) error = "la página ya no existe";
      } catch (falla) {
        // Si Notion pide esperar, se reintenta en la siguiente vuelta.
        if (falla instanceof FallaConector && falla.codigo === "limite") continue;
        error = falla instanceof Error ? falla.message : String(falla);
      }
      await registrar(supabase, "registrar_solicitado_afuera", { p_conector: config.id, p_solicitud: x.solicitud_id, p_error: error });
    }

    // 6b. "Honorario" del trámite al descontar la comisión al cliente (0079), solo con la propiedad en el mapeo.
    if (config.mapeo_campos.honorario) {
      const { data: honorarios, error: errorHon } = await supabase.rpc("por_actualizar_honorario_afuera", { p_conector: config.id });
      if (errorHon) throw new Error(errorHon.message);
      for (const x of (honorarios ?? []) as { solicitud_id: string; externo_id: string; monto: string | number }[]) {
        let error: string | null = null;
        try {
          if (!(await conector.actualizarHonorario(x.externo_id, Number(x.monto)))) error = "la página ya no existe";
        } catch (falla) {
          if (falla instanceof FallaConector && falla.codigo === "limite") continue;
          error = falla instanceof Error ? falla.message : String(falla);
        }
        await registrar(supabase, "registrar_honorario_afuera", { p_conector: config.id, p_solicitud: x.solicitud_id, p_monto: Number(x.monto), p_error: error });
      }
    }

    // 7 y 8. Comisión directa ("Ext Comisión") y, al aprobar el cierre, bono de referido ("Ref Bono"). Solo con
    //    las propiedades en el mapeo; si faltan, quedan pendientes. Igual que "Solicitado por": alerta y sigue.
    const pasos = [
      { mapeo: "ext_comision", leer: "por_actualizar_comision_afuera", anotar: "registrar_comision_afuera",
        escribir: (id: string, monto: number, pagina: string | null) => conector.actualizarComision(id, monto, pagina) },
      { mapeo: "ref_bono", leer: "por_actualizar_ref_afuera", anotar: "registrar_ref_afuera",
        escribir: (id: string, monto: number, pagina: string | null) => conector.actualizarReferido(id, monto, pagina) },
    ];
    for (const paso of pasos) {
      if (!config.mapeo_campos[paso.mapeo]) continue;
      const { data: porEscribir, error: errorLeer } = await supabase.rpc(paso.leer, { p_conector: config.id });
      if (errorLeer) throw new Error(errorLeer.message);
      for (const x of (porEscribir ?? []) as { solicitud_id: string; externo_id: string; monto: string | number; pagina: string | null }[]) {
        let error: string | null = null;
        try {
          if (!(await paso.escribir(x.externo_id, Number(x.monto), x.pagina))) error = "la página ya no existe";
        } catch (falla) {
          if (falla instanceof FallaConector && falla.codigo === "limite") continue;
          error = falla instanceof Error ? falla.message : String(falla);
        }
        await registrar(supabase, paso.anotar, { p_conector: config.id, p_solicitud: x.solicitud_id, p_monto: Number(x.monto), p_error: error });
      }
    }

    // 8b. Monedero (0078): "Crédito Tasa" y "Costo crédito" del trámite al aplicar o devolver crédito. Solo con LAS DOS
    //     propiedades en el mapeo (credito_tasa y costo_credito); mientras no estén, no se escribe nada y queda pendiente.
    if (config.mapeo_campos.credito_tasa && config.mapeo_campos.costo_credito) {
      const { data: creditos, error: errorCred } = await supabase.rpc("por_actualizar_credito_afuera", { p_conector: config.id });
      if (errorCred) throw new Error(errorCred.message);
      for (const x of (creditos ?? []) as { solicitud_id: string; externo_id: string; credito: string | number; costo: string | number }[]) {
        let error: string | null = null;
        try {
          if (!(await conector.actualizarCredito(x.externo_id, Number(x.credito), Number(x.costo)))) error = "la página ya no existe";
        } catch (falla) {
          if (falla instanceof FallaConector && falla.codigo === "limite") continue;
          error = falla instanceof Error ? falla.message : String(falla);
        }
        await registrar(supabase, "registrar_credito_afuera", { p_conector: config.id, p_solicitud: x.solicitud_id, p_credito: Number(x.credito),
          p_costo: Number(x.costo), p_error: error });
      }
    }

    // 9. Pagos de comisión (y sus anulaciones) → Cobros y Gastos. Solo si la base está configurada.
    if (config.configuracion.base_pagos) {
      const { data: pagos, error: errorPagos } = await supabase.rpc("por_registrar_pagos_afuera", { p_conector: config.id });
      if (errorPagos) throw new Error(errorPagos.message);
      for (const p of (pagos ?? []) as (Omit<PagoPorRegistrar, "monto" | "bono"> & { monto: string | number; bono: string | number })[]) {
        let ids: string[] = [];
        let avisos: string | null = null;
        let error: string | null = null;
        try {
          ({ ids, avisos } = await conector.registrarPago({ ...p, monto: Number(p.monto), bono: Number(p.bono) }));
        } catch (falla) {
          if (falla instanceof FallaConector && falla.codigo === "limite") continue;
          error = falla instanceof Error ? falla.message : String(falla);
        }
        await registrar(supabase, "registrar_pago_afuera", { p_conector: config.id, p_pago: p.pago_id, p_ids: ids, p_avisos: avisos, p_error: error });
      }
    }

    await registrar(supabase, "registrar_sync_ok", { p_conector: config.id });
  } catch (falla) {
    const f = falla instanceof FallaConector ? falla : new FallaConector("otro", falla instanceof Error ? falla.message : String(falla));
    resultado.error = f.message;
    await supabase.rpc("registrar_error_conector", { p_conector: config.id, p_codigo: f.codigo, p_mensaje: f.message });
  }
  return resultado;
}

async function registrar(supabase: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
}

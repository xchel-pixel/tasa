import type { SupabaseClient } from "@supabase/supabase-js";
import { conectorNotion } from "./notion";
import { FallaConector, type ConfigConector, type Conector, type TramitePorCrear } from "./tipos";

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
    for (const l of await conector.leerCambios(desde)) {
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

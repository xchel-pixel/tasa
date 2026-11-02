import type { SupabaseClient } from "@supabase/supabase-js";

/** Por omisión, si el comisionista no tiene perfil (la base pone "Asesor inmobiliario" al darlo de alta). */
export const PERFIL_POR_OMISION = "Asesor inmobiliario";

export type MiPerfil = {
  /** El catálogo activo de la organización. */
  opciones: { id: string; nombre: string }[];
  perfilId: string | null;
  /** "Otro" ya aprobado (manda sobre perfilId). */
  otro: string | null;
  /** "Otro" que espera a admin_org. */
  solicitado: string | null;
  /** El último rechazo: lo que pidió y el motivo. */
  rechazo: string | null;
  /** Lo que hoy dice su tarjeta antes de "· aliado comercial". */
  actual: string;
};

type Fila = { perfil_id: string | null; perfil_otro: string | null; perfil_solicitado: string | null; perfil_rechazo: string | null };

/** El perfil de un comisionista y el catálogo para elegir (lo lee él mismo o el staff, por RLS). */
export async function leerPerfil(supabase: SupabaseClient, personaId: string): Promise<MiPerfil> {
  const [{ data: c }, { data: catalogo }] = await Promise.all([
    supabase.from("comisionistas").select("perfil_id, perfil_otro, perfil_solicitado, perfil_rechazo")
      .eq("persona_id", personaId).maybeSingle<Fila>(),
    supabase.from("perfiles").select("id, nombre, activo").order("orden").order("nombre")
      .returns<{ id: string; nombre: string; activo: boolean }[]>(),
  ]);
  const todos = catalogo ?? [];
  const delCatalogo = todos.find((p) => p.id === c?.perfil_id)?.nombre;
  return {
    opciones: todos.filter((p) => p.activo || p.id === c?.perfil_id).map(({ id, nombre }) => ({ id, nombre })),
    perfilId: c?.perfil_id ?? null,
    otro: c?.perfil_otro ?? null,
    solicitado: c?.perfil_solicitado ?? null,
    rechazo: c?.perfil_rechazo ?? null,
    actual: c?.perfil_otro ?? delCatalogo ?? PERFIL_POR_OMISION,
  };
}

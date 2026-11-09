import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * DXF del mapa catastral (0065): quién puede bajarlo y cuánto le queda. El saldo no vence; nulo = sin límite.
 * Todo se decide en la base (mi_dxf, catastro_dxf); aquí solo se lee para pintar.
 */

export type EstadoDxf = { autorizado: boolean; sin_limite: boolean; saldo: number | null };

const NADA: EstadoDxf = { autorizado: false, sin_limite: false, saldo: 0 };

export async function miDxf(): Promise<EstadoDxf> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("mi_dxf");
  return (data as EstadoDxf | null) ?? NADA;
}

export async function dxfDePersona(persona: string): Promise<EstadoDxf & { tiene_mapa: boolean }> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.rpc("dxf_estado_persona", { p_persona: persona });
  return (data as (EstadoDxf & { tiene_mapa: boolean }) | null) ?? { ...NADA, tiene_mapa: false };
}

/** "Te quedan 3 DXF", "Te queda 1 DXF" o "DXF sin límite". */
export function textoDxf(e: EstadoDxf): string {
  if (e.sin_limite) return "DXF sin límite";
  return e.saldo === 1 ? "Te queda 1 DXF" : `Te quedan ${e.saldo ?? 0} DXF`;
}

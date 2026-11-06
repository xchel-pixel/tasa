import { urlDelSitio } from "@/lib/altas";
import { bonoDeEquipo, codigoDeEquipo, ligaDeClientes, ligaDeEquipo } from "@/lib/invitar";
import type { Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Ligas = { clientes: string | null; invitar: string | null; bono: string | null; equipo: boolean };

/**
 * "Para tus clientes" e "Invita a un comisionista" de quien entra: el comisionista con su código de
 * referido; el equipo y administración con el de su membresía (y su bono, si lo tiene).
 */
export async function ligasDe(persona: Persona): Promise<Ligas> {
  if (persona.rol === "comisionista") {
    const supabase = await crearClienteServidor();
    const { data: yo } = await supabase.from("comisionistas").select("codigo_referido").eq("persona_id", persona.id).maybeSingle<{ codigo_referido: string }>();
    if (!yo) return { clientes: null, invitar: null, bono: null, equipo: false };
    const sitio = await urlDelSitio(), slug = persona.organizacion.slug;
    return { clientes: `${sitio}/s/${slug}/${yo.codigo_referido}`, invitar: `${sitio}/alta/${slug}?ref=${yo.codigo_referido}`, bono: null, equipo: false };
  }
  const [invitar, bono, codigo] = await Promise.all([ligaDeEquipo(persona), bonoDeEquipo(persona), codigoDeEquipo(persona)]);
  return { clientes: codigo ? await ligaDeClientes(persona, codigo) : null, invitar, bono, equipo: true };
}

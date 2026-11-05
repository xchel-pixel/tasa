import { conectorNotion } from "./notion";
import type { ConfigConector, Conector } from "./tipos";
import { clienteDeServicio } from "@/lib/supabase/servicio";

/**
 * El conector de Notion de la organización, para usarlo desde una acción del servidor (ya revisado
 * el rol de quien pide). La credencial se lee aquí con la llave de servicio y nunca llega al navegador.
 */
export async function conectorDeLaOrg(organizacionId: string): Promise<{ conector: Conector } | { error: string }> {
  const servicio = clienteDeServicio();
  if (!servicio) return { error: "Falta la llave de servicio en el servidor: no se puede leer Notion." };
  const { data: config } = await servicio
    .rpc("conector_para_importar", { p_org: organizacionId })
    .maybeSingle<{ id: string; configuracion: Record<string, string>; mapeo_campos: Record<string, string>; prefijo_folio: string }>();
  if (!config) return { error: "El conector de Notion no está activo. Actívalo en Ajustes." };
  const { data: credencial } = await servicio.rpc("credencial_conector", { p_conector: config.id });
  if (!credencial) return { error: "Falta la credencial del conector de Notion (Ajustes)." };
  return {
    conector: conectorNotion(
      { ...config, organizacion_id: organizacionId, tipo: "notion", ultimo_sync: null } as ConfigConector,
      credencial as string
    ),
  };
}

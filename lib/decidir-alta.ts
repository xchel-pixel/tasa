import type { Rol } from "@/lib/sesion";

/**
 * Quién ve los botones de aprobar y rechazar una solicitud de alta: solo
 * admin_org. Quien la refirió (equipo, finanzas o admin de marca) nunca
 * los ve; si quien la refirió es admin_org, los ve con un aviso y su
 * decisión queda marcada en la bitácora (`decidida_por_referidor`).
 */
export function decisionDeAlta(rol: Rol, laRefirio: boolean): { botones: boolean; aviso: string | null } {
  if (rol !== "admin_org") return { botones: false, aviso: null };
  return {
    botones: true,
    aviso: laRefirio ? "Tú la invitaste: puedes decidirla, pero quedará marcado en la bitácora." : null,
  };
}

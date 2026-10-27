import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Rol = "super_admin" | "finanzas" | "comisionista";

export type Persona = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
};

export type Sesion = {
  correo: string;
  /** Nulo si el usuario tiene cuenta pero nadie lo dio de alta en Tasa. */
  persona: Persona | null;
};

type ClienteServidor = Awaited<ReturnType<typeof crearClienteServidor>>;

async function consultarPersona(
  supabase: ClienteServidor,
  userId: string
): Promise<Persona | null> {
  const { data } = await supabase
    .from("personas")
    .select("id, nombre, correo, rol")
    .eq("user_id", userId)
    .eq("activo", true)
    .maybeSingle()
    .returns<Persona | null>();

  return data ?? null;
}

/**
 * Quién es el usuario de esta petición. Nulo si no hay sesión.
 *
 * Si hay sesión pero no aparece la persona, intenta amarrarla por
 * correo una vez: cubre el caso de que el super_admin la haya dado de
 * alta DESPUÉS de que su usuario de autenticación ya existía.
 */
export async function obtenerSesion(): Promise<Sesion | null> {
  const supabase = await crearClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  let persona = await consultarPersona(supabase, user.id);

  if (!persona) {
    await supabase.rpc("vincular_mi_usuario");
    persona = await consultarPersona(supabase, user.id);
  }

  return { correo: user.email ?? "", persona };
}

/**
 * Para pantallas que no existen sin persona. Sin sesión, a /entrar;
 * con cuenta pero sin alta, al inicio, que es la pantalla que sabe
 * explicárselo.
 */
export async function exigirPersona(): Promise<Persona> {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");
  if (!sesion.persona) redirect("/");
  return sesion.persona;
}

/**
 * El RLS ya impide que un comisionista lea lo que no le toca; esto es
 * para que en vez de una pantalla vacía vea la suya.
 */
export async function exigirRol(...roles: Rol[]): Promise<Persona> {
  const persona = await exigirPersona();
  if (!roles.includes(persona.rol)) redirect("/");
  return persona;
}

export const esStaff = (persona: Persona) =>
  persona.rol === "super_admin" || persona.rol === "finanzas";

export const NOMBRE_DEL_ROL: Record<Rol, string> = {
  super_admin: "Administración",
  finanzas: "Finanzas",
  comisionista: "Comisionista",
};

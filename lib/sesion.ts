import { redirect } from "next/navigation";
import { cache } from "react";
import { crearClienteServidor } from "@/lib/supabase/server";

/** El rol en la organización activa (sale de la membresía, no de la persona). */
export type Rol = "admin_org" | "finanzas" | "admin_marca" | "equipo" | "comisionista";

export type Organizacion = { id: string; nombre: string; slug: string };

export type Persona = {
  id: string;
  nombre: string;
  correo: string;
  rol: Rol;
  organizacion: Organizacion;
  superPlataforma: boolean;
  /** Plataforma dentro de una organización donde no es miembro. */
  visitante: boolean;
  /** Entre cuántas organizaciones puede elegir (selector de la barra). */
  organizaciones: number;
};

export type Sesion = {
  correo: string;
  /** Nulo si el usuario tiene cuenta pero nadie lo dio de alta en Tasa. */
  persona: Persona | null;
  /** Dado de alta, pero todavía sin organización elegida. */
  sinOrganizacion: boolean;
  superPlataforma: boolean;
};

type ClienteServidor = Awaited<ReturnType<typeof crearClienteServidor>>;

type FilaSesion = {
  persona_id: string;
  nombre: string;
  correo: string;
  super_plataforma: boolean;
  rol: Rol | null;
  organizacion: Organizacion | null;
  visitante: boolean;
  organizaciones: number;
};

async function leerSesion(supabase: ClienteServidor): Promise<FilaSesion | null> {
  const { data } = await supabase.rpc("mi_sesion");
  return (data as FilaSesion | null) ?? null;
}

/**
 * Quién es el usuario de esta petición y en qué organización está.
 * Nulo si no hay sesión. Se calcula una vez por petición (`cache`): la
 * barra y la página la piden y no se repite la consulta.
 *
 * Dos reparaciones en caliente:
 *   · sin persona: intenta amarrarla por correo (la dieron de alta
 *     después de que su usuario ya existía);
 *   · sin organización activa y con una sola posible: la elige sola.
 */
export const obtenerSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let fila = await leerSesion(supabase);
  if (!fila) {
    await supabase.rpc("vincular_mi_usuario");
    fila = await leerSesion(supabase);
  }
  if (!fila) return { correo: user.email ?? "", persona: null, sinOrganizacion: false, superPlataforma: false };

  if (!fila.organizacion && fila.organizaciones === 1) {
    const { data: opciones } = await supabase.rpc("mis_organizaciones");
    const unica = (opciones as { id: string }[] | null)?.[0];
    if (unica) {
      await supabase.rpc("elegir_organizacion", { p_org: unica.id });
      fila = await leerSesion(supabase);
    }
  }

  if (!fila?.organizacion || !fila.rol) {
    return { correo: user.email ?? "", persona: null, sinOrganizacion: true, superPlataforma: Boolean(fila?.super_plataforma) };
  }

  return {
    correo: user.email ?? "",
    sinOrganizacion: false,
    superPlataforma: fila.super_plataforma,
    persona: {
      id: fila.persona_id,
      nombre: fila.nombre,
      correo: fila.correo,
      rol: fila.rol,
      organizacion: fila.organizacion,
      superPlataforma: fila.super_plataforma,
      visitante: fila.visitante,
      organizaciones: Number(fila.organizaciones),
    },
  };
});

/**
 * Para pantallas que no existen sin persona. Sin sesión, a /entrar;
 * sin organización elegida, a elegirla; con cuenta pero sin alta, al
 * inicio, que es la pantalla que sabe explicárselo.
 */
export async function exigirPersona(): Promise<Persona> {
  const sesion = await obtenerSesion();
  if (!sesion) redirect("/entrar");
  if (sesion.sinOrganizacion) redirect("/organizacion");
  if (!sesion.persona) redirect("/");
  return sesion.persona;
}

/**
 * El RLS ya impide que alguien lea lo que no le toca; esto es para que
 * en vez de una pantalla vacía vea la suya.
 */
export async function exigirRol(...roles: Rol[]): Promise<Persona> {
  const persona = await exigirPersona();
  if (!roles.includes(persona.rol)) redirect("/");
  return persona;
}

/** admin_org y finanzas: todo lo de la organización. */
export const esStaff = (persona: Persona) => persona.rol === "admin_org" || persona.rol === "finanzas";

/** Quienes operan trabajos, cotizaciones y pagos (admin_marca, solo de sus marcas). */
export const ROLES_OPERACION: Rol[] = ["admin_org", "finanzas", "admin_marca"];

export const NOMBRE_DEL_ROL: Record<Rol, string> = {
  admin_org: "Administración",
  finanzas: "Finanzas",
  admin_marca: "Administración de marca",
  equipo: "Equipo",
  comisionista: "Comisionista",
};

/** Carpeta propia dentro del bucket: {organización}/{persona}. */
export const carpetaDe = (persona: Persona) => `${persona.organizacion.id}/${persona.id}`;

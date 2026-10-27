"use server";

import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";
import { recordarAcceso, olvidarAcceso } from "@/lib/acceso";
import { obtenerContacto } from "@/lib/contacto";

export type EstadoAcceso = {
  paso: "correo" | "codigo";
  /** Vacío en el paso del código si se llegó por "Ya tengo un código". */
  correo: string;
  error: string | null;
  /** Algo que conviene saber y no es un error. */
  aviso: string | null;
  /** Cuándo se pidió el código vigente, en ISO. La hora la pone el celular. */
  pedido: string | null;
  /** Si el código vigente reemplazó a otro: el anterior ya no sirve. */
  reemplazo: boolean;
};

/**
 * Sin nombres del equipo en la interfaz: se dice "el administrador" y,
 * si super_admin configuró un contacto en Ajustes, se agrega.
 */
async function fueraDelPadron(): Promise<string> {
  const contacto = await obtenerContacto();
  const base = "Ese correo no está dado de alta en Tasa. Pídele al administrador que te registre.";
  return contacto ? `${base} Contacto: ${contacto}.` : base;
}

/**
 * Supabase no deja pedir otro código al mismo correo antes de un
 * minuto. Antes eso salía como "no se pudo enviar", que invita a
 * insistir. El texto sirve tanto si era ese límite como si era el
 * límite general de correos: no promete que haya un código en camino.
 */
const ESPERA_UN_MINUTO =
  "Espera un minuto antes de pedir otro. Si ya te habíamos mandado uno, sigue sirviendo: búscalo en tu correo.";

/**
 * Un solo punto de entrada para la pantalla de acceso.
 * El campo oculto `paso` dice qué se está pidiendo:
 *   · `correo`: el primer código;
 *   · `nuevo`: otro código para el mismo correo, que invalida el anterior;
 *   · `codigo`: verificar lo que la persona escribió;
 *   · `ya-tengo`: ir al campo del código sin pedir nada;
 *   · `otro`: volver a escribir el correo, sin mandar nada.
 *
 * Todo pasa por aquí, y no por ligas, a propósito: el formulario
 * conserva lo que esta acción devuelve. Si la pantalla se reiniciara
 * al cambiar la cookie, se perdería justo el aviso de "espera un
 * minuto".
 */
export async function accionAcceso(
  estadoPrevio: EstadoAcceso,
  formData: FormData
): Promise<EstadoAcceso> {
  const paso = String(formData.get("paso") ?? "correo");

  if (paso === "codigo") return verificarCodigo(formData);

  if (paso === "ya-tengo") {
    return {
      paso: "codigo",
      correo: String(formData.get("correo") ?? "").trim().toLowerCase(),
      error: null,
      aviso: null,
      pedido: null,
      reemplazo: false,
    };
  }

  if (paso === "otro") {
    // El código que ya se pidió sigue vivo en Supabase; solo que la
    // pantalla deja de esperarlo.
    await olvidarAcceso();
    return {
      paso: "correo",
      correo: estadoPrevio.correo,
      error: null,
      aviso: null,
      pedido: null,
      reemplazo: false,
    };
  }

  return enviarCodigo(formData, paso === "nuevo");
}

async function enviarCodigo(
  formData: FormData,
  reemplazo: boolean
): Promise<EstadoAcceso> {
  const correo = String(formData.get("correo") ?? "")
    .trim()
    .toLowerCase();

  const base = { correo, aviso: null, pedido: null, reemplazo: false };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { ...base, paso: "correo", error: "Escribe un correo válido." };
  }

  const supabase = await crearClienteServidor();

  // Candado 1: nadie se registra solo. Si el correo no está en el
  // padrón no se envía nada y no se crea usuario de autenticación.
  const { data: enPadron, error: errorPadron } = await supabase.rpc(
    "correo_en_padron",
    { p_correo: correo }
  );

  if (errorPadron) {
    return {
      ...base,
      paso: "correo",
      error: "No se pudo verificar el correo. Inténtalo otra vez.",
    };
  }

  if (!enPadron) {
    return { ...base, paso: "correo", error: await fueraDelPadron() };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: correo,
    options: { shouldCreateUser: true },
  });

  if (error?.status === 429) {
    // Probablemente ya hay un código en camino: se le lleva al campo
    // para escribirlo, en vez de dejarlo frente al botón de pedir otro.
    await recordarAcceso({ correo, pedido: null, reemplazo: false });
    return {
      ...base,
      paso: "codigo",
      error: null,
      aviso: ESPERA_UN_MINUTO,
    };
  }

  if (error) {
    return {
      ...base,
      paso: reemplazo ? "codigo" : "correo",
      error: "No se pudo enviar el código. Inténtalo en unos minutos.",
    };
  }

  const acceso = { correo, pedido: new Date().toISOString(), reemplazo };
  await recordarAcceso(acceso);

  return { ...acceso, paso: "codigo", error: null, aviso: null };
}

async function verificarCodigo(formData: FormData): Promise<EstadoAcceso> {
  const correo = String(formData.get("correo") ?? "")
    .trim()
    .toLowerCase();
  const codigo = String(formData.get("codigo") ?? "").replace(/\D/g, "");

  // Lo que ya se sabía del código se conserva al fallar, para que la
  // pantalla no pierda la hora ni el aviso del reemplazo.
  const base = {
    paso: "codigo" as const,
    correo,
    aviso: null,
    pedido: String(formData.get("pedido") ?? "") || null,
    reemplazo: formData.get("reemplazo") === "si",
  };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { ...base, error: "Escribe el correo al que te llegó el código." };
  }
  if (codigo.length !== 6) {
    return { ...base, error: "El código son 6 dígitos." };
  }

  const supabase = await crearClienteServidor();

  const { error } = await supabase.auth.verifyOtp({
    email: correo,
    token: codigo,
    type: "email",
  });

  if (error) {
    return {
      ...base,
      error:
        "Código incorrecto o vencido. Si pediste más de uno, solo sirve el del correo más reciente.",
    };
  }

  await olvidarAcceso();

  // redirect() lanza para cortar la ejecución: va fuera de cualquier try.
  redirect("/");
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor();
  await supabase.auth.signOut();
  redirect("/entrar");
}

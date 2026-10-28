"use server";

import { revalidatePath } from "next/cache";
import { MAXIMO_FILAS, parsearTabla, slugLibre } from "@/lib/importar-comisionistas";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type ResultadoFila = { linea: number; nombre: string; ok: boolean; mensaje: string };
export type EstadoImportar = { error: string | null; resultados: ResultadoFila[] | null };

/**
 * Da de alta, uno por uno, los renglones sin errores. Cada alta es su
 * propia transacción (`alta_comisionista`): si un renglón falla, los
 * demás quedan. Volver a importar la misma tabla no duplica a nadie: los
 * correos ya dados de alta regresan "ya estaba".
 *
 * El porcentaje élite solo lo pone admin_org (igual que en la ficha).
 */
export async function importarComisionistas(_previo: EstadoImportar, f: FormData): Promise<EstadoImportar> {
  const persona = await exigirRol("admin_org", "finanzas");
  const filas = parsearTabla(String(f.get("tabla") ?? ""));
  if (filas.length === 0) return { error: "Pega la tabla primero.", resultados: null };
  if (filas.length > MAXIMO_FILAS) return { error: `Máximo ${MAXIMO_FILAS} renglones por importación.`, resultados: null };

  const supabase = await crearClienteServidor();
  const { data: existentes } = await supabase.from("comisionistas").select("slug").returns<{ slug: string }[]>();
  const ocupados = new Set((existentes ?? []).map((c) => c.slug));

  const resultados: ResultadoFila[] = [];
  for (const fila of filas) {
    if (fila.errores.length) {
      resultados.push({ linea: fila.linea, nombre: fila.nombre, ok: false, mensaje: `No se importó: ${fila.errores.join(", ")}.` });
      continue;
    }
    const { data: id, error } = await supabase.rpc("alta_comisionista", {
      p_nombre: fila.nombre,
      p_correo: fila.correo,
      p_telefono: fila.telefono,
      p_rfc: fila.rfc,
      p_slug: slugLibre(fila.nombre, ocupados),
      p_referido_por: null,
      p_emite_factura: fila.emite_factura,
      p_bienvenida: fila.bienvenida,
      p_meses_bienvenida: fila.mesesBienvenida,
    });
    if (error) {
      const yaEstaba = /ya está dado de alta/i.test(error.message);
      resultados.push({ linea: fila.linea, nombre: fila.nombre, ok: yaEstaba, mensaje: yaEstaba ? "Ya estaba dado de alta." : error.message });
      continue;
    }

    let mensaje = fila.bienvenida ? "Dado de alta, con tasa de bienvenida." : "Dado de alta.";
    if (fila.elite !== null) {
      if (persona.rol !== "admin_org") {
        mensaje = "Dado de alta, sin el porcentaje élite (solo administración lo pone).";
      } else {
        const { error: errorElite } = await supabase.rpc("forzar_elite", { p_persona: id as string, p_porcentaje: fila.elite });
        mensaje = errorElite ? `Dado de alta, pero el porcentaje élite falló: ${errorElite.message}` : `Dado de alta, élite ${fila.elite}%.`;
      }
    }
    resultados.push({ linea: fila.linea, nombre: fila.nombre, ok: true, mensaje });
  }

  revalidatePath("/admin/comisionistas");
  return { error: null, resultados };
}

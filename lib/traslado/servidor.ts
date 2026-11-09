import { calcular, type Caso, type Parametros, type Resultado } from "./calculo";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Modo = "rapida" | "completa";

export type CalculoGuardado = {
  id: string;
  modo: Modo;
  referencia: string | null;
  municipio: string;
  lado: Resultado["lado"];
  entrada: Caso;
  resultado: Resultado & { avisos?: string[] };
  creado_en: string;
};

/** La rápida no lleva ISR por enajenación ni extemporáneo: se quitan aunque lleguen. */
export function limpiarPorModo(c: Caso, modo: Modo): Caso {
  if (modo === "completa") return c;
  return { ...c, extemporaneo: null, vendedor: { ...(c.vendedor ?? {}), isr: null } };
}

/**
 * Calcula con los parámetros vigentes a la fecha de firma y lo guarda en "Mis cálculos" (con su registro
 * de uso). La base revisa que la persona tenga la herramienta y el modo.
 */
export async function calcularYGuardar(entrada: Caso, modo: Modo): Promise<{ id: string; resultado: Resultado & { avisos: string[] } }> {
  const supabase = await crearClienteServidor();
  const caso = limpiarPorModo(entrada, modo);
  const { data, error } = await supabase.rpc("parametros_traslado", { p_fecha: caso.fecha_firma });
  if (error) throw new Error(error.message);
  const { avisos, ...parametros } = data as Parametros & { avisos: string[] };
  const r = calcular(caso, parametros as Parametros);
  const resultado = { ...r, avisos: avisos ?? [] };
  const { data: id, error: e2 } = await supabase.rpc("guardar_calculo_traslado", {
    p_modo: modo,
    p_referencia: caso.referencia ?? null,
    p_municipio: r.municipio,
    p_lado: r.lado,
    p_entrada: caso,
    p_resultado: resultado,
  });
  if (e2) throw new Error(e2.message);
  // Sin el modo o sin cupo, la base registra la denegación y devuelve nulo (0070).
  if (!id) {
    const { data: cupo } = await supabase.rpc("mi_cupo", { p_herramienta: modo === "completa" ? "calculadora_traslado_completa" : "calculadora_traslado" })
      .maybeSingle<{ disponibles: number | null }>();
    throw new Error(cupo?.disponibles === 0 ? "Llegaste a tu límite del mes. Sube de nivel o pide más cálculos."
      : "Ese modo de la calculadora no está disponible para ti.");
  }
  return { id: id as string, resultado };
}

export async function leerCalculo(id: string): Promise<CalculoGuardado | null> {
  const supabase = await crearClienteServidor();
  const { data } = await supabase
    .from("calculos_traslado")
    .select("id, modo, referencia, municipio, lado, entrada, resultado, creado_en")
    .eq("id", id)
    .maybeSingle<CalculoGuardado>();
  return data;
}

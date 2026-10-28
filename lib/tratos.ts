import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * El trato inicial de la organización (ver 0023): tasa de bienvenida
 * para quien ya trabajaba con ella y arranque para los nuevos. Si no
 * eligió nivel, la base usa el más alto (bienvenida) o el segundo desde
 * abajo (arranque); aquí se repite esa regla solo para mostrarlo.
 */
export type Trato = { nivelId: string | null; nivel: string; porcentaje: number; meses: number };
export type TratosOrg = { bienvenida: Trato; arranque: Trato };

type Nivel = { id: string; nombre: string; porcentaje: number | string | null; es_forzado: boolean };

export async function tratosDeLaOrg(organizacionId: string): Promise<TratosOrg> {
  const supabase = await crearClienteServidor();
  const [{ data: ajustes }, { data: niveles }] = await Promise.all([
    supabase
      .from("ajustes")
      .select("bienvenida_nivel_id, bienvenida_meses, arranque_nivel_id, arranque_meses")
      .eq("organizacion_id", organizacionId)
      .maybeSingle(),
    supabase.from("niveles").select("id, nombre, porcentaje, es_forzado").returns<Nivel[]>(),
  ]);
  const normales = (niveles ?? []).filter((n) => !n.es_forzado).sort((a, b) => Number(a.porcentaje) - Number(b.porcentaje));
  const elegir = (id: string | null | undefined, respaldo: Nivel | undefined): Trato => {
    const n = normales.find((x) => x.id === id) ?? respaldo;
    return { nivelId: id ?? null, nivel: n?.nombre ?? "—", porcentaje: Number(n?.porcentaje ?? 0), meses: 0 };
  };
  return {
    bienvenida: { ...elegir(ajustes?.bienvenida_nivel_id, normales.at(-1)), meses: ajustes?.bienvenida_meses ?? 3 },
    arranque: { ...elegir(ajustes?.arranque_nivel_id, normales[1]), meses: ajustes?.arranque_meses ?? 2 },
  };
}

/** "2027-01-31" → "31/01/2027", como se le muestra al comisionista. */
export const fechaDMA = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** El último día del mes N contando el actual (lo mismo que calcula la base). */
export function finDelTrato(meses: number, hoy = new Date()): string {
  const mexico = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(hoy);
  const [a, m] = mexico.split("-").map(Number);
  const fin = new Date(Date.UTC(a, m - 1 + meses, 0));
  return fin.toISOString().slice(0, 10);
}

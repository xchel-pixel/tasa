import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { mesActual, mesSiguiente, mesTitulo, pesos } from "@/lib/formato";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";

export const metadata = { title: "Cierre mensual — Tasa" };

const ESTADO = {
  en_curso: { texto: "En curso", tono: "neutro" as const },
  abierto: { texto: "Por preparar", tono: "proceso" as const },
  preparado: { texto: "Por aprobar", tono: "proceso" as const },
  aprobado: { texto: "Aprobado", tono: "exito" as const },
};

/**
 * Todos los meses desde que la organización empezó a operar (aunque no tengan movimientos: también se
 * cierran, en ceros) y los que tengan movimientos o cierre, del más reciente al más viejo.
 */
export default async function Cierres() {
  const persona = await exigirRol("admin_org", "finanzas");
  const supabase = await crearClienteServidor();
  const [comisiones, cierres, organizacion] = await Promise.all([
    supabase.from("comisiones").select("mes, monto").returns<{ mes: string; monto: string | number }[]>(),
    supabase.from("cierres").select("mes, estado").returns<{ mes: string; estado: "preparado" | "aprobado" }[]>(),
    supabase.from("organizaciones").select("creado_en").eq("id", persona.organizacion.id).maybeSingle<{ creado_en: string }>(),
  ]);

  const totales = new Map<string, number>();
  for (const c of oExplota(comisiones, "las comisiones") ?? []) totales.set(c.mes, (totales.get(c.mes) ?? 0) + Number(c.monto));
  const estados = new Map((oExplota(cierres, "los cierres") ?? []).map((c) => [c.mes, c.estado]));
  const actual = mesActual();
  const operando: string[] = [];
  const creada = oExplota(organizacion, "la organización")?.creado_en;
  if (creada) {
    const desde = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date(creada)).slice(0, 7) + "-01";
    for (let m = desde; m < actual; m = mesSiguiente(m)) operando.push(m);
  }
  const meses = [...new Set([actual, ...operando, ...totales.keys(), ...estados.keys()])].sort().reverse();

  return (
    <PantallaAdmin titulo="Cierre mensual">
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Finanzas prepara el mes cuando termina; Administración lo aprueba. Un cierre aprobado no se reabre.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {meses.map((m) => {
          const e = ESTADO[m === actual ? "en_curso" : (estados.get(m) ?? "abierto")];
          return (
            <li key={m}>
              <Link href={`/admin/cierres/${m.slice(0, 7)}`} className="flex items-center justify-between gap-3 rounded-xl border border-linea bg-alterno px-4 py-3">
                <span>
                  <span className="block font-semibold">{mesTitulo(m)}</span>
                  <span className="block text-[0.9375rem] text-secundario">{pesos(totales.get(m) ?? 0)} en comisiones</span>
                </span>
                <Etiqueta tono={e.tono}>{e.texto}</Etiqueta>
              </Link>
            </li>
          );
        })}
      </ul>
    </PantallaAdmin>
  );
}

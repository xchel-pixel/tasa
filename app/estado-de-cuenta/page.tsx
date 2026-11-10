import Link from "next/link";
import { BloqueNivel } from "@/components/bloque-nivel";
import { Encabezado } from "@/components/encabezado";
import { VistaEstadoDeCuenta } from "@/components/vista-estado-de-cuenta";
import { carpetaDe, exigirRol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { miNivel } from "@/lib/trabajos";

export const metadata = { title: "Estado de cuenta — Tasa" };

/**
 * Sin ranking ni comparación con otros comisionistas: cada quien ve
 * solo lo suyo (el RLS no le deja ver más).
 */
export default async function EstadoDeCuenta({ searchParams }: PageProps<"/estado-de-cuenta">) {
  const persona = await exigirRol("comisionista");
  const { mes } = await searchParams;
  const nivel = await miNivel(persona.id, persona.organizacion.id);
  // Monedero (0077): si su comisión por cobrar alcanza un paquete, puede convertirla en crédito.
  const { data: paquetes } = await (await crearClienteServidor()).rpc("mis_paquetes");
  const pq = paquetes as { comision_por_cobrar: number | string; catalogo: { precio: number | string }[]; por_pagar: unknown } | null;
  const porCobrar = Number(pq?.comision_por_cobrar ?? 0);
  const alcanza = Boolean(pq && !pq.por_pagar && pq.catalogo.some((p) => Number(p.precio) <= porCobrar));

  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="toque text-[0.9375rem] font-semibold text-acento">
            ← Portada
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">Estado de cuenta</h1>
          {alcanza ? (
            <Link href="/paquetes" className="mt-3 block rounded-xl border border-primario bg-tinte px-4 py-3 text-[0.9375rem] leading-6">
              <span className="font-semibold">Convertir mi comisión en crédito</span>: tu comisión por cobrar alcanza para un paquete. Lo que sobre se te paga normal.
            </Link>
          ) : null}

          <div className="mt-4 mb-6">
            <BloqueNivel nivel={nivel} />
          </div>

          <VistaEstadoDeCuenta
            personaId={persona.id}
            mesPedido={typeof mes === "string" ? mes : undefined}
            base="/estado-de-cuenta"
            dueno
            carpeta={carpetaDe(persona)}
          />
        </div>
      </main>
    </>
  );
}

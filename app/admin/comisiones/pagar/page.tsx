import { notFound } from "next/navigation";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { comisionesPorPagar, desgloseDelMes } from "@/lib/comisiones";
import { carpetaDe, exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import FormularioPagoComision from "./formulario-pago-comision";

export const metadata = { title: "Registrar pago de comisión — Tasa" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PagarComision({ searchParams }: PageProps<"/admin/comisiones/pagar">) {
  const persona = await exigirRol("admin_org", "finanzas");
  const { c } = await searchParams;
  if (typeof c !== "string" || !UUID.test(c)) notFound();

  const supabase = await crearClienteServidor();
  const [todos, origenes, facturas] = await Promise.all([
    comisionesPorPagar(),
    supabase.from("origenes_pago").select("id, nombre").eq("activo", true).order("orden").returns<{ id: string; nombre: string }[]>(),
    supabase.from("pendientes_comision").select("id, factura_ruta").eq("comisionista_id", c).returns<{ id: string; factura_ruta: string | null }[]>(),
  ]);
  const pendientes = todos.filter((p) => p.comisionista_id === c).sort((a, b) => a.mes.localeCompare(b.mes));
  const desglose = await desgloseDelMes(c, pendientes.map((p) => p.mes));

  // La factura que subió el comisionista, para revisarla antes de pagar.
  const conFactura = new Map((oExplota(facturas, "las facturas") ?? []).map((f) => [f.id, f.factura_ruta]));
  const ligas = new Map<string, string>();
  for (const p of pendientes) {
    const ruta = conFactura.get(p.pendiente_id);
    if (!ruta) continue;
    const { data } = await supabase.storage.from("facturas").createSignedUrl(ruta, 600);
    if (data?.signedUrl) ligas.set(p.pendiente_id, data.signedUrl);
  }

  const nombre = pendientes[0]?.comisionista;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  return (
    <PantallaAdmin titulo="Registrar pago de comisión" volver={{ href: "/admin/comisiones", texto: "Comisiones por pagar" }}>
      {pendientes.length === 0 ? (
        <p className="mt-4 rounded-xl bg-alterno px-4 py-3 text-secundario">Este comisionista no tiene saldo por pagar.</p>
      ) : (
        <>
          <p className="mt-1 text-[1.0625rem] font-semibold">{nombre}</p>
          <FormularioPagoComision
            comisionistaId={c}
            carpeta={carpetaDe(persona)}
            hoy={hoy}
            origenes={oExplota(origenes, "los orígenes") ?? []}
            pendientes={pendientes.map((p) => ({
              id: p.pendiente_id,
              mes: p.mes,
              saldo: p.saldo,
              vencido: p.vencido,
              liga_factura: ligas.get(p.pendiente_id) ?? null,
              desglose: [...(desglose.get(p.mes) ?? new Map<string, number>())].map(([concepto, monto]) => ({ concepto, monto })),
            }))}
          />
        </>
      )}
    </PantallaAdmin>
  );
}

import Link from "next/link";
import { comisionesPorPagar } from "@/lib/comisiones";
import { fechaCorta, pesos } from "@/lib/formato";
import { pendientesDelPanel } from "@/lib/panel";
import { esStaff, type Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

type Pendiente = { href: string; texto: string; cuenta?: number; urgente?: boolean };

/**
 * La franja de la portada: solo lo que espera a la persona, cada cosa lleva a su pantalla. Si no hay
 * nada, no se pinta.
 */
export async function FranjaPendientes({ persona }: { persona: Persona }) {
  const lista = persona.rol === "comisionista" ? await delComisionista(persona) : persona.rol === "equipo" ? [] : await deOperacion(persona);
  if (lista.length === 0) return null;
  return (
    <section aria-label="Pendientes" className="mt-5">
      <h2 className="text-[0.8125rem] font-bold uppercase tracking-wide text-secundario">Pendientes</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {lista.map((p) => (
          <li key={p.href + p.texto}>
            <Link href={p.href} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${p.urgente ? "border-error bg-error-fondo text-error" : "border-linea bg-alterno"}`}>
              <span className="font-semibold leading-6">{p.texto}</span>
              {p.cuenta !== undefined ? <span className="min-w-9 shrink-0 rounded-full bg-primario px-3 py-1 text-center text-[0.9375rem] font-bold text-sobre-primario">{p.cuenta}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function delComisionista(persona: Persona): Promise<Pendiente[]> {
  const supabase = await crearClienteServidor();
  const mes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date()).slice(0, 7) + "-01";
  const [{ data: yo }, { data: porEntregar }, { data: extras }, { data: inactividad }] = await Promise.all([
    supabase.from("comisionistas").select("csf_ruta").eq("persona_id", persona.id).maybeSingle<{ csf_ruta: string | null }>(),
    supabase.from("pagos").select("id, monto, entregar_antes, solicitud_id, solicitudes(cliente_nombre)")
      .eq("recibio_asesor", true).eq("estado", "reportado").is("entregado_en", null).eq("reportado_por", persona.id).order("entregar_antes")
      .returns<{ id: string; monto: string | number; entregar_antes: string; solicitud_id: string; solicitudes: { cliente_nombre: string } | null }[]>(),
    supabase.from("extras_herramienta").select("cantidad").eq("persona_id", persona.id).eq("mes", mes).returns<{ cantidad: number }[]>(),
    supabase.rpc("mi_inactividad"),
  ]);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const lista: Pendiente[] = [];
  const inact = inactividad as { estado: string; dias: number | null } | null;
  if (inact?.estado === "inactiva") {
    lista.push({ href: "/solicitudes/nueva", urgente: true,
      texto: "Tu cuenta está inactiva: el Mapa catastral y la Calculadora completa están apagados. Se reactiva sola cuando se cobre tu siguiente trabajo." });
  } else if (inact?.estado === "por_vencer") {
    lista.push({ href: "/solicitudes/nueva", urgente: true,
      texto: `Te quedan ${inact.dias ?? 0} día${inact.dias === 1 ? "" : "s"} para que tu cuenta pase a inactiva y se apaguen el Mapa catastral y la Calculadora completa. Un trabajo cobrado la mantiene activa.` });
  }
  lista.push(...(porEntregar ?? []).map((p) => ({
    href: `/trabajos/${p.solicitud_id}`,
    texto: `Entrega a la cuenta ${pesos(Number(p.monto))} de ${p.solicitudes?.cliente_nombre ?? "tu cliente"} · ${p.entregar_antes < hoy ? `venció el ${fechaCorta(p.entregar_antes)}` : `a más tardar el ${fechaCorta(p.entregar_antes)}`}`,
    urgente: p.entregar_antes < hoy,
  })));
  if (yo && !yo.csf_ruta) lista.push({ href: "/perfil", texto: "Sube tu Constancia de Situación Fiscal para cobrar tus comisiones" });
  const liberados = (extras ?? []).reduce((s, e) => s + e.cantidad, 0);
  if (liberados) lista.push({ href: "/calculadora", texto: `Se te liberaron ${liberados} cálculos más este mes` });
  return lista;
}

async function deOperacion(persona: Persona): Promise<Pendiente[]> {
  const staff = esStaff(persona);
  const [p, porPagar] = await Promise.all([pendientesDelPanel(), staff ? comisionesPorPagar() : Promise.resolve([])]);
  const vencidas = porPagar.filter((x) => x.vencido);
  const lista: Pendiente[] = [];
  if (p.pagos) lista.push({ href: "/admin/pagos", texto: "Pagos por confirmar", cuenta: p.pagos });
  if (p.solicitudes) lista.push({ href: "/admin/solicitudes", texto: "Solicitudes por cotizar", cuenta: p.solicitudes });
  if (p.alertas) lista.push({ href: "/admin/alertas", texto: "Alertas", cuenta: p.alertas });
  if (staff && p.altas) lista.push({ href: "/admin/altas", texto: "Solicitudes de alta", cuenta: p.altas });
  if (persona.rol === "admin_org" && p.testimonios) lista.push({ href: "/admin/testimonios", texto: "Testimonios por aprobar", cuenta: p.testimonios });
  if (staff && p.cierre.estado !== "aprobado") {
    lista.push({ href: `/admin/cierres/${p.cierre.mes.slice(0, 7)}`, texto: p.cierre.estado === "preparado" ? "Cierre por aprobar" : "Cierre por preparar" });
  }
  if (vencidas.length) lista.push({ href: "/admin/comisiones", texto: `Comisiones vencidas: ${pesos(vencidas.reduce((s, x) => s + x.saldo, 0))}`, cuenta: vencidas.length, urgente: true });
  return lista;
}

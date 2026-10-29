import Link from "next/link";
import { Etiqueta } from "@/components/etiqueta";
import { comisionesPorPagar, type PorPagar } from "@/lib/comisiones";
import { mesLargo, pesos } from "@/lib/formato";
import { SeccionesDeInicio } from "@/components/secciones-de-inicio";
import { TarjetaClientes } from "@/components/tarjeta-clientes";
import { TarjetaInvitar } from "@/components/tarjeta-invitar";
import { bonoDeEquipo, codigoDeEquipo, ligaDeClientes, ligaDeEquipo } from "@/lib/invitar";
import { pendientesDelPanel } from "@/lib/panel";
import { esStaff, NOMBRE_DEL_ROL, type Persona } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

/**
 * El panel abre con lo que toca hacer hoy, en orden: pagos por
 * confirmar primero. Cada renglón dice cuántos hay y lleva a su bandeja.
 * admin_marca ve lo de sus marcas (el RLS filtra) y nada del dinero de
 * comisiones, que mezcla marcas.
 */
export async function InicioStaff({ persona }: { persona: Persona }) {
  const staff = esStaff(persona);
  const supabase = await crearClienteServidor();
  const [p, porPagar, conector, liga, bono, codigo] = await Promise.all([
    pendientesDelPanel(),
    staff ? comisionesPorPagar() : Promise.resolve([] as PorPagar[]),
    supabase
      .from("conectores")
      .select("tipo, estado, ultimo_error")
      .eq("activo", true)
      .maybeSingle()
      .returns<{ tipo: string; estado: string; ultimo_error: string | null } | null>(),
    ligaDeEquipo(persona),
    bonoDeEquipo(persona),
    codigoDeEquipo(persona),
  ]);
  const ligaClientes = codigo ? await ligaDeClientes(persona, codigo) : null;

  const cierre = {
    sin_preparar: { texto: "Por preparar", tono: "proceso" as const },
    preparado: { texto: "Por aprobar", tono: "proceso" as const },
    aprobado: { texto: "Aprobado", tono: "exito" as const },
  }[p.cierre.estado];

  const totalPorPagar = porPagar.reduce((s, x) => s + x.saldo, 0);
  const vencidos = porPagar.filter((x) => x.vencido);
  const sinFactura = porPagar.filter((x) => x.esperando_factura).length;
  const conectorConError = conector.data?.estado === "error";

  return (
    <>
      <h1 className="text-[1.5rem] font-bold tracking-tight">Hola, {persona.nombre.split(" ")[0]}</h1>
      <p className="mt-1 text-[0.9375rem] text-secundario">{NOMBRE_DEL_ROL[persona.rol]}</p>

      {conectorConError ? (
        <Link
          href={persona.rol === "admin_org" ? "/ajustes" : "/admin/alertas"}
          className="mt-4 block rounded-xl border border-error bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6 text-error"
        >
          <span className="font-semibold">El conector no está sincronizando.</span>{" "}
          {conector.data?.ultimo_error ?? "Revisa el conector."}
        </Link>
      ) : null}

      <ul className="mt-6 flex flex-col gap-3">
        <Renglon href="/admin/pagos" titulo="Pagos por confirmar" cuenta={p.pagos} />
        <Renglon href="/admin/solicitudes" titulo="Solicitudes por cotizar" cuenta={p.solicitudes}
          detalle={p.deLiga > 0 ? `${p.deLiga === 1 ? "1 llegó" : `${p.deLiga} llegaron`} por liga de cliente` : undefined} />
        <Renglon href="/admin/alertas" titulo="Alertas" cuenta={p.alertas} />
        {staff ? <Renglon href="/admin/altas" titulo="Solicitudes de alta" cuenta={p.altas} /> : null}
        {staff ? (
          <>
            <li>
              <Link href="/admin/cierres" className="flex items-center justify-between gap-3 rounded-xl border border-linea bg-alterno px-4 py-4">
                <span>
                  <span className="block font-semibold">Cierre mensual</span>
                  <span className="block text-[0.9375rem] capitalize text-secundario">{mesLargo(p.cierre.mes)}</span>
                </span>
                <Etiqueta tono={cierre.tono}>{cierre.texto}</Etiqueta>
              </Link>
            </li>
            <li>
              <Link
                href="/admin/comisiones"
                className={`block rounded-xl border px-4 py-4 ${vencidos.length > 0 ? "border-error bg-error-fondo" : "border-linea bg-alterno"}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold">Comisiones por pagar</span>
                  {totalPorPagar > 0 ? (
                    <span className="font-bold text-primario">{pesos(totalPorPagar)}</span>
                  ) : (
                    <span className="text-[0.9375rem] text-secundario">Al día</span>
                  )}
                </span>
                {vencidos.length > 0 ? (
                  <span className="mt-1 block text-[0.9375rem] font-semibold text-error">
                    {vencidos.length === 1 ? "1 vencida" : `${vencidos.length} vencidas`}:{" "}
                    {pesos(vencidos.reduce((s, x) => s + x.saldo, 0))} pasaron su día límite
                  </span>
                ) : null}
                {sinFactura > 0 ? (
                  <span className="mt-1 block text-[0.9375rem] text-secundario">
                    {sinFactura === 1 ? "1 espera" : `${sinFactura} esperan`} factura del comisionista
                  </span>
                ) : null}
              </Link>
            </li>
          </>
        ) : null}
      </ul>

      <SeccionesDeInicio persona={persona} opera />

      <nav aria-label="Más" className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
        <Enlace href="/admin/tramites">Trámites</Enlace>
        <Enlace href="/admin/comisionistas">Comisionistas</Enlace>
        {staff ? <Enlace href="/admin/referidos">Referidos</Enlace> : null}
        {staff ? <Enlace href="/admin/reportes">Reportes</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/admin/configuracion">Configuración</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/admin/catalogos">Catálogos</Enlace> : null}
        {staff ? <Enlace href="/admin/equipo">Equipo</Enlace> : null}
        {persona.rol === "admin_org" ? <Enlace href="/ajustes">Ajustes</Enlace> : null}
        {persona.superPlataforma ? <Enlace href="/plataforma">Plataforma</Enlace> : null}
      </nav>

      {ligaClientes ? <TarjetaClientes liga={ligaClientes} /> : null}
      {liga ? <TarjetaInvitar liga={liga} equipo bono={bono} /> : null}
    </>
  );
}

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
      {children}
    </Link>
  );
}

function Renglon({ href, titulo, cuenta, detalle }: { href: string; titulo: string; cuenta: number; detalle?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-3 rounded-xl border border-linea bg-alterno px-4 py-4">
        <span>
          <span className="block font-semibold">{titulo}</span>
          {detalle ? <span className="block text-[0.9375rem] text-secundario">{detalle}</span> : null}
        </span>
        {cuenta > 0 ? (
          <span className="min-w-9 rounded-full bg-primario px-3 py-1 text-center text-[0.9375rem] font-bold text-sobre-primario">
            {cuenta}
          </span>
        ) : (
          <span className="text-[0.9375rem] text-secundario">Al día</span>
        )}
      </Link>
    </li>
  );
}

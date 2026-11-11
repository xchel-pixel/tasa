import type { ReactNode } from "react";
import { AccionAcceso } from "@/app/admin/accesos/formularios";
import { DxfPersona } from "@/components/dxf-persona";
import { Etiqueta } from "@/components/etiqueta";
import { LiberarCupo } from "@/components/formularios-cupo";
import { textoCupo, type Cupo } from "@/lib/cupos";
import { fechaCorta, pesos } from "@/lib/formato";
import { resumenNavegador } from "@/lib/navegador";
import { detalleMovimiento, TIPO_COMPRA, TIPO_MOVIMIENTO, type Movimiento, type TipoCompra } from "@/lib/paquetes";
import { NOMBRE_DEL_ROL, type Rol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, NOMBRE_HERRAMIENTA, textoEvento, type EventoUso } from "@/lib/uso";

/**
 * Piezas de la ficha de una persona (fase 2): Accesos y sesiones (con cupos y DXF, que de un comisionista se editan
 * SOLO aquí), Paquete e Historial. Las usan la ficha del comisionista y la pantalla vieja de Accesos.
 */

type Acceso = {
  persona: { id: string; nombre: string; correo: string };
  rol: Rol;
  activa: boolean;
  demo?: boolean;
  yo: boolean;
  nivel: string | null;
  ultimo_acceso: string | null;
  sesiones: { creada: string; actividad: string; navegador: string | null; ip: string | null; humo: boolean }[];
  cupos: Record<string, Cupo>;
  eventos: EventoUso[];
  bitacora: { creado_en: string; tabla: string; accion: string; motivo: string | null; quien: string | null; cambios: string[]; activa: boolean | null }[];
};

type Actividad = { persona_id: string; estado: "activa" | "por_vencer" | "inactiva"; ultima_actividad: string; vence: string | null; inactiva_desde: string | null; paquete: boolean };

const TABLA: Record<string, string> = {
  membresias: "Membresía", "auth.sessions": "Sesiones", extras_herramienta: "Cupo extra", dxf_autorizaciones: "DXF",
  comisionistas: "Ficha de comisionista", personas: "Datos de la persona", membresia_marcas: "Marcas", vistas_como: "Ver como",
  compras_paquete: "Paquete", solicitudes: "Trámite",
};

export function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-linea px-4 py-3">
      <h2 className="font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

export function ParaQueSirve({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[0.9375rem] leading-6 text-secundario">Para qué sirve: {children}</p>;
}

async function leerAcceso(id: string) {
  const supabase = await crearClienteServidor();
  const [{ data }, { data: inact }, { data: eq }] = await Promise.all([
    supabase.rpc("accesos_persona", { p_persona: id }), supabase.rpc("inactividad_org"), supabase.rpc("equipos_org"),
  ]);
  const a = data as Acceso | null;
  const actividad = ((inact ?? []) as Actividad[]).find((i) => i.persona_id === id) ?? null;
  const equipos = ((eq ?? []) as { persona_id: string; equipos: number; maximo: number | null; cierres_mes: number }[]).find((e) => e.persona_id === id) ?? null;
  return { a, actividad, equipos };
}

/** Estatus, acciones de acceso, equipos y sesiones, cupos y DXF. Solo admin_org (accesos_persona lo exige). */
export async function AccesosYSesiones({ id, editaCuposYDxf, verComo = null }: { id: string; editaCuposYDxf: boolean; verComo?: ReactNode }) {
  const { a, actividad, equipos } = await leerAcceso(id);
  if (!a) return null;
  const sesiones = a.sesiones.filter((s) => !s.humo);
  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.9375rem]">
        <div><dt className="text-[0.8125rem] text-secundario">Rol</dt><dd>{NOMBRE_DEL_ROL[a.rol] ?? a.rol}</dd></div>
        <div><dt className="text-[0.8125rem] text-secundario">Estatus</dt>
          <dd>{a.activa ? <Etiqueta tono="exito">Activa</Etiqueta> : <Etiqueta tono="error">Suspendida</Etiqueta>}</dd></div>
        {a.demo ? (
          <div><dt className="text-[0.8125rem] text-secundario">Tipo de cuenta</dt><dd><Etiqueta tono="neutro">Cuenta de demostración</Etiqueta></dd></div>
        ) : null}
        {actividad && !a.demo ? (
          <div><dt className="text-[0.8125rem] text-secundario">Actividad</dt>
            <dd>{actividad.estado === "inactiva" ? <Etiqueta tono="neutro">Inactiva</Etiqueta>
              : actividad.estado === "por_vencer" ? <Etiqueta tono="proceso">Por inactivarse</Etiqueta> : <Etiqueta tono="exito">Al corriente</Etiqueta>}</dd></div>
        ) : null}
        {actividad ? (
          <div><dt className="text-[0.8125rem] text-secundario">Último trabajo cobrado o alta</dt><dd>{fechaHora(actividad.ultima_actividad).split(",")[0]}</dd></div>
        ) : null}
        {actividad && actividad.estado !== "inactiva" && actividad.vence ? (
          <div><dt className="text-[0.8125rem] text-secundario">Pasaría a inactiva</dt><dd>{fechaHora(actividad.vence).split(",")[0]}</dd></div>
        ) : null}
        {actividad?.inactiva_desde ? (
          <div><dt className="text-[0.8125rem] text-secundario">Inactiva desde</dt><dd>{fechaHora(actividad.inactiva_desde).split(",")[0]}</dd></div>
        ) : null}
        <div><dt className="text-[0.8125rem] text-secundario">Último acceso</dt><dd>{a.ultimo_acceso ? fechaHora(a.ultimo_acceso) : "Nunca"}</dd></div>
        <div className="col-span-2"><dt className="text-[0.8125rem] text-secundario">Correo</dt><dd className="[overflow-wrap:anywhere]">{a.persona.correo}</dd></div>
      </dl>

      {a.yo ? null : (
        <div className="mt-4 flex flex-col gap-2">
          {a.activa ? (
            <AccionAcceso que="suspender" personaId={a.persona.id} texto="Suspender" peligro
              explicacion="Se cierran todas sus sesiones y la base le niega todo al instante, aunque traiga una sesión abierta. Lo que se le debe se le sigue pagando." />
          ) : (
            <AccionAcceso que="reactivar" personaId={a.persona.id} texto="Reactivar"
              explicacion="Vuelve a poder entrar con su código; sus sesiones anteriores no se recuperan." />
          )}
          {a.activa && actividad && actividad.estado !== "activa" ? (
            <AccionAcceso que="reactivar_inactiva" personaId={a.persona.id} texto="Reactivar su cuenta inactiva"
              explicacion="Le vuelven el Mapa catastral y la Calculadora completa, y cuenta como actividad: tendrá otros 6 meses antes de volver a quedar inactiva." />
          ) : null}
          {verComo}
          {a.rol === "comisionista" ? (a.demo ? (
            <AccionAcceso que="quitar_demo" personaId={a.persona.id} texto="Quitar la marca de demostración"
              explicacion="Vuelve a enviar solicitudes y a contar en estadísticas, niveles, inactividad y límite de equipos." />
          ) : (
            <AccionAcceso que="marcar_demo" personaId={a.persona.id} texto="Marcar como cuenta de demostración"
              explicacion="Para enseñar los menús: ve todas las herramientas, no envía solicitudes y queda fuera de estadísticas, niveles, inactividad, límite de equipos y Notion." />
          )) : null}
          {a.sesiones.length ? (
            <AccionAcceso que="cerrar" personaId={a.persona.id} texto="Cerrar sus sesiones"
              explicacion="Sin suspenderla: tendrá que volver a entrar con el código que le llega al correo. Útil si perdió su celular." />
          ) : null}
        </div>
      )}

      <Bloque titulo={`Equipos conectados: ${sesiones.length}${equipos?.maximo ? ` de ${equipos.maximo} permitidos` : " (sin límite)"}`}>
        {equipos?.cierres_mes ? (
          <p className="mt-1 text-[0.9375rem] text-secundario">
            {equipos.cierres_mes} cierre{equipos.cierres_mes === 1 ? "" : "s"} por límite este mes{equipos.cierres_mes >= 4 ? ": puede ser una cuenta compartida." : "."}
          </p>
        ) : null}
        {sesiones.length ? (
          <ul className="mt-2 flex flex-col gap-2 text-[0.9375rem]">
            {sesiones.slice(0, 5).map((s, i) => (
              <li key={i}>
                <span className="font-semibold">{resumenNavegador(s.navegador ?? "")}</span>
                <span className="block text-secundario">Desde {fechaHora(s.creada)} · última actividad {fechaHora(s.actividad)}{s.ip ? ` · IP ${s.ip}` : ""}</span>
              </li>
            ))}
            {sesiones.length > 5 ? (
              <li className="text-secundario">Y {sesiones.length - 5} más, menos recientes. &quot;Cerrar sus sesiones&quot; las cierra todas.</li>
            ) : null}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">Ninguna.</p>}
      </Bloque>

      <Bloque titulo="Cupos del mes">
        <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
          {Object.entries(a.cupos).map(([h, c]) => (
            <li key={h} className="flex justify-between gap-3">
              <span className="text-secundario">{NOMBRE_HERRAMIENTA[h] ?? h}</span>
              <span className="text-right font-semibold">{c.usados} usados · {textoCupo(c).replace("Te quedan", "le quedan")}</span>
            </li>
          ))}
        </ul>
        {a.rol === "comisionista" && editaCuposYDxf ? (
          <LiberarCupo personaId={a.persona.id} opciones={Object.keys(a.cupos).map((h) => ({ clave: h, nombre: NOMBRE_HERRAMIENTA[h] ?? h }))} />
        ) : null}
      </Bloque>

      {a.rol !== "admin_org" ? <DxfPersona personaId={a.persona.id} edita={editaCuposYDxf} /> : null}
    </>
  );
}

/** Paquete vigente, saldo, compras y movimientos de crédito (admin_org y finanzas). */
export async function PaqueteDePersona({ id }: { id: string }) {
  const supabase = await crearClienteServidor();
  const [{ data: cred }, { data: compras }] = await Promise.all([
    supabase.rpc("credito_de", { p_persona: id }),
    supabase.from("compras_paquete").select("id, tipo, forma_pago, precio, credito, estado, inicia, vence, creado_en, folio_cfdi, paquetes(nombre)")
      .eq("persona_id", id).order("creado_en", { ascending: false })
      .returns<{ id: string; tipo: TipoCompra; forma_pago: string; precio: number | string; credito: number | string; estado: string; inicia: string | null;
        vence: string | null; creado_en: string; folio_cfdi: string | null; paquetes: { nombre: string } | null }[]>(),
  ]);
  const c = cred as { paquete: string | null; vence: string | null; saldo: number | string; movimientos: Movimiento[] } | null;
  if (!c) return null;
  return (
    <>
      <div className="mt-3 rounded-xl border border-linea px-4 py-3">
        <p className="text-[0.9375rem] text-secundario">Crédito disponible</p>
        <p className="text-[1.5rem] font-bold tabular-nums text-primario">{pesos(Number(c.saldo))}</p>
        <p className="text-[0.9375rem]">{c.paquete ? <>Paquete <strong>{c.paquete}</strong>, vence el {fechaCorta(c.vence!)}</> : "Sin paquete vigente"}</p>
      </div>
      <Bloque titulo="Compras">
        {compras?.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
            {compras.map((x) => (
              <li key={x.id}>
                <span className="text-secundario">{fechaCorta(x.creado_en)}</span> · {TIPO_COMPRA[x.tipo]} {x.paquetes?.nombre} · {pesos(Number(x.precio))}
                {x.forma_pago === "comision" ? " con su comisión" : ""} · {x.estado === "confirmada" ? "pagada" : x.estado === "por_pagar" ? "por pagar" : "cancelada"}
                {x.folio_cfdi ? ` · CFDI ${x.folio_cfdi}` : ""}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">No ha comprado paquetes.</p>}
      </Bloque>
      <Bloque titulo="Movimientos de crédito">
        {c.movimientos.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-[0.9375rem]">
            {c.movimientos.map((m) => (
              <li key={m.id}><span className="text-secundario">{fechaCorta(m.creado_en)}</span> · {TIPO_MOVIMIENTO[m.tipo]} · {detalleMovimiento(m)} · {pesos(Number(m.monto))}</li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">Sin movimientos.</p>}
      </Bloque>
    </>
  );
}

function Lista({ titulo, lista, vacio, n }: { titulo: string; lista: EventoUso[]; vacio: string; n: number }) {
  return (
    <>
      <h3 className="mt-3 text-[0.9375rem] font-semibold">{titulo}</h3>
      {lista.length ? (
        <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
          {lista.slice(0, n).map((e) => <li key={e.id}><span className="text-secundario">{fechaHora(e.creado_en)}</span> · {textoEvento(e)}{e.clave ? ` · ${e.clave}` : ""}</li>)}
        </ul>
      ) : <p className="mt-1 text-[0.9375rem] text-secundario">{vacio}</p>}
    </>
  );
}

/** Accesos, denegaciones, uso y (solo admin_org) cambios administrativos. */
export async function HistorialPersona({ id, admin }: { id: string; admin: boolean }) {
  const supabase = await crearClienteServidor();
  let eventos: EventoUso[] = [];
  let bitacora: Acceso["bitacora"] = [];
  if (admin) {
    const { a } = await leerAcceso(id);
    eventos = a?.eventos ?? [];
    bitacora = a?.bitacora ?? [];
  } else {
    eventos = ((await supabase.from("eventos_uso").select("*").eq("persona_id", id).eq("humo", false).order("creado_en", { ascending: false }).limit(80)).data ?? []) as EventoUso[];
  }
  const accesos = eventos.filter((e) => e.evento === "acceso" || e.evento === "cierre_limite");
  const negados = eventos.filter((e) => e.evento === "denegado");
  const usos = eventos.filter((e) => e.evento !== "acceso" && e.evento !== "denegado" && e.evento !== "cierre_limite");
  return (
    <Bloque titulo="Historial">
      <Lista titulo="Accesos" lista={accesos} vacio="Sin accesos registrados (se registran desde el 9 nov 2026)." n={10} />
      <Lista titulo="Denegaciones" lista={negados} vacio="Ninguna." n={20} />
      <Lista titulo="Uso reciente" lista={usos} vacio="Sin uso registrado." n={20} />
      {admin ? (
        <>
          <h3 className="mt-3 text-[0.9375rem] font-semibold">Cambios administrativos</h3>
          {bitacora.length ? (
            <ul className="mt-1 flex flex-col gap-2 text-[0.9375rem]">
              {bitacora.slice(0, 20).map((b, i) => (
                <li key={i}>
                  <span className="font-semibold">
                    {TABLA[b.tabla] ?? b.tabla}: {b.tabla === "membresias" && b.cambios.includes("activa") ? (b.activa ? "reactivada" : "suspendida")
                      : b.tabla === "auth.sessions" ? "sesiones cerradas" : b.accion === "INSERT" ? "alta" : b.accion === "DELETE" ? "baja" : `cambió ${b.cambios.join(", ") || "datos"}`}
                  </span>
                  <span className="block text-secundario">{fechaHora(b.creado_en)} · {b.quien ?? "el sistema"}{b.motivo ? ` · ${b.motivo}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-1 text-[0.9375rem] text-secundario">Sin cambios.</p>}
        </>
      ) : null}
    </Bloque>
  );
}

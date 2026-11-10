import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { DxfPersona } from "@/components/dxf-persona";
import { Etiqueta } from "@/components/etiqueta";
import { LiberarCupo } from "@/components/formularios-cupo";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { textoCupo, type Cupo } from "@/lib/cupos";
import { resumenNavegador } from "@/lib/navegador";
import { exigirRol, NOMBRE_DEL_ROL, type Rol } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";
import { fechaHora, NOMBRE_HERRAMIENTA, textoEvento, type EventoUso } from "@/lib/uso";
import { AccionAcceso } from "../formularios";

export const metadata = { title: "Accesos — Tasa" };

type Acceso = {
  persona: { id: string; nombre: string; correo: string };
  rol: Rol;
  activa: boolean;
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
  comisionistas: "Ficha de comisionista", personas: "Datos de la persona", membresia_marcas: "Marcas",
};

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-xl border border-linea px-4 py-3">
      <h2 className="font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

/** Accesos de una persona (0071): solo admin_org. La IP llega recortada desde la base. */
export default async function AccesoPersona({ params }: { params: Promise<{ id: string }> }) {
  await exigirRol("admin_org");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await crearClienteServidor();
  const [{ data }, { data: inact }, { data: eq }] = await Promise.all([supabase.rpc("accesos_persona", { p_persona: id }), supabase.rpc("inactividad_org"),
    supabase.rpc("equipos_org")]);
  const equipos = ((eq ?? []) as { persona_id: string; equipos: number; maximo: number | null; cierres_mes: number }[]).find((e) => e.persona_id === id) ?? null;
  const a = data as Acceso | null;
  if (!a) notFound();
  const actividad = ((inact ?? []) as Actividad[]).find((i) => i.persona_id === id) ?? null;
  const accesos = a.eventos.filter((e) => e.evento === "acceso" || e.evento === "cierre_limite");
  const sesiones = a.sesiones.filter((s) => !s.humo);
  const negados = a.eventos.filter((e) => e.evento === "denegado");
  const usos = a.eventos.filter((e) => e.evento !== "acceso" && e.evento !== "denegado");

  return (
    <PantallaAdmin titulo={a.persona.nombre} volver={{ href: "/admin/accesos", texto: "Accesos" }}>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.9375rem]">
        <div><dt className="text-[0.8125rem] text-secundario">Rol</dt><dd>{NOMBRE_DEL_ROL[a.rol] ?? a.rol}</dd></div>
        <div><dt className="text-[0.8125rem] text-secundario">Estatus</dt>
          <dd>{a.activa ? <Etiqueta tono="exito">Activa</Etiqueta> : <Etiqueta tono="error">Suspendida</Etiqueta>}</dd></div>
        {a.nivel ? <div><dt className="text-[0.8125rem] text-secundario">Nivel del mes</dt><dd>{a.nivel}</dd></div> : null}
        {actividad ? (
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
        {/* Liberar extra: solo comisionistas (el equipo no tiene límite mensual). */}
        {a.rol === "comisionista" ? <LiberarCupo personaId={a.persona.id} opciones={Object.keys(a.cupos).map((h) => ({ clave: h, nombre: NOMBRE_HERRAMIENTA[h] ?? h }))} /> : null}
      </Bloque>

      {a.rol !== "admin_org" ? <DxfPersona personaId={a.persona.id} edita /> : null}

      <Bloque titulo="Historial">
        <h3 className="mt-2 text-[0.9375rem] font-semibold">Accesos</h3>
        {accesos.length ? (
          <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
            {accesos.slice(0, 10).map((e) => <li key={e.id}><span className="text-secundario">{fechaHora(e.creado_en)}</span> · {textoEvento(e)}</li>)}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">Sin accesos registrados (se registran desde el 9 nov 2026).</p>}

        <h3 className="mt-3 text-[0.9375rem] font-semibold">Denegaciones</h3>
        {negados.length ? (
          <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
            {negados.slice(0, 20).map((e) => (
              <li key={e.id}><span className="text-secundario">{fechaHora(e.creado_en)}</span> · {textoEvento(e)}{e.clave ? ` · ${e.clave}` : ""}</li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">Ninguna.</p>}

        <h3 className="mt-3 text-[0.9375rem] font-semibold">Uso reciente</h3>
        {usos.length ? (
          <ul className="mt-1 flex flex-col gap-1 text-[0.9375rem]">
            {usos.slice(0, 20).map((e) => (
              <li key={e.id}><span className="text-secundario">{fechaHora(e.creado_en)}</span> · {textoEvento(e)}{e.clave ? ` · ${e.clave}` : ""}</li>
            ))}
          </ul>
        ) : <p className="mt-1 text-[0.9375rem] text-secundario">Sin uso registrado.</p>}

        <h3 className="mt-3 text-[0.9375rem] font-semibold">Cambios administrativos</h3>
        {a.bitacora.length ? (
          <ul className="mt-1 flex flex-col gap-2 text-[0.9375rem]">
            {a.bitacora.slice(0, 12).map((b, i) => (
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
        {a.bitacora.length > 12 ? (
          <p className="mt-2 text-[0.875rem] text-secundario">Se muestran los 12 más recientes de {a.bitacora.length}.</p>
        ) : null}
      </Bloque>
    </PantallaAdmin>
  );
}

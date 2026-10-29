"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { altaMiembro, cambiarActiva, cambiarBonoReferido, ponerNombreParaMostrar, type EstadoEquipo } from "./acciones";

const INICIAL: EstadoEquipo = { error: null, mensaje: null };
const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

const ROLES = [
  { valor: "finanzas", texto: "Finanzas", detalle: "Pagos, cierres y comisiones de toda la organización." },
  { valor: "admin_marca", texto: "Administración de marca", detalle: "Trabajos, cotizaciones y pagos solo de sus marcas." },
  { valor: "admin_org", texto: "Administración", detalle: "Todo, incluidos ajustes y equipo." },
  { valor: "equipo", texto: "Equipo", detalle: "Sin comisión. Para herramientas internas (todavía no hay)." },
];

export function AltaMiembro({ marcas }: { marcas: { id: string; clave: string; nombre: string }[] }) {
  const [estado, enviar] = useActionState(altaMiembro, INICIAL);
  const [rol, setRol] = useState("finanzas");
  return (
    <form action={enviar} className="mt-4 flex flex-col gap-5">
      <div>
        <label htmlFor="nombre" className="block font-semibold">Nombre</label>
        <input id="nombre" name="nombre" required maxLength={120} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="correo" className="block font-semibold">Correo</label>
        <input id="correo" name="correo" type="email" required className={ENTRADA} />
      </div>
      <fieldset>
        <legend className="font-semibold">Rol</legend>
        <div className="mt-2 flex flex-col gap-2">
          {ROLES.map((r) => (
            <label key={r.valor} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${rol === r.valor ? "border-acento bg-tinte" : "border-linea"}`}>
              <input type="radio" name="rol" value={r.valor} checked={rol === r.valor} onChange={() => setRol(r.valor)}
                className="mt-1 h-5 w-5 accent-primario" />
              <span>
                <span className="block font-semibold">{r.texto}</span>
                <span className="block text-[0.9375rem] leading-6 text-secundario">{r.detalle}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {rol === "admin_marca" ? (
        <fieldset>
          <legend className="font-semibold">Sus marcas</legend>
          <div className="mt-2 flex flex-col gap-2">
            {marcas.map((m) => (
              <label key={m.id} className="flex items-center gap-3 text-[0.9375rem]">
                <input type="checkbox" name="marcas" value={m.id} className="h-5 w-5 accent-primario" />
                {m.clave} · {m.nombre}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Aviso estado={estado} />
      <BotonEnviar>Agregar</BotonEnviar>
    </form>
  );
}

/** "Nombre para mostrar": el que ven comisionistas, la liga pública y el panel. */
export function NombreParaMostrar({ personaId, actual }: { personaId: string; actual: string | null }) {
  const [estado, enviar] = useActionState(ponerNombreParaMostrar, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="persona" value={personaId} />
      <label htmlFor={`npm-${personaId}`} className="text-[0.9375rem] font-semibold">Nombre para mostrar</label>
      <div className="flex gap-2">
        <input id={`npm-${personaId}`} name="nombre_para_mostrar" maxLength={60} defaultValue={actual ?? ""} placeholder="Su nombre real"
          className="min-w-0 flex-1 rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
        <button type="submit" className="rounded-lg border border-primario px-3 font-semibold text-primario">Guardar</button>
      </div>
      <Aviso estado={estado} />
    </form>
  );
}

/**
 * Interruptor, % y vigencia por persona; solo aparece si la organización tiene encendido el bono para el
 * equipo. El % y la fecha se ven al encender el interruptor.
 */
export function CambiarBonoReferido({ membresiaId, activo, pct, hasta }: {
  membresiaId: string; activo: boolean; pct: number | null; hasta: string | null;
}) {
  const [estado, enviar] = useActionState(cambiarBonoReferido, INICIAL);
  const [encendido, setEncendido] = useState(activo);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3 rounded-lg border border-linea px-3 py-3">
      <input type="hidden" name="membresia" value={membresiaId} />
      <label className="flex items-center gap-3 font-semibold">
        <input type="checkbox" name="activo" checked={encendido} onChange={(e) => setEncendido(e.target.checked)}
          className="size-5 shrink-0 accent-primario" />
        Dar bono de referido
      </label>
      {encendido ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`pct-${membresiaId}`} className="block text-[0.9375rem] font-semibold">% de bono</label>
            <input id={`pct-${membresiaId}`} name="pct" inputMode="decimal" maxLength={4} defaultValue={pct ?? ""}
              placeholder="Escala"
              className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
          </div>
          <div>
            <label htmlFor={`hasta-${membresiaId}`} className="block text-[0.9375rem] font-semibold">Vigente hasta</label>
            <input id={`hasta-${membresiaId}`} name="hasta" type="date" defaultValue={hasta ?? ""}
              className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
          </div>
          <p className="col-span-2 text-[0.875rem] leading-5 text-secundario">
            De 0 a 5%. Vacío: la escala de comisionistas (2% a 5% según sus referidos activos). Sin fecha: sin vencimiento.
          </p>
        </div>
      ) : null}
      <BotonEnviar variante="secundario">Guardar bono</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Lo mismo, en solo lectura (finanzas). */
export function BonoReferidoLectura({ activo, pct, hasta }: { activo: boolean; pct: number | null; hasta: string | null }) {
  return (
    <p className="mt-3 text-[0.9375rem] text-secundario">
      Bono de referido:{" "}
      {activo
        ? `${pct === null ? "escala normal (2% a 5%)" : `${pct}% fijo`}${hasta ? `, vigente hasta ${hasta}` : ""}`
        : "no"}
    </p>
  );
}

export function CambiarActiva({ membresiaId, activa }: { membresiaId: string; activa: boolean }) {
  const [estado, enviar] = useActionState(cambiarActiva, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="membresia" value={membresiaId} />
      <input type="hidden" name="activa" value={String(!activa)} />
      <BotonEnviar variante={activa ? "peligro" : "secundario"}>{activa ? "Desactivar" : "Activar"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

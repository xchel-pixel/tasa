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

/** Interruptor por persona; solo aparece si la organización tiene encendido el bono para el equipo. */
export function CambiarBonoReferido({ membresiaId, activo }: { membresiaId: string; activo: boolean }) {
  const [estado, enviar] = useActionState(cambiarBonoReferido, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="membresia" value={membresiaId} />
      <input type="hidden" name="activo" value={String(!activo)} />
      <p className="text-[0.9375rem] text-secundario">Bono de referido: {activo ? "sí" : "no"}</p>
      <BotonEnviar variante="secundario">{activo ? "Quitar bono de referido" : "Dar bono de referido"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
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

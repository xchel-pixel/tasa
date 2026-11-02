"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { guardarMiPerfil, type EstadoPerfil } from "@/app/perfil/acciones-perfil";
import type { MiPerfil } from "@/lib/perfil";

const OTRO = "otro";

/**
 * "Mi perfil": de la lista de la organización o "Otro" (texto libre que aprueba Administración; mientras
 * tanto la tarjeta sigue con el anterior). Va en "Mis datos" y en "Mi tarjeta".
 */
export function MiPerfilFormulario({ perfil }: { perfil: MiPerfil }) {
  const [estado, enviar] = useActionState<EstadoPerfil, FormData>(guardarMiPerfil, { error: null, mensaje: null });
  const [eleccion, setEleccion] = useState(perfil.otro ? OTRO : (perfil.perfilId ?? ""));
  return (
    <form action={enviar} className="mt-6 flex flex-col gap-2 rounded-xl border border-linea px-4 py-4">
      <label htmlFor="perfil" className="font-semibold">Mi perfil</label>
      <p className="text-[0.9375rem] leading-6 text-secundario">
        Tu tarjeta dice: <span className="font-semibold text-texto">{perfil.actual} · aliado comercial</span>
      </p>
      <select id="perfil" name="perfil" value={eleccion} onChange={(e) => setEleccion(e.target.value)}
        className="mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento">
        {perfil.opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        <option value={OTRO}>Otro…</option>
      </select>
      {eleccion === OTRO ? (
        <>
          <input name="otro" required minLength={2} maxLength={60} defaultValue={perfil.otro ?? perfil.solicitado ?? ""}
            placeholder="Tu profesión (p. ej. Corredor de seguros)" aria-label="Tu perfil"
            className="w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
          <p className="text-[0.875rem] leading-5 text-secundario">
            Lo revisa Administración antes de que salga en tu tarjeta. No escribas perito, valuador ni los nombres de las marcas.
          </p>
        </>
      ) : null}
      {perfil.solicitado ? (
        <p className="rounded-lg bg-proceso-fondo px-3 py-2 text-[0.9375rem] leading-6 text-proceso">
          Pediste &quot;{perfil.solicitado}&quot;: espera la aprobación de Administración.
        </p>
      ) : null}
      {perfil.rechazo ? (
        <p className="rounded-lg bg-error-fondo px-3 py-2 text-[0.9375rem] leading-6 text-error">
          Administración no aprobó {perfil.rechazo}
        </p>
      ) : null}
      <BotonEnviar variante="secundario">Guardar perfil</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

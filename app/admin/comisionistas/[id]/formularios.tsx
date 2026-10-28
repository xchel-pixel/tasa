"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { CampoBienvenida } from "@/components/campo-bienvenida";
import type { TratosOrg } from "@/lib/tratos";
import { agregarMovimiento, cambiarActivo, editarDatos, forzarElite, ponerBienvenida, type EstadoFicha } from "./acciones";

const INICIAL: EstadoFicha = { error: null, mensaje: null };
const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

export function EditarDatos({
  personaId, nombre, telefono, rfc, emiteFactura,
}: { personaId: string; nombre: string; telefono: string; rfc: string; emiteFactura: boolean }) {
  const [estado, enviar] = useActionState(editarDatos, INICIAL);
  return (
    <details className="mt-3 rounded-xl border border-linea px-4 py-3">
      <summary className="toque cursor-pointer font-semibold text-acento">Editar datos</summary>
      <form action={enviar} className="mt-3 flex flex-col gap-4">
        <input type="hidden" name="persona_id" value={personaId} />
        <div>
          <label htmlFor="nombre" className="block font-semibold">Nombre</label>
          <input id="nombre" name="nombre" required maxLength={120} defaultValue={nombre} className={ENTRADA} />
        </div>
        <div>
          <label htmlFor="telefono" className="block font-semibold">Teléfono</label>
          <input id="telefono" name="telefono" type="tel" maxLength={20} defaultValue={telefono} className={ENTRADA} />
        </div>
        <div>
          <label htmlFor="rfc" className="block font-semibold">RFC</label>
          <input id="rfc" name="rfc" maxLength={20} defaultValue={rfc} className={`${ENTRADA} uppercase`} />
        </div>
        <label className="flex items-start gap-3 text-[0.9375rem] leading-6">
          <input type="checkbox" name="emite_factura" defaultChecked={emiteFactura} className="mt-1 h-5 w-5 accent-primario" />
          Emite factura por sus comisiones
        </label>
        <BotonEnviar variante="secundario">Guardar datos</BotonEnviar>
        <Aviso estado={estado} />
      </form>
    </details>
  );
}

export function CambiarActivo({ personaId, activo }: { personaId: string; activo: boolean }) {
  const [estado, enviar] = useActionState(cambiarActivo, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <input type="hidden" name="persona_id" value={personaId} />
      <input type="hidden" name="activo" value={String(!activo)} />
      <p className="text-[0.9375rem] leading-6 text-secundario">
        {activo
          ? "Desactivado no entra al portal ni se le calcula nivel. Su historial y lo que se le debe se conservan."
          : "Al activarlo vuelve a entrar con su correo."}
      </p>
      <BotonEnviar variante={activo ? "peligro" : "secundario"}>{activo ? "Desactivar" : "Activar"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function ForzarElite({ personaId, actual, vence }: { personaId: string; actual: number | null; vence: string | null }) {
  const [estado, enviar] = useActionState(forzarElite, INICIAL);
  return (
    <div className="rounded-xl border border-linea px-4 py-4">
      <p className="font-semibold">Nivel Élite</p>
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Un porcentaje fijo que manda sobre el nivel calculado. Aplica a lo que se devengue desde hoy; no cambia
        meses cerrados.
      </p>
      <form action={enviar} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="persona_id" value={personaId} />
        <label htmlFor="porcentaje" className="block font-semibold">Porcentaje (máximo 30)</label>
        <input id="porcentaje" name="porcentaje" inputMode="decimal" defaultValue={actual ?? ""} className={ENTRADA.replace("mt-2 ", "")} />
        <label htmlFor="vence" className="block font-semibold">
          Vence <span className="font-normal text-secundario">(opcional; aplica hasta el mes de esta fecha)</span>
        </label>
        <input id="vence" name="vence" type="date" defaultValue={vence ?? ""} className={ENTRADA.replace("mt-2 ", "")} />
        <BotonEnviar variante="secundario">{actual === null ? "Forzar Élite" : "Cambiar porcentaje"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {actual !== null ? (
        <form action={enviar} className="mt-2">
          <input type="hidden" name="persona_id" value={personaId} />
          <input type="hidden" name="quitar" value="true" />
          <BotonEnviar variante="peligro">Quitar Élite</BotonEnviar>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Dar la tasa de bienvenida a quien ya está dado de alta (o quitársela).
 * Empieza este mes; quitarla lo deja en la escalera normal.
 */
export function TasaDeBienvenida({
  personaId, tratos, puedeCambiarMeses, tiene,
}: { personaId: string; tratos: TratosOrg; puedeCambiarMeses: boolean; tiene: boolean }) {
  const [estado, enviar] = useActionState(ponerBienvenida, INICIAL);
  return (
    <div className="rounded-xl border border-linea px-4 py-4">
      <p className="font-semibold">Tasa de bienvenida</p>
      <form action={enviar} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="persona_id" value={personaId} />
        {tiene ? (
          <>
            <input type="hidden" name="quitar" value="true" />
            <BotonEnviar variante="peligro">Quitar tasa de bienvenida</BotonEnviar>
          </>
        ) : (
          <>
            <CampoBienvenida bienvenida={tratos.bienvenida} arranque={tratos.arranque} puedeCambiarMeses={puedeCambiarMeses} marcada />
            <BotonEnviar variante="secundario">Dar tasa de bienvenida desde este mes</BotonEnviar>
          </>
        )}
        <Aviso estado={estado} />
      </form>
    </div>
  );
}

export function AgregarMovimiento({
  personaId, cuentas, servicios,
}: { personaId: string; cuentas: { id: string; alias: string }[]; servicios: { id: string; nombre: string }[] }) {
  const [estado, enviar] = useActionState(agregarMovimiento, INICIAL);
  return (
    <details className="rounded-xl border border-linea px-4 py-3">
      <summary className="toque cursor-pointer font-semibold text-acento">Agregar bono, ajuste o cargo</summary>
      <form action={enviar} className="mt-3 flex flex-col gap-4">
        <input type="hidden" name="persona_id" value={personaId} />
        <div>
          <label htmlFor="tipo" className="block font-semibold">Tipo</label>
          <select id="tipo" name="tipo" required defaultValue="bono" className={ENTRADA}>
            <option value="bono">Bono (suma)</option>
            <option value="cargo">Cargo (resta)</option>
            <option value="ajuste">Ajuste (con signo: −500 resta)</option>
          </select>
        </div>
        <div>
          <label htmlFor="monto_mov" className="block font-semibold">Monto</label>
          <input id="monto_mov" name="monto" inputMode="decimal" required className={ENTRADA} />
        </div>
        <div>
          <label htmlFor="cuenta" className="block font-semibold">Empresa</label>
          <select id="cuenta" name="cuenta" required defaultValue="" className={ENTRADA}>
            <option value="" disabled>Elige la empresa</option>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.alias}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="servicio" className="block font-semibold">
            Servicio <span className="font-normal text-secundario">(opcional)</span>
          </label>
          <select id="servicio" name="servicio" defaultValue="" className={ENTRADA}>
            <option value="">Ninguno</option>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nota_mov" className="block font-semibold">Concepto</label>
          <input id="nota_mov" name="nota" required maxLength={200} className={ENTRADA} />
          <p className="mt-1 text-[0.9375rem] text-secundario">El comisionista lo ve en su estado de cuenta.</p>
        </div>
        <BotonEnviar variante="secundario">Agregar al mes abierto</BotonEnviar>
        <Aviso estado={estado} />
      </form>
    </details>
  );
}

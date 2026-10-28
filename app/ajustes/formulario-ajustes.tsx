"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { guardarAjustes, guardarOrigen, guardarPrefijo, usarConectorManual, type EstadoAjustes } from "./acciones";

const INICIAL: EstadoAjustes = { mensaje: null, error: null };
const ENTRADA =
  "mt-3 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

export default function FormularioAjustes({
  contacto,
  diaLimite,
  terminos,
  aviso,
}: {
  contacto: string;
  diaLimite: number;
  terminos: string;
  aviso: string;
}) {
  const [estado, enviar] = useActionState(guardarAjustes, INICIAL);

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-6">
      <div>
        <label htmlFor="contacto_soporte" className="block font-semibold">
          Contacto de soporte
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Correo o teléfono que ven los comisionistas y quien no está dado de alta cuando
          necesitan ayuda. Vacío: no se muestra ningún contacto.
        </p>
        <input id="contacto_soporte" name="contacto_soporte" maxLength={120} defaultValue={contacto} className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="dia_limite_pago_comision" className="block font-semibold">
          Día límite para pagar comisiones
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Día del mes siguiente al de las comisiones. Con 10, lo de septiembre vence el 10 de octubre; después
          sale en rojo en el inicio.
        </p>
        <input id="dia_limite_pago_comision" name="dia_limite_pago_comision" type="number" min={1} max={28} required
          defaultValue={diaLimite} className={`${ENTRADA} max-w-28`} />
      </div>

      <div>
        <label htmlFor="terminos" className="block font-semibold">Términos para los comisionistas</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          El texto que aceptan al entrar. Si lo cambias, cada comisionista tendrá que volver a aceptarlo antes de seguir usando Tasa.
        </p>
        <textarea id="terminos" name="terminos" rows={5} maxLength={20000} defaultValue={terminos} className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="aviso_privacidad" className="block font-semibold">Aviso de privacidad</label>
        <textarea id="aviso_privacidad" name="aviso_privacidad" rows={5} maxLength={20000} defaultValue={aviso}
          className={ENTRADA} />
      </div>

      <Aviso estado={estado} />
      <BotonEnviar pendiente="Guardando…">Guardar</BotonEnviar>
    </form>
  );
}

/** El prefijo de los folios que genera Tasa. */
export function FormularioPrefijo({ prefijo }: { prefijo: string }) {
  const [estado, enviar] = useActionState(guardarPrefijo, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3">
      <label htmlFor="prefijo_folio" className="block font-semibold">Prefijo de folio</label>
      <p className="-mt-2 text-[0.9375rem] leading-6 text-secundario">
        Con el conector manual, Tasa pone el folio al aceptarse un trabajo: PREFIJO-AAAA-NNNN. Cambiarlo aplica a los
        siguientes; los que ya tienen folio no cambian.
      </p>
      <input id="prefijo_folio" name="prefijo_folio" required maxLength={6} pattern="[A-Za-z0-9]{2,6}" defaultValue={prefijo}
        className={`${ENTRADA.replace("mt-3 ", "")} max-w-40 uppercase`} />
      <BotonEnviar variante="secundario">Guardar prefijo</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Volver a manual si el conector activo es otro (hoy solo manual está disponible). */
export function VolverAManual() {
  const [estado, enviar] = useActionState(usarConectorManual, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <BotonEnviar variante="secundario">Usar el conector manual</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Una fila del catálogo (nombre + activo) o, sin `id`, la de agregar. */
export function FilaOrigen({ id, nombre, activo }: { id?: string; nombre?: string; activo?: boolean }) {
  const [estado, enviar] = useActionState(guardarOrigen, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-lg border border-linea px-3 py-3">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="flex items-center gap-2">
        <label htmlFor={`origen-${id ?? "nuevo"}`} className="sr-only">Nombre</label>
        <input id={`origen-${id ?? "nuevo"}`} name="nombre" required maxLength={40} defaultValue={nombre}
          placeholder={id ? undefined : "Nuevo origen"}
          className="min-w-0 flex-1 rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
        <div className="w-28 shrink-0"><BotonEnviar variante="secundario">{id ? "Guardar" : "Agregar"}</BotonEnviar></div>
      </div>
      {id ? (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="activo" defaultChecked={activo} className="h-5 w-5 accent-primario" />
          Activo (aparece al registrar un pago)
        </label>
      ) : null}
      <Aviso estado={estado} />
    </form>
  );
}

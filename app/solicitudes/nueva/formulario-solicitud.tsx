"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { crearSolicitud, type EstadoSolicitud } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

export type InicialSolicitud = { servicio_id?: string; municipio?: string; clave?: string; descripcion?: string; calculo?: string; direccion?: string; desde?: "mapa" };

/** `inicial`: lo que trae la liga de la calculadora de traslado (servicio, municipio, clave y notas). */
export default function FormularioSolicitud({ servicios, inicial = {}, credito = 0 }: { servicios: { id: string; nombre: string }[]; inicial?: InicialSolicitud; credito?: number }) {
  const [estado, enviar] = useActionState<EstadoSolicitud, FormData>(crearSolicitud, { error: null });

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-6">
      {inicial.calculo ? <input type="hidden" name="calculo_traslado_id" value={inicial.calculo} /> : null}
      {inicial.desde ? <input type="hidden" name="desde" value={inicial.desde} /> : null}
      <fieldset>
        <legend className="font-semibold">Qué necesitas</legend>
        <div className="mt-2 flex flex-col gap-2">
          <Opcion
            valor="cotizacion"
            titulo="Solo cotización"
            detalle="Te mandamos el precio; el trabajo arranca cuando la aceptes."
            marcada
          />
          <Opcion
            valor="tramite_directo"
            titulo="Trámite directo"
            detalle="El cliente ya está de acuerdo: arrancamos en cuanto pongamos el precio."
          />
        </div>
      </fieldset>

      <div>
        <label htmlFor="servicio_id" className="block font-semibold">Servicio</label>
        <select id="servicio_id" name="servicio_id" required defaultValue={inicial.servicio_id ?? ""} className={ENTRADA}>
          <option value="" disabled>Elige uno</option>
          {servicios.map((s) => (
            <option key={s.id} value={s.id}>{s.nombre}</option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-[1.125rem] font-bold">Inmueble</legend>
        <Campo id="inmueble_direccion" etiqueta="Dirección" requerido autoComplete="street-address" inicial={inicial.direccion} />
        <Campo id="inmueble_municipio" etiqueta="Municipio" opcional inicial={inicial.municipio} />
        <Campo id="inmueble_clave_catastral" etiqueta="Clave catastral" opcional inicial={inicial.clave} />
        <div>
          <label htmlFor="inmueble_descripcion" className="block font-semibold">
            Descripción <span className="font-normal text-secundario">(opcional)</span>
          </label>
          <textarea
            id="inmueble_descripcion"
            name="inmueble_descripcion"
            rows={inicial.descripcion ? 8 : 3}
            placeholder="Casa, terreno, nave… lo que ayude a cotizar"
            defaultValue={inicial.descripcion}
            className={ENTRADA}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-[1.125rem] font-bold">Cliente</legend>
        <Campo id="cliente_nombre" etiqueta="Nombre" requerido />
        <Campo id="cliente_telefono" etiqueta="Teléfono" opcional tipo="tel" />
        <Campo id="cliente_correo" etiqueta="Correo" opcional tipo="email" />
      </fieldset>

      {credito > 0 ? (
        <label className="flex items-start gap-2 rounded-xl border border-linea px-4 py-3 text-[0.9375rem] leading-6">
          <input type="checkbox" name="pagar_con_credito" className="mt-1 h-5 w-5 shrink-0" />
          <span><span className="font-semibold">Pagar con mi crédito</span> (tienes {credito.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}).
            Al aceptarse la cotización se aplica a los honorarios{" "}(+ IVA si lleva factura); si no alcanza, el resto se paga normal.</span>
        </label>
      ) : null}
      {estado.error ? <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p> : null}
      <Enviar />
    </form>
  );
}

function Opcion({ valor, titulo, detalle, marcada = false }: { valor: string; titulo: string; detalle: string; marcada?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-linea px-4 py-3 has-[:checked]:border-acento has-[:checked]:bg-tinte">
      <input type="radio" name="tipo" value={valor} defaultChecked={marcada} className="mt-1 h-5 w-5 accent-primario" />
      <span>
        <span className="block font-semibold">{titulo}</span>
        <span className="block text-[0.9375rem] leading-6 text-secundario">{detalle}</span>
      </span>
    </label>
  );
}

function Campo({
  id,
  etiqueta,
  requerido = false,
  opcional = false,
  tipo = "text",
  autoComplete,
  inicial,
}: {
  id: string;
  etiqueta: string;
  requerido?: boolean;
  opcional?: boolean;
  tipo?: string;
  autoComplete?: string;
  inicial?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block font-semibold">
        {etiqueta}
        {opcional ? <span className="font-normal text-secundario"> (opcional)</span> : null}
      </label>
      <input
        id={id}
        name={id}
        type={tipo}
        required={requerido}
        autoComplete={autoComplete ?? "off"}
        defaultValue={inicial}
        inputMode={tipo === "tel" ? "tel" : tipo === "email" ? "email" : undefined}
        className={ENTRADA}
      />
    </div>
  );
}

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-12 w-full rounded-lg bg-primario px-4 py-3 text-[1.0625rem] font-semibold text-sobre-primario disabled:opacity-50"
    >
      {pending ? "Enviando…" : "Enviar solicitud"}
    </button>
  );
}

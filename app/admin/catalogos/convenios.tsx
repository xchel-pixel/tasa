"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { pesos } from "@/lib/formato";
import { guardarConvenio, guardarPrecioConvenio, type EstadoCatalogo } from "./acciones";
import { Borrar } from "./formularios";

const INICIAL: EstadoCatalogo = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

export type Convenio = {
  id: string;
  nombre: string;
  contacto: string | null;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  notas: string | null;
  comision_regla: "normal" | "ninguna" | "fija";
  comision_pct: number | null;
  activo: boolean;
  precios: { id: string; servicio_id: string; marca_id: string | null; sin_costo: boolean; monto: number }[];
};

type Opcion = { id: string; nombre: string };

/** "Comisión normal", "Sin comisión" o "Comisión fija 10%". */
export function textoComision(c: Pick<Convenio, "comision_regla" | "comision_pct">) {
  return c.comision_regla === "ninguna" ? "Sin comisión" : c.comision_regla === "fija" ? `Comisión fija ${c.comision_pct}%` : "Comisión normal";
}

export function FormularioConvenio({ convenio }: { convenio?: Convenio }) {
  const [estado, enviar] = useActionState(guardarConvenio, INICIAL);
  const [regla, setRegla] = useState(convenio?.comision_regla ?? "normal");
  return (
    <form action={enviar} className="flex flex-col gap-3">
      {convenio ? <input type="hidden" name="id" value={convenio.id} /> : null}
      <label className="block text-[0.9375rem] font-semibold">
        Cliente o empresa
        <input name="nombre" required maxLength={120} defaultValue={convenio?.nombre} className={ENTRADA} />
      </label>
      <label className="block text-[0.9375rem] font-semibold">
        Contacto <span className="font-normal text-secundario">(opcional)</span>
        <input name="contacto" maxLength={300} defaultValue={convenio?.contacto ?? ""} className={ENTRADA} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[0.9375rem] font-semibold">
          Vigente desde
          <input name="vigente_desde" type="date" defaultValue={convenio?.vigente_desde ?? ""} className={ENTRADA} />
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Hasta
          <input name="vigente_hasta" type="date" defaultValue={convenio?.vigente_hasta ?? ""} className={ENTRADA} />
        </label>
      </div>
      <fieldset>
        <legend className="text-[0.9375rem] font-semibold">¿Genera comisión?</legend>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {([["normal", "Sí, normal"], ["ninguna", "No"], ["fija", "% fijo"]] as const).map(([valor, texto]) => (
            <label key={valor} className="toque flex min-h-12 items-center gap-2 rounded-lg border border-borde-campo px-2 text-[0.9375rem]">
              <input type="radio" name="comision_regla" value={valor} checked={regla === valor} onChange={() => setRegla(valor)} className="size-5 shrink-0" />
              {texto}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[0.875rem] leading-5 text-secundario">
          {regla === "ninguna"
            ? "Sus trabajos no generan comisión ni cuentan para el nivel del comisionista."
            : regla === "fija"
              ? "El comisionista gana este % en lugar del de su nivel. Cuenta para su nivel."
              : "Comisión con el % del nivel del comisionista, como cualquier trabajo."}
        </p>
      </fieldset>
      {regla === "fija" ? (
        <label className="block text-[0.9375rem] font-semibold">
          % de comisión
          <input name="comision_pct" inputMode="decimal" required defaultValue={convenio?.comision_pct ?? ""} className={ENTRADA} />
        </label>
      ) : null}
      <label className="block text-[0.9375rem] font-semibold">
        Notas <span className="font-normal text-secundario">(opcional)</span>
        <textarea name="notas" rows={2} maxLength={2000} defaultValue={convenio?.notas ?? ""} className={ENTRADA} />
      </label>
      {convenio ? (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="activo" defaultChecked={convenio.activo} className="h-5 w-5 accent-primario" />
          Activo (aparece al cotizar mientras esté vigente)
        </label>
      ) : null}
      <BotonEnviar variante="secundario">{convenio ? "Guardar convenio" : "Agregar convenio"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Los precios del convenio por servicio (y marca); se agregan o reemplazan de uno en uno. */
export function PreciosConvenio({ convenio, servicios, marcas }: { convenio: Convenio; servicios: Opcion[]; marcas: Opcion[] }) {
  const [estado, enviar] = useActionState(guardarPrecioConvenio, INICIAL);
  const [sinCosto, setSinCosto] = useState(false);
  const nombre = (lista: Opcion[], id: string | null) => lista.find((x) => x.id === id)?.nombre ?? "";
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-linea pt-4">
      <h3 className="font-bold">Precios</h3>
      {convenio.precios.length === 0 ? (
        <p className="text-[0.9375rem] text-secundario">Sin precios todavía.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {convenio.precios.map((p) => (
            <li key={p.id} className="rounded-lg bg-alterno px-3 py-2 text-[0.9375rem]">
              <span className="flex justify-between gap-3">
                <span>
                  {nombre(servicios, p.servicio_id)}
                  {p.marca_id ? ` · ${nombre(marcas, p.marca_id)}` : ""}
                </span>
                <span className="font-semibold">{p.sin_costo ? "Sin costo" : pesos(p.monto)}</span>
              </span>
              <Borrar tabla="convenio_precios" id={p.id} />
            </li>
          ))}
        </ul>
      )}
      <form action={enviar} className="flex flex-col gap-3 rounded-lg border border-dashed border-borde-campo p-3">
        <input type="hidden" name="convenio_id" value={convenio.id} />
        <label className="block text-[0.9375rem] font-semibold">
          Servicio
          <select name="servicio_id" required defaultValue="" className={ENTRADA}>
            <option value="" disabled>Elige uno</option>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Marca <span className="font-normal text-secundario">(vacío: cualquiera)</span>
          <select name="marca_id" defaultValue="" className={ENTRADA}>
            <option value="">Cualquier marca</option>
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="sin_costo" checked={sinCosto} onChange={(e) => setSinCosto(e.target.checked)} className="h-5 w-5 accent-primario" />
          Sin costo (p. ej. el valor hacendario)
        </label>
        {sinCosto ? null : (
          <label className="block text-[0.9375rem] font-semibold">
            Honorario (sin IVA)
            <input name="monto" inputMode="decimal" required className={ENTRADA} />
          </label>
        )}
        <BotonEnviar variante="secundario">Guardar precio</BotonEnviar>
        <Aviso estado={estado} />
      </form>
    </div>
  );
}

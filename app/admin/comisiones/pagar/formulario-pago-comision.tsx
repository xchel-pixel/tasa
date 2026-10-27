"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { CampoArchivo } from "@/components/campo-archivo";
import { Etiqueta } from "@/components/etiqueta";
import { Aviso } from "@/components/pantalla-admin";
import { mesLargo, pesos } from "@/lib/formato";
import { registrarPagoComision, type EstadoPagoComision } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

type PendienteParaPagar = {
  id: string;
  mes: string;
  saldo: number;
  vencido: boolean;
  liga_factura: string | null;
  desglose: { concepto: string; monto: number }[];
};

/**
 * Un pago cubre uno o varios pendientes del mismo comisionista; de cada
 * uno se aplica el saldo completo o una parte.
 */
export default function FormularioPagoComision({
  comisionistaId,
  personaId,
  hoy,
  origenes,
  pendientes,
}: {
  comisionistaId: string;
  personaId: string;
  hoy: string;
  origenes: { id: string; nombre: string }[];
  pendientes: PendienteParaPagar[];
}) {
  const [estado, enviar] = useActionState<EstadoPagoComision, FormData>(registrarPagoComision, { error: null, mensaje: null });
  const [montos, setMontos] = useState<Record<string, string>>(
    Object.fromEntries(pendientes.map((p) => [p.id, p.saldo.toFixed(2)]))
  );
  const [elegidos, setElegidos] = useState<Record<string, boolean>>(Object.fromEntries(pendientes.map((p) => [p.id, true])));

  const total = pendientes.reduce((s, p) => s + (elegidos[p.id] ? Number(montos[p.id]) || 0 : 0), 0);
  const aplicaciones = pendientes
    .filter((p) => elegidos[p.id])
    .map((p) => ({ pendiente_id: p.id, monto: Number(montos[p.id]) || 0 }));

  if (estado.mensaje) return <div className="mt-6"><Aviso estado={estado} /></div>;

  return (
    <form action={enviar} className="mt-4 flex flex-col gap-5">
      <input type="hidden" name="comisionista_id" value={comisionistaId} />
      <input type="hidden" name="aplicaciones" value={JSON.stringify(aplicaciones)} />

      <fieldset className="flex flex-col gap-3">
        <legend className="font-semibold">Qué cubre este pago</legend>
        {pendientes.map((p) => (
          <div key={p.id} className="rounded-xl border border-linea px-4 py-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={elegidos[p.id]}
                onChange={(e) => setElegidos({ ...elegidos, [p.id]: e.target.checked })}
                className="mt-1 h-5 w-5 accent-primario"
              />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-3">
                  <span className="font-semibold capitalize">{mesLargo(p.mes)}</span>
                  <span className="font-semibold">{pesos(p.saldo)}</span>
                </span>
                {p.vencido ? <span className="mt-1 inline-block"><Etiqueta tono="error">Vencido</Etiqueta></span> : null}
              </span>
            </label>
            <dl className="mt-2 flex flex-col gap-1 text-[0.875rem]">
              {p.desglose.map((d) => (
                <div key={d.concepto} className="flex justify-between gap-3">
                  <dt className="text-secundario">{d.concepto}</dt>
                  <dd>{pesos(d.monto)}</dd>
                </div>
              ))}
            </dl>
            {p.liga_factura ? (
              <a href={p.liga_factura} target="_blank" rel="noopener noreferrer"
                className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
                Ver factura que subió
              </a>
            ) : null}
            {elegidos[p.id] ? (
              <div className="mt-2">
                <label htmlFor={`monto-${p.id}`} className="block text-[0.9375rem] font-semibold">Monto que se aplica</label>
                <input
                  id={`monto-${p.id}`}
                  inputMode="decimal"
                  value={montos[p.id]}
                  onChange={(e) => setMontos({ ...montos, [p.id]: e.target.value.replace(/[$,\s]/g, "") })}
                  className={ENTRADA}
                />
              </div>
            ) : null}
          </div>
        ))}
      </fieldset>

      <dl className="flex items-baseline justify-between rounded-xl bg-tinte px-4 py-3">
        <dt className="font-semibold">Total del pago</dt>
        <dd className="text-[1.25rem] font-bold text-primario">{pesos(total)}</dd>
      </dl>

      <div>
        <label htmlFor="fecha" className="block font-semibold">Fecha del pago</label>
        <input id="fecha" name="fecha" type="date" required max={hoy} defaultValue={hoy} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="origen" className="block font-semibold">De dónde salió el dinero</label>
        <select id="origen" name="origen" required defaultValue="" className={ENTRADA}>
          <option value="" disabled>Elige el origen</option>
          {origenes.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <p className="mt-1 text-[0.9375rem] text-secundario">El comisionista no ve el origen.</p>
      </div>
      <div>
        <label htmlFor="referencia" className="block font-semibold">
          Referencia <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <input id="referencia" name="referencia" maxLength={80} className={ENTRADA} />
      </div>
      <fieldset>
        <legend className="font-semibold">Documento del comisionista</legend>
        <div className="mt-2 flex flex-col gap-2">
          {[
            ["factura", "Factura"],
            ["recibo", "Recibo simple"],
            ["ninguno", "Ninguno"],
          ].map(([valor, texto]) => (
            <label key={valor} className="flex items-center gap-3 text-[0.9375rem]">
              <input type="radio" name="documento" value={valor} required
                defaultChecked={valor === (pendientes.some((p) => p.liga_factura) ? "factura" : "ninguno")}
                className="h-5 w-5 accent-primario" />
              {texto}
            </label>
          ))}
        </div>
      </fieldset>
      <CampoArchivo bucket="comprobantes" personaId={personaId} nombre="comprobante_ruta"
        etiqueta="Comprobante" ayuda="Foto o PDF de la transferencia o del recibo de efectivo." opcional />
      <div>
        <label htmlFor="nota" className="block font-semibold">
          Nota <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <textarea id="nota" name="nota" rows={2} maxLength={300} className={ENTRADA} />
      </div>

      <Aviso estado={estado} />
      {total > 0 ? <BotonEnviar>Registrar pago de {pesos(total)}</BotonEnviar> : null}
    </form>
  );
}

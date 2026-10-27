"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { pesos } from "@/lib/formato";
import { ponerPrecio, type EstadoPrecio } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

type Marca = { id: string; nombre: string; cuenta_sugerida_id: string | null };
type Cuenta = { id: string; alias: string; banco: string | null; marca_id: string };

/** Vigencia por omisión: 15 días. */
function enQuinceDias(): string {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);
}

const numero = (t: string) => {
  const n = Number(t.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export default function FormularioPrecio({
  solicitudId,
  tipo,
  marcaInicial,
  marcas,
  cuentas,
}: {
  solicitudId: string;
  tipo: "cotizacion" | "tramite_directo";
  marcaInicial: string | null;
  marcas: Marca[];
  cuentas: Cuenta[];
}) {
  const [estado, enviar] = useActionState<EstadoPrecio, FormData>(ponerPrecio, { error: null, mensaje: null });
  const [marca, setMarca] = useState(marcaInicial ?? "");
  const [cuenta, setCuenta] = useState(marcas.find((m) => m.id === marcaInicial)?.cuenta_sugerida_id ?? "");
  const [factura, setFactura] = useState(false);
  const [honorarios, setHonorarios] = useState("");
  const [terceros, setTerceros] = useState("");

  const h = numero(honorarios);
  const iva = factura ? Math.round(h * 16) / 100 : 0;
  const total = h + iva + numero(terceros);

  // Elegir marca sugiere su cuenta; se puede cambiar antes de emitir.
  function alElegirMarca(id: string) {
    setMarca(id);
    const sugerida = marcas.find((m) => m.id === id)?.cuenta_sugerida_id;
    if (sugerida) setCuenta(sugerida);
  }

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-5">
      <input type="hidden" name="solicitud" value={solicitudId} />
      <input type="hidden" name="tipo" value={tipo} />

      <div>
        <label htmlFor="marca" className="block font-semibold">Marca ejecutora</label>
        <select id="marca" name="marca" required value={marca} onChange={(e) => alElegirMarca(e.target.value)} className={ENTRADA}>
          <option value="" disabled>Elige una</option>
          {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="cuenta" className="block font-semibold">Cuenta receptora</label>
        <select id="cuenta" name="cuenta" required value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={ENTRADA}>
          <option value="" disabled>Elige una</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>{c.alias}{c.banco ? ` · ${c.banco}` : ""}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="honorarios" className="block font-semibold">Honorarios (sin IVA)</label>
        <p className="mt-1 text-[0.9375rem] text-secundario">Base de la comisión.</p>
        <input id="honorarios" name="honorarios" inputMode="decimal" required value={honorarios}
          onChange={(e) => setHonorarios(e.target.value)} className={ENTRADA} />
      </div>

      <label className="flex items-center gap-3">
        <input type="checkbox" name="factura" checked={factura} onChange={(e) => setFactura(e.target.checked)}
          className="h-5 w-5 accent-primario" />
        <span className="font-semibold">Requiere factura (IVA 16% sobre honorarios)</span>
      </label>

      <div>
        <label htmlFor="terceros" className="block font-semibold">
          Derechos y terceros <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <p className="mt-1 text-[0.9375rem] text-secundario">No generan comisión.</p>
        <input id="terceros" name="terceros" inputMode="decimal" value={terceros}
          onChange={(e) => setTerceros(e.target.value)} className={ENTRADA} />
      </div>

      {tipo === "cotizacion" ? (
        <div>
          <label htmlFor="vigencia" className="block font-semibold">Vigente hasta</label>
          <input id="vigencia" name="vigencia" type="date" required defaultValue={enQuinceDias()} className={ENTRADA} />
        </div>
      ) : null}

      <dl className="flex flex-col gap-1 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem]">
        <div className="flex justify-between"><dt className="text-secundario">Honorarios</dt><dd className="font-semibold">{pesos(h)}</dd></div>
        {factura ? <div className="flex justify-between"><dt className="text-secundario">IVA</dt><dd className="font-semibold">{pesos(iva)}</dd></div> : null}
        {numero(terceros) > 0 ? <div className="flex justify-between"><dt className="text-secundario">Terceros</dt><dd className="font-semibold">{pesos(numero(terceros))}</dd></div> : null}
        <div className="mt-1 flex justify-between border-t border-linea pt-2">
          <dt className="font-semibold">Total al cliente</dt>
          <dd className="text-[1.125rem] font-bold text-primario">{pesos(total)}</dd>
        </div>
      </dl>

      <Aviso estado={estado} />
      <BotonEnviar pendiente={tipo === "cotizacion" ? "Emitiendo y generando PDF…" : "Guardando…"}>
        {tipo === "cotizacion" ? "Emitir cotización" : "Guardar precio y arrancar trámite"}
      </BotonEnviar>
    </form>
  );
}

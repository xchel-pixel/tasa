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
/** Un convenio vigente con sus precios para el servicio de esta solicitud. */
export type ConvenioParaCotizar = {
  id: string;
  nombre: string;
  comision: string;
  precios: { marca_id: string | null; tipo: "fijo" | "sin_costo" | "estimado"; monto: number; minimo: number | null; nota: string | null }[];
};
export type Ligable = { id: string; texto: string };
type TipoHonorario = "fijo" | "sin_costo" | "estimado";

/** El precio del convenio para esta marca (o el general del servicio). */
function precioDeConvenio(c: ConvenioParaCotizar | undefined, marca: string) {
  if (!c) return null;
  return c.precios.find((p) => p.marca_id === marca) ?? c.precios.find((p) => p.marca_id === null) ?? null;
}

/** Vigencia por omisión: 30 días. */
function enTreintaDias(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
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
  convenios,
  ligables,
}: {
  solicitudId: string;
  tipo: "cotizacion" | "tramite_directo";
  marcaInicial: string | null;
  marcas: Marca[];
  cuentas: Cuenta[];
  convenios: ConvenioParaCotizar[];
  ligables: Ligable[];
}) {
  const [estado, enviar] = useActionState<EstadoPrecio, FormData>(ponerPrecio, { error: null, mensaje: null });
  const [marca, setMarca] = useState(marcaInicial ?? "");
  const [cuenta, setCuenta] = useState(marcas.find((m) => m.id === marcaInicial)?.cuenta_sugerida_id ?? "");
  const [factura, setFactura] = useState(false);
  const [honorarios, setHonorarios] = useState("");
  const [terceros, setTerceros] = useState("");
  const [tipoHonorario, setTipoHonorario] = useState<TipoHonorario>("fijo");
  const [minimo, setMinimo] = useState("");
  const [convenio, setConvenio] = useState("");

  const h = tipoHonorario === "sin_costo" ? 0 : numero(honorarios);
  const elegido = convenios.find((c) => c.id === convenio);
  const delConvenio = precioDeConvenio(elegido, marca);
  // Si se aparta de lo que dice el convenio, se pide el motivo (va a la bitácora).
  const ajustado =
    delConvenio !== null &&
    (tipoHonorario !== delConvenio.tipo ||
      (tipoHonorario !== "sin_costo" && h !== delConvenio.monto) ||
      (tipoHonorario === "estimado" && (minimo.trim() ? numero(minimo) : null) !== delConvenio.minimo));

  /** El convenio llena el tipo y el precio; luego se puede ajustar con motivo. */
  function aplicarConvenio(id: string, marcaActual: string) {
    const p = precioDeConvenio(convenios.find((c) => c.id === id), marcaActual);
    if (!p) return;
    setTipoHonorario(p.tipo);
    setHonorarios(p.tipo === "sin_costo" ? "" : String(p.monto));
    setMinimo(p.tipo === "estimado" && p.minimo !== null ? String(p.minimo) : "");
  }
  const iva = factura ? Math.round(h * 16) / 100 : 0;
  const total = h + iva + numero(terceros);

  // Elegir marca sugiere su cuenta; se puede cambiar antes de emitir.
  function alElegirMarca(id: string) {
    setMarca(id);
    const sugerida = marcas.find((m) => m.id === id)?.cuenta_sugerida_id;
    if (sugerida) setCuenta(sugerida);
    if (convenio) aplicarConvenio(convenio, id);
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

      {convenios.length > 0 ? (
        <div>
          <label htmlFor="convenio" className="block font-semibold">
            Convenio <span className="font-normal text-secundario">(opcional)</span>
          </label>
          <select id="convenio" name="convenio" value={convenio}
            onChange={(e) => { setConvenio(e.target.value); aplicarConvenio(e.target.value, marca); }} className={ENTRADA}>
            <option value="">Sin convenio</option>
            {convenios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {elegido ? (
            <p className="mt-1 text-[0.9375rem] text-secundario">
              {elegido.comision}
              {delConvenio ? "" : " · Este convenio no tiene precio para este servicio."}
              {delConvenio?.nota ? ` · ${delConvenio.nota}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      <fieldset>
        <legend className="font-semibold">Tipo de honorario</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([["fijo", "Fijo"], ["sin_costo", "Sin costo"], ["estimado", "Estimado"]] as const).map(([valor, texto]) => (
            <label key={valor} className="toque flex min-h-12 items-center gap-2 rounded-lg border border-borde-campo px-3">
              <input type="radio" name="honorario_tipo" value={valor} checked={tipoHonorario === valor}
                onChange={() => setTipoHonorario(valor)} className="size-5 shrink-0" />
              {texto}
            </label>
          ))}
        </div>
      </fieldset>

      {tipoHonorario === "sin_costo" ? (
        <div>
          <label htmlFor="ligada_a" className="block font-semibold">
            Ligado a <span className="font-normal text-secundario">(opcional)</span>
          </label>
          <p className="mt-1 text-[0.9375rem] text-secundario">
            El trabajo que sí cobra (p. ej. el avalúo). Este no genera comisión ni cuenta para nivel.
          </p>
          <select id="ligada_a" name="ligada_a" defaultValue="" className={ENTRADA}>
            <option value="">Sin ligar</option>
            {ligables.map((l) => <option key={l.id} value={l.id}>{l.texto}</option>)}
          </select>
        </div>
      ) : (
        <div>
          <label htmlFor="honorarios" className="block font-semibold">
            {tipoHonorario === "estimado" ? "Honorario estimado (sin IVA)" : "Honorarios (sin IVA)"}
          </label>
          <p className="mt-1 text-[0.9375rem] text-secundario">
            {tipoHonorario === "estimado"
              ? "Si es rango, el máximo. El honorario final se fija antes de entregar; la comisión va sobre él."
              : "Base de la comisión."}
          </p>
          <input id="honorarios" name="honorarios" inputMode="decimal" required value={honorarios}
            onChange={(e) => setHonorarios(e.target.value)} className={ENTRADA} />
        </div>
      )}

      {tipoHonorario === "estimado" ? (
        <div>
          <label htmlFor="minimo" className="block font-semibold">
            Mínimo del rango <span className="font-normal text-secundario">(opcional)</span>
          </label>
          <input id="minimo" name="minimo" inputMode="decimal" value={minimo}
            onChange={(e) => setMinimo(e.target.value)} className={ENTRADA} />
        </div>
      ) : null}

      {ajustado ? (
        <div>
          <label htmlFor="motivo" className="block font-semibold">Motivo del ajuste al convenio</label>
          <p className="mt-1 text-[0.9375rem] text-secundario">
            El convenio dice{" "}
            {delConvenio.tipo === "sin_costo"
              ? "sin costo"
              : delConvenio.tipo === "estimado"
                ? `estimado ${delConvenio.minimo !== null ? `${pesos(delConvenio.minimo)} – ` : ""}${pesos(delConvenio.monto)}`
                : pesos(delConvenio.monto)}
            . Queda en la bitácora.
          </p>
          <input id="motivo" name="motivo" required maxLength={500} className={ENTRADA} />
        </div>
      ) : null}

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
          <input id="vigencia" name="vigencia" type="date" required defaultValue={enTreintaDias()} className={ENTRADA} />
        </div>
      ) : null}

      <dl className="flex flex-col gap-1 rounded-xl bg-tinte px-4 py-3 text-[0.9375rem]">
        <div className="flex justify-between">
          <dt className="text-secundario">{tipoHonorario === "estimado" ? "Honorario estimado" : "Honorarios"}</dt>
          <dd className="font-semibold">{tipoHonorario === "sin_costo" ? "Sin costo" : pesos(h)}</dd>
        </div>
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

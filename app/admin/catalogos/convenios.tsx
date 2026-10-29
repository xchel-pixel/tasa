"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { guardarConvenioCompleto, type EstadoCatalogo } from "./acciones";

const INICIAL: EstadoCatalogo = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

type TipoHonorario = "fijo" | "sin_costo" | "estimado";

export type PrecioConvenio = {
  servicio_id: string;
  marca_id: string | null;
  honorario_tipo: TipoHonorario;
  monto: number;
  monto_minimo: number | null;
  nota: string | null;
};

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
  precios: PrecioConvenio[];
};

type Opcion = { id: string; nombre: string };

/** Lo que se edita de cada servicio del catálogo; `incluir` en falso no se guarda. */
type Fila = { servicio_id: string; incluir: boolean; marca_id: string; tipo: TipoHonorario; monto: string; minimo: string; nota: string };

const AYUDA_COMISION = {
  normal: "El comisionista gana el % de su nivel, como en cualquier trabajo, y cuenta para su nivel.",
  ninguna: "Sus trabajos no generan comisión ni cuentan para el nivel del comisionista.",
  fija: "El comisionista gana este % en lugar del de su nivel (sin bienvenida ni Élite). Sí cuenta para su nivel.",
} as const;

/**
 * Un convenio en una sola pantalla: datos, una fila por servicio del catálogo y la comisión. Se
 * guarda todo junto (una transacción en la base); si algo no cuadra, se dice qué y no se guarda
 * nada a medias.
 */
export function FormularioConvenio({ convenio, servicios, marcas }: { convenio?: Convenio; servicios: Opcion[]; marcas: Opcion[] }) {
  const [estado, enviar] = useActionState(guardarConvenioCompleto, INICIAL);
  const [regla, setRegla] = useState(convenio?.comision_regla ?? "normal");
  const [filas, setFilas] = useState<Fila[]>(() =>
    servicios.map((s) => {
      const p = convenio?.precios.find((x) => x.servicio_id === s.id);
      return {
        servicio_id: s.id,
        incluir: Boolean(p),
        marca_id: p?.marca_id ?? "",
        tipo: p?.honorario_tipo ?? "fijo",
        monto: p && p.honorario_tipo !== "sin_costo" ? String(p.monto) : "",
        minimo: p?.monto_minimo != null ? String(p.monto_minimo) : "",
        nota: p?.nota ?? "",
      };
    })
  );
  const cambiar = (i: number, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  const precios = filas
    .filter((f) => f.incluir)
    .map((f) => ({
      servicio_id: f.servicio_id,
      marca_id: f.marca_id || null,
      honorario_tipo: f.tipo,
      monto: f.tipo === "sin_costo" ? "0" : f.monto.replace(/[$,\s]/g, ""),
      monto_minimo: f.tipo === "estimado" ? f.minimo.replace(/[$,\s]/g, "") : "",
      nota: f.nota.trim(),
    }));
  const id = convenio?.id ?? "nuevo";

  return (
    <form action={enviar} className="flex flex-col gap-4">
      {convenio ? <input type="hidden" name="id" value={convenio.id} /> : null}
      <input type="hidden" name="precios" value={JSON.stringify(precios)} />

      <p className="rounded-lg bg-tinte px-3 py-2 text-[0.9375rem] leading-6">
        Ej.: Valor hacendario <span className="font-semibold">sin costo</span>, Avalúo hacendario{" "}
        <span className="font-semibold">$X</span>, Avalúo comercial <span className="font-semibold">estimado</span> de $X a $Y.
      </p>

      <fieldset className="flex flex-col gap-3">
        <legend className="font-bold">Datos</legend>
        <label className="block text-[0.9375rem] font-semibold">
          Cliente o empresa
          <input name="nombre" required maxLength={120} defaultValue={convenio?.nombre} className={ENTRADA} />
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Contacto <span className="font-normal text-secundario">(opcional)</span>
          <input name="contacto" maxLength={300} defaultValue={convenio?.contacto ?? ""} className={ENTRADA}
            placeholder="Nombre, teléfono o correo" />
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
        <label className="block text-[0.9375rem] font-semibold">
          Notas <span className="font-normal text-secundario">(opcional)</span>
          <textarea name="notas" rows={2} maxLength={2000} defaultValue={convenio?.notas ?? ""} className={ENTRADA} />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">Precios del convenio</legend>
        <p className="text-[0.875rem] leading-5 text-secundario">Marca los servicios que incluye. Precios sin IVA.</p>
        {filas.map((f, i) => {
          const nombre = servicios[i].nombre;
          return (
            <div key={f.servicio_id} className={`rounded-lg border px-3 py-2 ${f.incluir ? "border-primario" : "border-linea"}`}>
              <label className="toque flex min-h-11 items-center gap-3 font-semibold">
                <input type="checkbox" checked={f.incluir} onChange={(e) => cambiar(i, { incluir: e.target.checked })}
                  className="size-5 shrink-0 accent-primario" />
                {nombre}
              </label>
              {f.incluir ? (
                <div className="flex flex-col gap-2 pb-1">
                  <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={`Tipo de ${nombre}`}>
                    {([["fijo", "Fijo"], ["sin_costo", "Sin costo"], ["estimado", "Estimado"]] as const).map(([valor, texto]) => (
                      <label key={valor}
                        className="toque flex min-h-11 items-center justify-center rounded-lg border border-borde-campo px-1 text-center text-[0.875rem] font-semibold has-[:checked]:border-primario has-[:checked]:bg-primario has-[:checked]:text-sobre-primario has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-acento">
                        <input type="radio" name={`tipo-${id}-${f.servicio_id}`} checked={f.tipo === valor}
                          onChange={() => cambiar(i, { tipo: valor })} className="sr-only" />
                        {texto}
                      </label>
                    ))}
                  </div>
                  {f.tipo === "fijo" ? (
                    <label className="block text-[0.875rem] font-semibold">
                      Precio
                      <input inputMode="decimal" value={f.monto} onChange={(e) => cambiar(i, { monto: e.target.value })} className={ENTRADA} />
                    </label>
                  ) : f.tipo === "estimado" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[0.875rem] font-semibold">
                        Desde <span className="font-normal text-secundario">(opc.)</span>
                        <input inputMode="decimal" value={f.minimo} onChange={(e) => cambiar(i, { minimo: e.target.value })} className={ENTRADA} />
                      </label>
                      <label className="block text-[0.875rem] font-semibold">
                        Hasta
                        <input inputMode="decimal" value={f.monto} onChange={(e) => cambiar(i, { monto: e.target.value })} className={ENTRADA} />
                      </label>
                    </div>
                  ) : null}
                  <label className="block text-[0.875rem] font-semibold">
                    Marca
                    <select value={f.marca_id} onChange={(e) => cambiar(i, { marca_id: e.target.value })} className={ENTRADA}>
                      <option value="">Cualquier marca</option>
                      {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </select>
                  </label>
                  <label className="block text-[0.875rem] font-semibold">
                    Nota <span className="font-normal text-secundario">(opcional)</span>
                    <input maxLength={200} value={f.nota} onChange={(e) => cambiar(i, { nota: e.target.value })} className={ENTRADA}
                      placeholder="p. ej. sin costo si contrata el avalúo" />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <fieldset>
        <legend className="font-bold">¿Genera comisión?</legend>
        <div className="mt-2 flex flex-col gap-2">
          {([["normal", "Sí, normal"], ["ninguna", "No"], ["fija", "% fijo"]] as const).map(([valor, texto]) => (
            <label key={valor} className={`toque flex items-start gap-3 rounded-lg border px-3 py-2 ${regla === valor ? "border-primario" : "border-borde-campo"}`}>
              <input type="radio" name="comision_regla" value={valor} checked={regla === valor} onChange={() => setRegla(valor)}
                className="mt-1 size-5 shrink-0" />
              <span>
                <span className="block font-semibold">{texto}</span>
                <span className="block text-[0.875rem] leading-5 text-secundario">{AYUDA_COMISION[valor]}</span>
              </span>
            </label>
          ))}
        </div>
        {regla === "fija" ? (
          <label className="mt-2 block text-[0.9375rem] font-semibold">
            % de comisión
            <input name="comision_pct" inputMode="decimal" required defaultValue={convenio?.comision_pct ?? ""} className={ENTRADA} />
          </label>
        ) : null}
      </fieldset>

      {convenio ? (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="activo" defaultChecked={convenio.activo} className="h-5 w-5 accent-primario" />
          Activo (aparece al cotizar mientras esté vigente)
        </label>
      ) : null}

      <Aviso estado={estado} />
      <BotonEnviar>{convenio ? "Guardar convenio" : "Agregar convenio"}</BotonEnviar>
    </form>
  );
}

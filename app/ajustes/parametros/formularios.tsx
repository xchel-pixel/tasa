"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { agregarInpc, guardarIstd, guardarTabla, guardarValor, type EstadoParametro } from "./acciones";

const INICIAL: EstadoParametro = { error: null, mensaje: null };
const ENTRADA = "w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const CELDA = "w-full min-w-16 rounded border border-borde-campo bg-fondo px-2 py-1 text-right text-[0.875rem] tabular-nums";

function Vigencia({ porOmision }: { porOmision: string }) {
  return (
    <label className="block text-[0.9375rem] font-semibold">Rige desde
      <input type="date" name="vigente" required defaultValue={porOmision} className={`mt-1 ${ENTRADA}`} />
    </label>
  );
}

export function FormularioValor({ clave, etiqueta, valor, vigente }: { clave: string; etiqueta: string; valor: number; vigente: string }) {
  const [estado, enviar] = useActionState(guardarValor, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-xl border border-linea px-4 py-3">
      <input type="hidden" name="clave" value={clave} />
      <label className="block font-semibold">{etiqueta}
        <input name="valor" inputMode="decimal" required defaultValue={valor} className={`mt-1 ${ENTRADA}`} />
      </label>
      <Vigencia porOmision={vigente} />
      <BotonEnviar variante="secundario">Guardar</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function FormularioInpc({ ultimos }: { ultimos: [string, number][] }) {
  const [estado, enviar] = useActionState(agregarInpc, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-xl border border-linea px-4 py-3">
      <p className="text-[0.9375rem] text-secundario">Últimos: {ultimos.map(([m, v]) => `${m} = ${v}`).join(" · ")}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[0.9375rem] font-semibold">Mes (AAAA-MM)<input name="mes" required pattern="\d{4}-\d{2}" className={`mt-1 ${ENTRADA}`} /></label>
        <label className="block text-[0.9375rem] font-semibold">Índice (INEGI)<input name="valor" inputMode="decimal" required className={`mt-1 ${ENTRADA}`} /></label>
      </div>
      <BotonEnviar variante="secundario">Agregar mes</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Tabla por renglones; una celda vacía es "sin límite" donde la columna lo permite. */
function Renglones({ columnas, filas, setFilas }: { columnas: { titulo: string; vacio?: boolean }[]; filas: (number | null)[][]; setFilas: (f: (number | null)[][]) => void }) {
  const cambiar = (i: number, j: number, t: string) => {
    const copia = filas.map((r) => [...r]);
    copia[i][j] = t.trim() === "" ? null : Number(t.replace(",", "."));
    setFilas(copia);
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[0.8125rem]">
        <thead><tr>{columnas.map((c) => <th key={c.titulo} className="text-left font-semibold text-secundario">{c.titulo}</th>)}<th /></tr></thead>
        <tbody>
          {filas.map((r, i) => (
            <tr key={i}>
              {columnas.map((c, j) => (
                <td key={j}><input aria-label={`${c.titulo}, renglón ${i + 1}`} defaultValue={r[j] ?? ""} placeholder={c.vacio ? "sin límite" : ""} onChange={(e) => cambiar(i, j, e.target.value)} className={CELDA} /></td>
              ))}
              <td><button type="button" onClick={() => setFilas(filas.filter((_, k) => k !== i))} aria-label={`Quitar renglón ${i + 1}`} className="toque px-2 text-error">×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setFilas([...filas, columnas.map(() => null)])} className="toque mt-1 text-[0.9375rem] font-semibold text-acento underline underline-offset-4">Agregar renglón</button>
    </div>
  );
}

export function FormularioTabla({ clave, columnas, filas: iniciales, vigente }: { clave: string; columnas: { titulo: string; vacio?: boolean }[]; filas: (number | null)[][]; vigente: string }) {
  const [estado, enviar] = useActionState(guardarTabla, INICIAL);
  const [filas, setFilas] = useState(iniciales);
  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-xl border border-linea px-4 py-3">
      <input type="hidden" name="clave" value={clave} />
      <input type="hidden" name="filas" value={JSON.stringify(filas)} />
      <Renglones columnas={columnas} filas={filas} setFilas={setFilas} />
      <Vigencia porOmision={vigente} />
      <BotonEnviar variante="secundario">Guardar tabla</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

type Istd = { tipo: string; tasa?: number; tabla?: (number | null)[][]; base?: string; deduccion?: string | null; donacion_familiar?: number; estado: string; ley: string; url: string; art?: string; notas?: string[] };

const DEDUCCIONES = ["", "LH", "COLON", "CADEREYTA", "CORREGIDORA", "SIETE_UMA", "SIETE_UMA_SIN_TOPE", "EZEQUIEL", "TOLIMAN"];

export function FormularioIstd({ municipios, vigente }: { municipios: Record<string, Istd>; vigente: string }) {
  const nombres = Object.keys(municipios).sort((a, b) => a.localeCompare(b, "es"));
  const [mun, setMun] = useState(nombres[0]);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-linea px-4 py-3">
      <label className="block font-semibold">Municipio
        <select value={mun} onChange={(e) => setMun(e.target.value)} className={`mt-1 ${ENTRADA}`}>
          {nombres.map((n) => <option key={n} value={n}>{n}{municipios[n].estado !== "verificado" ? " (parcial)" : ""}</option>)}
        </select>
      </label>
      <MunicipioIstd key={mun} municipio={mun} t={municipios[mun]} vigente={vigente} />
    </div>
  );
}

function MunicipioIstd({ municipio, t, vigente }: { municipio: string; t: Istd; vigente: string }) {
  const [estado, enviar] = useActionState(guardarIstd, INICIAL);
  const [tipo, setTipo] = useState(t.tipo);
  const [filas, setFilas] = useState<(number | null)[][]>(t.tabla ?? []);
  return (
    <form action={enviar} className="flex flex-col gap-2">
      <input type="hidden" name="municipio" value={municipio} />
      <input type="hidden" name="filas" value={JSON.stringify(filas)} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[0.9375rem] font-semibold">Tipo
          <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={`mt-1 ${ENTRADA}`}>
            <option value="tasa">Tasa fija</option><option value="tarifa">Tarifa progresiva</option>
          </select>
        </label>
        {tipo === "tasa" ? (
          <label className="block text-[0.9375rem] font-semibold">Tasa (%)<input name="tasa" inputMode="decimal" defaultValue={t.tasa ? +(t.tasa * 100).toFixed(4) : ""} className={`mt-1 ${ENTRADA}`} /></label>
        ) : <span />}
        <label className="block text-[0.9375rem] font-semibold">Base
          <select name="base" defaultValue={t.base ?? "op_com"} className={`mt-1 ${ENTRADA}`}>
            <option value="op_com">Mayor entre operación y comercial</option>
            <option value="cat_com">Mayor entre catastral y comercial</option>
            <option value="op_com_cat">Mayor entre operación, comercial y catastral</option>
          </select>
        </label>
        <label className="block text-[0.9375rem] font-semibold">Deducción de vivienda
          <select name="deduccion" defaultValue={t.deduccion ?? ""} className={`mt-1 ${ENTRADA}`}>
            {DEDUCCIONES.map((d) => <option key={d} value={d}>{d || "Ninguna"}</option>)}
          </select>
        </label>
        <label className="block text-[0.9375rem] font-semibold">Donación familiar: se paga (%)<input name="donacion_familiar" inputMode="decimal" defaultValue={t.donacion_familiar ? t.donacion_familiar * 100 : ""} placeholder="vacío: sin reducción" className={`mt-1 ${ENTRADA}`} /></label>
        <label className="block text-[0.9375rem] font-semibold">Estado
          <select name="estado" defaultValue={t.estado} className={`mt-1 ${ENTRADA}`}><option value="verificado">Verificado</option><option value="parcial">Parcial</option></select>
        </label>
      </div>
      {tipo === "tarifa" ? (
        <Renglones columnas={[{ titulo: "Desde" }, { titulo: "Hasta", vacio: true }, { titulo: "Cuota fija" }, { titulo: "Factor" }]} filas={filas} setFilas={setFilas} />
      ) : null}
      <label className="block text-[0.9375rem] font-semibold">Ley<input name="ley" defaultValue={t.ley} className={`mt-1 ${ENTRADA}`} /></label>
      <label className="block text-[0.9375rem] font-semibold">Liga<input name="url" defaultValue={t.url} className={`mt-1 ${ENTRADA}`} /></label>
      <label className="block text-[0.9375rem] font-semibold">Artículo<input name="art" defaultValue={t.art ?? ""} className={`mt-1 ${ENTRADA}`} /></label>
      <label className="block text-[0.9375rem] font-semibold">Notas (una por renglón)<textarea name="notas" rows={3} defaultValue={(t.notas ?? []).join("\n")} className={`mt-1 ${ENTRADA}`} /></label>
      <Vigencia porOmision={vigente} />
      <BotonEnviar variante="secundario">Guardar {municipio}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { PedirMas } from "@/components/formularios-cupo";
import { calcularTraslado, type EstadoCalculo } from "./acciones";

type CupoVista = { texto: string; agotado: boolean; extras: number };

const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

/**
 * Rápida: municipio o clave, lado, operación, valores, vivienda social e hipoteca. Completa (Socio en
 * adelante y equipo): además ISR por enajenación y extemporáneo. Los montos se calculan en el servidor.
 */
export function FormularioCalculadora({ municipios, completa, hoy, cupos }: { municipios: string[]; completa: boolean; hoy: string; cupos: { rapida: CupoVista; completa: CupoVista | null } }) {
  const [estado, enviar] = useActionState<EstadoCalculo, FormData>(calcularTraslado, { error: null });
  const [modo, setModo] = useState<"rapida" | "completa">("rapida");
  const [lado, setLado] = useState("C");
  const [operacion, setOperacion] = useState("compraventa");
  const [conIsr, setConIsr] = useState(false);
  const [extemporaneo, setExtemporaneo] = useState(false);
  const vendedor = lado !== "C", comprador = lado !== "V";
  // Si el cálculo marca un error, el formulario vuelve con lo capturado (el form se remonta con estos valores).
  const v = (nombre: string, porOmision = "") => estado.valores?.[nombre] ?? porOmision;
  const cupo = modo === "completa" && cupos.completa ? cupos.completa : cupos.rapida;

  return (
    <>
    <form key={JSON.stringify(estado.valores ?? {})} action={enviar} className="mt-5 flex flex-col gap-5">
      <input type="hidden" name="modo" value={modo} />
      {completa ? (
        <div role="radiogroup" aria-label="Modo" className="grid grid-cols-2 gap-2 rounded-xl bg-alterno p-1">
          {(["rapida", "completa"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
              className={`min-h-11 rounded-lg font-semibold ${modo === m ? "bg-fondo text-primario shadow-sm" : "text-secundario"}`}>
              {m === "rapida" ? "Rápida" : "Completa"}
            </button>
          ))}
        </div>
      ) : null}

      <fieldset>
        <legend className="font-semibold">¿Para quién es el cálculo?</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[["C", "Comprador"], ["V", "Vendedor"], ["ambos", "Ambos"]].map(([v, t]) => (
            <label key={v} className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-linea px-2 text-center has-[:checked]:border-acento has-[:checked]:bg-tinte">
              <input type="radio" name="lado" value={v} checked={lado === v} onChange={() => setLado(v)} className="sr-only" />
              {t}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block font-semibold">Municipio
          <select name="municipio" defaultValue={v("municipio")} className={ENTRADA}>
            <option value="">— Por clave catastral —</option>
            {municipios.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="block font-semibold">Clave catastral <span className="font-normal text-secundario">(opcional)</span>
          <input name="clave_catastral" inputMode="numeric" maxLength={40} defaultValue={v("clave_catastral")} className={ENTRADA} placeholder="14 01 001 …" />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block font-semibold">Operación
          <select name="operacion" value={operacion} onChange={(e) => setOperacion(e.target.value)} className={ENTRADA}>
            <option value="compraventa">Compraventa</option>
            <option value="donacion">Donación</option>
            <option value="herencia">Herencia (adjudicación)</option>
          </select>
        </label>
        <label className="block font-semibold">Fecha estimada de firma
          <input type="date" name="fecha_firma" defaultValue={v("fecha_firma", hoy)} className={ENTRADA} />
        </label>
      </div>
      {operacion === "donacion" ? (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="donacion_exenta" className="h-5 w-5 accent-primario" />
          Entre cónyuges o en línea recta (padres, hijos)
        </label>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block font-semibold">Valor de operación
          <input name="valor_operacion" inputMode="decimal" defaultValue={v("valor_operacion")} className={ENTRADA} placeholder="$" required={operacion !== "donacion"} />
        </label>
        <label className="block font-semibold">Avalúo hacendario <span className="font-normal text-secundario">(si lo hay)</span>
          <input name="avaluo" inputMode="decimal" defaultValue={v("avaluo")} className={ENTRADA} placeholder="$" required={operacion === "donacion"} />
        </label>
      </div>
      <label className="block font-semibold">Valor catastral <span className="font-normal text-secundario">(opcional; Arroyo Seco lo usa)</span>
        <input name="valor_catastral" inputMode="decimal" defaultValue={v("valor_catastral")} className={ENTRADA} placeholder="$" />
      </label>

      {comprador ? (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-linea px-4 py-3">
          <legend className="px-1 font-semibold">Comprador</legend>
          <label className="block text-[0.9375rem]">Primera vivienda de interés social o popular
            <select name="vivienda_primera" defaultValue={v("vivienda_primera")} className={ENTRADA}>
              <option value="">No</option>
              <option value="social">Sí, interés social</option>
              <option value="popular">Sí, popular</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[0.9375rem]">
            <input type="checkbox" name="incluir_avaluo" defaultChecked className="h-5 w-5 accent-primario" />
            Incluir el avalúo hacendario en sus gastos
          </label>
        </fieldset>
      ) : null}

      {vendedor ? (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-linea px-4 py-3">
          <legend className="px-1 font-semibold">Vendedor</legend>
          <label className="block text-[0.9375rem]">Hipoteca por cancelar <span className="text-secundario">(monto, si hay)</span>
            <input name="cancelar_hipoteca" inputMode="decimal" defaultValue={v("cancelar_hipoteca")} className={ENTRADA} placeholder="$" />
          </label>
          {modo === "completa" ? (
            <>
              <label className="flex items-center gap-2 text-[0.9375rem] font-semibold">
                <input type="checkbox" name="con_isr" checked={conIsr} onChange={(e) => setConIsr(e.target.checked)} className="h-5 w-5 accent-primario" />
                Incluir ISR por enajenación
              </label>
              {conIsr ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-[0.9375rem]">Fecha de adquisición<input type="date" name="fecha_adq" defaultValue={v("fecha_adq")} required className={ENTRADA} /></label>
                  <label className="block text-[0.9375rem]">Costo de adquisición (escritura)<input name="costo_adq" inputMode="decimal" defaultValue={v("costo_adq")} className={ENTRADA} placeholder="$ (0 si no hay)" /></label>
                  <label className="block text-[0.9375rem]">Terreno en la escritura ($)<input name="costo_terreno" inputMode="decimal" defaultValue={v("costo_terreno")} className={ENTRADA} placeholder="vacío: 20 %" /></label>
                  <label className="block text-[0.9375rem]">o % de terreno<input name="pct_terreno" inputMode="decimal" defaultValue={v("pct_terreno")} className={ENTRADA} placeholder="20" /></label>
                  <label className="block text-[0.9375rem]">Mejoras ($)<input name="mejora_monto" inputMode="decimal" defaultValue={v("mejora_monto")} className={ENTRADA} placeholder="$" /></label>
                  <label className="block text-[0.9375rem]">Fecha de las mejoras<input type="date" name="mejora_fecha" defaultValue={v("mejora_fecha")} className={ENTRADA} /></label>
                  <label className="block text-[0.9375rem]">Cómo se comprueban
                    <select name="mejora_comprobante" defaultValue="cfdi" className={ENTRADA}>
                      <option value="cfdi">CFDI (facturas)</option>
                      <option value="aviso">Aviso de terminación de obra</option>
                      <option value="avaluo">Avalúo referido (se reconoce el 80 %)</option>
                    </select>
                  </label>
                  <label className="block text-[0.9375rem]">Gastos de la adquisición ($)<input name="gastos_monto" inputMode="decimal" defaultValue={v("gastos_monto")} className={ENTRADA} placeholder="escritura, impuestos, avalúo" /></label>
                  <label className="flex items-center gap-2 text-[0.9375rem] sm:col-span-2">
                    <input type="checkbox" name="casa_habitacion" className="h-5 w-5 accent-primario" />
                    Es su casa habitación (sin otra venta exenta en 3 años)
                  </label>
                </div>
              ) : null}
            </>
          ) : null}
        </fieldset>
      ) : null}

      {modo === "completa" && comprador ? (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-linea px-4 py-3">
          <legend className="px-1 font-semibold">Extemporáneo</legend>
          <label className="flex items-center gap-2 text-[0.9375rem] font-semibold">
            <input type="checkbox" name="extemporaneo" checked={extemporaneo} onChange={(e) => setExtemporaneo(e.target.checked)} className="h-5 w-5 accent-primario" />
            Es una operación antigua que se escritura hasta ahora
          </label>
          {extemporaneo ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-[0.9375rem]">Fecha de la operación original<input type="date" name="ext_fecha" defaultValue={v("ext_fecha")} required className={ENTRADA} /></label>
              <label className="block text-[0.9375rem]">Valor referido a esa fecha ($)<input name="ext_valor" inputMode="decimal" defaultValue={v("ext_valor")} className={ENTRADA} placeholder="vacío: se estima con INPC" /></label>
              <label className="block text-[0.9375rem]">Tasa del ISTD en esa fecha (%)<input name="ext_tasa" inputMode="decimal" defaultValue={v("ext_tasa")} required className={ENTRADA} placeholder="2" /></label>
              <label className="block text-[0.9375rem]">Tope de meses de recargos
                <select name="ext_tope" defaultValue="60" className={ENTRADA}><option value="60">60 (ley)</option><option value="12">12</option></select>
              </label>
              <label className="flex items-center gap-2 text-[0.9375rem]">
                <input type="checkbox" name="ext_adicional" className="h-5 w-5 accent-primario" /> Adicional del 25 % (educación y obras)
              </label>
              <label className="flex items-center gap-2 text-[0.9375rem]">
                <input type="checkbox" name="ext_actualizar" value="off" className="h-5 w-5 accent-primario" /> No actualizar con INPC
              </label>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <label className="block font-semibold">Referencia <span className="font-normal text-secundario">(opcional, solo para ti: “Casa Juriquilla”)</span>
        <input name="referencia" maxLength={80} defaultValue={v("referencia")} className={ENTRADA} />
      </label>
      <p className="text-[0.8125rem] leading-5 text-secundario">No escribas datos del cliente: el cálculo se guarda 90 días en &quot;Mis cálculos&quot;.</p>

      {estado.error ? <p className="text-[0.9375rem] leading-6 text-error">{estado.error}</p> : null}
      <p className="text-[0.9375rem] font-semibold text-secundario">{modo === "completa" ? "Completa" : "Rápida"}: {cupo.texto}</p>
      {cupo.agotado ? (
        <div className="rounded-xl bg-proceso-fondo px-4 py-3 text-proceso">
          <p className="font-semibold">Llegaste a tu límite del mes. Sube de nivel o pide más cálculos.</p>
        </div>
      ) : (
        <BotonEnviar>Calcular</BotonEnviar>
      )}
    </form>
    {cupo.agotado ? <PedirMas herramienta={modo === "completa" ? "calculadora_traslado_completa" : "calculadora_traslado"} /> : null}
    </>
  );
}

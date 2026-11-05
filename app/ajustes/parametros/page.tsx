import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { FormularioInpc, FormularioIstd, FormularioTabla, FormularioValor } from "./formularios";

export const metadata = { title: "Parámetros fiscales — Tasa" };

function Seccion({ titulo, detalle, children }: { titulo: string; detalle?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[1.125rem] font-bold">{titulo}</h2>
      {detalle ? <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">{detalle}</p> : null}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

type Fila = { clave: string; valor: unknown; vigente_desde: string; actualizado_en: string };

/**
 * Lo que usa la calculadora de traslado, con su vigencia (el cálculo toma la versión vigente a la fecha de
 * firma). Cada enero: UMA, art. 126, recargos, derechos y tarifas de ISTD; cada mes, el INPC.
 */
export default async function ParametrosFiscales() {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const filas = oExplota(
    await supabase.from("parametros_fiscales").select("clave, valor, vigente_desde, actualizado_en").order("vigente_desde", { ascending: false }).returns<Fila[]>(),
    "los parámetros"
  ) ?? [];
  const ultimo = (clave: string) => filas.find((f) => f.clave === clave);
  const anio = new Date().getFullYear();
  const enero = `${anio}-01-01`, hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const inpc = Object.entries((ultimo("inpc")?.valor ?? {}) as Record<string, number>).sort(([a], [b]) => a.localeCompare(b));
  const recargos = Object.entries((ultimo("recargos")?.valor ?? {}) as Record<string, number[]>).sort(([a], [b]) => b.localeCompare(a)).slice(0, 4)
    .map(([a, meses]) => [Number(a), ...meses]);
  const recargosResto = Object.entries((ultimo("recargos")?.valor ?? {}) as Record<string, number[]>).sort(([a], [b]) => b.localeCompare(a)).slice(4)
    .map(([a, meses]) => [Number(a), ...meses]);

  const vig = (clave: string) => {
    const f = ultimo(clave);
    return f ? ` · vigente desde ${f.vigente_desde.split("-").reverse().join("/")}` : "";
  };

  return (
    <PantallaAdmin titulo="Parámetros fiscales" volver={{ href: "/ajustes", texto: "Ajustes" }}>
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
        Los usa la calculadora de traslado. Cada cambio guarda una versión con su fecha de vigencia y queda en la bitácora; el cálculo usa la
        vigente a la fecha de firma.
      </p>

      <Seccion titulo="Valores" detalle="UMA vigente desde febrero (INEGI); UDI de Banxico a la fecha de firma.">
        {([["uma", "UMA diaria"], ["uma_anual", "UMA anual"], ["salario_minimo", "Salario mínimo diario (deducción LH)"], ["udi", "UDI"], ["tope_udis", "Exención casa habitación (UDIS)"]] as const).map(([k, e]) => (
          <FormularioValor key={k} clave={k} etiqueta={`${e}${vig(k)}`} valor={Number(ultimo(k)?.valor ?? 0)} vigente={k === "udi" ? hoy : enero} />
        ))}
      </Seccion>

      <Seccion titulo="INPC" detalle="INEGI lo publica cerca del día 10 del mes siguiente. Si pasan 45 días sin actualizarlo, llega una alerta.">
        <FormularioInpc ultimos={inpc.slice(-4) as [string, number][]} />
      </Seccion>

      <Seccion titulo={`Tarifa del art. 126 LISR${vig("tarifa_126")}`} detalle="Anexo 8 de la RMF del año.">
        <FormularioTabla clave="tarifa_126" columnas={[{ titulo: "Límite inferior" }, { titulo: "Límite superior", vacio: true }, { titulo: "Cuota fija" }, { titulo: "% excedente" }]}
          filas={(ultimo("tarifa_126")?.valor ?? []) as (number | null)[][]} vigente={enero} />
      </Seccion>

      <Seccion titulo={`Arancel notarial art. 147 (al millar por tramo de UMA)${vig("arancel_147")}`}>
        <FormularioTabla clave="arancel_147" columnas={[{ titulo: "Desde (UMA)" }, { titulo: "Hasta (UMA)", vacio: true }, { titulo: "Al millar" }]}
          filas={(ultimo("arancel_147")?.valor ?? []) as (number | null)[][]} vigente={enero} />
      </Seccion>

      <Seccion titulo={`Cancelación de hipoteca art. 158${vig("arancel_158")}`}>
        <FormularioTabla clave="arancel_158" columnas={[{ titulo: "Hasta (UMA)", vacio: true }, { titulo: "Honorario (UMA)" }]}
          filas={(ultimo("arancel_158")?.valor ?? []) as (number | null)[][]} vigente={enero} />
      </Seccion>

      <Seccion titulo={`Avalúo hacendario: arancel del Consejo${vig("consejo")}`} detalle="Tramos en UMA anuales; cuota en UMA más el al millar sobre el valor.">
        <FormularioTabla clave="consejo" columnas={[{ titulo: "Desde (UMA anuales)" }, { titulo: "Hasta" }, { titulo: "Cuota (UMA)" }, { titulo: "Al millar" }]}
          filas={(ultimo("consejo")?.valor ?? []) as (number | null)[][]} vigente={enero} />
      </Seccion>

      <Seccion titulo="Recargos (tasa mensual de mora, %)" detalle="Un renglón por año: año y sus 12 tasas. Se muestran los últimos cuatro; los anteriores se guardan igual.">
        <FormularioTabla clave="recargos" columnas={[{ titulo: "Año" }, ...["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((t) => ({ titulo: t }))]}
          filas={[...recargos, ...recargosResto]} vigente={ultimo("recargos")?.vigente_desde ?? "1990-01-01"} />
      </Seccion>

      <Seccion titulo={`ISTD por municipio${vig("istd")}`} detalle="Leyes de ingresos municipales (La Sombra de Arteaga, fin de diciembre). En una tarifa, la cuota fija de cada rango debe ser el impuesto en el límite del anterior.">
        <FormularioIstd municipios={(ultimo("istd")?.valor ?? {}) as never} vigente={enero} />
      </Seccion>
    </PantallaAdmin>
  );
}

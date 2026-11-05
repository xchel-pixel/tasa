"use server";

import { redirect } from "next/navigation";
import { municipioPorClave, type Caso, type DatosIsr, type Mejora } from "@/lib/traslado/calculo";
import { calcularYGuardar, type Modo } from "@/lib/traslado/servidor";
import { tengoHerramienta } from "@/lib/herramientas";
import { obtenerSesion } from "@/lib/sesion";
import { crearClienteServidor } from "@/lib/supabase/server";

export type EstadoCalculo = { error: string | null };

const texto = (f: FormData, n: string) => String(f.get(n) ?? "").trim();
const numero = (f: FormData, n: string) => {
  const t = texto(f, n).replace(/[$,\s]/g, "");
  return t === "" ? 0 : Number(t);
};
const fecha = (f: FormData, n: string) => (/^\d{4}-\d{2}-\d{2}$/.test(texto(f, n)) ? texto(f, n) : "");

/** Del formulario al caso de la calculadora; la base y el cálculo validan lo demás. */
function casoDelFormulario(f: FormData, modo: Modo): Caso | string {
  const lado = texto(f, "lado") as Caso["lado"];
  if (!["C", "V", "ambos"].includes(lado)) return "Elige para quién es el cálculo.";
  const clave = texto(f, "clave_catastral").replace(/[^d-]/g, "").slice(0, 40);
  const municipio = texto(f, "municipio") || (clave ? municipioPorClave(clave) ?? "" : "");
  if (!municipio) return "Elige el municipio o escribe la clave catastral.";
  const operacion = texto(f, "operacion") as Caso["operacion"];
  const vo = numero(f, "valor_operacion"), va = numero(f, "avaluo");
  if ([vo, va].some((x) => !Number.isFinite(x) || x < 0)) return "Los valores van en pesos, sin letras.";
  if (operacion !== "donacion" && vo <= 0) return "Escribe el valor de operación.";
  if (operacion === "donacion" && va <= 0) return "En una donación hace falta el avalúo.";
  const firma = fecha(f, "fecha_firma") || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

  const caso: Caso = {
    lado, municipio, fecha_firma: firma, clave_catastral: clave || undefined, referencia: texto(f, "referencia").slice(0, 80) || undefined,
    operacion: operacion || "compraventa", donacion_exenta: f.get("donacion_exenta") === "on",
    valor_operacion: vo, avaluo: va, valor_catastral: numero(f, "valor_catastral"),
    comprador: {
      vivienda_primera: (["social", "popular"].includes(texto(f, "vivienda_primera")) ? texto(f, "vivienda_primera") : null) as "social" | "popular" | null,
      incluir_avaluo: f.get("incluir_avaluo") === "on", certificados_gravamen: 1,
    },
    vendedor: { isr: null, cancelar_hipoteca: numero(f, "cancelar_hipoteca") },
    extemporaneo: null,
    detalle: true,
  };

  if (modo === "completa") {
    if (f.get("con_isr") === "on" && lado !== "C") {
      const adq = fecha(f, "fecha_adq");
      if (!adq) return "Para el ISR escribe la fecha de adquisición.";
      const mejoras: Mejora[] = [];
      if (numero(f, "mejora_monto") > 0) {
        const fm = fecha(f, "mejora_fecha");
        if (!fm) return "Escribe la fecha de las mejoras.";
        mejoras.push({ monto: numero(f, "mejora_monto"), fecha: fm, comprobante: (texto(f, "mejora_comprobante") || "cfdi") as Mejora["comprobante"] });
      }
      const isr: DatosIsr = {
        fecha_adq: adq, costo_adq: numero(f, "costo_adq"),
        costo_terreno: texto(f, "costo_terreno") ? numero(f, "costo_terreno") : null,
        pct_terreno: texto(f, "pct_terreno") ? numero(f, "pct_terreno") : null,
        mejoras,
        gastos: numero(f, "gastos_monto") > 0 ? [{ monto: numero(f, "gastos_monto"), fecha: fecha(f, "gastos_fecha") || adq, concepto: "gastos de adquisición" }] : [],
        casa_habitacion: f.get("casa_habitacion") === "on",
        fecha_mejora_cero: null,
      };
      caso.vendedor = { ...caso.vendedor, isr };
    }
    if (f.get("extemporaneo") === "on" && lado !== "V") {
      const fo = fecha(f, "ext_fecha");
      if (!fo) return "Para el extemporáneo escribe la fecha de la operación original.";
      const tasa = numero(f, "ext_tasa");
      if (!(tasa > 0 && tasa <= 10)) return "Escribe la tasa del ISTD vigente en esa fecha (por ejemplo, 2).";
      caso.extemporaneo = {
        fecha_operacion: fo, valor: numero(f, "ext_valor"), tasa_pct: tasa, adicional_25: f.get("ext_adicional") === "on",
        actualizar: f.get("ext_actualizar") !== "off", tope_meses: texto(f, "ext_tope") === "12" ? 12 : 60,
      };
    }
  }
  return caso;
}

export async function calcularTraslado(_previo: EstadoCalculo, f: FormData): Promise<EstadoCalculo> {
  const sesion = await obtenerSesion();
  if (!sesion?.persona) return { error: "Tu sesión terminó; vuelve a entrar." };
  const modo: Modo = texto(f, "modo") === "completa" ? "completa" : "rapida";
  if (!(await tengoHerramienta(modo === "completa" ? "calculadora_traslado_completa" : "calculadora_traslado"))) {
    return { error: "Ese modo de la calculadora no está disponible para tu nivel." };
  }
  const caso = casoDelFormulario(f, modo);
  if (typeof caso === "string") return { error: caso };
  let id: string;
  try {
    ({ id } = await calcularYGuardar(caso, modo));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo calcular. Inténtalo otra vez." };
  }
  redirect(`/calculadora/${id}`);
}

export async function borrarCalculo(f: FormData) {
  const supabase = await crearClienteServidor();
  await supabase.from("calculos_traslado").delete().eq("id", texto(f, "id"));
  redirect("/calculadora/mis-calculos");
}

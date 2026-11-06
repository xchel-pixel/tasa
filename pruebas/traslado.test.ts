import { describe, expect, test } from "vitest";
import casos from "@/docs/fuentes-traslado/casos-referencia.json";
import { calcular, factorRecargos, limpiarClave, municipio, municipioPorClave, type Caso, type Parametros, type Resultado } from "@/lib/traslado/calculo";
import datos from "@/lib/traslado/parametros-2026.json";
import { prellenadoDesdeCalculo } from "@/lib/traslado/prellenado";

/**
 * La calculadora de traslado contra los scripts Python originales: cada caso de
 * docs/fuentes-traslado/casos-referencia.json trae la entrada y el resultado de gastos.calcular.
 * Mismos conceptos, en el mismo orden, y cada importe con ±1 peso de tolerancia (redondeo).
 */

const p = datos as unknown as Parametros;
type CasoRef = { entrada: Caso; resultado: Resultado };
const sinHtml = (s: string) => s.replace(/<[^>]+>/g, "");

describe("calculadora de traslado vs. scripts originales", () => {
  for (const { entrada, resultado: esperado } of casos as unknown as CasoRef[]) {
    test(entrada.referencia ?? "caso", () => {
      const r = calcular(entrada, p);
      expect(r.lado).toBe(esperado.lado);
      expect(r.municipio).toBe(esperado.municipio);
      for (const parte of ["C", "V"] as const) {
        expect(r[parte].map(([g, k]) => `${g} · ${k}`)).toEqual(esperado[parte].map(([g, k]) => `${g} · ${k}`));
        r[parte].forEach(([, k, v], i) => expect(Math.abs(v - esperado[parte][i][2]), `${parte} · ${k}: ${v} vs ${esperado[parte][i][2]}`).toBeLessThanOrEqual(1));
      }
      expect(Math.abs(r.totC - esperado.totC)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.totV - esperado.totV)).toBeLessThanOrEqual(1);
      if (esperado.mejora) {
        expect(r.mejora?.[1]).toBe(esperado.mejora[1]);
        expect(Math.abs((r.mejora?.[0] ?? 0) - esperado.mejora[0])).toBeLessThanOrEqual(100); // redondeado a centenas
      } else expect(r.mejora).toBeNull();
      // Las mismas sugerencias y observaciones (el texto puede variar en centavos dentro de los importes).
      expect(r.SC.length).toBe(esperado.SC.length);
      expect(r.SV.length).toBe(esperado.SV.length);
      r.SC.forEach((s, i) => expect(sinHtml(s).slice(0, 40)).toBe(sinHtml(esperado.SC[i]).slice(0, 40)));
      r.SV.forEach((s, i) => expect(sinHtml(s).slice(0, 40)).toBe(sinHtml(esperado.SV[i]).slice(0, 40)));
      expect([...r.notas].sort()).toEqual([...esperado.notas].sort());
    });
  }
});

describe("piezas sueltas", () => {
  test("recargos: los factores de Integranot", () => {
    expect(factorRecargos(p, 1990, 11, 12)).toBe(28.5);
    expect(factorRecargos(p, 1990, 11, 60)).toBe(137.17);
    expect(factorRecargos(p, 1990, 11, 200, 60)).toBe(137.17);
  });
  test("municipio por nombre (sin acentos, parcial) y por clave catastral", () => {
    expect(municipio(p, "queretaro")).toBe("Querétaro");
    expect(municipio(p, "marques")).toBe("El Marqués");
    expect(municipioPorClave("14-01-001-01-001-001")).toBe("Querétaro");
    expect(municipioPorClave("160101")).toBe("San Juan del Río");
    expect(() => municipio(p, "Guadalajara")).toThrow();
    // Como la captura la gente: con espacios o puntos; se guarda y deduce el municipio igual.
    expect(limpiarClave("14 01 001 01 001 001")).toBe("140100101001001");
    expect(limpiarClave("06.01.002-03")).toBe("0601002-03");
    expect(municipioPorClave(limpiarClave("16 01 001"))).toBe("San Juan del Río");
  });
});

describe("solicitud del avalúo desde la calculadora (prellenado)", () => {
  const casoRef = (ref: string) => (casos as unknown as CasoRef[]).find((x) => x.entrada.referencia === ref)!;
  test("no se pierde nada: municipio, clave, referencia, operación, valores, extemporáneo, firma y total", () => {
    const { entrada } = casoRef("08_extemporaneo");
    const e = { ...entrada, clave_catastral: "14-01-001-01-001-001", valor_catastral: 750000 };
    const resultado = calcular(e, p);
    const pre = prellenadoDesdeCalculo({ referencia: "Casa Juriquilla", entrada: e, resultado }, "hacendario");
    expect(pre.servicio).toBe("hacendario");
    expect(pre.municipio).toBe("Querétaro");
    expect(pre.clave).toBe("14-01-001-01-001-001");
    const total = resultado.totC.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
    expect(pre.descripcion.split("\n")).toEqual([
      `Desde calculadora de traslado: comprador, total estimado ${total}`,
      "Referencia: Casa Juriquilla",
      "Operación: compraventa",
      "Valor de operación: $900,000.00",
      "Avalúo o valor de referencia: $1,600,000.00",
      "Valor catastral: $750,000.00",
      "Extemporáneo: operación original del 10/08/2015 (se necesita avalúo referido a esa fecha)",
      "Firma estimada: 20/11/2026",
    ]);
  });
  test("ambos lados, donación exenta y avalúo comercial", () => {
    const ambos = casoRef("06_ambos_qro");
    const r = calcular(ambos.entrada, p);
    const pre = prellenadoDesdeCalculo({ referencia: null, entrada: ambos.entrada, resultado: r }, "comercial");
    expect(pre.servicio).toBe("comercial");
    expect(pre.clave).toBe("");
    expect(pre.descripcion.split("\n")[0]).toMatch(/^Desde calculadora de traslado: comprador y vendedor, total estimado .* \(comprador .* · vendedor .*\)$/);
    const don = casoRef("11_donacion_exenta");
    const pd = prellenadoDesdeCalculo({ referencia: null, entrada: don.entrada, resultado: calcular(don.entrada, p) }, "hacendario");
    expect(pd.descripcion).toContain("Operación: donación entre cónyuges o línea recta");
    expect(pd.descripcion).not.toContain("Valor de operación");
  });
});

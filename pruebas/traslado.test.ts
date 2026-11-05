import { describe, expect, test } from "vitest";
import casos from "@/docs/fuentes-traslado/casos-referencia.json";
import { calcular, factorRecargos, municipio, municipioPorClave, type Caso, type Parametros, type Resultado } from "@/lib/traslado/calculo";
import datos from "@/lib/traslado/parametros-2026.json";

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
  });
});

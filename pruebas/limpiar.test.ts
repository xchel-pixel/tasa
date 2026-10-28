import { describe, expect, test } from "vitest";
import { errorDeClabe, limpiarClabe } from "@/lib/clabe";
import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono, rfcValido } from "@/lib/limpiar";

describe("Campos que se pegan con espacios y guiones", () => {
  test("CLABE: se limpia y explica qué falta", () => {
    expect(limpiarClabe("0021 8000-0000 0000 12")).toBe("002180000000000012");
    expect(errorDeClabe(limpiarClabe("002 180 000 000 000 012"))).toBeNull();
    expect(errorDeClabe("00218000000000001")).toBe("La CLABE debe tener 18 dígitos.");
    expect(errorDeClabe("002180000000000013")).toBe("El dígito de control no coincide, revisa la CLABE.");
  });

  test("RFC y teléfono", () => {
    expect(limpiarRfc("gusm-840104 gu9")).toBe("GUSM840104GU9");
    expect(errorDeRfc("GUSM840104GU9")).toBeNull();
    expect(errorDeRfc("ABC")).toMatch(/12 caracteres/);
    expect(errorDeRfc("")).toBeNull();
    expect(errorDeRfc("", { obligatorio: true })).toBe("Falta el RFC.");
    expect(errorDeRfc("GUSM840104GU8")).toMatch(/dígito verificador/);
    expect(errorDeRfc("GUSM840104GU8", { revisadoAMano: true })).toBeNull();
    expect(limpiarTelefono("(442) 123-45 67")).toBe("4421234567");
    expect(limpiarTelefono("+52 442 123 4567")).toBe("+524421234567");
    expect(errorDeTelefono("4421234")).toMatch(/10 dígitos/);
    expect(errorDeTelefono("")).toBeNull();
  });

  test("RFC: dígito verificador del SAT con RFC reales", () => {
    // Persona moral (12) y personas físicas (13): los de las cuentas receptoras.
    for (const rfc of ["CHC2206204P2", "PUSA8705253C3", "GUSM840104GU9"]) expect(rfcValido(rfc)).toBe(true);
    expect(rfcValido("CHC2206204P3")).toBe(false);
    expect(rfcValido("PUSA8705253C4")).toBe(false);
  });
});

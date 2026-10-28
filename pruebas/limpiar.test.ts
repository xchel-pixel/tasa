import { describe, expect, test } from "vitest";
import { errorDeClabe, limpiarClabe } from "@/lib/clabe";
import { errorDeRfc, errorDeTelefono, limpiarRfc, limpiarTelefono } from "@/lib/limpiar";

describe("Campos que se pegan con espacios y guiones", () => {
  test("CLABE: se limpia y explica qué falta", () => {
    expect(limpiarClabe("0021 8000-0000 0000 12")).toBe("002180000000000012");
    expect(errorDeClabe(limpiarClabe("002 180 000 000 000 012"))).toBeNull();
    expect(errorDeClabe("00218000000000001")).toBe("La CLABE debe tener 18 dígitos.");
    expect(errorDeClabe("002180000000000013")).toBe("El dígito de control no coincide, revisa la CLABE.");
  });

  test("RFC y teléfono", () => {
    expect(limpiarRfc("lopa-800101 ab1")).toBe("LOPA800101AB1");
    expect(errorDeRfc("LOPA800101AB1")).toBeNull();
    expect(errorDeRfc("ABC")).toMatch(/12 caracteres/);
    expect(limpiarTelefono("(442) 123-45 67")).toBe("4421234567");
    expect(limpiarTelefono("+52 442 123 4567")).toBe("+524421234567");
    expect(errorDeTelefono("4421234")).toMatch(/10 dígitos/);
    expect(errorDeTelefono("")).toBeNull();
  });
});

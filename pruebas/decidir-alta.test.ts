import { describe, expect, test } from "vitest";
import { decisionDeAlta } from "@/lib/decidir-alta";

describe("Quién decide una solicitud de alta", () => {
  test("quien refirió (equipo o finanzas) no ve los botones", () => {
    expect(decisionDeAlta("finanzas", true).botones).toBe(false);
    expect(decisionDeAlta("equipo", true).botones).toBe(false);
    expect(decisionDeAlta("admin_marca", true).botones).toBe(false);
  });
  test("admin_org decide; si la refirió, con aviso de que queda marcado", () => {
    expect(decisionDeAlta("admin_org", false)).toEqual({ botones: true, aviso: null });
    expect(decisionDeAlta("admin_org", true).aviso).toMatch(/bitácora/);
  });
});

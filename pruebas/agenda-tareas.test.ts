import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { cambioDeTarea } from "@/lib/agenda";

// 0093: palomear en cualquier lista nunca borra; borrar solo marca eliminada (se puede deshacer).
describe("Agenda: tareas", () => {
  const ahora = new Date("2026-11-19T18:00:00Z");

  test("la casilla (hecha / pendiente) solo cambia hecha_en, en las dos listas", () => {
    for (const dia of ["2026-11-19", null]) {
      expect(cambioDeTarea("hecha", dia, ahora)).toEqual({ hecha_en: "2026-11-19T18:00:00.000Z" });
      expect(cambioDeTarea("pendiente", dia, ahora)).toEqual({ hecha_en: null });
    }
  });

  test("borrar marca eliminada y restaurar la regresa; nada más toca eliminada_en", () => {
    expect(cambioDeTarea("borrar", null, ahora)).toEqual({ eliminada_en: "2026-11-19T18:00:00.000Z" });
    expect(cambioDeTarea("restaurar", null, ahora)).toEqual({ eliminada_en: null });
    for (const que of ["hecha", "pendiente", "hoy", "despues"]) expect(Object.keys(cambioDeTarea(que, "2026-11-19", ahora) ?? {})).not.toContain("eliminada_en");
    expect(cambioDeTarea("otra cosa", null, ahora)).toBeNull();
  });

  test("la app nunca borra tareas de verdad y la casilla nunca manda 'borrar'", () => {
    const acciones = readFileSync("app/agenda/acciones.ts", "utf8");
    const bloque = acciones.slice(acciones.indexOf("export async function cambiarTarea"), acciones.indexOf("export async function guardarCita"));
    expect(bloque).not.toContain(".delete(");
    const fila = readFileSync("app/agenda/tareas.tsx", "utf8");
    const palomear = fila.slice(fila.indexOf("const palomear"), fila.indexOf("const borrar"));
    expect(palomear).toContain("\"hecha\"");
    expect(palomear).not.toContain("borrar");
    // Las dos listas usan la misma fila.
    const pagina = readFileSync("app/agenda/page.tsx", "utf8");
    expect(pagina).toContain("<ListaTareas tareas={d.tareas}");
    expect(pagina).toContain("<ListaTareas tareas={d.despues}");
    expect(pagina.match(/<FilaTarea /g)).toHaveLength(1);
  });

  test("'Para después' también muestra las palomeadas de hoy (tachadas) y oculta las eliminadas", () => {
    const lib = readFileSync("lib/agenda.ts", "utf8");
    expect(lib).toContain("hecha_en.is.null,hecha_en.gte.${inicioHoy}");
    expect(lib.match(/is\("eliminada_en", null\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

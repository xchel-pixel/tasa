import { describe, expect, test } from "vitest";
import { construirIcs, escaparIcs, plegar } from "@/lib/agenda-ics";
import { diaValido, instanteMx, ligaWhatsApp, sumarDias } from "@/lib/agenda";

describe("Agenda (0091)", () => {
  test("días y horas de México", () => {
    expect(diaValido("2026-11-19")).toBe("2026-11-19");
    expect(diaValido("2026-02-30")).toBeNull();
    expect(diaValido("19/11/2026")).toBeNull();
    expect(sumarDias("2026-11-30", 1)).toBe("2026-12-01");
    expect(sumarDias("2026-01-01", -1)).toBe("2025-12-31");
    expect(instanteMx("2026-11-19", "10:15")).toBe("2026-11-19T16:15:00.000Z");
  });

  test("WhatsApp: 10 dígitos de México llevan el 52", () => {
    expect(ligaWhatsApp("442 100 0001")).toBe("https://wa.me/524421000001");
    expect(ligaWhatsApp("+52 1 442 100 0001")).toBe("https://wa.me/5214421000001");
    expect(ligaWhatsApp("123")).toBeNull();
  });

  test("liga de calendario: visita con hora (UTC) y alarma; lo demás de día completo; sin alarma", () => {
    const ics = construirIcs([
      { tipo: "visita", dia: "2026-11-20", hora: "10:15:00", titulo: "Visita MGP-2026-0991 · Corregidora", uid: "visita-1" },
      { tipo: "entrega", dia: "2026-11-23", hora: null, titulo: "Entrega MGP-2026-0991 · Corregidora", uid: "entrega-1" },
    ], new Date("2026-11-19T18:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261120T161500Z\r\nDTEND:20261120T171500Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261123\r\nDTEND;VALUE=DATE:20261124");
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics).toContain("TRIGGER:-PT1H");
    expect(ics).toContain("UID:visita-1@tasa.xgplataform.com");
    // El aviso va en la descripción; los renglones largos se pliegan (CRLF + espacio), así que se compara desplegado.
    expect(ics.replaceAll("\r\n ", "")).toContain("Las alarmas y cambios de último momento míralos en la Agenda de Tasa.");
    // Ningún renglón pasa de 75 bytes.
    for (const r of ics.split("\r\n")) expect(new TextEncoder().encode(r).length).toBeLessThanOrEqual(75);
  });

  test("texto de iCal: escapa comas, punto y coma y saltos; pliega renglones largos", () => {
    expect(escaparIcs("a, b; c\nd")).toBe(String.raw`a\, b\; c\nd`);
    const largo = plegar(`SUMMARY:${"Á".repeat(60)}`);
    expect(largo.split("\r\n ").length).toBeGreaterThan(1);
  });
});

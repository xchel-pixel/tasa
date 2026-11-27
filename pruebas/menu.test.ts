import { describe, expect, test } from "vitest";
import type { Herramienta } from "@/lib/herramientas";
import { seccionActiva, seccionesDe } from "@/lib/menu";
import type { Persona } from "@/lib/sesion";

/** Menú por secciones (dic-2026): cinco como máximo, por rol; las rutas de siempre caen en su sección. */

const persona = (rol: Persona["rol"]) => ({ rol, organizacion: { slug: "xg", nombre: "XG" } }) as unknown as Persona;
const h = (...claves: string[]) => claves.map((clave, i) => ({ clave, nombre: clave, en_menu: true, orden: i })) as Herramienta[];
const CON_AGENDA = h("agenda", "invitar", "mapa_catastral");
const textos = (rol: Persona["rol"], her = CON_AGENDA) => seccionesDe(persona(rol), her).map((s) => s.corto ?? s.texto);

describe("Secciones por rol", () => {
  test("comisionista: Inicio · Mis trabajos · Herramientas · Agenda · Mi cuenta", () => {
    expect(textos("comisionista")).toEqual(["Inicio", "Mis trabajos", "Herramientas", "Agenda", "Mi cuenta"]);
  });
  test("admin_org: Hoy · Admin (Administración en la computadora) · Herramientas · Agenda · Ajustes", () => {
    expect(textos("admin_org")).toEqual(["Hoy", "Admin", "Herramientas", "Agenda", "Ajustes"]);
    expect(seccionesDe(persona("admin_org"), CON_AGENDA)[1].texto).toBe("Administración");
  });
  test("finanzas y admin_marca sin Ajustes; equipo con Mi panel", () => {
    expect(textos("finanzas")).toEqual(["Hoy", "Admin", "Herramientas", "Agenda"]);
    expect(textos("admin_marca")).toEqual(["Hoy", "Admin", "Herramientas", "Agenda"]);
    expect(textos("equipo")).toEqual(["Inicio", "Mi panel", "Herramientas", "Agenda"]);
  });
  test("sin la Agenda en el catálogo (apagada), no sale", () => {
    expect(textos("comisionista", h("mapa_catastral"))).toEqual(["Inicio", "Mis trabajos", "Herramientas", "Mi cuenta"]);
  });
  test("Administración solo con las pantallas que el rol abre", () => {
    const de = (rol: Persona["rol"]) => seccionesDe(persona(rol), CON_AGENDA).find((s) => s.id === "administracion")!.pantallas.map((p) => p.href);
    expect(de("admin_org")).toContain("/admin/bitacora");
    expect(de("finanzas")).not.toContain("/admin/bitacora");
    expect(de("admin_marca")).not.toContain("/admin/cierres");
    expect(de("admin_marca")).toContain("/admin/tramites");
  });
});

describe("Cada ruta de siempre en su sección", () => {
  const com = seccionesDe(persona("comisionista"), CON_AGENDA);
  const adm = seccionesDe(persona("admin_org"), CON_AGENDA);
  test.each([
    ["/", "inicio"], ["/solicitudes/nueva", "trabajos"], ["/estado-de-cuenta", "trabajos"], ["/trabajos/abc", "trabajos"],
    ["/mapa-catastral", "herramientas"], ["/calculadora/mis-calculos", "herramientas"], ["/agenda/calendario", "agenda"],
    ["/perfil", "cuenta"], ["/paquetes", "cuenta"], ["/mi-cuenta", "cuenta"],
  ])("comisionista %s → %s", (ruta, id) => expect(seccionActiva(com, ruta)).toBe(id));
  test.each([
    ["/", "hoy"], ["/admin", "hoy"], ["/admin/tramites", "administracion"], ["/admin/cierres/2026-10", "administracion"],
    ["/administracion", "administracion"], ["/admin/niveles", "ajustes"], ["/admin/configuracion", "ajustes"], ["/ajustes/parametros", "ajustes"],
    ["/herramientas", "herramientas"],
  ])("admin_org %s → %s", (ruta, id) => expect(seccionActiva(adm, ruta)).toBe(id));
  test("/administracion no se confunde con /admin (Hoy)", () => {
    expect(seccionActiva(adm, "/administracion")).toBe("administracion");
    expect(seccionActiva(adm, "/admin")).toBe("hoy");
  });
});

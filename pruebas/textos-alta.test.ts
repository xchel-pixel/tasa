import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { esCorreo, llenarTexto, nivelYPorcentaje, nombreDePila } from "@/lib/textos-alta";

/** Los textos de origen son los que pone la migración 0024 en Ajustes. */
const migracion = readFileSync(join(import.meta.dirname, "..", "supabase", "migrations", "0024_alta_por_solicitud.sql"), "utf8");
const textoDe = (columna: string) => migracion.split(`add column ${columna} text`)[1].split("$t$")[1];
const BIENVENIDA = textoDe("correo_bienvenida");
const RECHAZO = textoDe("correo_rechazo");

describe("Correos de alta", () => {
  test("bienvenida completa: asunto, nombre de pila, nivel, fecha y contacto", () => {
    const { asunto, texto } = llenarTexto(
      BIENVENIDA,
      { nombre: "María José López", nivel: nivelYPorcentaje("Socio Plus", 15), fecha: "31/01/2027", contacto: "soporte@xgplataform.com" },
      "x"
    );
    expect(asunto).toBe("Te damos la bienvenida a Tasa");
    expect(texto.startsWith("Hola, María:")).toBe(true);
    expect(texto).toContain("Tu nivel inicial: Socio Plus 15% hasta el 31/01/2027.");
    expect(texto).toContain("Si tienes dudas, escríbenos a soporte@xgplataform.com.");
    expect(texto.endsWith("Te damos la bienvenida.")).toBe(true);
    expect(texto).not.toMatch(/\[|\]/);
  });

  test("sin fecha ni contacto, esos pedazos no salen", () => {
    const { texto } = llenarTexto(BIENVENIDA, { nombre: "Ana", nivel: nivelYPorcentaje("Enlace", 5) }, "x");
    expect(texto).toContain("Tu nivel inicial: Enlace 5%.");
    expect(texto).not.toContain("hasta el");
    expect(texto).not.toContain("Si tienes dudas");
    expect(texto).not.toMatch(/\n{3,}/);
  });

  test("rechazo: el motivo opcional desaparece con su espacio", () => {
    const sin = llenarTexto(RECHAZO, { nombre: "Beto Ruiz", contacto: "soporte@xgplataform.com" }, "x");
    expect(sin.asunto).toBe("Tu solicitud para Tasa");
    expect(sin.texto).toBe(
      "Hola, Beto: revisamos tu solicitud para Tasa y por ahora no pudimos aprobarla. Si crees que es un error, escríbenos a soporte@xgplataform.com."
    );
    const con = llenarTexto(RECHAZO, { nombre: "Beto", motivo: "Falta la CSF vigente.", contacto: "soporte@xgplataform.com" }, "x");
    expect(con.texto).toContain("no pudimos aprobarla. Falta la CSF vigente. Si crees");
  });

  test("detalles", () => {
    expect(nombreDePila("  Juana Gabriela Olvera ")).toBe("Juana");
    expect(nivelYPorcentaje("Socio", "12.50")).toBe("Socio 12.5%");
    expect(esCorreo("soporte@xgplataform.com")).toBe(true);
    expect(esCorreo("442 682 1525")).toBe(false);
  });
});

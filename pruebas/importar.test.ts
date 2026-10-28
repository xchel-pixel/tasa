import { describe, expect, test } from "vitest";
import { parsearTabla, slugDe, slugLibre } from "@/lib/importar-comisionistas";

describe("Importar comisionistas", () => {
  test("lee la tabla pegada de una hoja, salta el encabezado y marca errores", () => {
    const filas = parsearTabla(
      [
        "Nombre\tCorreo\tTeléfono\tRFC\tFactura\tÉlite",
        "Ana López\tANA@correo.com\t4421234567\tLOPA800101AB7\tsí\t",
        "",
        "Beto\tbeto-sin-arroba\t\t\tno\t",
        "Carla Ruiz\tana@correo.com\t\tMAL\t\t40",
        "Dora Peña;dora@correo.com;;PEDO800101AB1;x;18",
        "Eva\teva@correo.com\t\tLOPA800101AB1\t\t",
      ].join("\n")
    );
    expect(filas).toHaveLength(5);
    expect(filas[0]).toMatchObject({ linea: 2, nombre: "Ana López", correo: "ana@correo.com", emite_factura: true, elite: null, errores: [] });
    expect(filas[1].errores).toEqual(["correo no válido", "falta el RFC"]);
    expect(filas[2].errores).toEqual([
      "correo repetido en la tabla",
      "RFC que no cuadra (formato o dígito verificador)",
      "el porcentaje élite va de más de 0 a 30",
    ]);
    expect(filas[3]).toMatchObject({ nombre: "Dora Peña", emite_factura: true, elite: 18, errores: [] });
    expect(filas[4].errores).toEqual(["RFC que no cuadra (formato o dígito verificador)"]);
  });

  test("tasa de bienvenida: sí/no o número de meses", () => {
    const [a, b, c, d] = parsearTabla(
      [
        "Uno\tuno@c.com\t\tLOPA800101AB7\t\t\tsí",
        "Dos\tdos@c.com\t\tLOPA800101AB7\t\t\t6",
        "Tres\ttres@c.com\t\tLOPA800101AB7",
        "Cuatro\tcuatro@c.com\t\tLOPA800101AB7\t\t\t15",
      ].join("\n")
    );
    expect([a.bienvenida, a.mesesBienvenida]).toEqual([true, null]);
    expect([b.bienvenida, b.mesesBienvenida]).toEqual([true, 6]);
    expect([c.bienvenida, c.mesesBienvenida]).toEqual([false, null]);
    expect(d.errores).toEqual(["la bienvenida va de 1 a 12 meses"]);
  });

  test("la liga sale del nombre y no choca con las que ya existen", () => {
    expect(slugDe("José Ángel Pérez Núñez")).toBe("jose-angel-perez");
    const ocupados = new Set(["ana-lopez"]);
    expect(slugLibre("Ana López", ocupados)).toBe("ana-lopez-2");
    expect(slugLibre("Ana  López", ocupados)).toBe("ana-lopez-3");
  });
});

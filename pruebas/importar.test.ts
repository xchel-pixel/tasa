import { describe, expect, test } from "vitest";
import { parsearTabla, slugDe, slugLibre } from "@/lib/importar-comisionistas";

describe("Importar comisionistas", () => {
  test("lee la tabla pegada de una hoja, salta el encabezado y marca errores", () => {
    const filas = parsearTabla(
      [
        "Nombre\tCorreo\tTeléfono\tRFC\tFactura\tÉlite",
        "Ana López\tANA@correo.com\t4421234567\tLOPA800101AB1\tsí\t",
        "",
        "Beto\tbeto-sin-arroba\t\t\tno\t",
        "Carla Ruiz\tana@correo.com\t\tMAL\t\t40",
        "Dora Peña;dora@correo.com;;;x;18",
      ].join("\n")
    );
    expect(filas).toHaveLength(4);
    expect(filas[0]).toMatchObject({ linea: 2, nombre: "Ana López", correo: "ana@correo.com", emite_factura: true, elite: null, errores: [] });
    expect(filas[1].errores).toEqual(["correo no válido"]);
    expect(filas[2].errores).toEqual(["correo repetido en la tabla", "RFC con formato incorrecto", "el porcentaje élite va de más de 0 a 30"]);
    expect(filas[3]).toMatchObject({ nombre: "Dora Peña", emite_factura: true, elite: 18, errores: [] });
  });

  test("la liga sale del nombre y no choca con las que ya existen", () => {
    expect(slugDe("José Ángel Pérez Núñez")).toBe("jose-angel-perez");
    const ocupados = new Set(["ana-lopez"]);
    expect(slugLibre("Ana López", ocupados)).toBe("ana-lopez-2");
    expect(slugLibre("Ana  López", ocupados)).toBe("ana-lopez-3");
  });
});

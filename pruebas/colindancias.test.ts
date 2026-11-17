import { describe, expect, test } from "vitest";
import { ladosDelPoligono, leerColindancias, rumboDeAzimut, textoMedida } from "@/lib/catastro/colindancias";
import { seccionesDeFicha } from "@/lib/catastro/etiquetas";
import { limpiarExpediente } from "@/lib/catastro/limpiar";
import type { Ficha } from "@/lib/catastro/servicio";

/** Textos reales de predios guardados (nov-2026), con los nombres de personas cambiados por PERSONA A, B… */
const filasDe = (texto: string) => leerColindancias(texto).filas.map((f) => [f.orientacion, textoMedida(f.medidas), f.colinda]);

describe("medidas y colindancias del Registro Público", () => {
  test("lo clásico: AL NORTE 13.00 MTS. CON…", () => {
    const r = leerColindancias("AL NORTE 13.00 MTS. CON PROPIEDAD DE PERSONA A. AL SUR 13.00 MTS. CON LA AVENIDA 15 DE MAYO. AL ORIENTE 46.13 MTS. CON PROPIEDAD DE PERSONA B. AL PONIENTE 46.00 MTS. CON PROPIEDAD DE PERSONA C.");
    expect(r.seguro).toBe(true);
    expect(filasDe("AL NORTE 13.00 MTS. CON PROPIEDAD DE PERSONA A. AL SUR 13.00 MTS. CON LA AVENIDA 15 DE MAYO. AL ORIENTE 46.13 MTS. CON PROPIEDAD DE PERSONA B. AL PONIENTE 46.00 MTS. CON PROPIEDAD DE PERSONA C.")).toEqual([
      ["Norte", "13.00", "PROPIEDAD DE PERSONA A"], ["Sur", "13.00", "LA AVENIDA 15 DE MAYO"],
      ["Oriente", "46.13", "PROPIEDAD DE PERSONA B"], ["Poniente", "46.00", "PROPIEDAD DE PERSONA C"]]);
  });

  test("con dos puntos y M., (NORTE: 50.00 M., CON…)", () => {
    expect(filasDe("NORTE: 50.00 M., CON CALLE DE LA SIEMBRA; SUR: 50.00 M., CON LOTES 26, 27, 28, 29 Y 30; ORIENTE: 30.00 M., CON LOTE 6; PONIENTE: 30.00 M., CON CALLE DE LA HORTALIZA"))
      .toEqual([["Norte", "50.00", "CALLE DE LA SIEMBRA"], ["Sur", "50.00", "LOTES 26, 27, 28, 29 Y 30"], ["Oriente", "30.00", "LOTE 6"],
        ["Poniente", "30.00", "CALLE DE LA HORTALIZA"]]);
  });

  test("varios tramos en el mismo rumbo (con suma) y una calle que se llama SUR no parte el lado", () => {
    expect(filasDe("AL NORTE: EN LINEA QUEBRADA DE TRES TRAMOS DE 20.10 M, 1.50 M Y 26.60 M CON PERSONA A; AL SUR: EN LINEA QUEBRADA DE OCHO TRAMOS DE 6.85 M, 0.20 M, 10.15 M, 1.15 M, 5.00 M, 7.00 M, 15.35 M Y 11.00 M CON PERSONA B Y PERSONA C; AL ORIENTE: 13.40 M CON CALLE LUIS PASTEUR SUR; AL PONIENTE: 3.00 M CON PERSONA D."))
      .toEqual([["Norte", "20.10 + 1.50 + 26.60 = 48.20", "PERSONA A"],
        ["Sur", "6.85 + 0.20 + 10.15 + 1.15 + 5.00 + 7.00 + 15.35 + 11.00 = 56.70", "PERSONA B Y PERSONA C"],
        ["Oriente", "13.40", "CALLE LUIS PASTEUR SUR"], ["Poniente", "3.00", "PERSONA D"]]);
  });

  test("varios colindantes en el mismo rumbo: una fila por tramo, en orden", () => {
    expect(filasDe("AL NOROESTE 32.09 M CON PERSONA A Y 0.30 M Y 1.50 M CON PERSONA B, AL SURESTE 33.23 M CON PERSONA C, AL NORESTE 10.00 M CON PERSONA B, AL SUROESTE 11.85 M CON CALLE PASTEUR SUR."))
      .toEqual([["Noroeste", "32.09", "PERSONA A"], ["Noroeste", "0.30 + 1.50 = 1.80", "PERSONA B"], ["Sureste", "33.23", "PERSONA C"],
        ["Noreste", "10.00", "PERSONA B"], ["Suroeste", "11.85", "CALLE PASTEUR SUR"]]);
  });

  test("rumbos sin AL (NORTE 12.00 M CON… SUR 10.42 M…) y medidas pegadas (17M)", () => {
    expect(filasDe("NORTE 12.00 M CON CALLE CERRADA DE LAS LUCIERNAGAS SUR 10.42 M CON CAMPO DE GOLF ORIENTE 40.42 M CON LOTE 63 PONIENTE 39.96 M CON LOTE 65"))
      .toEqual([["Norte", "12.00", "CALLE CERRADA DE LAS LUCIERNAGAS"], ["Sur", "10.42", "CAMPO DE GOLF"], ["Oriente", "40.42", "LOTE 63"],
        ["Poniente", "39.96", "LOTE 65"]]);
    expect(filasDe("AL NORESTE 17M con AREA 6 AL SURESTE EN LINEA CURVA DE 12.25 M CON VIALIDAD INTERIOR DEL CONDOMINIO AL SUROESTE 17.00M con AREA 4 AL NOROESTE EN LINEA CURVA DE 10.98 M CON SEGUNDA CERRADA PUERTA DEL SOL"))
      .toEqual([["Noreste", "17.00", "AREA 6"], ["Sureste", "12.25", "VIALIDAD INTERIOR DEL CONDOMINIO"], ["Suroeste", "17.00", "AREA 4"],
        ["Noroeste", "10.98", "SEGUNDA CERRADA PUERTA DEL SOL"]]);
  });

  test("un rumbo dentro de la descripción (VOLTEANDO AL ESTE) no es un lado nuevo", () => {
    expect(filasDe("AL NORTE EN LQ DE 2 TRAMOS QUIEBRA DE SUROESTE A NORESTE EN 32.239 M VOLTEANDO AL ESTE EN 15.90 M CON AREA DE RESERVA ECOLOGICA PROTECCION ESPECIAL; AL SUR 43.378 M CON AVENIDA HACIENDA EL CAMPANARIO; AL ESTE 119.418 M CON LOTE 19; AL OESTE 105.0 M CON COLEGIO."))
      .toEqual([["Norte", "32.24 + 15.90 = 48.14", "AREA DE RESERVA ECOLOGICA PROTECCION ESPECIAL"], ["Sur", "43.38", "AVENIDA HACIENDA EL CAMPANARIO"],
        ["Este", "119.42", "LOTE 19"], ["Oeste", "105.00", "COLEGIO"]]);
  });

  test("sin CON y una sola medida: lo que sigue es el colindante", () => {
    expect(filasDe("AL NORESTE MIDE 986.35 M. PERSONA A. AL ESTE MIDE 452.12 M. POBLADO DE GALERAS. AL SUROESTE MIDE 994.72 M. UNA INSTITUCION FIDUCIARIA. AL OESTE MIDE 449.28 M. FRACCION 1-A."))
      .toEqual([["Noreste", "986.35", "PERSONA A"], ["Este", "452.12", "POBLADO DE GALERAS"], ["Suroeste", "994.72", "UNA INSTITUCION FIDUCIARIA"],
        ["Oeste", "449.28", "FRACCION 1-A"]]);
  });

  test("texto antes de los lados queda como nota; sin medidas, la medida es —", () => {
    const r = leerColindancias("SEGUN LA ESCRITURA DE PROPIEDAD: 9.63 M DE FRENTE POR 31.94 M DE FONDO, LINDANDO: AL NORTE CON CALLE DE SU UBICACION; AL SUR CON PROPIEDAD QUE FUE DE PERSONA A; AL ORIENTE CON EL ANTIGUO MESON DEL LIMON; AL PONIENTE CON PROPIEDAD DE PERSONA B.");
    expect(r.seguro).toBe(true);
    expect(r.nota).toBe("SEGUN LA ESCRITURA DE PROPIEDAD: 9.63 M DE FRENTE POR 31.94 M DE FONDO, LINDANDO");
    expect(r.filas.map((f) => [f.orientacion, textoMedida(f.medidas)])).toEqual([["Norte", "—"], ["Sur", "—"], ["Oriente", "—"], ["Poniente", "—"]]);
  });

  test("recorrido por vértices: rumbo, distancia y colindante de cada tramo", () => {
    expect(filasDe("SE INICIA EL RECORRIDO DEL VÉRTICE 1 CON RUMBO SURESTE EN LÍNEA RECTA Y UNA DISTANCIA DE 63.142 M, HASTA EL VÉRTICE 2, SIENDO EL LINDERO EL TALUD DE CORTE Y COLINDA CON PERSONA A, SE CONTINUA EL RECORRIDO DEL VERTICE 2 CON RUMBO NOROESTE EN LÍNEA RETA Y UNA DISTANCIA DE 36.960 M HASTA EL VÉRTICE 4 PASANDO POR EL VÉRTICE 3, SIENDO EL LINDERO ABIERTO Y COLINDA CON UN CENTRO DE INVESTIGACIÓN, SE CONTINUA DEL VÉRTICE 4 CON RUMBO NORESTE EN LÍNEA RECTA Y UNA DISTANCIA DE 20.50 M HASTA EL VÉRTICE 1 Y COLINDA CON CALLE PRIVADA."))
      .toEqual([["Sureste", "63.14", "PERSONA A"], ["Noroeste", "36.96", "UN CENTRO DE INVESTIGACIÓN"], ["Noreste", "20.50", "CALLE PRIVADA"]]);
  });

  test("recorrido con quiebres dentro de un tramo y una distancia sin unidad", () => {
    expect(filasDe("SE INICIA EL RECORRIDO DEL VÉRTICE 1 CON RUMBO NOROESTE Y UNA DISTANCIA DE 4.645 HASTA EL VERTICE 7 Y COLINDA CON DERECHO DE VIA, SE CONTINUA CON EL RECORRIDO DEL VERTICE 13 CON UN RUMBO SURESTE EN LINEA QUEBRADA Y UNA DISTANCIA DE 100.560 M HASTA EL VERTICE 26, PASANDO POR LOS VERTICES 1, 15 Y 25 DEL VERICE 26 HACE UN QUIEBRE CON UN RUMBO NORESTE EN LINEA QUEBRADA Y UNA DISTANCIA DE 22.219 M HASTA EL VERTICE 31 DEL VERTICE 31 HACE UN QUIEBRE CON RUMBO ESTE EN LINEA RECTA Y UNA DISTANCIA DE 24.837 M, HASTA EL VERTICE 1, SIENDO LOS LINDEROS, LINDERO ABIERTO Y EL TALUD DE CORTE Y COLINDA CON PERSONA A, PERSONA B Y PERSONA C"))
      .toEqual([["Noroeste", "4.65", "DERECHO DE VIA"], ["Sureste", "100.56", "PERSONA A, PERSONA B Y PERSONA C"],
        ["Noreste", "22.22", "PERSONA A, PERSONA B Y PERSONA C"], ["Este", "24.84", "PERSONA A, PERSONA B Y PERSONA C"]]);
  });

  test("si no se puede ordenar con seguridad (una cifra sin unidad), se muestra el texto completo por lados, sin cortar", () => {
    const texto = "AL NOROESTE EN LINEA QUEBRADA QUE DE ORIENTE A PONIENTE MIDE 6.17 M VA AL NOROESTE EN 1.20 M Y TERMINA EN 18.58 M AL PONIENTE LINDANDO CON PROPIEDAD DE PERSONA A AL SURESTE EN LINEA QUEBRADA TAMBIEN QUE DA ORIENTE A PONIENTE MIDE 2.43 BAJA EN 0.65 M AL SUR SIGUE AL PONIENTE EN 6.60 M LINDANDO CON PERSONA B";
    expect(leerColindancias(texto).seguro).toBe(false);
    const f = { clave: "140100102020030", municipio: "14", consultado_en: "2026-11-06T18:00:00Z", expediente: "completo", geometria: null, latitud: null,
      longitud: null, campos: { rppc_medid_colind: texto } } as Ficha;
    const s = seccionesDeFicha(f).find((x) => x.id === "medidas")!;
    expect(s.titulo).toBe("Medidas y colindancias (Registro Público)");
    expect(s.tablas).toBeUndefined();
    expect(s.filas[0][1].replaceAll("\n", " ").replaceAll(" ", "")).toBe(texto.replaceAll(" ", ""));
  });

  test("la ficha usa la tabla cuando se puede, y las medidas sueltas solo si dicen otra cosa", () => {
    const mc = "AL NORTE 8.00 M CON LOTE 4; AL SUR 8.00 M CON CALLE SOR JUANA INÉS DE LA CRUZ; AL ORIENTE 20.00 M CON LOTE 36; AL PONIENTE 20.00 M CON LOTE 38";
    const f = { clave: "140100117387037", municipio: "14", consultado_en: "2026-11-06T18:00:00Z", expediente: "completo", geometria: null, latitud: null,
      longitud: null, campos: { rppc_medid_colind: mc, rppc_medidas: mc } } as Ficha;
    const s = seccionesDeFicha(f).find((x) => x.id === "medidas")!;
    expect(s.tablas?.[0].encabezados).toEqual(["Orientación", "Medida (m)", "Colinda con"]);
    expect(s.tablas?.[0].filas[1]).toEqual(["Sur", "8.00", "CALLE SOR JUANA INÉS DE LA CRUZ"]);
    expect(s.filas).toEqual([]);
  });

  test("un texto de más de 500 caracteres de la fuente llega completo (antes se cortaba)", () => {
    const largo = Array.from({ length: 30 }, (_, i) => `AL NORTE ${i + 1}.00 M CON LOTE ${i + 1}`).join("; ");
    expect(largo.length).toBeGreaterThan(500);
    const r = limpiarExpediente({ predio: { claveCatastral: "140100141090006", datosRPPC: { medid_colind: largo } } });
    expect(r?.datos.rppc_medid_colind).toBe(largo);
  });
});

describe("medidas del polígono (catastro)", () => {
  test("rumbo por azimut, en ocho direcciones", () => {
    expect([0, 44, 46, 90, 135, 180, 225, 270, 315, 359].map(rumboDeAzimut)).toEqual(["N", "NE", "NE", "E", "SE", "S", "SO", "O", "NO", "N"]);
  });

  test("con la geometría UTM: un renglón por lado (sin vértices repetidos) y la superficie, exacto", () => {
    const utm = { type: "Polygon" as const, coordinates: [[[350000, 2280000], [350000, 2280020], [350000, 2280020], [350010, 2280020], [350010, 2280000], [350000, 2280000]]] as [number, number][][] };
    const geo = { type: "Polygon" as const, coordinates: [[[-100.4, 20.6], [-100.4, 20.6002], [-100.3999, 20.6002], [-100.3999, 20.6], [-100.4, 20.6]]] as [number, number][][] };
    const r = ladosDelPoligono(geo, utm)!;
    expect(r.aprox).toBe(false);
    expect(r.lados.map((l) => [l.lado, l.orientacion, Math.round(l.largo * 100) / 100])).toEqual([[1, "N", 20], [2, "E", 10], [3, "S", 20], [4, "O", 10]]);
    expect(Math.round(r.superficie!)).toBe(200);
  });

  test("sin la geometría UTM: de los grados, marcado aproximado; la ficha lo dice en el título y solo si el rol ve medidas", () => {
    const geo = { type: "Polygon" as const, coordinates: [[[-100.4, 20.6], [-100.4, 20.6002], [-100.3999, 20.6002], [-100.3999, 20.6], [-100.4, 20.6]]] as [number, number][][] };
    expect(ladosDelPoligono(geo, null)!.aprox).toBe(true);
    const base = { clave: "140100117387037", municipio: "14", consultado_en: "2026-11-06T18:00:00Z", expediente: "completo", geometria: geo, latitud: null,
      longitud: null, campos: {} } as unknown as Ficha;
    expect(seccionesDeFicha({ ...base, ve_medidas: false }).some((s) => s.id === "poligono")).toBe(false);
    const s = seccionesDeFicha({ ...base, ve_medidas: true }).find((x) => x.id === "poligono")!;
    expect(s.titulo).toBe("Medidas del polígono (catastro) (aprox.)");
    expect(s.tablas?.[0].encabezados).toEqual(["Lado", "Orientación", "Largo (m)"]);
    expect(s.tablas?.[0].filas).toHaveLength(4);
    expect(s.tablas?.[0].pie).toMatch(/^Superficie del polígono \(aprox\.\): /);
    // Sin colindancias en esta sección.
    expect(JSON.stringify(s)).not.toContain("Colinda");
  });
});

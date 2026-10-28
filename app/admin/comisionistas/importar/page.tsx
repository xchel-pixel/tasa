import { PantallaAdmin } from "@/components/pantalla-admin";
import { exigirRol } from "@/lib/sesion";
import { FormularioImportar } from "./formulario-importar";

export const metadata = { title: "Importar comisionistas — Tasa" };

/** Alta de muchos comisionistas a la vez, pegando la tabla desde una hoja de cálculo. */
export default async function ImportarComisionistas() {
  await exigirRol("admin_org");
  return (
    <PantallaAdmin titulo="Importar comisionistas" volver={{ href: "/admin/comisionistas", texto: "Comisionistas" }}>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Copia de tu hoja de cálculo las columnas, en este orden: <strong>nombre, correo</strong>, teléfono, <strong>RFC</strong>, factura
        (sí/no), porcentaje élite y tasa de bienvenida (sí/no, o el número de meses: solo administración puede pedir otro
        número que el de la organización). Nombre, correo y RFC (con su dígito verificador) son obligatorios; la constancia (CSF) queda pendiente y cada quien la sube desde su inicio. Quien no lleva bienvenida arranca en
        el nivel de arranque. Si copias el encabezado, se salta solo.
      </p>
      <p className="mt-2 text-[0.9375rem] leading-6 text-secundario">
        Nadie recibe correo al importarse: cada quien entra con su correo cuando le compartas la liga de Tasa. La liga
        personal de cada uno se arma con su nombre.
      </p>
      <FormularioImportar />
    </PantallaAdmin>
  );
}

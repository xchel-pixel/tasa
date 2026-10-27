import { leerAcceso } from "@/lib/acceso";
import type { EstadoAcceso } from "@/app/acciones";
import FormularioAcceso from "./formulario-acceso";

export const metadata = { title: "Entrar — Tasa" };

/**
 * La única pantalla que se ve sin sesión.
 *
 * Si este celular ya pidió un código, arranca directo en el campo del
 * código, aunque la pestaña se haya recargado mientras la persona
 * buscaba el correo.
 */
export default async function Entrar() {
  const acceso = await leerAcceso();

  const inicial: EstadoAcceso = acceso
    ? { ...acceso, paso: "codigo", error: null, aviso: null }
    : {
        paso: "correo",
        correo: "",
        error: null,
        aviso: null,
        pedido: null,
        reemplazo: false,
      };

  return <FormularioAcceso inicial={inicial} />;
}

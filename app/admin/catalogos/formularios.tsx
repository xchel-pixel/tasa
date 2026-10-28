"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { eliminar, guardarCuenta, guardarMarca, guardarServicio, subirLogo, type EstadoCatalogo } from "./acciones";

const INICIAL: EstadoCatalogo = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

export type Marca = {
  id: string;
  clave: string;
  nombre: string;
  color: string | null;
  cuenta_sugerida_id: string | null;
  activa: boolean;
  nombre_legal: string | null;
  direccion: string | null;
  correo: string | null;
  telefonos: string | null;
  firmante: string | null;
  firmante_cargo: string | null;
  formas_pago: string | null;
  color_acento: string | null;
  color_claro: string | null;
  tipografia: "adventor" | "manrope";
  hoja: "carta" | "oficio";
  logo_ruta: string | null;
  /** URL firmada para la vista previa (la arma la página). */
  logo_url?: string | null;
};
export type Cuenta = { id: string; alias: string; titular: string; banco: string | null; clabe: string; rfc: string | null; marca_id: string; activa: boolean };
export type Servicio = {
  id: string;
  nombre: string;
  activo: boolean;
  alcance: string | null;
  tiempo_entrega: string | null;
  documentos: string | null;
  aviso: string | null;
};

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="block text-[0.9375rem] font-semibold">
      {etiqueta}
      {children}
    </label>
  );
}

function Activa({ nombre, valor, texto }: { nombre: string; valor: boolean; texto: string }) {
  return (
    <label className="flex items-center gap-2 text-[0.9375rem]">
      <input type="checkbox" name={nombre} defaultChecked={valor} className="h-5 w-5 accent-primario" />
      {texto}
    </label>
  );
}

/** Borrar solo si nunca se usó; si no, la base lo impide y pide desactivar. */
function Borrar({ tabla, id }: { tabla: string; id: string }) {
  const [estado, enviar] = useActionState(eliminar, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-1">
      <input type="hidden" name="tabla" value={tabla} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="toque self-start text-[0.9375rem] font-semibold text-error underline underline-offset-4">
        Borrar (solo si nunca se usó)
      </button>
      <Aviso estado={estado} />
    </form>
  );
}

export function FormularioMarca({ marca, cuentas }: { marca?: Marca; cuentas: Cuenta[] }) {
  const [estado, enviar] = useActionState(guardarMarca, INICIAL);
  return (
    <div className="flex flex-col gap-3">
      <form action={enviar} className="flex flex-col gap-3">
        {marca ? <input type="hidden" name="id" value={marca.id} /> : null}
        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <Campo etiqueta="Clave">
            <input name="clave" required maxLength={10} defaultValue={marca?.clave} className={`${ENTRADA} uppercase`} />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" required maxLength={80} defaultValue={marca?.nombre} className={ENTRADA} />
          </Campo>
        </div>
        <Campo etiqueta="Cuenta que se sugiere al cotizar">
          <select name="cuenta_sugerida_id" defaultValue={marca?.cuenta_sugerida_id ?? ""} className={ENTRADA}>
            <option value="">Ninguna</option>
            {cuentas.filter((c) => !marca || c.marca_id === marca.id).map((c) => (
              <option key={c.id} value={c.id}>{c.alias}</option>
            ))}
          </select>
        </Campo>
        <div className="grid grid-cols-3 gap-2">
          <Campo etiqueta="Color">
            <input name="color" type="text" placeholder="#04386C" pattern="#[0-9a-fA-F]{6}" defaultValue={marca?.color ?? ""}
              className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Acento">
            <input name="color_acento" type="text" placeholder="#006DB3" pattern="#[0-9a-fA-F]{6}"
              defaultValue={marca?.color_acento ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Fondo claro">
            <input name="color_claro" type="text" placeholder="#E7F0F8" pattern="#[0-9a-fA-F]{6}"
              defaultValue={marca?.color_claro ?? ""} className={ENTRADA} />
          </Campo>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-linea p-3">
          <legend className="px-1 text-[0.9375rem] font-bold">Lo que imprime la cotización</legend>
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Tipografía">
              <select name="tipografia" defaultValue={marca?.tipografia ?? "adventor"} className={ENTRADA}>
                <option value="adventor">TeX Gyre Adventor</option>
                <option value="manrope">Manrope</option>
              </select>
            </Campo>
            <Campo etiqueta="Hoja">
              <select name="hoja" defaultValue={marca?.hoja ?? "carta"} className={ENTRADA}>
                <option value="carta">Carta</option>
                <option value="oficio">Oficio</option>
              </select>
            </Campo>
          </div>
          <Campo etiqueta="Razón social o nombre legal">
            <input name="nombre_legal" maxLength={160} defaultValue={marca?.nombre_legal ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Dirección (pie de página)">
            <input name="direccion" maxLength={200} defaultValue={marca?.direccion ?? ""} className={ENTRADA} />
          </Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Correo">
              <input name="correo" maxLength={120} defaultValue={marca?.correo ?? ""} className={ENTRADA} />
            </Campo>
            <Campo etiqueta="Teléfonos">
              <input name="telefonos" maxLength={120} defaultValue={marca?.telefonos ?? ""} className={ENTRADA} />
            </Campo>
          </div>
          <Campo etiqueta="Quién firma">
            <input name="firmante" maxLength={120} defaultValue={marca?.firmante ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Cargo de quien firma">
            <input name="firmante_cargo" maxLength={120} defaultValue={marca?.firmante_cargo ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Otras formas de pago (una por línea: Título | detalle)">
            <textarea name="formas_pago" rows={3} maxLength={1000} defaultValue={marca?.formas_pago ?? ""}
              placeholder="Efectivo | Al momento de la visita al inmueble." className={ENTRADA} />
          </Campo>
          <p className="text-[0.875rem] leading-5 text-secundario">
            La cuenta receptora del trabajo siempre va primero; estas se agregan después.
          </p>
        </fieldset>
        {marca ? <Activa nombre="activa" valor={marca.activa} texto="Activa (aparece al cotizar)" /> : null}
        <BotonEnviar variante="secundario">{marca ? "Guardar marca" : "Agregar marca"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {marca ? <Logo marca={marca} /> : null}
      {marca ? <Borrar tabla="marcas" id={marca.id} /> : null}
    </div>
  );
}

/** El logo va en su propio formulario: se sube aparte de los textos. */
function Logo({ marca }: { marca: Marca }) {
  const [estado, enviar] = useActionState(subirLogo, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-lg border border-linea p-3">
      <input type="hidden" name="id" value={marca.id} />
      <span className="text-[0.9375rem] font-bold">Logo de la cotización</span>
      {marca.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL firmada de un bucket privado
        <img src={marca.logo_url} alt={`Logo de ${marca.clave}`} className="max-h-16 self-start" />
      ) : (
        <span className="text-[0.875rem] text-secundario">Sin logo: la cotización imprime la clave de la marca.</span>
      )}
      <input name="logo" type="file" accept="image/png,image/jpeg" required className="text-[0.9375rem]" />
      <BotonEnviar variante="secundario" pendiente="Subiendo…">Subir logo</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function FormularioCuenta({ cuenta, marcas }: { cuenta?: Cuenta; marcas: Marca[] }) {
  const [estado, enviar] = useActionState(guardarCuenta, INICIAL);
  return (
    <div className="flex flex-col gap-3">
      <form action={enviar} className="flex flex-col gap-3">
        {cuenta ? <input type="hidden" name="id" value={cuenta.id} /> : null}
        <Campo etiqueta="Alias (la etiqueta corta en listas y reportes)">
          <input name="alias" required maxLength={30} defaultValue={cuenta?.alias} placeholder="Scotiabank XG" className={ENTRADA} />
        </Campo>
        <Campo etiqueta="Titular (solo se muestra junto a la CLABE)">
          <input name="titular" required maxLength={120} defaultValue={cuenta?.titular} className={ENTRADA} />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Banco">
            <input name="banco" maxLength={60} defaultValue={cuenta?.banco ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="RFC (opcional)">
            <input name="rfc" maxLength={13} defaultValue={cuenta?.rfc ?? ""} className={`${ENTRADA} uppercase`} />
          </Campo>
        </div>
        <Campo etiqueta="CLABE (18 dígitos)">
          <input name="clabe" required inputMode="numeric" maxLength={18} pattern="[0-9]{18}" defaultValue={cuenta?.clabe}
            className={`${ENTRADA} font-mono tracking-wider`} />
        </Campo>
        <Campo etiqueta="Marca">
          <select name="marca_id" required defaultValue={cuenta?.marca_id ?? ""} className={ENTRADA}>
            <option value="" disabled>Elige la marca</option>
            {marcas.map((m) => <option key={m.id} value={m.id}>{m.clave} · {m.nombre}</option>)}
          </select>
        </Campo>
        {cuenta ? <Activa nombre="activa" valor={cuenta.activa} texto="Activa (aparece al cotizar)" /> : null}
        <BotonEnviar variante="secundario">{cuenta ? "Guardar cuenta" : "Agregar cuenta"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {cuenta ? <Borrar tabla="cuentas_receptoras" id={cuenta.id} /> : null}
    </div>
  );
}

export function FormularioServicio({ servicio }: { servicio?: Servicio }) {
  const [estado, enviar] = useActionState(guardarServicio, INICIAL);
  return (
    <div className="flex flex-col gap-3">
      <form action={enviar} className="flex flex-col gap-3">
        {servicio ? <input type="hidden" name="id" value={servicio.id} /> : null}
        <Campo etiqueta="Nombre">
          <input name="nombre" required maxLength={80} defaultValue={servicio?.nombre} className={ENTRADA} />
        </Campo>
        <fieldset className="flex flex-col gap-3 rounded-lg border border-linea p-3">
          <legend className="px-1 text-[0.9375rem] font-bold">Lo que imprime la cotización</legend>
          <Campo etiqueta="Alcance">
            <textarea name="alcance" rows={3} maxLength={2000} defaultValue={servicio?.alcance ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Tiempo de entrega">
            <input name="tiempo_entrega" maxLength={300} defaultValue={servicio?.tiempo_entrega ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Documentos que se piden (uno por línea)">
            <textarea name="documentos" rows={3} maxLength={2000} defaultValue={servicio?.documentos ?? ""} className={ENTRADA} />
          </Campo>
          <Campo etiqueta="Importante (recuadro al final)">
            <textarea name="aviso" rows={3} maxLength={2000} defaultValue={servicio?.aviso ?? ""} className={ENTRADA} />
          </Campo>
        </fieldset>
        {servicio ? <Activa nombre="activo" valor={servicio.activo} texto="Activo (aparece al pedir una solicitud)" /> : null}
        <BotonEnviar variante="secundario">{servicio ? "Guardar servicio" : "Agregar servicio"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {servicio ? <Borrar tabla="servicios" id={servicio.id} /> : null}
    </div>
  );
}

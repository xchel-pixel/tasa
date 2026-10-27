"use client";

import { useActionState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { eliminar, guardarCuenta, guardarMarca, guardarServicio, type EstadoCatalogo } from "./acciones";

const INICIAL: EstadoCatalogo = { error: null, mensaje: null };
const ENTRADA =
  "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";

export type Marca = { id: string; clave: string; nombre: string; color: string | null; cuenta_sugerida_id: string | null; activa: boolean };
export type Cuenta = { id: string; alias: string; titular: string; banco: string | null; clabe: string; rfc: string | null; marca_id: string; activa: boolean };
export type Servicio = { id: string; nombre: string; activo: boolean };

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
        <Campo etiqueta="Color (opcional)">
          <input name="color" type="text" placeholder="#04386c" pattern="#[0-9a-fA-F]{6}" defaultValue={marca?.color ?? ""}
            className={`${ENTRADA} max-w-40`} />
        </Campo>
        {marca ? <Activa nombre="activa" valor={marca.activa} texto="Activa (aparece al cotizar)" /> : null}
        <BotonEnviar variante="secundario">{marca ? "Guardar marca" : "Agregar marca"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {marca ? <Borrar tabla="marcas" id={marca.id} /> : null}
    </div>
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
        {servicio ? <Activa nombre="activo" valor={servicio.activo} texto="Activo (aparece al pedir una solicitud)" /> : null}
        <BotonEnviar variante="secundario">{servicio ? "Guardar servicio" : "Agregar servicio"}</BotonEnviar>
        <Aviso estado={estado} />
      </form>
      {servicio ? <Borrar tabla="servicios" id={servicio.id} /> : null}
    </div>
  );
}

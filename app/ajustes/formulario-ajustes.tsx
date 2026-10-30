"use client";

import { useActionState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { fijarUltimoFolio, guardarAjustes, guardarOrigen, guardarPrefijo, usarConectorManual, type EstadoAjustes } from "./acciones";

const INICIAL: EstadoAjustes = { mensaje: null, error: null };
const ENTRADA =
  "mt-3 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

export default function FormularioAjustes({
  contacto,
  diaLimite,
  terminos,
  aviso,
  correoBienvenida,
  correoRechazo,
  slug,
  bonoEquipo,
  vigenciaReferidos,
  ligaPorTelefono,
  ligaPorConexion,
}: {
  contacto: string;
  diaLimite: number;
  terminos: string;
  aviso: string;
  correoBienvenida: string;
  correoRechazo: string;
  slug: string;
  bonoEquipo: boolean;
  vigenciaReferidos: number;
  ligaPorTelefono: number;
  ligaPorConexion: number;
}) {
  const [estado, enviar] = useActionState(guardarAjustes, INICIAL);

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-6">
      <div>
        <label htmlFor="contacto_soporte" className="block font-semibold">
          Contacto de soporte
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Correo o teléfono que ven los comisionistas y quien no está dado de alta cuando
          necesitan ayuda. Si es un correo, las respuestas a los correos de Tasa le llegan ahí. Vacío: no se muestra
          ningún contacto.
        </p>
        <input id="contacto_soporte" name="contacto_soporte" maxLength={120} defaultValue={contacto} className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="dia_limite_pago_comision" className="block font-semibold">
          Día límite para pagar comisiones
        </label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Día del mes siguiente al de las comisiones. Con 10, lo de septiembre vence el 10 de octubre; después
          sale en rojo en el inicio.
        </p>
        <input id="dia_limite_pago_comision" name="dia_limite_pago_comision" type="number" min={1} max={28} required
          defaultValue={diaLimite} className={`${ENTRADA} max-w-28`} />
      </div>

      <div>
        <label htmlFor="terminos" className="block font-semibold">Términos para los comisionistas</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          El texto que aceptan al entrar. Si lo cambias, cada comisionista tendrá que volver a aceptarlo antes de seguir usando Tasa.
        </p>
        <textarea id="terminos" name="terminos" rows={5} maxLength={20000} defaultValue={terminos} className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="aviso_privacidad" className="block font-semibold">Aviso de privacidad</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Se publica en /privacidad y se acepta al pedir el alta en /alta/{slug}. [ENLACE] y [FECHA] los llena Tasa
          (la dirección del aviso y el día en que guardas esta versión).
        </p>
        <textarea id="aviso_privacidad" name="aviso_privacidad" rows={5} maxLength={20000} defaultValue={aviso}
          className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="correo_bienvenida" className="block font-semibold">Correo de bienvenida</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Sale al aprobar una solicitud de alta. La primera línea &quot;Asunto: …&quot; es el asunto. Tasa llena [NOMBRE], [NIVEL Y %],
          [FECHA] y [CONTACTO DE SOPORTE].
        </p>
        <textarea id="correo_bienvenida" name="correo_bienvenida" rows={8} maxLength={5000} defaultValue={correoBienvenida}
          className={ENTRADA} />
      </div>

      <div>
        <label htmlFor="correo_rechazo" className="block font-semibold">Correo de rechazo</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          [MOTIVO OPCIONAL] es el motivo que escribas al rechazar; si no escribes, desaparece.
        </p>
        <textarea id="correo_rechazo" name="correo_rechazo" rows={4} maxLength={2000} defaultValue={correoRechazo}
          className={ENTRADA} />
      </div>

      <fieldset>
        <legend className="font-semibold">Límites de la liga de clientes (por día)</legend>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Antispam para quien llena la solicitud sin sesión. Al llegar al límite se le pide comunicarse con quien le pasó la
          liga y te llega una alerta, desde donde puedes liberar el teléfono.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-[0.9375rem]">
            Por teléfono
            <input name="liga_max_por_telefono" type="number" min={1} max={100} required defaultValue={ligaPorTelefono} className={ENTRADA} />
          </label>
          <label className="block text-[0.9375rem]">
            Por conexión
            <input name="liga_max_por_conexion" type="number" min={1} max={500} required defaultValue={ligaPorConexion} className={ENTRADA} />
          </label>
        </div>
      </fieldset>

      <div>
        <label htmlFor="referido_vigencia_meses" className="block font-semibold">Vigencia del bono de referidos (meses)</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Cuenta desde el primer trabajo pagado de cada referido. Cambiarla aplica a los referidos que todavía no arrancan;
          los que ya corren se ajustan uno por uno en la ficha del comisionista.
        </p>
        <input id="referido_vigencia_meses" name="referido_vigencia_meses" type="number" min={1} max={120} required
          defaultValue={vigenciaReferidos} className={ENTRADA} />
      </div>

      <label className="flex items-start gap-3 leading-6">
        <input type="checkbox" name="bono_referido_equipo" defaultChecked={bonoEquipo} className="mt-1 size-5 shrink-0 accent-primario" />
        <span>
          <span className="block font-semibold">Bono de referido para equipo</span>
          <span className="block text-[0.9375rem] text-secundario">
            Apagado: lo que invita el equipo es solo seguimiento. Encendido, además hay que darlo a cada persona en Equipo; el
            bono cuenta dentro del tope de 30%.
          </span>
        </span>
      </label>

      <Aviso estado={estado} />
      <BotonEnviar pendiente="Guardando…">Guardar</BotonEnviar>
    </form>
  );
}

/** El último folio real del año: sin él, con el conector manual no se acepta ningún trabajo. */
export function FormularioUltimoFolio({ anio, prefijo, ultimo }: { anio: number; prefijo: string; ultimo: number | null }) {
  const [estado, enviar] = useActionState(fijarUltimoFolio, INICIAL);
  return (
    <form action={enviar} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="anio" value={anio} />
      <label htmlFor="ultimo_folio" className="block font-semibold">Último folio real de {anio}</label>
      <p className="-mt-2 text-[0.9375rem] leading-6 text-secundario">
        {ultimo === null
          ? "Sin capturar: con el conector manual no se puede aceptar ningún trabajo hasta que escribas el último folio de la base de Trámites (0 si el año arranca)."
          : `Capturado: ${prefijo}-${anio}-${String(ultimo).padStart(4, "0")}. Con el conector manual, el siguiente será el ${String(ultimo + 1).padStart(4, "0")}. Con Notion, los folios los pone Notion.`}
      </p>
      <input id="ultimo_folio" name="ultimo" inputMode="numeric" required maxLength={4} defaultValue={ultimo ?? ""}
        className={`${ENTRADA.replace("mt-3 ", "")} max-w-40`} />
      <BotonEnviar variante="secundario">Guardar último folio</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** El prefijo de los folios que genera Tasa. */
export function FormularioPrefijo({ prefijo }: { prefijo: string }) {
  const [estado, enviar] = useActionState(guardarPrefijo, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-3">
      <label htmlFor="prefijo_folio" className="block font-semibold">Prefijo de folio</label>
      <p className="-mt-2 text-[0.9375rem] leading-6 text-secundario">
        Con el conector manual, Tasa pone el folio al aceptarse un trabajo: PREFIJO-AAAA-NNNN. Cambiarlo aplica a los
        siguientes; los que ya tienen folio no cambian.
      </p>
      <input id="prefijo_folio" name="prefijo_folio" required maxLength={6} defaultValue={prefijo}
        className={`${ENTRADA.replace("mt-3 ", "")} max-w-40 uppercase`} />
      <BotonEnviar variante="secundario">Guardar prefijo</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Volver a manual si el conector activo es otro (hoy solo manual está disponible). */
export function VolverAManual() {
  const [estado, enviar] = useActionState(usarConectorManual, INICIAL);
  return (
    <form action={enviar} className="mt-3 flex flex-col gap-2">
      <BotonEnviar variante="secundario">Usar el conector manual</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

/** Una fila del catálogo (nombre + activo) o, sin `id`, la de agregar. */
export function FilaOrigen({ id, nombre, activo }: { id?: string; nombre?: string; activo?: boolean }) {
  const [estado, enviar] = useActionState(guardarOrigen, INICIAL);
  return (
    <form action={enviar} className="flex flex-col gap-2 rounded-lg border border-linea px-3 py-3">
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="flex items-center gap-2">
        <label htmlFor={`origen-${id ?? "nuevo"}`} className="sr-only">Nombre</label>
        <input id={`origen-${id ?? "nuevo"}`} name="nombre" required maxLength={40} defaultValue={nombre}
          placeholder={id ? undefined : "Nuevo origen"}
          className="min-w-0 flex-1 rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento" />
        <div className="w-28 shrink-0"><BotonEnviar variante="secundario">{id ? "Guardar" : "Agregar"}</BotonEnviar></div>
      </div>
      {id ? (
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="activo" defaultChecked={activo} className="h-5 w-5 accent-primario" />
          Activo (aparece al registrar un pago)
        </label>
      ) : null}
      <Aviso estado={estado} />
    </form>
  );
}

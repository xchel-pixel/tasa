"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { accionAcceso, type EstadoAcceso } from "@/app/acciones";
import { Marca } from "@/components/marca";
import { useMontado } from "@/components/montado";
import { horaCorta } from "@/lib/formato";

// Sin `outline-none`: el aro de foco azul de globals.css es lo que dice
// en qué campo se está escribiendo.
const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

const LIGA =
  "toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4";

/**
 * Cada botón manda su propio `paso` en vez de un campo oculto: así
 * "Pedir un código nuevo" o "Ya tengo un código" usan el mismo correo
 * que está escrito en el formulario, sin copiarlo a otro.
 */
export default function FormularioAcceso({
  inicial,
}: {
  inicial: EstadoAcceso;
}) {
  const [estado, enviar] = useActionState(accionAcceso, inicial);

  return (
    <main className="flex flex-1 flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <h1>
          <Marca alto={72} prioridad />
        </h1>
        <p className="mt-2 text-[0.9375rem] text-secundario">
          Portal de comisionistas
        </p>

        <form action={enviar} className="mt-10 flex flex-col gap-4">
          {estado.paso === "codigo" ? (
            <PasoCodigo estado={estado} />
          ) : (
            <PasoCorreo estado={estado} />
          )}
        </form>
      </div>
    </main>
  );
}

function PasoCorreo({ estado }: { estado: EstadoAcceso }) {
  return (
    <>
      <div>
        <label htmlFor="correo" className="block font-semibold">
          Tu correo
        </label>
        <input
          id="correo"
          name="correo"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          autoFocus
          defaultValue={estado.correo}
          className={ENTRADA}
        />
      </div>

      <Errores estado={estado} />

      <Boton paso="correo">Enviar código</Boton>

      {/*
        Para quien vuelve por otro camino —otro navegador, la liga de su
        app de correo— y ya tiene un código en la mano. Pedir otro sería
        invalidar el que tiene.
      */}
      <button
        type="submit"
        name="paso"
        value="ya-tengo"
        formNoValidate
        className={`${LIGA} self-start`}
      >
        Ya tengo un código
      </button>
    </>
  );
}

function PasoCodigo({ estado }: { estado: EstadoAcceso }) {
  const montado = useMontado();

  /*
   * El correo queda fijo si esta pantalla mandó el código. Si se llegó
   * por "Ya tengo un código", hay que escribirlo: no sabemos a cuál
   * llegó.
   */
  const correoFijo = Boolean(estado.correo) && estado.pedido !== null;

  /*
   * La hora en la zona del celular: lo que importa es
   * compararla contra la bandeja de entrada. Solo después de hidratar,
   * porque el servidor no sabe en qué zona está el teléfono.
   */
  const hora =
    montado && estado.pedido ? horaDelCelular(estado.pedido) : null;

  const cuando = hora ? ` a las ${hora}` : "";

  return (
    <>
      <input type="hidden" name="pedido" value={estado.pedido ?? ""} />
      <input
        type="hidden"
        name="reemplazo"
        value={estado.reemplazo ? "si" : ""}
      />

      {correoFijo ? (
        <input type="hidden" name="correo" value={estado.correo} />
      ) : (
        <div>
          <label htmlFor="correo" className="block font-semibold">
            Tu correo
          </label>
          <input
            id="correo"
            name="correo"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            autoFocus={!estado.correo}
            defaultValue={estado.correo}
            className={ENTRADA}
          />
        </div>
      )}

      <div>
        <label htmlFor="codigo" className="block font-semibold">
          Código
        </label>

        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          {!correoFijo ? (
            <>
              El que te llegó por correo. Si pediste más de uno, solo sirve
              el más reciente.
            </>
          ) : estado.reemplazo ? (
            <>
              Te mandamos un código nuevo a {estado.correo}
              {cuando}.{" "}
              <strong className="text-texto">
                El anterior ya no sirve: usa el del correo más reciente.
              </strong>
            </>
          ) : (
            <>
              Te lo mandamos a {estado.correo}
              {cuando}. Revisa correo no deseado.
            </>
          )}
        </p>

        <input
          id="codigo"
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus={Boolean(estado.correo)}
          className="mt-3 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-center text-[2rem] tracking-[0.3em] focus:border-acento"
        />
      </div>

      <Errores estado={estado} />

      <Boton paso="codigo">Entrar</Boton>

      {/*
        Dos acciones que antes eran un solo botón. Pedir otro código
        invalida el anterior, así que se advierte ANTES de tocarlo: es
        la forma en que alguien termina con tres códigos y ninguno
        sirve.
      */}
      <div className="mt-2">
        <button
          type="submit"
          name="paso"
          value="nuevo"
          formNoValidate
          className={LIGA}
        >
          Pedir un código nuevo
        </button>
        <p className="text-[0.9375rem] leading-6 text-secundario">
          El que ya te mandamos deja de servir. Si ya te llegó, úsalo.
        </p>
      </div>

      {correoFijo ? (
        <button
          type="submit"
          name="paso"
          value="otro"
          formNoValidate
          className={`${LIGA} self-start`}
        >
          Usar otro correo
        </button>
      ) : null}
    </>
  );
}

/**
 * "2026-09-21T19:14:00Z" → "1:14 pm" en la zona del teléfono. Con el
 * mismo formato que el resto de la aplicación, y sin el "p.m." de
 * `toLocaleTimeString`, que choca con el punto final de la oración.
 */
function horaDelCelular(iso: string): string {
  const momento = new Date(iso);
  return horaCorta(`${momento.getHours()}:${momento.getMinutes()}`);
}

function Errores({ estado }: { estado: EstadoAcceso }) {
  return (
    <>
      {estado.aviso ? (
        <p className="rounded-lg bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6 text-proceso">
          {estado.aviso}
        </p>
      ) : null}

      {estado.error ? (
        <p className="text-[0.9375rem] leading-6 text-error">
          {estado.error}
        </p>
      ) : null}
    </>
  );
}

/**
 * El botón principal de cada paso. Es el primero del formulario, así
 * que es el que manda la tecla Enter del teclado.
 */
function Boton({
  paso,
  children,
}: {
  paso: "correo" | "codigo";
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="paso"
      value={paso}
      disabled={pending}
      className="min-h-12 w-full rounded-lg bg-primario px-4 py-3 text-[1.0625rem] font-semibold text-sobre-primario disabled:opacity-50"
    >
      {pending ? "Un momento…" : children}
    </button>
  );
}

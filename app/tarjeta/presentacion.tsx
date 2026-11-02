"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { ICONOS_SERVICIO, Icono } from "@/components/iconos-tarjeta";
import { urlImagenTarjeta } from "@/components/tarjeta-vista";
import { pesos } from "@/lib/formato";
import { crearClienteNavegador } from "@/lib/supabase/client";
import {
  borrarDeMiTarjeta,
  guardarInmueble,
  guardarRedes,
  guardarServicio,
  ordenarMiTarjeta,
  type EstadoTarjeta,
} from "./acciones";
import { prepararImagen } from "./imagen";

const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const NIVELES = ["", "Enlace", "Aliado", "Socio", "Socio Plus"];
const INICIAL: EstadoTarjeta = { error: null, mensaje: null };

export type ServicioEditable = {
  id: string;
  titulo: string;
  descripcion: string | null;
  icono: string;
  enlace: string | null;
  oculto_motivo: string | null;
};
export type InmuebleEditable = {
  id: string;
  titulo: string;
  operacion: "venta" | "renta";
  precio: number | null;
  zona: string;
  foto_ruta: string;
  enlace: string | null;
  oculto_motivo: string | null;
};
/** Cuántos muestra cada nivel (índice 1 a 4), como lo dice la base (`limite_tarjeta`). */
export type Limites = { servicio: number[]; inmueble: number[] };

/**
 * Qué se ve y qué no de una lista, en su orden: lo oculto por Administración no cuenta; de lo demás,
 * lo que pasa del límite de su nivel se oculta y se dice qué nivel lo recupera.
 */
function porNivel<T extends { oculto_motivo: string | null }>(lista: T[], limites: number[], nivel: number) {
  let lugar = 0;
  return lista.map((x) => {
    if (x.oculto_motivo) return { x, nivel: null as string | null };
    const p = lugar++;
    if (p < limites[nivel]) return { x, nivel: null };
    const recupera = [1, 2, 3, 4].find((n) => n > nivel && limites[n] > p);
    return { x, nivel: recupera ? NIVELES[recupera] : "un nivel más alto" };
  });
}

/**
 * Lista que se ordena arrastrando desde la agarradera (con el dedo o el mouse, sin librerías) o con
 * las flechas ↑↓, que también sirven con teclado y lector de pantalla. Al soltar se guarda el orden.
 */
function ListaOrdenable<T extends { id: string }>({
  elementos,
  tipo,
  render,
}: {
  elementos: T[];
  tipo: "servicio" | "inmueble";
  render: (x: T, i: number) => React.ReactNode;
}) {
  const [lista, setLista] = useState(elementos);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  const [estado, setEstado] = useState<EstadoTarjeta>(INICIAL);
  const [, guardando] = useTransition();
  const filas = useRef<(HTMLLIElement | null)[]>([]);
  const actual = useRef<number | null>(null);
  // El orden vivo durante el arrastre (lo mantiene `mover`; el estado solo pinta).
  const listaRef = useRef(elementos);
  // El orden es local mientras se arrastra; el contenido, siempre el más reciente (p. ej. después de editar).
  const porId = new Map(elementos.map((x) => [x.id, x]));

  const guardar = (nueva: T[]) =>
    guardando(async () => setEstado(await ordenarMiTarjeta(tipo, nueva.map((x) => x.id))));
  const mover = (de: number, a: number) => {
    if (a < 0 || a >= listaRef.current.length || de === a) return listaRef.current;
    const nueva = [...listaRef.current];
    const [x] = nueva.splice(de, 1);
    nueva.splice(a, 0, x);
    setLista(nueva);
    listaRef.current = nueva;
    return nueva;
  };

  function alMover(e: React.PointerEvent) {
    const i = actual.current;
    if (i === null) return;
    const y = e.clientY;
    const abajo = filas.current[i + 1]?.getBoundingClientRect();
    const arriba = filas.current[i - 1]?.getBoundingClientRect();
    if (abajo && y > abajo.top + abajo.height / 2) {
      mover(i, i + 1);
      actual.current = i + 1;
      setArrastrando(i + 1);
    } else if (arriba && y < arriba.top + arriba.height / 2) {
      mover(i, i - 1);
      actual.current = i - 1;
      setArrastrando(i - 1);
    }
  }

  function alSoltar() {
    if (actual.current === null) return;
    actual.current = null;
    setArrastrando(null);
    guardar(listaRef.current);
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {lista.map((x, i) => (
          <li key={x.id} ref={(el) => { filas.current[i] = el; }}
            className={`rounded-lg border bg-fondo ${arrastrando === i ? "border-acento shadow-md" : "border-linea"}`}>
            <div className="flex items-start gap-2 px-2 py-2">
              <div className="flex shrink-0 flex-col items-center">
                <button type="button" aria-label="Subir" disabled={i === 0} onClick={() => guardar(mover(i, i - 1))}
                  className="toque size-8 rounded text-secundario disabled:opacity-30">↑</button>
                <span
                  role="presentation"
                  title="Arrastra para ordenar"
                  className="flex h-8 w-8 cursor-grab touch-none select-none items-center justify-center text-[1.25rem] text-secundario active:cursor-grabbing"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    actual.current = i;
                    setArrastrando(i);
                  }}
                  onPointerMove={alMover}
                  onPointerUp={alSoltar}
                  onPointerCancel={alSoltar}
                >
                  ⠿
                </span>
                <button type="button" aria-label="Bajar" disabled={i === lista.length - 1} onClick={() => guardar(mover(i, i + 1))}
                  className="toque size-8 rounded text-secundario disabled:opacity-30">↓</button>
              </div>
              <div className="min-w-0 flex-1">{render(porId.get(x.id) ?? x, i)}</div>
            </div>
          </li>
        ))}
      </ul>
      {estado.error ? <p className="mt-2 text-[0.9375rem] text-error">{estado.error}</p> : null}
    </>
  );
}

function Borrar({ tipo, id }: { tipo: "servicio" | "inmueble"; id: string }) {
  const [pendiente, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button type="button" disabled={pendiente}
        onClick={() => {
          if (!confirm(tipo === "servicio" ? "¿Borrar este servicio?" : "¿Borrar este inmueble y su foto?")) return;
          empezar(async () => setError((await borrarDeMiTarjeta(tipo, id)).error));
        }}
        className="toque text-[0.9375rem] font-semibold text-error">
        {pendiente ? "Borrando…" : "Borrar"}
      </button>
      {error ? <p className="text-[0.875rem] text-error">{error}</p> : null}
    </>
  );
}

function Ocultos({ motivo, nivel }: { motivo: string | null; nivel: string | null }) {
  if (motivo) return <p className="mt-1 text-[0.875rem] leading-5 text-error">Oculto por Administración: {motivo}</p>;
  if (nivel) return <p className="mt-1 text-[0.875rem] leading-5 text-proceso">Oculto por tu nivel: se vuelve a ver en {nivel}.</p>;
  return null;
}

// ------------------------------------------------------------
// Redes y posición del bloque del despacho
// ------------------------------------------------------------

export function FormularioRedes({
  redes,
  despachoArriba,
}: {
  redes: { facebook: string | null; instagram: string | null; tiktok: string | null; linkedin: string | null; sitio: string | null };
  despachoArriba: boolean;
}) {
  const [estado, enviar] = useActionState(guardarRedes, INICIAL);
  const campos = [
    ["facebook", "Facebook", "https://facebook.com/…"],
    ["instagram", "Instagram", "https://instagram.com/…"],
    ["tiktok", "TikTok", "https://tiktok.com/@…"],
    ["linkedin", "LinkedIn", "https://linkedin.com/in/…"],
    ["sitio", "Sitio web", "https://…"],
  ] as const;
  return (
    <form action={enviar} className="flex flex-col gap-3">
      {campos.map(([nombre, etiqueta, ejemplo]) => (
        <label key={nombre} className="block text-[0.9375rem]">
          <span className="flex items-center gap-2 font-semibold"><Icono clave={nombre} className="size-5" />{etiqueta}</span>
          <input name={nombre} type="url" inputMode="url" maxLength={300} placeholder={ejemplo} defaultValue={redes[nombre] ?? ""} className={ENTRADA} />
        </label>
      ))}
      <fieldset>
        <legend className="font-semibold">Bloque &quot;Avalúos y valuación · despacho aliado&quot;</legend>
        <p className="text-[0.875rem] leading-5 text-secundario">Siempre se ve. Tú eliges si va arriba o abajo de tus servicios.</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["arriba", "abajo"] as const).map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-2 rounded-lg border border-linea px-3">
              <input type="radio" name="despacho" value={p} defaultChecked={(p === "arriba") === despachoArriba} className="accent-primario" />
              {p === "arriba" ? "Arriba" : "Abajo"}
            </label>
          ))}
        </div>
      </fieldset>
      <BotonEnviar variante="secundario" pendiente="Guardando…">Guardar redes</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

// ------------------------------------------------------------
// Mis servicios
// ------------------------------------------------------------

function FormularioServicio({ s, alTerminar }: { s?: ServicioEditable; alTerminar?: () => void }) {
  const [estado, enviar] = useActionState(async (previo: EstadoTarjeta, datos: FormData) => {
    const r = await guardarServicio(previo, datos);
    if (!r.error) alTerminar?.();
    return r;
  }, INICIAL);
  const [icono, setIcono] = useState(s?.icono ?? "casa");
  const [descripcion, setDescripcion] = useState(s?.descripcion ?? "");
  return (
    <form action={enviar} className="flex flex-col gap-3">
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <input type="hidden" name="icono" value={icono} />
      <label className="block text-[0.9375rem]">
        <span className="font-semibold">Título</span>
        <input name="titulo" required minLength={2} maxLength={60} defaultValue={s?.titulo ?? ""} placeholder="p. ej. Venta de casas" className={ENTRADA} />
      </label>
      <label className="block text-[0.9375rem]">
        <span className="font-semibold">Descripción corta</span>
        <textarea name="descripcion" rows={2} maxLength={160} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={ENTRADA} />
        <span className="text-[0.8125rem] text-secundario">{descripcion.length}/160</span>
      </label>
      <fieldset>
        <legend className="text-[0.9375rem] font-semibold">Ícono</legend>
        <div className="mt-1 grid grid-cols-6 gap-1">
          {ICONOS_SERVICIO.map((i) => (
            <button key={i.clave} type="button" aria-label={i.nombre} aria-pressed={icono === i.clave} title={i.nombre}
              onClick={() => setIcono(i.clave)}
              className={`flex h-11 items-center justify-center rounded-lg border ${icono === i.clave ? "border-acento bg-tinte text-primario" : "border-linea"}`}>
              <Icono clave={i.clave} />
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-[0.9375rem]">
        <span className="font-semibold">Enlace <span className="font-normal text-secundario">(opcional)</span></span>
        <input name="enlace" type="url" inputMode="url" maxLength={300} defaultValue={s?.enlace ?? ""} placeholder="https://…" className={ENTRADA} />
      </label>
      <BotonEnviar variante="secundario" pendiente="Guardando…">{s ? "Guardar servicio" : "Agregar servicio"}</BotonEnviar>
      <Aviso estado={estado} />
    </form>
  );
}

export function MisServicios({
  servicios,
  limites,
  nivel,
}: {
  servicios: ServicioEditable[];
  limites: Limites;
  nivel: number;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const tope = limites.servicio[nivel];
  const marcas = new Map(porNivel(servicios, limites.servicio, nivel).map((m) => [m.x.id, m.nivel]));
  return (
    <div className="flex flex-col gap-4">
      {servicios.length > 0 ? (
        <ListaOrdenable
          key={servicios.map((s) => s.id).join()}
          elementos={servicios}
          tipo="servicio"
          render={(s) =>
            editando === s.id ? (
              <>
                <FormularioServicio s={s} alTerminar={() => setEditando(null)} />
                <button type="button" onClick={() => setEditando(null)} className="toque mt-2 text-[0.9375rem] text-secundario">Cancelar</button>
              </>
            ) : (
              <div>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-primario"><Icono clave={s.icono} className="size-5" /></span>
                  <div className="min-w-0">
                    <p className="font-semibold">{s.titulo}</p>
                    {s.descripcion ? <p className="text-[0.9375rem] leading-6 text-secundario">{s.descripcion}</p> : null}
                    {s.enlace ? <p className="truncate text-[0.875rem] text-acento">{s.enlace}</p> : null}
                  </div>
                </div>
                <Ocultos motivo={s.oculto_motivo} nivel={marcas.get(s.id) ?? null} />
                <div className="mt-1 flex gap-4">
                  <button type="button" onClick={() => setEditando(s.id)} className="toque text-[0.9375rem] font-semibold text-acento">Editar</button>
                  <Borrar tipo="servicio" id={s.id} />
                </div>
              </div>
            )
          }
        />
      ) : null}
      {servicios.length < tope ? (
        <details className="rounded-lg border border-linea px-3 py-2">
          <summary className="toque cursor-pointer font-semibold text-acento">Agregar servicio</summary>
          <div className="mt-3"><FormularioServicio key={servicios.length} /></div>
        </details>
      ) : (
        <p className="text-[0.9375rem] leading-6 text-secundario">
          Llegaste a {tope} servicios, lo que permite tu nivel.
          {nivel < 4 ? ` Sube de nivel para agregar más (Aliado 6, Socio Plus sin límite).` : ""}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Portafolio
// ------------------------------------------------------------

function FormularioInmueble({
  i,
  orgId,
  personaId,
  alTerminar,
}: {
  i?: InmuebleEditable;
  orgId: string;
  personaId: string;
  alTerminar?: () => void;
}) {
  const [foto, setFoto] = useState<string | null>(i?.foto_ruta ?? null);
  const [subiendo, setSubiendo] = useState(false);
  const [estado, setEstado] = useState<EstadoTarjeta>(INICIAL);
  const [pendiente, empezar] = useTransition();

  async function subir(archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(true);
    setEstado(INICIAL);
    try {
      const blob = await prepararImagen(archivo, "inmueble");
      const ruta = `${orgId}/${personaId}/${crypto.randomUUID()}.jpg`;
      const { error } = await crearClienteNavegador().storage.from("tarjetas").upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error("No se pudo subir la foto. Inténtalo otra vez.");
      setFoto(ruta);
    } catch (e) {
      setEstado({ error: e instanceof Error ? e.message : "No se pudo subir la foto.", mensaje: null });
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const precio = String(f.get("precio") ?? "").replace(/[$,\s]/g, "");
        empezar(async () => {
          const r = await guardarInmueble({
            id: i?.id ?? null,
            titulo: String(f.get("titulo") ?? "").trim(),
            operacion: f.get("operacion") === "renta" ? "renta" : "venta",
            precio: precio ? Number(precio) : null,
            zona: String(f.get("zona") ?? "").trim(),
            foto,
            enlace: String(f.get("enlace") ?? "").trim() || null,
          });
          setEstado(r);
          if (!r.error) alTerminar?.();
        });
      }}
    >
      <div>
        <span className="block text-[0.9375rem] font-semibold">Foto (se recorta a 4:3)</span>
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen pública del bucket de tarjetas
          <img src={urlImagenTarjeta(foto)!} alt="" className="mt-1 aspect-[4/3] w-full rounded-lg object-cover" />
        ) : null}
        <input type="file" accept="image/jpeg,image/png,image/webp" disabled={subiendo} onChange={(e) => subir(e.target.files?.[0])}
          className="mt-1 block w-full text-[0.9375rem] text-secundario file:mr-3 file:rounded-lg file:border file:border-borde-campo file:bg-fondo file:px-3 file:py-2 file:font-semibold file:text-primario" />
        {subiendo ? <p className="text-[0.875rem] text-secundario">Subiendo…</p> : null}
      </div>
      <label className="block text-[0.9375rem]">
        <span className="font-semibold">Título</span>
        <input name="titulo" required minLength={2} maxLength={80} defaultValue={i?.titulo ?? ""} placeholder="p. ej. Casa con jardín en Juriquilla" className={ENTRADA} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[0.9375rem]">
          <span className="font-semibold">Operación</span>
          <select name="operacion" defaultValue={i?.operacion ?? "venta"} className={ENTRADA}>
            <option value="venta">Venta</option>
            <option value="renta">Renta</option>
          </select>
        </label>
        <label className="block text-[0.9375rem]">
          <span className="font-semibold">Precio <span className="font-normal text-secundario">(opcional)</span></span>
          <input name="precio" inputMode="decimal" defaultValue={i?.precio ?? ""} className={ENTRADA} />
        </label>
      </div>
      <label className="block text-[0.9375rem]">
        <span className="font-semibold">Zona</span>
        <input name="zona" required minLength={2} maxLength={80} defaultValue={i?.zona ?? ""} placeholder="Colonia o fraccionamiento" className={ENTRADA} />
        <span className="text-[0.8125rem] text-secundario">Sin calle ni número: la dirección exacta no se publica.</span>
      </label>
      <label className="block text-[0.9375rem]">
        <span className="font-semibold">Enlace <span className="font-normal text-secundario">(opcional)</span></span>
        <input name="enlace" type="url" inputMode="url" maxLength={300} defaultValue={i?.enlace ?? ""} placeholder="https://…" className={ENTRADA} />
      </label>
      <button type="submit" disabled={pendiente || subiendo || !foto}
        className="min-h-12 rounded-lg border border-primario px-4 font-semibold text-primario disabled:opacity-50">
        {pendiente ? "Guardando…" : i ? "Guardar inmueble" : "Agregar inmueble"}
      </button>
      {!foto ? <p className="-mt-2 text-[0.875rem] text-secundario">Sube la foto para continuar.</p> : null}
      <Aviso estado={estado} />
    </form>
  );
}

export function Portafolio({
  inmuebles,
  limites,
  nivel,
  orgId,
  personaId,
}: {
  inmuebles: InmuebleEditable[];
  limites: Limites;
  nivel: number;
  orgId: string;
  personaId: string;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const tope = limites.inmueble[nivel];
  const marcas = new Map(porNivel(inmuebles, limites.inmueble, nivel).map((m) => [m.x.id, m.nivel]));
  return (
    <div className="flex flex-col gap-4">
      {inmuebles.length > 0 ? (
        <ListaOrdenable
          key={inmuebles.map((i) => i.id).join()}
          elementos={inmuebles}
          tipo="inmueble"
          render={(i) =>
            editando === i.id ? (
              <>
                <FormularioInmueble i={i} orgId={orgId} personaId={personaId} alTerminar={() => setEditando(null)} />
                <button type="button" onClick={() => setEditando(null)} className="toque mt-2 text-[0.9375rem] text-secundario">Cancelar</button>
              </>
            ) : (
              <div>
                <div className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagen pública del bucket de tarjetas */}
                  <img src={urlImagenTarjeta(i.foto_ruta)!} alt="" className="aspect-[4/3] w-24 shrink-0 rounded object-cover" />
                  <div className="min-w-0">
                    <p className="font-semibold">{i.titulo}</p>
                    <p className="text-[0.9375rem] text-secundario">
                      {i.operacion === "venta" ? "Venta" : "Renta"} · {i.zona}{i.precio ? ` · ${pesos(i.precio)}` : ""}
                    </p>
                  </div>
                </div>
                <Ocultos motivo={i.oculto_motivo} nivel={marcas.get(i.id) ?? null} />
                <div className="mt-1 flex gap-4">
                  <button type="button" onClick={() => setEditando(i.id)} className="toque text-[0.9375rem] font-semibold text-acento">Editar</button>
                  <Borrar tipo="inmueble" id={i.id} />
                </div>
              </div>
            )
          }
        />
      ) : null}
      {tope === 0 ? (
        <p className="text-[0.9375rem] leading-6 text-secundario">
          El portafolio está disponible desde Socio.{inmuebles.length > 0 ? " Lo que ya tienes se oculta mientras tanto (no se borra)." : ""}
        </p>
      ) : inmuebles.length < tope ? (
        <details className="rounded-lg border border-linea px-3 py-2">
          <summary className="toque cursor-pointer font-semibold text-acento">Agregar inmueble</summary>
          <div className="mt-3"><FormularioInmueble key={inmuebles.length} orgId={orgId} personaId={personaId} /></div>
        </details>
      ) : (
        <p className="text-[0.9375rem] leading-6 text-secundario">
          Llegaste a {tope} inmuebles, lo que permite tu nivel.{nivel < 4 ? " En Socio Plus no hay límite." : ""}
        </p>
      )}
    </div>
  );
}

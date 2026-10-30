"use client";

import { useActionState, useState } from "react";
import { Aviso } from "@/components/aviso";
import { BotonEnviar } from "@/components/boton-enviar";
import { TarjetaVista, urlImagenTarjeta } from "@/components/tarjeta-vista";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { guardarTarjeta, ponerImagen, type EstadoTarjeta } from "./acciones";

const ENTRADA = "mt-1 w-full rounded-lg border border-borde-campo bg-fondo px-3 py-2 text-[1rem] focus:border-acento";
const MAXIMO_BYTES = 2 * 1024 * 1024;
const NIVEL = { 2: "Aliado", 3: "Socio", 4: "Socio Plus" } as const;

export type TarjetaGuardada = {
  frase: string | null;
  telefono: string | null;
  correo: string | null;
  mostrar_correo: boolean;
  zona: string | null;
  foto_ruta: string | null;
  logo_ruta: string | null;
  color: string | null;
  servicios: string[];
};

/**
 * Recorta en el teléfono, sin librerías: la foto, al cuadrado del centro; el logo, entero dentro de
 * 512×512. Sale en 512 px (JPEG la foto, PNG el logo para conservar transparencia).
 */
async function prepararImagen(archivo: File, tipo: "foto" | "logo"): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(archivo.type)) {
    throw new Error("Usa una imagen JPG, PNG o WebP.");
  }
  const img = await createImageBitmap(archivo);
  const lado = 512;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  if (tipo === "foto") {
    const corte = Math.min(img.width, img.height);
    canvas.width = lado;
    canvas.height = lado;
    ctx.drawImage(img, (img.width - corte) / 2, (img.height - corte) / 2, corte, corte, 0, 0, lado, lado);
  } else {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  const blob = await new Promise<Blob | null>((ok) =>
    canvas.toBlob(ok, tipo === "foto" ? "image/jpeg" : "image/png", tipo === "foto" ? 0.85 : undefined)
  );
  if (!blob) throw new Error("No se pudo preparar la imagen.");
  if (blob.size > MAXIMO_BYTES) throw new Error("La imagen pesa más de 2 MB aun recortada: usa una más ligera.");
  return blob;
}

export function EditorTarjeta({
  inicial,
  nivel,
  nombre,
  org,
  orgId,
  personaId,
  codigo,
  servicios,
}: {
  inicial: TarjetaGuardada;
  nivel: number;
  nombre: string;
  org: string;
  orgId: string;
  personaId: string;
  codigo: string;
  servicios: { id: string; nombre: string }[];
}) {
  const [estado, enviar] = useActionState<EstadoTarjeta, FormData>(guardarTarjeta, { error: null, mensaje: null });
  const [frase, setFrase] = useState(inicial.frase ?? "");
  const [telefono, setTelefono] = useState(inicial.telefono ?? "");
  const [correo, setCorreo] = useState(inicial.correo ?? "");
  const [mostrarCorreo, setMostrarCorreo] = useState(inicial.mostrar_correo);
  const [zona, setZona] = useState(inicial.zona ?? "");
  const [color, setColor] = useState(inicial.color ?? "#04386C");
  const [elegidos, setElegidos] = useState<string[]>(inicial.servicios);
  const [foto, setFoto] = useState(inicial.foto_ruta);
  const [logo, setLogo] = useState(inicial.logo_ruta);
  const [imagenEstado, setImagenEstado] = useState<EstadoTarjeta>({ error: null, mensaje: null });
  const [subiendo, setSubiendo] = useState<"foto" | "logo" | null>(null);

  async function subir(tipo: "foto" | "logo", archivo: File | undefined) {
    if (!archivo) return;
    setSubiendo(tipo);
    setImagenEstado({ error: null, mensaje: null });
    try {
      const blob = await prepararImagen(archivo, tipo);
      const ruta = `${orgId}/${personaId}/${crypto.randomUUID()}.${tipo === "foto" ? "jpg" : "png"}`;
      const { error } = await crearClienteNavegador().storage.from("tarjetas").upload(ruta, blob, {
        contentType: tipo === "foto" ? "image/jpeg" : "image/png",
        upsert: false,
      });
      if (error) throw new Error("No se pudo subir la imagen. Inténtalo otra vez.");
      const r = await ponerImagen(tipo, ruta);
      setImagenEstado(r);
      if (!r.error) (tipo === "foto" ? setFoto : setLogo)(ruta);
    } catch (e) {
      setImagenEstado({ error: e instanceof Error ? e.message : "No se pudo subir la imagen.", mensaje: null });
    } finally {
      setSubiendo(null);
    }
  }

  const nombresServicios = servicios.filter((s) => elegidos.includes(s.id)).map((s) => s.nombre);
  const bloqueado = (desde: 2 | 3 | 4) => (
    <p className="text-[0.875rem] text-secundario">Disponible desde {NIVEL[desde]}. Si bajas de nivel, se oculta (no se borra).</p>
  );

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="font-bold">Vista previa</h2>
        <div className="mt-2">
          <TarjetaVista
            d={{
              nombre,
              frase: frase.trim() || null,
              telefono: telefono.replace(/\D/g, "").slice(-10) || null,
              correo: mostrarCorreo && correo.trim() ? correo.trim() : null,
              zona: zona.trim() || null,
              fotoUrl: urlImagenTarjeta(foto),
              logoUrl: nivel >= 2 ? urlImagenTarjeta(logo) : null,
              color: nivel >= 2 ? color : null,
              servicios: nivel >= 4 ? nombresServicios : [],
              testimonios: [],
            }}
            ligaSolicitud={`/s/${org}/${codigo}`}
            vcardHref={null}
            ligaPrivacidad={`/privacidad?org=${org}`}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-linea px-4 py-4">
        <h2 className="font-bold">Foto{nivel >= 2 ? " y logo" : ""}</h2>
        <label className="block text-[0.9375rem] font-semibold">
          Foto (se recorta al cuadrado, hasta 2 MB)
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={subiendo !== null}
            onChange={(e) => subir("foto", e.target.files?.[0])} className="mt-1 block w-full text-[0.9375rem]" />
        </label>
        {nivel >= 2 ? (
          <label className="block text-[0.9375rem] font-semibold">
            Tu logo (opcional)
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={subiendo !== null}
              onChange={(e) => subir("logo", e.target.files?.[0])} className="mt-1 block w-full text-[0.9375rem]" />
          </label>
        ) : (
          bloqueado(2)
        )}
        {subiendo ? <p className="text-[0.9375rem] text-secundario">Subiendo…</p> : null}
        <Aviso estado={imagenEstado} />
      </section>

      <form action={enviar} className="flex flex-col gap-3 rounded-xl border border-linea px-4 py-4">
        <h2 className="font-bold">Tus datos en la tarjeta</h2>
        <p className="text-[0.875rem] leading-5 text-secundario">
          Se ve como &quot;Asesor afiliado&quot;. No escribas perito, valuador ni los nombres de las marcas.
        </p>
        <label className="block text-[0.9375rem] font-semibold">
          Frase corta
          <input name="frase" maxLength={140} value={frase} onChange={(e) => setFrase(e.target.value)} className={ENTRADA}
            placeholder="Te ayudo con tu avalúo o cotización" />
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          WhatsApp (botón &quot;Escríbeme&quot;)
          <input name="telefono" type="tel" inputMode="tel" maxLength={20} value={telefono} onChange={(e) => setTelefono(e.target.value)}
            className={ENTRADA} />
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Correo <span className="font-normal text-secundario">(opcional)</span>
          <input name="correo" type="email" maxLength={120} value={correo} onChange={(e) => setCorreo(e.target.value)} className={ENTRADA} />
        </label>
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input type="checkbox" name="mostrar_correo" checked={mostrarCorreo} onChange={(e) => setMostrarCorreo(e.target.checked)}
            className="size-5 accent-primario" />
          Mostrar mi correo en la tarjeta
        </label>
        <label className="block text-[0.9375rem] font-semibold">
          Zona donde trabajas
          <input name="zona" maxLength={80} value={zona} onChange={(e) => setZona(e.target.value)} className={ENTRADA}
            placeholder="Querétaro y El Marqués" />
        </label>
        {nivel >= 2 ? (
          <label className="block text-[0.9375rem] font-semibold">
            Color
            <input name="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 block h-11 w-20" />
          </label>
        ) : (
          <>
            <input type="hidden" name="color" value={inicial.color ?? ""} />
            {bloqueado(2)}
          </>
        )}
        <fieldset>
          <legend className="text-[0.9375rem] font-semibold">Servicios destacados (hasta 6)</legend>
          {nivel >= 4 ? (
            <div className="mt-1 flex flex-col gap-1">
              {servicios.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-[0.9375rem]">
                  <input type="checkbox" name="servicios" value={s.id} checked={elegidos.includes(s.id)}
                    disabled={!elegidos.includes(s.id) && elegidos.length >= 6}
                    onChange={(e) => setElegidos((x) => (e.target.checked ? [...x, s.id] : x.filter((y) => y !== s.id)))}
                    className="size-5 accent-primario" />
                  {s.nombre}
                </label>
              ))}
            </div>
          ) : (
            <>
              {inicial.servicios.map((id) => <input key={id} type="hidden" name="servicios" value={id} />)}
              {bloqueado(4)}
            </>
          )}
        </fieldset>
        <Aviso estado={estado} />
        <BotonEnviar>Guardar tarjeta</BotonEnviar>
      </form>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { crearOrganizacion, type EstadoPlataforma } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

const aSlug = (t: string) =>
  t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function FormularioOrganizacion() {
  const [estado, enviar] = useActionState<EstadoPlataforma, FormData>(crearOrganizacion, { error: null, mensaje: null });
  const [nombre, setNombre] = useState("");

  return (
    <form action={enviar} className="mt-4 flex flex-col gap-5">
      <div>
        <label htmlFor="nombre" className="block font-semibold">Nombre</label>
        <input id="nombre" name="nombre" required maxLength={80} value={nombre}
          onChange={(e) => setNombre(e.target.value)} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="slug" className="block font-semibold">Slug</label>
        <input id="slug" name="slug" required key={aSlug(nombre)}
          defaultValue={aSlug(nombre)} className={ENTRADA} />
        <p className="mt-1 text-[0.9375rem] text-secundario">Va en su liga pública: …/s/slug/comisionista.</p>
      </div>
      <div>
        <label htmlFor="prefijo" className="block font-semibold">Prefijo de folio</label>
        <input id="prefijo" name="prefijo" required maxLength={6}
          className={`${ENTRADA} uppercase`} />
        <p className="mt-1 text-[0.9375rem] text-secundario">2 a 6 letras o números: PREFIJO-AAAA-NNNN.</p>
      </div>
      <div>
        <label htmlFor="admin_nombre" className="block font-semibold">Nombre de su administrador</label>
        <input id="admin_nombre" name="admin_nombre" required maxLength={120} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="admin_correo" className="block font-semibold">Correo de su administrador</label>
        <input id="admin_correo" name="admin_correo" type="email" required className={ENTRADA} />
        <p className="mt-1 text-[0.9375rem] text-secundario">Con ese correo entra; si ya existe en otra organización, se reutiliza.</p>
      </div>
      <Aviso estado={estado} />
      <BotonEnviar>Dar de alta la organización</BotonEnviar>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { BotonEnviar } from "@/components/boton-enviar";
import { Aviso } from "@/components/aviso";
import { CampoBienvenida } from "@/components/campo-bienvenida";
import type { TratosOrg } from "@/lib/tratos";
import { altaComisionista, type EstadoAlta } from "./acciones";

const ENTRADA =
  "mt-2 w-full rounded-lg border border-borde-campo bg-fondo px-4 py-3 text-[1.0625rem] focus:border-acento";

/** "José Ñúñez Pérez" → "jose-nunez-perez". */
function sugerirSlug(nombre: string) {
  return nombre
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export default function FormularioAlta({
  existentes,
  tratos,
  puedeCambiarMeses,
}: {
  existentes: { id: string; nombre: string; slug: string }[];
  tratos: TratosOrg;
  puedeCambiarMeses: boolean;
}) {
  const [estado, enviar] = useActionState<EstadoAlta, FormData>(altaComisionista, { error: null, mensaje: null });
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTocado, setSlugTocado] = useState(false);

  // Mientras no lo editen a mano, la liga sigue al nombre; si ya existe, le agrega un número.
  let sugerido = sugerirSlug(nombre);
  const usados = new Set(existentes.map((e) => e.slug));
  for (let n = 2; usados.has(sugerido); n++) sugerido = `${sugerirSlug(nombre)}-${n}`;
  const valorSlug = slugTocado ? slug : sugerido;

  return (
    <form action={enviar} className="mt-6 flex flex-col gap-5">
      <div>
        <label htmlFor="nombre" className="block font-semibold">Nombre completo</label>
        <input id="nombre" name="nombre" required maxLength={120} value={nombre}
          onChange={(e) => setNombre(e.target.value)} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="correo" className="block font-semibold">Correo</label>
        <input id="correo" name="correo" type="email" required autoComplete="off" className={ENTRADA} />
        <p className="mt-1 text-[0.9375rem] text-secundario">Con este correo entra al portal.</p>
      </div>
      <div>
        <label htmlFor="telefono" className="block font-semibold">
          Teléfono <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <input id="telefono" name="telefono" type="tel" inputMode="tel" maxLength={20} className={ENTRADA} />
      </div>
      <div>
        <label htmlFor="rfc" className="block font-semibold">
          RFC <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <input id="rfc" name="rfc" maxLength={20} autoCapitalize="characters" className={`${ENTRADA} uppercase`} />
      </div>
      <label className="flex items-start gap-3 text-[0.9375rem] leading-6">
        <input type="checkbox" name="emite_factura" className="mt-1 h-5 w-5 accent-primario" />
        Emite factura por sus comisiones
      </label>
      <div>
        <label htmlFor="slug" className="block font-semibold">Liga personal</label>
        <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
          Para su futura liga de solicitudes (todavía no se publica): …/s/<strong>{valorSlug || "…"}</strong>
        </p>
        <input id="slug" name="slug" required maxLength={40} value={valorSlug}
          onChange={(e) => { setSlugTocado(true); setSlug(e.target.value.toLowerCase()); }} className={ENTRADA} />
        <p className="mt-1 text-[0.9375rem] text-secundario">Minúsculas, números y guiones.</p>
      </div>
      <div>
        <label htmlFor="referido_por" className="block font-semibold">
          Referido por <span className="font-normal text-secundario">(opcional)</span>
        </label>
        <select id="referido_por" name="referido_por" defaultValue="" className={ENTRADA}>
          <option value="">Nadie</option>
          {existentes.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
      </div>

      <CampoBienvenida bienvenida={tratos.bienvenida} arranque={tratos.arranque} puedeCambiarMeses={puedeCambiarMeses} />

      <Aviso estado={estado} />
      <BotonEnviar>Dar de alta</BotonEnviar>
    </form>
  );
}

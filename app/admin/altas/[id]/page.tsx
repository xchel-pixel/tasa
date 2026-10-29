import Link from "next/link";
import { notFound } from "next/navigation";
import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { bienvenidaDe } from "@/lib/altas";
import { fechaCorta } from "@/lib/formato";
import { decisionDeAlta } from "@/lib/decidir-alta";
import { rfcValido } from "@/lib/limpiar";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { tratosDeLaOrg } from "@/lib/tratos";
import { ESTADOS, type EstadoAltaSolicitud } from "../estados";
import { CopiarWhatsApp, FormularioAprobar, FormularioRechazar, ReintentarCorreo } from "./formularios";

export const metadata = { title: "Solicitud de alta — Tasa" };

type Solicitud = {
  id: string;
  nombre: string;
  correo: string;
  telefono: string;
  rfc: string | null;
  curp: string | null;
  csf_ruta: string | null;
  csf_borrada_en: string | null;
  estado: EstadoAltaSolicitud | "subiendo";
  posible_duplicado: boolean;
  rfc_por_revisar: boolean;
  coincidencias: string[];
  aviso_aceptado_en: string | null;
  motivo: string | null;
  rfc_revisado_a_mano: boolean;
  persona_id: string | null;
  decidida_en: string | null;
  correo_enviado_en: string | null;
  correo_error: string | null;
  creada_en: string;
  capturo: { nombre: string } | null;
  decidio: { nombre: string } | null;
  referidor: { personas: { nombre: string } | null } | null;
  referidor_id: string | null;
  referidor_miembro_id: string | null;
  decidida_por_referidor: boolean;
  invito: { nombre: string } | null;
};

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-linea py-2 text-[0.9375rem]">
      <dt className="text-secundario">{titulo}</dt>
      <dd className="text-right font-semibold break-all">{children}</dd>
    </div>
  );
}

export default async function SolicitudDeAltaDetalle({ params }: { params: Promise<{ id: string }> }) {
  const persona = await exigirRol("admin_org", "finanzas");
  const { id } = await params;
  const supabase = await crearClienteServidor();
  const s = oExplota(
    await supabase
      .from("solicitudes_alta")
      .select(
        "id, nombre, correo, telefono, rfc, curp, csf_ruta, csf_borrada_en, estado, posible_duplicado, rfc_por_revisar, coincidencias, " +
          "aviso_aceptado_en, motivo, rfc_revisado_a_mano, persona_id, decidida_en, correo_enviado_en, correo_error, creada_en, " +
          "capturo:personas!solicitudes_alta_capturada_por_fkey(nombre), decidio:personas!solicitudes_alta_decidida_por_fkey(nombre), " +
          "referidor:comisionistas(personas(nombre)), referidor_id, referidor_miembro_id, decidida_por_referidor, " +
          "invito:personas!solicitudes_alta_referidor_miembro_id_fkey(nombre)"
      )
      .eq("id", id)
      .maybeSingle()
      .returns<Solicitud | null>(),
    "la solicitud de alta"
  );
  if (!s || s.estado === "subiendo") notFound();

  const esAdmin = persona.rol === "admin_org";
  const decision = decisionDeAlta(persona.rol, persona.id === s.referidor_id || persona.id === s.referidor_miembro_id);
  const rfcNoCuadra = s.rfc ? !rfcValido(s.rfc) : false;
  const [csf, tratos, bienvenida] = await Promise.all([
    s.csf_ruta ? supabase.storage.from("altas").createSignedUrl(s.csf_ruta, 600) : Promise.resolve(null),
    s.estado === "pendiente" && esAdmin ? tratosDeLaOrg(persona.organizacion.id) : Promise.resolve(null),
    s.estado === "aprobada" && s.persona_id ? bienvenidaDe(supabase, s.persona_id) : Promise.resolve(null),
  ]);

  return (
    <PantallaAdmin titulo={s.nombre} volver={{ href: "/admin/altas", texto: "Solicitudes de alta" }}>
      <div className="mt-2 flex flex-wrap gap-2">
        <Etiqueta tono={ESTADOS[s.estado].tono}>{ESTADOS[s.estado].texto}</Etiqueta>
        {s.posible_duplicado ? <Etiqueta tono="error">Posible duplicado</Etiqueta> : null}
        {s.rfc_por_revisar ? <Etiqueta tono="error">RFC por revisar</Etiqueta> : null}
        {!s.csf_ruta && !s.csf_borrada_en ? <Etiqueta tono="proceso">CSF pendiente</Etiqueta> : null}
      </div>

      {s.coincidencias.length ? (
        <div className="mt-4 rounded-lg border border-error bg-error-fondo px-4 py-3 text-[0.9375rem] leading-6">
          <p className="font-semibold">Coincide con:</p>
          <ul className="mt-1 list-disc pl-5">
            {s.coincidencias.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      ) : null}

      <dl className="mt-4">
        <Dato titulo="Correo">{s.correo}</Dato>
        <Dato titulo="Teléfono">{s.telefono}</Dato>
        <Dato titulo="RFC">
          {s.rfc ?? "—"}
          {rfcNoCuadra ? <span className="block font-normal text-error">El dígito verificador no cuadra</span> : null}
          {s.rfc_revisado_a_mano ? <span className="block font-normal text-secundario">Revisado a mano</span> : null}
        </Dato>
        {s.curp ? <Dato titulo="CURP">{s.curp}</Dato> : null}
        <Dato titulo="Llegó">{fechaCorta(s.creada_en)}{s.capturo ? `, capturada por ${s.capturo.nombre}` : ", por la liga"}</Dato>
        {s.referidor?.personas ? <Dato titulo="Lo refirió">{s.referidor.personas.nombre}</Dato> : null}
        {s.invito ? <Dato titulo="Lo invitó">{s.invito.nombre} (equipo)</Dato> : null}
        <Dato titulo="Aviso de privacidad">
          {s.aviso_aceptado_en ? `Aceptado el ${fechaCorta(s.aviso_aceptado_en)}` : "Lo acepta en su primer acceso"}
        </Dato>
        {s.decidida_en ? (
          <Dato titulo={s.estado === "aprobada" ? "Aprobada" : "Rechazada"}>
            {fechaCorta(s.decidida_en)}{s.decidio ? `, por ${s.decidio.nombre}` : ""}
          </Dato>
        ) : null}
        {s.motivo ? <Dato titulo="Motivo">{s.motivo}</Dato> : null}
        {s.decidida_por_referidor ? <Dato titulo="Ojo">La decidió quien la invitó</Dato> : null}
      </dl>

      <div className="mt-4">
        {csf && "data" in csf && csf.data ? (
          <a href={csf.data.signedUrl} target="_blank" rel="noopener"
            className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
            Ver la Constancia de Situación Fiscal
          </a>
        ) : s.csf_borrada_en ? (
          <p className="text-[0.9375rem] text-secundario">La constancia se borró el {fechaCorta(s.csf_borrada_en)} (90 días después del rechazo).</p>
        ) : s.csf_ruta ? (
          <p className="text-[0.9375rem] text-error">No se pudo abrir la constancia.</p>
        ) : (
          <p className="text-[0.9375rem] leading-6 text-secundario">
            Llegó sin constancia. Se puede aprobar igual; la sube después desde &quot;Mis datos&quot;.
          </p>
        )}
      </div>

      {s.estado === "pendiente" && decision.botones && tratos ? (
        <section className="mt-8">
          <h2 className="text-[1.125rem] font-bold">Aprobar</h2>
          {decision.aviso ? (
            <p className="mt-2 rounded-lg border border-proceso bg-proceso-fondo px-4 py-3 text-[0.9375rem] leading-6">{decision.aviso}</p>
          ) : null}
          <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">
            Crea su acceso y le manda el correo de bienvenida con su nivel inicial.
          </p>
          <FormularioAprobar id={s.id} tratos={tratos} rfcNoCuadra={rfcNoCuadra} />
          <FormularioRechazar id={s.id} />
        </section>
      ) : s.estado === "pendiente" ? (
        <p className="mt-8 text-[0.9375rem] leading-6 text-secundario">Administración la aprueba o la rechaza.</p>
      ) : null}

      {s.estado !== "pendiente" ? (
        <section className="mt-8">
          <h2 className="text-[1.125rem] font-bold">Correo</h2>
          {s.correo_enviado_en ? (
            <p className="mt-1 text-[0.9375rem] text-secundario">Enviado el {fechaCorta(s.correo_enviado_en)}.</p>
          ) : (
            <p className="mt-1 text-[0.9375rem] leading-6 text-error">No salió{s.correo_error ? `: ${s.correo_error}` : "."}</p>
          )}
          {!s.correo_enviado_en && esAdmin ? <ReintentarCorreo id={s.id} /> : null}
          {bienvenida ? <CopiarWhatsApp texto={bienvenida.texto} /> : null}
          {s.persona_id ? (
            <Link href={`/admin/comisionistas/${s.persona_id}`}
              className="toque mt-4 block text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
              Ver su ficha
            </Link>
          ) : null}
        </section>
      ) : null}
    </PantallaAdmin>
  );
}

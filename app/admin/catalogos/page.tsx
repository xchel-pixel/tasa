import { Etiqueta } from "@/components/etiqueta";
import { PantallaAdmin } from "@/components/pantalla-admin";
import { clabeValida } from "@/lib/clabe";
import { exigirRol } from "@/lib/sesion";
import { crearClienteServidor, oExplota } from "@/lib/supabase/server";
import { FormularioConvenio, PreciosConvenio, textoComision, type Convenio } from "./convenios";
import { FormularioCuenta, FormularioMarca, FormularioServicio, type Cuenta, type Marca, type Servicio } from "./formularios";

type FilaConvenio = Omit<Convenio, "precios" | "comision_pct"> & {
  comision_pct: string | number | null;
  convenio_precios: { id: string; servicio_id: string; marca_id: string | null; sin_costo: boolean; monto: string | number }[];
};

export const metadata = { title: "Catálogos — Tasa" };

/**
 * Marcas, cuentas receptoras, servicios y convenios de la organización.
 * Con esto una organización nueva ya puede cotizar. Lo que ya tiene trabajos no
 * se borra: se desactiva y deja de aparecer en lo nuevo.
 */
export default async function Catalogos() {
  await exigirRol("admin_org");
  const supabase = await crearClienteServidor();
  const [marcas, cuentas, servicios, convenios] = await Promise.all([
    supabase
      .from("marcas")
      .select(
        "id, clave, nombre, color, cuenta_sugerida_id, activa, nombre_legal, direccion, correo, telefonos, firmante, firmante_cargo, formas_pago, color_acento, color_claro, tipografia, hoja, logo_ruta"
      )
      .order("clave")
      .returns<Marca[]>(),
    supabase
      .from("cuentas_receptoras")
      .select("id, alias, titular, banco, clabe, rfc, marca_id, activa")
      .order("alias")
      .returns<Cuenta[]>(),
    supabase
      .from("servicios")
      .select("id, nombre, activo, alcance, tiempo_entrega, documentos, aviso, nombre_notion")
      .order("orden")
      .order("nombre")
      .returns<Servicio[]>(),
    supabase
      .from("convenios")
      .select("id, nombre, contacto, vigente_desde, vigente_hasta, notas, comision_regla, comision_pct, activo, convenio_precios(id, servicio_id, marca_id, sin_costo, monto)")
      .order("nombre")
      .returns<FilaConvenio[]>(),
  ]);
  const conLogo = oExplota(marcas, "las marcas") ?? [];
  // Vista previa del logo: URL firmada por una hora (el bucket es privado).
  const rutas = conLogo.flatMap((m) => (m.logo_ruta ? [m.logo_ruta] : []));
  const firmadas = rutas.length ? ((await supabase.storage.from("marcas").createSignedUrls(rutas, 3600)).data ?? []) : [];
  const listaMarcas = conLogo.map((m) => ({ ...m, logo_url: firmadas.find((x) => x.path === m.logo_ruta)?.signedUrl ?? null }));
  const listaCuentas = oExplota(cuentas, "las cuentas") ?? [];
  const listaServicios = oExplota(servicios, "los servicios") ?? [];
  const listaConvenios: Convenio[] = (oExplota(convenios, "los convenios") ?? []).map(({ convenio_precios, ...c }) => ({
    ...c,
    comision_pct: c.comision_pct === null ? null : Number(c.comision_pct),
    precios: convenio_precios.map((p) => ({ ...p, monto: Number(p.monto) })),
  }));
  const vigencia = (c: Convenio) =>
    c.vigente_desde || c.vigente_hasta ? ` · ${c.vigente_desde ?? "…"} a ${c.vigente_hasta ?? "…"}` : "";

  return (
    <PantallaAdmin titulo="Catálogos">
      <Seccion titulo="Marcas" detalle="Quien ejecuta el trabajo. Comparten comisionistas y niveles.">
        {listaMarcas.map((m) => (
          <Elemento key={m.id} titulo={`${m.clave} · ${m.nombre}`} inactivo={!m.activa} color={m.color}>
            <FormularioMarca marca={m} cuentas={listaCuentas} />
          </Elemento>
        ))}
        <Nuevo texto="Agregar marca"><FormularioMarca cuentas={listaCuentas} /></Nuevo>
      </Seccion>

      <Seccion titulo="Cuentas receptoras" detalle="A nombre de quién entra el dinero. La CLABE se valida con su dígito de control.">
        {listaCuentas.map((c) => (
          <Elemento
            key={c.id}
            titulo={c.alias}
            subtitulo={`${c.banco ?? "Banco por definir"} · ${listaMarcas.find((m) => m.id === c.marca_id)?.clave ?? ""}`}
            inactivo={!c.activa}
            aviso={clabeValida(c.clabe) ? null : "CLABE por corregir"}
          >
            <FormularioCuenta cuenta={c} marcas={listaMarcas} />
          </Elemento>
        ))}
        {listaMarcas.length === 0 ? (
          <p className="text-[0.9375rem] text-secundario">Primero agrega una marca.</p>
        ) : (
          <Nuevo texto="Agregar cuenta"><FormularioCuenta marcas={listaMarcas.filter((m) => m.activa)} /></Nuevo>
        )}
      </Seccion>

      <Seccion titulo="Servicios" detalle="Lo que el comisionista elige al pedir una solicitud.">
        {listaServicios.map((s) => (
          <Elemento key={s.id} titulo={s.nombre} inactivo={!s.activo}>
            <FormularioServicio servicio={s} />
          </Elemento>
        ))}
        <Nuevo texto="Agregar servicio"><FormularioServicio /></Nuevo>
      </Seccion>

      <Seccion titulo="Convenios" detalle="Precios pactados con un cliente o empresa y si generan comisión. El comisionista solo ve el precio de su trabajo.">
        {listaConvenios.map((c) => (
          <Elemento key={c.id} titulo={c.nombre} subtitulo={`${textoComision(c)}${vigencia(c)}`} inactivo={!c.activo}>
            <FormularioConvenio convenio={c} />
            <PreciosConvenio
              convenio={c}
              servicios={listaServicios.filter((s) => s.activo).map((s) => ({ id: s.id, nombre: s.nombre }))}
              marcas={listaMarcas.filter((m) => m.activa).map((m) => ({ id: m.id, nombre: m.clave }))}
            />
          </Elemento>
        ))}
        <Nuevo texto="Agregar convenio"><FormularioConvenio /></Nuevo>
      </Seccion>
    </PantallaAdmin>
  );
}

function Seccion({ titulo, detalle, children }: { titulo: string; detalle: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[1.125rem] font-bold">{titulo}</h2>
      <p className="mt-1 text-[0.9375rem] leading-6 text-secundario">{detalle}</p>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Elemento({
  titulo,
  subtitulo,
  inactivo,
  color,
  aviso,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  inactivo: boolean;
  color?: string | null;
  aviso?: string | null;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-xl border border-linea px-4 py-3">
      <summary className="toque flex cursor-pointer items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {color ? <span aria-hidden className="h-4 w-4 shrink-0 rounded-full border border-linea" style={{ backgroundColor: color }} /> : null}
          <span className="min-w-0">
            <span className="block font-semibold">{titulo}</span>
            {subtitulo ? <span className="block text-[0.875rem] text-secundario">{subtitulo}</span> : null}
          </span>
        </span>
        <span className="flex shrink-0 gap-1">
          {aviso ? <Etiqueta tono="proceso">{aviso}</Etiqueta> : null}
          {inactivo ? <Etiqueta tono="neutro">Inactiva</Etiqueta> : null}
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Nuevo({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-dashed border-borde-campo px-4 py-3">
      <summary className="toque cursor-pointer font-semibold text-acento">+ {texto}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

import Link from "next/link";
import { Contraible } from "@/components/contraible";
import { TarjetasTramite } from "@/components/lista-tramites";
import type { Persona } from "@/lib/sesion";
import { enCurso, leerTramites, ordenar, pendienteDeFolio, saldoDe, type Tramite } from "@/lib/tramites";

const MAXIMO = 5;

/**
 * El inicio del equipo y del staff en secciones contraíbles, para que en el celular no sea una
 * lista larga. Cada una muestra hasta 5 y lleva a la página con filtros. Quien opera (admin_org,
 * finanzas, admin_marca) ve por cotizar, folios y cobros de todos (su RLS); el equipo, solo lo
 * de su liga. "Mis trámites" es siempre lo atribuido a la liga de la persona.
 */
export async function SeccionesDeInicio({ persona, opera }: { persona: Persona; opera: boolean }) {
  const [mis, todos] = await Promise.all([
    leerTramites({ ligaDe: persona.id }),
    opera ? leerTramites({ conNombres: true }) : Promise.resolve(null),
  ]);
  const base = todos ?? mis;
  const misEnCurso = mis.filter(enCurso).sort(ordenar);
  const porCotizar = base.filter((t) => t.estado === "solicitada").sort(ordenar);
  const quieren = porCotizar.filter((t) => t.quiere_tramite).length;
  const sinFolio = base.filter(pendienteDeFolio).sort(ordenar);
  const porCobrar = base.filter((t) => saldoDe(t) > 0).sort(ordenar);
  // El honorario final lo fijan admin_org y finanzas: solo a ellos se les avisa.
  const fija = persona.rol === "admin_org" || persona.rol === "finanzas";
  const estimados = fija ? base.filter((t) => t.estimado_pendiente).sort(ordenar) : [];
  const ruta = opera ? "/admin/tramites" : "/mis-tramites";

  return (
    <div className="mt-6">
      {estimados.length > 0 ? (
        <Seccion id="inicio:estimados" usuario={persona.id} titulo="Estimados sin honorario final" tramites={estimados} abierta conDueno
          verTodos="/admin/tramites?estimado=1" vacio="" />
      ) : null}
      <Seccion id="inicio:mis-tramites" usuario={persona.id} titulo="Mis trámites" tramites={misEnCurso} abierta
        verTodos="/mis-tramites" vacio="Nada en curso por tu liga de cliente." />
      <Seccion id="inicio:por-cotizar" usuario={persona.id}
        titulo={quieren > 0 ? `Por cotizar · ${quieren === 1 ? "1 quiere" : `${quieren} quieren`} el trámite` : "Por cotizar"}
        tramites={porCotizar} abierta={porCotizar.length > 0} conDueno={opera}
        verTodos={opera ? "/admin/solicitudes" : "/mis-tramites?ver=por_cotizar"} vacio="Nada por cotizar." />
      <Seccion id="inicio:sin-folio" usuario={persona.id} titulo="Pendientes de folio" tramites={sinFolio} conDueno={opera}
        verTodos={`${ruta}?ver=sin_folio`} vacio="Todos los trabajos tienen folio." />
      <Seccion id="inicio:por-cobrar" usuario={persona.id} titulo="Por cobrar" tramites={porCobrar} conDueno={opera}
        verTodos={`${ruta}?ver=por_cobrar`} vacio="Nada por cobrar." />
    </div>
  );
}

function Seccion({
  id,
  usuario,
  titulo,
  tramites,
  abierta = false,
  conDueno = false,
  verTodos,
  vacio,
}: {
  id: string;
  usuario: string;
  titulo: string;
  tramites: Tramite[];
  abierta?: boolean;
  conDueno?: boolean;
  verTodos: string;
  vacio: string;
}) {
  return (
    <Contraible id={id} usuario={usuario} titulo={titulo} cuenta={tramites.length} abierta={abierta}>
      {tramites.length === 0 ? (
        <p className="text-[0.9375rem] text-secundario">{vacio}</p>
      ) : (
        <TarjetasTramite tramites={tramites.slice(0, MAXIMO)} conDueno={conDueno} />
      )}
      <p className="mt-3">
        <Link href={verTodos} className="toque text-[0.9375rem] font-semibold text-acento underline underline-offset-4">
          Ver todos
        </Link>
      </p>
    </Contraible>
  );
}

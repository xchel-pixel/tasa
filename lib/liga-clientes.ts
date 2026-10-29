/** Lo que hace falta para decir quién trajo una solicitud. */
export type Procedencia = {
  origen: string;
  liga_sin_dueno: boolean;
  comisionistas: { personas: { nombre: string } | null } | null;
  liga: { nombre: string } | null;
};

/**
 * Quién la trajo: el comisionista o, si llegó por la liga de alguien del equipo, de quién era la
 * liga (solo seguimiento). Si el dueño de la liga está inactivo, quedó a nombre de la organización.
 */
export function quienLaTrajo(s: Procedencia): string {
  if (s.comisionistas?.personas?.nombre) return s.comisionistas.personas.nombre;
  if (s.origen !== "liga_cliente") return "";
  return s.liga_sin_dueno
    ? `Organización (liga de ${s.liga?.nombre ?? "alguien"}, inactivo)`
    : `${s.liga?.nombre ?? "Equipo"} (solo seguimiento)`;
}

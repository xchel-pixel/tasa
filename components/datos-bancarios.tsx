/**
 * Los datos para transferir: CLABE, titular real y banco. Es el ÚNICO
 * lugar de la interfaz donde aparece el titular legal de una cuenta;
 * en listas y estados de cuenta la cuenta se nombra por su alias.
 */
export type DatosCuenta = { titular: string; banco: string | null; clabe: string };

export function DatosBancarios({ cuenta }: { cuenta: DatosCuenta }) {
  // La CLABE en grupos de 3-3-11-1 (banco, plaza, cuenta, control), que es
  // como se lee en voz alta y como la muestran los bancos.
  const c = cuenta.clabe;
  const agrupada = `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6, 17)} ${c.slice(17)}`;
  return (
    <div className="rounded-xl border border-linea bg-alterno px-4 py-3">
      <p className="text-[0.9375rem] text-secundario">CLABE</p>
      <p className="mt-1 select-all text-[1.25rem] font-bold tabular-nums tracking-wide text-primario">{agrupada}</p>
      <dl className="mt-2 flex flex-col gap-0.5 text-[0.9375rem]">
        <div className="flex gap-2">
          <dt className="text-secundario">Titular:</dt>
          <dd className="font-semibold">{cuenta.titular}</dd>
        </div>
        {cuenta.banco ? (
          <div className="flex gap-2">
            <dt className="text-secundario">Banco:</dt>
            <dd className="font-semibold">{cuenta.banco}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

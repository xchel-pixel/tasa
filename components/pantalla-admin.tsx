import Link from "next/link";
import { Encabezado } from "@/components/encabezado";

/** El marco de toda pantalla del panel: encabezado, regreso y título. */
export function PantallaAdmin({
  titulo,
  volver = { href: "/", texto: "Panel" },
  children,
}: {
  titulo: string;
  volver?: { href: string; texto: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <Encabezado />
      <main className="flex flex-1 flex-col px-6 py-6">
        <div className="mx-auto w-full max-w-md">
          <Link href={volver.href} className="toque text-[0.9375rem] font-semibold text-acento">
            ← {volver.texto}
          </Link>
          <h1 className="mt-2 text-[1.5rem] font-bold tracking-tight">{titulo}</h1>
          {children}
        </div>
      </main>
    </>
  );
}


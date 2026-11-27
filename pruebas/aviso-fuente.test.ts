import { beforeEach, describe, expect, test, vi } from "vitest";

/** Alerta de bloqueo (0098/0099): solo 403/429 avisan a la base; el correo sale solo cuando la base lo pide. */

const rpc = vi.fn();
const enviarCorreo = vi.fn(async () => null);
vi.mock("@/lib/supabase/server", () => ({ crearClienteServidor: async () => ({ rpc }) }));
vi.mock("@/lib/correo", () => ({ enviarCorreo }));
vi.mock("@/lib/altas", () => ({ ligaPrivacidad: async () => "https://tasa/privacidad", urlDelSitio: async () => "https://tasa" }));
vi.mock("@/lib/contacto", () => ({ obtenerContacto: async () => null }));

const { avisarSiBloqueo } = await import("@/lib/catastro/aviso-fuente");

beforeEach(() => { rpc.mockReset(); enviarCorreo.mockClear(); });

describe("Aviso de bloqueo de la fuente", () => {
  test("otra respuesta (500, 404): ni alerta ni correo", async () => {
    await avisarSiBloqueo("mapa", 500);
    await avisarSiBloqueo("mapa", 404);
    expect(rpc).not.toHaveBeenCalled();
  });
  test("403/429: se avisa a la base; si la base no pide correo (alerta ya abierta o ya salió hoy), no sale", async () => {
    rpc.mockResolvedValue({ data: null });
    await avisarSiBloqueo("mosaicos", 429);
    expect(rpc).toHaveBeenCalledWith("catastro_aviso_fuente", { p_servicio: "mosaicos", p_estado: 429 });
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
  test("al abrirse la alerta, un correo a quien diga la base, con lo que respondió la fuente y la liga a Hoy", async () => {
    rpc.mockResolvedValue({ data: { correo: "xg@ejemplo.test", nombre: "Xchel", slug: "xg", mensaje: "La fuente catastral respondió 403 (acceso negado) en zona." } });
    await avisarSiBloqueo("zona", 403);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
    const arg = (enviarCorreo.mock.calls[0] as unknown as [{ para: string; asunto: string; texto: string; demo: boolean }])[0];
    expect(arg.para).toBe("xg@ejemplo.test");
    expect(arg.asunto).toBe("Tasa: la fuente catastral nos está limitando");
    expect(arg.texto).toContain("respondió 403");
    expect(arg.texto).toContain("https://tasa/admin/alertas");
    expect(arg.demo).toBe(false);
  });
  test("si la base falla, la consulta sigue (no truena)", async () => {
    rpc.mockRejectedValue(new Error("sin base"));
    await expect(avisarSiBloqueo("mapa", 429)).resolves.toBeUndefined();
  });
});

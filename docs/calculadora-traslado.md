# Calculadora de gastos de traslado (0055)

Puerto a TypeScript de las skills de Xchel `gastos-traslado-qro` e `istd-fus-sub-qro` (ver
`docs/fuentes-traslado/`). Sin tarifas propias: todo sale de los parámetros fiscales de la base.

## Dónde vive

| Pieza | Archivo |
|---|---|
| Cálculo (ISTD de 18 municipios, ISR por enajenación y adquisición, arancel notarial, RPP, avalúo, extemporáneo) | `lib/traslado/calculo.ts` |
| Semilla de parámetros (extraída de las skills) | `lib/traslado/parametros-2026.json` → migración 0055 |
| Calcular, guardar y leer | `lib/traslado/servidor.ts`, `app/calculadora/` |
| PDF sin marca (hoja 1 resumen y sugerencias; hoja 2 detalle) | `lib/traslado/pdf.ts` |
| Parámetros fiscales (admin_org) | `app/ajustes/parametros/` |
| Pruebas contra los scripts originales (±1 peso) | `pruebas/traslado.test.ts` + `docs/fuentes-traslado/casos-referencia.json` |

## Reglas

- **Modos:** Rápida (municipio o clave, lado, operación, valores, vivienda social, hipoteca) para quien tenga
  `calculadora_traslado`; Completa (además ISR por enajenación y extemporáneo) para `calculadora_traslado_completa`
  (catálogo 0053: Socio, Socio Plus, Élite y equipo).
- **Vigencia:** cada parámetro guarda versiones con fecha; el cálculo usa la vigente a la fecha de firma. Si la
  fecha es de un año sin tarifas, usa la más reciente y avisa ("Tarifas de 2026; las de 2027 aún no se cargan").
  INPC, recargos y UDI son una sola fila; el INPC se agrega mes a mes.
- **Mis cálculos:** solo de quien calculó (ni Administración los ve), 90 días; los borra `mantener_calculadora()`
  en el cron. Sin datos del cliente: municipio, valores, fechas, resultado y una referencia libre.
- **Registro de uso:** `usos_herramienta` (una fila por cálculo), para los cupos de la fase 8.
- **Alertas a admin_org:** INPC con más de 45 días sin actualizar; año nuevo con tarifas del anterior.
- **Solicitar el avalúo:** abre Nueva solicitud con servicio (hacendario o comercial), municipio, clave y notas; el
  comisionista agrega al cliente y sale a su nombre con su comisión normal.
- **Sugerencias:** informativas; nunca proponen inflar valores. Leyenda fija: "Estimación aproximada; el notario y
  las autoridades determinan las cifras definitivas. No es asesoría fiscal."

## Mantenimiento

- Cada mes: INPC nuevo en Ajustes → Parámetros fiscales (INEGI, ~día 10) y la UDI.
- Cada enero: UMA, tarifa del art. 126 (Anexo 8 RMF), recargos, derechos del RPP, arancel y tarifas de ISTD de
  cada municipio (La Sombra de Arteaga), con vigencia 1 de enero (UMA: 1 de febrero).
- Si las skills cambian: correr de nuevo el extractor, regenerar casos con los scripts y comparar.

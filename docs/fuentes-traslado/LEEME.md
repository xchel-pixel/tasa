# Fuentes para la calculadora de gastos de traslado (Tasa)

Copia de las skills de Xchel, solo como referencia para portar el cálculo a Tasa:

- gastos-traslado-qro.md: flujo, reglas por parte, ISR por enajenación/adquisición, arancel notarial, RPP, extemporáneos, sugerencias y el código Python (gastos.py, isr.py, inpc.py, recargos.py).
- istd-fus-sub-qro.md: tarifas de ISTD de los 18 municipios y UMA (tarifas.py, calc.py).
- estimacion-valor.md: tabla INPC desde 2000 (estimar.py). Solo se usa la parte de INPC.

No editar aquí: son la fuente. El cálculo se porta a TypeScript con pruebas que comparen contra estos scripts.

## casos-referencia.json
8 casos ya calculados con los scripts Python originales (gastos.calcular), para que las pruebas en TypeScript comparen contra ellos sin instalar Python: comprador Querétaro, comprador El Marqués con avalúo mayor, vivienda social Corregidora, vendedor con ISR casa habitación, vendedor con ISR, mejoras e hipoteca, ambos, donación no exenta y extemporáneo. Cada uno trae "entrada" (caso.json) y "resultado". Fecha de firma 2026-11-20.

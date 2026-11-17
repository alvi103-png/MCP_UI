# En directo: la primera decisión con Jev

Llega el mensaje de un cliente y Jev decide de qué trata. El código está en `clasificar.js` y se ve en `/directo/clasificar` de la web del taller (`pnpm dev` en la raíz).

**En directo no se escribe código: se descomenta.** Selecciona las líneas de código de cada `PASO N` y pulsa `Cmd + /`. La página se recarga sola al guardar.

| Paso | Qué se ve |
| --- | --- |
| 1 | Una pregunta `choice`: el tema y la probabilidad de cada opción |
| 2 | `noul` (¿urgente?) y `score` (¿enfadado?) en la misma llamada |
| 3 | `decidir()`: el código actúa con números |

Para volver a empezar: `git checkout -- clasificar.js`.

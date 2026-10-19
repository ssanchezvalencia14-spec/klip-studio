# La IA: elegir momentos con tu suscripción de Claude

"Elegir momentos" (en el panel, **Buscar momentos**) usa **Claude Code** con
tu suscripción de Claude. No usa la API de pago ni necesita una clave.

---

## Requisitos en el PC que procesa

1. **Node.js 24.** El plan de fases pedía Node 22 LTS, pero el proyecto exige
   `>=24` (`package.json`) y Claude Code funciona igual con él. Comprueba la
   versión con `node --version`.
2. **Claude Code instalado** y en el PATH. Si no está en el PATH, pon la ruta
   en `CLAUDE_CLI_PATH`.
3. **Haber iniciado sesión una vez:**

   ```
   claude
   /login
   ```

   Entra con la cuenta que tiene la suscripción y cierra Claude Code. La
   sesión queda guardada en ese usuario de Windows.
4. **El trabajador corriendo** (tarea programada "KLIP trabajador", ver
   `OPERACION.md`).

**El procesamiento solo funciona con ese PC encendido y el trabajador en
marcha.** El panel de Hostinger solo encola tareas; la IA corre en el PC.

---

## Configuración (`.env`)

| Variable | Valor por defecto | Para qué |
|---|---|---|
| `LLM_PROVIDER` | `claude-cli` | `claude-cli` (suscripción), `anthropic-api` (API de pago) u `ollama` |
| `CLAUDE_CLI_PATH` | `claude` del PATH | Ruta del ejecutable |
| `LLM_MODEL` | `sonnet` | `sonnet` para calidad, `haiku` para tareas simples, `opus`, o un nombre completo |
| `LLM_MODEL_PRUEBA` | `haiku` | Modelo de "Probar IA" |
| `LLM_TIMEOUT_MS` | `180000` | Tiempo máximo por llamada |
| `LLM_MAX_CARACTERES` | `300000` | Tope para mandar la transcripción en una sola llamada |

No hay ninguna clave en esta configuración.

---

## Cómo llama a Claude Code

`src/llm/claude-cli.ts`. Las banderas se comprobaron con `claude --help` en la
versión 2.1.299:

```
claude -p --output-format json --model <LLM_MODEL> --tools "" --max-turns 1
       --safe-mode --strict-mcp-config --no-session-persistence
       --permission-prompts none --system-prompt <instrucciones>
```

- **Sin herramientas** (`--tools ""`), **sin MCP**, **sin hooks ni CLAUDE.md**
  (`--safe-mode`) y en una **carpeta temporal vacía** que se borra al terminar.
  Solo puede devolver texto: no lee ni escribe archivos del PC.
- **El prompt va por la entrada estándar**, no como argumento. En Windows la
  línea de comandos se corta en unos 32 000 caracteres.
- **Entorno limpio.** Antes de lanzarlo se quitan todas las variables
  `ANTHROPIC_*` y las de una sesión de Claude Code (`CLAUDECODE`,
  `CLAUDE_CODE_*`). Con una `ANTHROPIC_API_KEY` en el entorno, el CLI usa esa
  clave en lugar de la suscripción. Una clave vieja en las variables de Windows
  era la causa probable del error 401.
- **`child_process.spawn` sin shell**, con tiempo máximo: si se pasa, se mata
  el proceso y sus hijos.
- **Una llamada a la vez**, también entre procesos (un cerrojo en la carpeta
  temporal).

---

## Qué hace con la respuesta

`src/llm/seleccion.ts` y `src/llm/esquema.ts`.

1. **Un solo bloque por video siempre que quepa** (`LLM_MAX_CARACTERES`). Si no
   cabe, bloques de una hora con dos minutos de solape, y los resultados se
   unen y se quitan los repetidos.
2. Pide **JSON** y lo valida con zod: `inicio`, `fin`, `titulo` (máximo 8
   palabras, distinto de la primera frase), `gancho`, `descripcion`,
   `hashtags`, `puntaje_gancho`, `puntaje_cierre`, `puntaje_retencion`,
   `puntaje_total` y `motivo`.
   - `inicio` y `fin` son **números de línea**, no segundos, como en el resto
     del proyecto. Un segundo inventado no se puede comprobar; una línea que no
     existe, sí.
   - `descripcion` y `hashtags` no estaban en el plan, pero los necesita la
     publicación.
3. Si el JSON no valida, **un solo reintento** enviándole el error. Si vuelve a
   fallar, la tarea falla limpia.
4. **Máximo 2 reintentos por tarea** en total, sumando todos los bloques.
5. **Caché**: el mismo bloque con el mismo modelo y el mismo prompt no se
   vuelve a preguntar. Se guarda en `work/ia-cache/`.
6. La comprobación de siempre contra la transcripción: si el `gancho` no
   aparece en el texto, el momento se descarta.

---

## Límite de uso y sesión

Cuando Claude Code responde que no hay sesión ("Not logged in · Please run
/login") o que se llegó al límite de la suscripción:

- La tarea **no falla**: queda en **esperando a la IA** (`en_espera_ia`).
- La **cola de IA se pausa**. El trabajador no coge más tareas de IA, pero
  sigue con el resto (descargas, renders).
- **No reintenta en bucle.** Se reanuda sola a la hora que diga el aviso de
  límite. Si el aviso no trae hora, o si falta la sesión, se reanuda con el
  botón **Reintentar** del panel.
- El panel muestra **un solo aviso** en Inicio:
  - "IA lista"
  - "IA con límite, vuelve a las HH:MM"
  - "IA sin sesión (abre Claude Code en tu PC y ejecuta /login)"

## Probar la IA

- En el panel: **Ajustes → IA → Probar IA**. Encola una prueba mínima que hace
  el trabajador del PC y guarda el resultado.
- En el PC: `npm run probar-ia` o `npm run check-health`.

Resultados posibles: lista, sin sesión, límite, Claude Code no encontrado o
tiempo agotado.

## Registro de uso

Cada "Elegir momentos" anota en el historial el tiempo, el proveedor, el modelo
y cuántas llamadas hizo. El coste se muestra como **"Incluido en la
suscripción"**: no se calculan dólares para este proveedor.

---

## Advertencia

El uso automatizado de la suscripción tiene que cumplir las **condiciones de
uso de Anthropic y sus límites**. Si deja de ser viable, el cambio es solo
de configuración:

```
LLM_PROVIDER=anthropic-api
ANTHROPIC_API_KEY=<una clave nueva de platform.claude.com>
```

El resto del sistema no cambia. Se puede añadir otro proveedor (por ejemplo
Gemini) implementando `ProveedorLlm` en `src/llm/provider.ts`.

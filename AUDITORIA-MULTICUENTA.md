# Fase A: auditoría multicuenta

Fecha: 2026-10-10. Sin tocar código. Mapeado con graphify 0.9.71 sobre el grafo
del proyecto (954 nodos) y comprobado leyendo el código y midiendo en el panel.

---

## Resumen en cinco líneas

El programa **no está construido para exactamente 20 cuentas.** El modelo ya es
normalizado y acepta 1..N; 20 es un *valor por defecto* y 100 un *tope*. No hay
columnas `account_1..account_20` en ninguna parte, ni bucles sobre un array
fijo, ni 20 huecos en la interfaz. Lo que sí hay son cuatro cuellos reales, y
ninguno es el que el encargo supone. Y hay un límite externo, ajeno al código,
que decide antes que cualquier refactor: **el plan contratado de upload-post
admite 25 perfiles.**

---

## Lo primero: dos cosas del encargo que no encajan

### El stack sigue sin existir

El documento dice "no cambies el stack (Next.js + TypeScript + Tailwind +
shadcn/ui + Supabase + Framer Motion)". Comprobado otra vez en `package.json`:
de esa lista solo existe TypeScript. No hay Next.js, React, Tailwind, shadcn ni
Framer Motion. Supabase se usa **solo como Postgres**, con el driver `postgres`
y conexión directa. Ya está documentado en `AUDITORIA-FASE-0.md` y la decisión
tomada entonces fue mantener el stack real. Sigo con esa.

Donde el encargo dice "migraciones de Supabase", aquí son ficheros `.sql`
numerados en `db/`. Donde dice "listas virtualizadas", aquí es HTML generado
por concatenación de cadenas. Lo traduzco, no lo ignoro.

### El tope que manda no está en el código

`src/publish/providers/uploadPost.ts` lo documenta: el plan Professional
contratado son **50 USD/mes y 25 perfiles**. Hoy hay 20 cuentas creadas y 2
activas, así que sobra sitio. Pero "cientos de cuentas" no es un problema de
código: con 200 cuentas harían falta ocho planes, o cambiar de proveedor
(bundle.social, 100 USD, cuentas ilimitadas, ya comparado en ese mismo
comentario).

**Esto decide el alcance de las fases B a F.** Si el objetivo real es llegar a
5 o 25 cuentas, casi todo lo que sigue sobra. Si es llegar a cientos, el primer
paso es comercial, no técnico. Necesito que me digas cuál es antes de la fase B.

---

## Lo que ya funciona con N cuentas y NO hay que tocar

Para no gastar fases rehaciendo lo que está bien:

| El encargo pide | Ya existe como |
|---|---|
| `accounts` normalizada | `accounts (id, owner_id, label, status, slots[], token_status, last_published_at, cliente_id)`. Una fila por cuenta, sin límite estructural. |
| `account_groups` + `members` | `clientes` + `accounts.cliente_id` (nulo = sin asignar), con índice propio. |
| Ajustes por grupo que heredan | `clientes.posts_per_day`, `day_start_hour`, `day_end_hour`. **Todos nulables, y nulo significa "lo que diga el ajuste general"**. La jerarquía global → grupo ya está hecha, con su restricción en la base. |
| Idempotencia al publicar | Índice único `queue (owner_id, account_id, checksum)`. La base impide físicamente encolar dos veces el mismo clip en la misma cuenta. |
| `publications` | Repartido a propósito entre `queue` (lo programado y pendiente) y `posts` (lo entregado, con su id externo). Funciona; unificarlo es opcional y no urgente. |
| Multi-inquilino | **Las 15 tablas llevan `owner_id` desde el primer día.** Solo hay un propietario y su uuid está en una constante, `src/lib/owner.ts`. Pasar a varios es quitar esa constante, no migrar el esquema. |
| Motor de distribución | `planSchedule(accounts, clipIds, options)` acepta cualquier número de cuentas, con dispersión determinista, enfriamiento global y antirrepetición por cuenta. |
| Cuentas con token vencido | `accounts.token_status` y `status`; `vencidos()` filtra por `a.status='active'`, así que una cuenta pausada no bloquea al resto. |

---

## Hallazgos reales, por impacto

### ALTO

**1. El trabajador publica en serie, de uno en uno.**
`src/publish/worker.ts:287` es un `for (const item of due)` con `await` dentro.
No hay concurrencia configurable ni paralela.

Las cuentas son: hoy 2 activas × 3 al día = 6 envíos diarios, que en serie son
dos minutos. Con 200 cuentas serían 600 envíos; a ~15 s por subida, **2 horas y
media por pasada**, y la tarea programada corre cada 30 minutos: las pasadas se
solaparían.

Lo importante: **los topes de TikTok son POR CUENTA** (`TIKTOK_LIMITS`: 5 por
minuto, 13 al día). Publicar en paralelo en cuentas distintas no los viola. La
serialización no protege de nada; es que nunca hizo falta.

**2. Dos consultas a la base por cada envío, antes de subir nada.**
`cadenceBlock` (`worker.ts:170`) llama a `publicacionesDesde` dos veces por
item, una para el tope por minuto y otra para el diario. Con 600 envíos son
**1.200 viajes de ida y vuelta a Supabase**, a 20-50 ms cada uno: entre medio
minuto y un minuto de pura latencia antes de la primera subida. Se resuelve con
una sola consulta agregada por pasada.

**3. El tope de 100 cuentas está escrito en tres sitios.**
- `src/queue/settings.ts:48` — `accounts: [1, 100]`
- `src/review/server.ts:1882` — `existentes.length + cuantas > 100`
- `src/review/server.ts:1876` — máximo 50 por tanda
Y el CLI `scripts/accounts.ts --init` **no tiene ningún tope**, así que por
consola se pueden crear mil y el panel luego se niega a crear la 101. Esa
incoherencia ya es un fallo hoy.

**4. La pantalla de Cuentas no escala. Medido, no estimado.**
Inyecté 1, 5, 20 y 200 cuentas en el panel y medí el render real:

| Cuentas | Alto de la lista | Botones | Tiempo de pintado |
|---|---|---|---|
| 1 | 499 px | 8 | 1,6 ms |
| 5 | 671 px | 18 | 1,1 ms |
| 20 | 1.776 px | 55 | 1,7 ms |
| **200** | **16.581 px** | **495** | 8,4 ms |

**El pintado no es el problema** (8,4 ms es nada). El problema son **veinte
pantallas de scroll** y 495 botones sin buscador, sin filtro, sin orden, sin
selección múltiple y sin acciones por lotes. Es un muro de usabilidad, no de
rendimiento, y conviene no confundirlos al planificar.

### MEDIO

**5. Ninguna ruta pagina.** Buscado `limit`/`offset`/`page` en
`src/review/server.ts`: cero resultados en consultas. `/api/overview`,
`/api/plataformas`, `/api/queue`, `/api/clips` y `/api/proyectos` devuelven
todo. Con 200 cuentas, `/api/overview` carga además todos los clips y todas las
publicaciones para calcular contadores.

**6. `planSchedule` reordena la lista entera de clips en cada hueco.**
`schedule.ts:112`, un `[...clipIds].sort()` dentro del bucle de huecos. Es
O(huecos × clips·log clips). Hoy (20 cuentas, 3 franjas, 7 días, 85 clips) son
~230.000 operaciones, invisibles. Con 1.000 cuentas y 2.000 clips serían ~900
millones. El ranking se puede mantener incremental.

**7. `vencidos()` no lleva LIMIT.** El `--limit 12` de `publicar.cmd` se aplica
**en memoria** (`worker.ts:278`, `due.slice(0, limit)`) después de haber traído
de la base todas las filas vencidas.

**8. No hay ajustes por cuenta.** La jerarquía hoy es global → cliente. El
nivel de cuenta que pide la fase E no existe: ni plantilla de subtítulos, ni
horario, ni hashtags propios por cuenta.

**9. RLS es un cierre, no un aislamiento.** `db/010` activa RLS en las 15 tablas
**con cero políticas a propósito**, y revoca permisos a `anon` y
`authenticated`. Pero el programa entra como `postgres`, que **salta RLS**. O
sea: el aislamiento entre propietarios lo hace hoy el código de la aplicación,
poniendo `owner_id` en cada consulta, no la base.

"RLS verificada por workspace" como pide la fase B exigiría que la aplicación
dejara de conectarse como superusuario y pasara a un rol con políticas. Es un
cambio de calado y de riesgo alto: si una consulta se queda sin su política, no
falla, **devuelve cero filas en silencio**. Con un solo propietario no compra
nada. Lo recomiendo solo cuando entren clientes de verdad.

### BAJO

**10. El 20 que queda es narrativo.** Doce apariciones, todas en comentarios que
cuentan historia ("con 20 cuentas quedan 5 de margen", "14 de 20 cuentas
repetían clip"). No afectan a nada, pero envejecen mal. El resto de los `20` del
código son otra cosa: niveles de log, lotes de métricas, límites de grosor de
borde, segundos mínimos de clip.

**11. El valor por defecto 20 está duplicado**: `queue/settings.ts:36` y
`review/guion.ts:1758` (la copia del panel).

---

## Flujo actual, de punta a punta

```
VOD                 sources (id, title, duration_sec, campana_id)
 │  ingest          descarga + transcribe
 ▼
transcript.json     en disco, en el PC que procesa
 │  select          un modelo elige momentos -> clips.json
 ▼
clips               clips (source_id, clip_id, start, end, hook, caption,
 │                         hashtags, score, status, master_path, proxy_path)
 │  render          ffmpeg + NVENC -> clip-NN.mp4   [local, necesita GPU]
 │  subir           copia de revision -> Supabase Storage
 ▼
REVISAR             el unico gesto manual: approved / rejected
 │
 │  repartirSiToca  se dispara solo al no quedar pendientes del VOD
 ▼
variants            una copia por cuenta, con el pie variado
 │  planSchedule    huecos = cuentas x franjas x dias, con dispersion
 ▼
queue               (owner_id, account_id, clip_id, scheduled_at, status,
 │                   checksum UNIQUE)      <- aqui vive lo programado
 │  worker          cada 30 min: coge lo vencido, respeta cadencia, sube
 ▼
posts               (account_id, clip_id, provider, external_id, published_at)
 │  metrics         vistas y likes por publicacion
 ▼
metrics             snapshots por post
```

Dónde entra la cuenta: **solo en los tres últimos pasos** (variants, queue,
posts). Todo lo anterior es independiente del número de cuentas. Eso acota el
riesgo de cualquier cambio: procesar VODs y generar clips no se toca.

---

## Riesgos de la migración

1. **El mayor riesgo es hacer la migración que el encargo pide.** Crear
   `workspaces`, `publications` y `distribution_rules` cuando ya existen
   `owners`, `queue`+`posts` y `planSchedule` significa mover 15 tablas con
   datos reales dentro, reescribir las ~44 llamadas al almacén y rehacer las
   175 comprobaciones que hoy pasan. A cambio de nombres distintos para lo
   mismo.
2. **Paralelizar el worker puede duplicar publicaciones** si se hace sin
   cuidado: el índice único protege la COLA, no la entrega. Dos trabajadores
   cogiendo el mismo item en `pending` lo subirían dos veces. Hace falta tomar
   el item con `update ... where status='pending' returning`, que ya es el
   patrón que usa `rescatarEncallados`.
3. **Pasar a un rol sin bypass de RLS falla en silencio.** Una política que
   falte no da error: devuelve cero filas. Con publicación automática, eso se
   manifiesta como "hoy no salió nada" sin ninguna traza.
4. **Reversibilidad.** Hoy no hay `down` en ninguna de las 14 migraciones: son
   `alter table ... if not exists` acumulativos. Pedir `up`/`down` es razonable
   pero es un cambio de convención del proyecto entero, no de esta fase.

---

## Lo que propongo en vez de las fases B a F

Ordenado por valor sobre esfuerzo. Mi recomendación es hacer 1 a 4 y parar a
ver qué hace falta de verdad.

**1. Quitar el tope de 100 y unificarlo (medio día).** Un solo ajuste
`maxCuentas` por propietario, leído de la base, con el CLI y el panel
respetándolo. Arregla además la incoherencia actual entre consola y panel.

**2. Concurrencia en el worker (1-2 días).** Tomar los items con `update ...
returning`, procesar N en paralelo con N configurable, y agrupar la
comprobación de cadencia en una consulta por pasada en vez de dos por item.
Esto es lo que de verdad decide cuántas cuentas aguanta el sistema.

**3. Paginar y filtrar la pantalla de Cuentas (1-2 días).** Buscador, filtro
por estado y por cliente, y acciones por lotes (pausar, activar, asignar
cliente). Con la divulgación progresiva que pide el encargo: con menos de 6
cuentas, la lista de ahora; a partir de ahí, la tabla con herramientas. Es lo
que convierte 16.581 px en una pantalla usable.

**4. Paginar las rutas que devuelven listas (medio día).** `queue`, `clips`,
`posts`, con límite y cursor.

**5. Ajustes por cuenta (2-3 días).** Tabla `account_settings` con todo
nulable, igual que ya se hizo con `clientes`, y el indicador de heredado o
propio en la interfaz. Solo si vas a tener cuentas que de verdad necesiten
estilos distintos.

**6. Varios propietarios y RLS real.** Solo cuando entren clientes con acceso
al panel. Hoy no compra nada y arriesga mucho.

Lo que **no** recomiendo: renombrar `clientes` a `account_groups`, partir
`queue`/`posts` en `publications`, ni crear `distribution_rules` como tabla
cuando hoy la estrategia es una sola y está probada.

---

## Qué necesito de ti para la fase B

1. **¿A cuántas cuentas quieres llegar de verdad?** Cambia todo. Hasta 25
   entras en el plan actual de upload-post y basta con los puntos 1, 3 y 4.
   Más allá, hay que resolver antes el plan del proveedor.
2. **¿Confirmas que seguimos sin Next.js/React/Tailwind?** Es la misma pregunta
   de la fase 0 del rediseño, y la respuesta de entonces fue que sí.
3. **¿Te vale mi propuesta de 6 puntos en lugar de las fases B a F literales?**
   Si prefieres el modelo del encargo tal cual (workspaces, publications,
   distribution_rules, RLS por workspace), lo hago, pero quiero que sepas que
   es reescribir lo que ya funciona y que la ganancia es de nombres.

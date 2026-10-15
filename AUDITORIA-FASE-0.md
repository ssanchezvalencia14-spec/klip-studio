# Fase 0: auditoría y plan

Fecha: 2026-10-10. Sin tocar código.

---

## Antes de nada: dos cosas del brief que no coinciden con el proyecto

No son matices. Cambian lo que se puede hacer en las fases 1 a 9.

### 1. El stack descrito no existe

El brief dice "Next.js + TypeScript + Tailwind + shadcn/ui + Supabase, animaciones con
Framer Motion" y pide no cambiarlo. Comprobado en `package.json` y `node_modules`:

| Pieza del brief | Realidad |
|---|---|
| Next.js | no instalado |
| React | no instalado |
| Tailwind | no instalado |
| shadcn/ui | no instalado |
| Framer Motion | no instalado |
| `@supabase/supabase-js` | no instalado |

Lo que hay de verdad son **cinco dependencias**: `@anthropic-ai/sdk`, `postgres`,
`typescript`, `zod`, `@types/node`. Más `tsx` y `pglite` para desarrollo.

La web es un **servidor HTTP de Node a pelo**. Toda la interfaz (HTML, CSS y
JavaScript) vive dentro de un único template literal en `src/review/page.ts`,
4.651 líneas. El servidor son otras 2.113 en `src/review/server.ts`.

Supabase sí se usa, pero **solo como Postgres** (con el driver `postgres`) y como
almacén de objetos para las copias de revisión. No hay cliente de Supabase ni
autenticación suya: la entrada al panel es una llave en la dirección.

**Consecuencia:** las partes del brief que dicen "tematiza shadcn/ui" o "todo con
Framer Motion" no se pueden ejecutar tal cual sin migrar el framework, que es
justo lo que el brief prohíbe. Más abajo propongo el equivalente real de cada una.

### 2. La app no es la que describe el brief

El brief dice: "Hoy la web es básica: solo tiene vista de VODs y vista de clips".

Lo que hay:

- **10 vistas**: Inicio, Revisar, Agenda/Calendario, Agenda/Resultados,
  Ajustes/Clientes, Ajustes/Cuentas, Ajustes/Horarios, Ajustes/Marca y textos,
  Ajustes/Historial, más la vista previa.
- **17 rutas HTTP**, incluidas `/api/overview`, `/api/clips`, `/api/queue`,
  `/api/jobs`, `/api/proyectos`, `/api/cuentas`, `/api/metrics`, `/api/events`
  (SSE), `/auth/tiktok/callback` y las páginas legales.
- **15 tablas**: `accounts`, `campanas`, `clientes`, `clips`, `jobs`, `metrics`,
  `owners`, `plantillas`, `posts`, `queue`, `runs`, `settings`, `sources`,
  `tiktok_pendientes`, `tiktok_tokens`.
- Publicación real a TikTok por upload-post, reparto automático entre cuentas,
  cola programada, recolección de métricas y 20 ajustes configurables.

O sea: buena parte de lo que las fases 2, 3, 4, 5 y 7 piden **construir** ya
existe y funciona en producción con cuentas reales. El trabajo real es
rediseñarlo, no crearlo.

---

## Problemas encontrados, por impacto

### Alto

**1. No hay modo oscuro.** Cero reglas `prefers-color-scheme: dark` en todo el
fichero. El brief lo pide como modo principal y es lo más visible que falta.

**2. El foco de teclado casi no existe.** Dos reglas `focus-visible` en 4.651
líneas. Con decenas de controles por pantalla, navegar con teclado es a ciegas.
Es un requisito de accesibilidad, no un extra.

**3. Un solo fichero de 4.651 líneas para toda la interfaz.** No es un problema
estético, es el que hace caros todos los demás. Ya ha costado seis incidentes en
este proyecto: una comilla invertida o una barra mal escapada en un comentario
rompe la página entera, y el typecheck no lo ve. Hay una comprobación que lo caza
(`verify:panel` compila el guion), pero el fichero sigue siendo inmanejable.

**4. No hay jerarquía de radios ni de elevación.** Un solo radio para todo y
sombras genéricas. El brief pide jerarquía explícita y tiene razón: ahora una
tarjeta de acción principal y una nota al pie pesan casi lo mismo.

### Medio

**5. Sin tipografía monoespaciada para datos.** Las duraciones, los timecodes y
las horas de publicación van en la misma proporcional que el texto. En una
herramienta de vídeo eso es un error de oficio: las columnas de horas no alinean.

**6. Movimiento reducido apenas contemplado.** Una sola regla
`prefers-reduced-motion`. Hay animaciones de entrada en cascada que deberían
apagarse con ella.

**7. Nada evoca una herramienta de vídeo.** El brief lo clava: esto parece un
panel de administración genérico. No hay línea de tiempo, ni marcadores, ni forma
de onda, ni relación visual entre el VOD largo y sus clips. La proporción 9:16
solo aparece en las miniaturas.

**8. No hay vista de detalle de un VOD.** Se ve la lista con sus pasos, pero no se
puede abrir uno para ver dónde cayeron sus momentos dentro de las dos horas de
directo.

### Bajo

**9. Sin búsqueda ni paleta de comandos.** Con 45 clips pendientes y 14 VODs,
encontrar algo concreto es bajar scrolleando.

**10. Sin página 404 ni enlace de salto al contenido.**

### Lo que ya está bien y no voy a tocar

Para no gastar fases en arreglar lo que no está roto:

- **La marca ya coincide exactamente con el brief.** `#0D0D0D`, `#4160E6`,
  `#1C23A6`, `#FAFAFA` ya son tokens (`--negro`, `--azul`, `--indigo`, `--blanco`).
- **La tipografía ya es una elección, no una herencia**: Instrument Sans, que no
  es ninguna de las tres que el brief prohíbe.
- **Estados de carga y vacío ya existen**: 9 esqueletos y 5 estados vacíos.
- **El azul ya está reservado** para la acción principal y el estado activo.
- **Hay 24 usos de `aria-`** y el menú marca la sección activa.

---

## Dos puntos donde propongo desviarme del brief

### No voy a usar datos mock

El brief dice: "donde no haya backend, usa datos mock tipados".

**Esta web gobierna ocho cuentas reales de TikTok y lleva 225 publicaciones.** Un
número inventado en esta pantalla no es un placeholder: es una cifra que alguien
va a creerse y sobre la que va a decidir.

Además va contra la norma que el propio proyecto ya aplica en todas partes. Hay
precedentes caros documentados en el código: el panel llegó a decir "se reparten
entre 20 cuentas" cuando solo 8 podían publicar, y a dar por publicado un clip que
TikTok había rechazado.

**Propongo:** donde no haya backend, un estado vacío honesto que diga qué falta y
qué hay que hacer para que aparezcan los datos. Nunca un número de relleno.

### "Un solo elemento memorable" sí, pero no decorativo

El brief propone la línea de tiempo del VOD con sus clips marcados encima. De
acuerdo, y es la mejor idea del brief. Pero que **sirva para algo**, no solo para
verse bien: pinchas un marcador y saltas a revisar ese clip; ves que los momentos
se apelotonan en los primeros veinte minutos y entiendes por qué el resto del
directo no dio nada.

---

## Arquitectura de navegación propuesta

El brief pide: Inicio, VODs, Clips, Plataformas, Plantillas, Analytics, Ajustes.
Siete entradas.

**Propongo cuatro**, que es lo que ya hay, por un motivo concreto: hace dos
semanas este panel tenía nueve entradas y el usuario pidió expresamente
simplificarlo porque no sabía dónde mirar. Volver a siete deshace eso.

```
Inicio      Subir un VOD y ver en qué punto va cada uno
Revisar     Aprobar o descartar clips            [45]
Agenda      Calendario · Resultados
Ajustes     Clientes · Cuentas · Horarios · Marca · Historial
```

Lo que el brief pide como entradas de primer nivel ya vive dentro:

- "Plataformas" -> Ajustes · Cuentas
- "Plantillas" -> Ajustes · Marca y textos
- "Analytics" -> Agenda · Resultados
- "VODs" y "Clips" -> Inicio y Revisar

**Lo único que añadiría**: una vista de **detalle de VOD**, accesible pinchando un
vídeo en Inicio. Ahí vive la línea de tiempo. No es una entrada de menú, es una
profundidad más.

---

## Plan de diseño

### Color: seis nombres

Los cuatro de marca se quedan como están. Añado dos familias que faltan.

| Nombre | Claro | Oscuro | Para qué |
|---|---|---|---|
| `tinta` | `#0D0D0D` | `#F2F2F3` | Texto principal |
| `lienzo` | `#FAFAFA` | `#0F0F11` | Fondo de la página |
| `superficie` | `#FFFFFF` | `#17171A` | Tarjetas y paneles |
| `acento` | `#4160E6` | `#5B76EE` | Acción principal y estado activo. Solo eso |
| `profundo` | `#1C23A6` | `#2E37C4` | Énfasis secundario, cabeceras de timeline |
| `señal` | ok `#1A7F5A` · aviso `#8A5A0B` · error `#B0342C` | aclarados | Estados |

En oscuro el fondo es `#0F0F11`, no negro puro: el negro absoluto con texto blanco
produce halo y cansa. Y el acento se aclara a `#5B76EE` porque `#4160E6` sobre
`#0F0F11` no llega a AA en texto pequeño.

**Grises de una sola familia**, derivados del negro de marca con un punto de frío,
para que no convivan grises cálidos y fríos como ahora.

### Tipografía

**Interfaz: Instrument Sans.** Ya está puesta, es una elección deliberada y no es
ninguna de las prohibidas. Cambiarla sería gastar una fase en un empate.

Lo que sí falta es usarla mejor: pesos 500 y 600 (hoy solo 400 y 700), tracking
negativo en los titulares grandes y líneas por debajo de 70 caracteres.

**Datos: JetBrains Mono.** Para duraciones, timecodes, horas de publicación y
cifras de métricas. Es lo que hace que una columna de horas se lea como una
columna. Se carga solo el peso 400 y 500, subconjunto latino.

Escala, con nombres por función y no por tamaño:

```
hero     40 / 1.05  peso 700  tracking -0.03em   una cifra que es la respuesta
titulo   22 / 1.2   peso 650  tracking -0.02em   titular de tarjeta destacada
seccion  16 / 1.35  peso 650                     encabezado de sección
cuerpo   15 / 1.55  peso 400                     texto normal
meta     13 / 1.45  peso 450                     explicaciones y pies
dato     13 / 1.4   peso 500  mono tabular       horas, duraciones, cifras
```

### Concepto de layout

El elemento memorable es la línea de tiempo del VOD. Aparece en dos sitios y en
ningún otro: en la ficha de cada vídeo (compacta) y en el detalle del VOD
(completa).

**Inicio**

```
┌─────────────────────────────────────────────────────────────┐
│ Lo que toca ahora                                           │
│ Subir 15 vídeos para poder revisarlos        [ Subir ]      │
└─────────────────────────────────────────────────────────────┘

 45 por revisar    27 aprobados    228 en cola

┌── Añadir un vídeo ──────────┐  ┌── Tus vídeos ──────────────┐
│ pegar enlace                │  │ Blessd · Atanasio   45 min │
│ o soltar un MP4             │  │ ├──●──●───●────●──●──┤     │
│                             │  │ 15 momentos · en la nube   │
└─────────────────────────────┘  │ ─────────────────────────  │
                                 │ ZOTI · Mi traído    2 min  │
                                 │ ├─●────●──┤                │
                                 │ 3 momentos · repartido     │
                                 └────────────────────────────┘
```

La barra con puntos es el VOD entero; cada punto, un momento encontrado. De un
vistazo se ve si el material está repartido o apelotonado.

**Detalle de VOD** (nuevo)

```
Blessd · Antes de hacer historia en el Atanasio        45:02
┌─────────────────────────────────────────────────────────────┐
│  0:00        10:00       20:00       30:00       40:00      │
│  ├────●─●──────●────●───────●─●────●──────●───●────●──┤     │
│       ▲ clip-03  2:14  "Nunca me salté ningún escalón"      │
└─────────────────────────────────────────────────────────────┘
  15 momentos · 0 aprobados · ninguno repartido
  [ Revisar los 15 ]
```

**Revisar** se queda como está: rejilla de 9:16 de tres columnas, que es lo que se
arregló ayer y funciona. Añadir atajos de teclado y acciones por lotes.

---

## Revisión del plan contra el propio brief

El brief pide: "si alguna parte parece lo que harías para cualquier SaaS, cámbiala
y dime qué cambiaste". Tres cosas:

**1. Quité la barra lateral de siete entradas.** Es el reflejo de cualquier panel
y además deshace una simplificación que el usuario pidió hace dos semanas. Se
quedan cuatro, y lo que sobra vive una profundidad más abajo.

**2. Quité la página `/design-system`.** Es un entregable típico de rediseño que
aquí no lee nadie: el equipo son editores, no diseñadores, y añade una ruta más
que mantener en un fichero que ya pesa demasiado. En su lugar, los tokens quedan
documentados en el propio CSS, que es donde se consultan.

**3. Quité la numeración de "primeros pasos" del estado vacío.** El brief la pide
en la fase 3. Pero el panel ya tiene algo mejor y más honesto: la tarjeta
"Siguiente paso", que calcula el hueco real y ofrece el botón que lo resuelve. Una
lista de 1-2-3 fija sería un retroceso.

**Lo que mantengo del brief porque es lo mejor que trae:** el concepto de que esto
es una herramienta de vídeo y no un panel de administración, y la línea de tiempo
como único elemento memorable.

---

## Qué pasa con las fases 1 a 9 dados los dos desajustes

| Fase | Se puede tal cual | Hay que traducirla |
|---|---|---|
| 1 Fundamentos | Tokens, modo oscuro, escala | shadcn no existe: las variantes se hacen con las clases que ya hay (`.act`, `.chip`, `.card`). Sin `/design-system` |
| 2 Shell | Breadcrumbs, anchos | Menú ya existe. Paleta ⌘K y búsqueda global: nuevas |
| 3 Inicio | Pulido y jerarquía | Ya existe casi todo |
| 4 VODs | Detalle con timeline: **nuevo y es el grueso** | Subida y lista ya existen |
| 5 Clips | Atajos y acciones por lotes | Rejilla ya está hecha |
| 6 Editor de clip | **Nuevo entero.** Recorte, forma de onda, arrastrar subtítulos | Es la fase más grande con diferencia |
| 7 Ajustes | Pulido | Los 20 ajustes, plataformas y plantillas ya existen |
| 8 Movimiento | Transiciones y esqueletos | Framer Motion no existe: CSS y Web Animations |
| 9 QA | Tal cual | |

La fase 6 y la mitad de la 4 son trabajo nuevo de verdad. El resto es rediseño
sobre algo que ya funciona.

---

## Lo que no he podido hacer

- **Figma.** El conector pide autorización y no puedo iniciarla yo. Si lo
  autorizas en los ajustes de conectores de claude.ai, hago los mockups antes de
  codificar como pide el brief.
- **Las skills `frontend-design`, `taste-skill` y `redesign-skill`** no existen con
  ese nombre. Cargué la equivalente real, `redesign-existing-projects`. También
  están disponibles `design-taste-frontend` y `high-end-visual-design` si las
  quieres en las fases de ejecución.
- **Graphify** tiene el grafo generado pero el ejecutable no está instalado, así
  que mapeé el proyecto leyendo el código directamente.

---

## Lo que necesito de ti para seguir

1. **¿Confirmas que NO migramos a Next.js/React/Tailwind?** Es lo que dice la
   regla 3 del brief, pero el brief también da por hecho que ya están. Si
   realmente quieres ese stack, es un proyecto distinto y mucho más largo, y hay
   que decidirlo ahora y no en la fase 6.
2. **¿De acuerdo con cuatro entradas de menú en vez de siete?**
3. **¿De acuerdo con no usar datos mock?**
4. Si quieres mockups en Figma, autoriza el conector.

Con eso arranco la Fase 1.

# Rediseño del panel: fases 1 a 9

Fecha: 2026-10-10. Continuación de `AUDITORIA-FASE-0.md`, que es donde están
las decisiones de partida y los dos puntos en los que me desvié del encargo.

Las decisiones que tomé por ti cuando dijiste "haz lo que consideres mejor":
se mantiene el stack real (Node a pelo, sin Next.js ni React ni Tailwind),
cuatro entradas de menú en vez de siete, y **ningún dato inventado** en ninguna
pantalla.

---

## Antes de nada: el fichero de 4.830 líneas

Era el problema de fondo, no uno más de la lista: seis veces se ha roto la
página entera porque una comilla invertida o una barra mal escapada dentro de
un comentario cerraba la plantilla de texto a media altura. El typecheck no lo
veía, porque para TypeScript seguía siendo una cadena válida.

Ahora son tres ficheros:

| Fichero | Líneas | Qué es |
|---|---|---|
| `src/review/page.ts` | 106 | El esqueleto del HTML |
| `src/review/estilos.ts` | 1.998 | La hoja de estilos |
| `src/review/guion.ts` | 4.520 | Estado, peticiones, pintado y eventos |
| `src/review/perdido.ts` | 104 | La página de "esto no existe" (nueva) |

No elimina el riesgo, pero lo acota: un fallo en el CSS ya no puede romper el
guion. Y de hecho el typecheck ya caza lo que antes se le escapaba — me pasó
dos veces durante este trabajo y las dos las detectó al instante.

---

## Fase 1 · Fundamentos

- Familias de color de estado completas (`--ok-*`, `--error-*`, `--info-*`).
- JetBrains Mono para datos: horas, duraciones, timecodes y cifras, con cifras
  de ancho fijo. Es lo que hace que una columna de horas se lea como columna.
- **Tema oscuro completo.** Fondo `#0F0F11`, no negro puro (el negro absoluto
  con texto blanco produce halo y cansa). El azul se aclara a `#5B76EE` porque
  `#4160E6` sobre ese fondo no llega a AA en texto pequeño.
- Los tokens oscuros se escriben **una vez** y se emiten en dos selectores:
  preferencia del sistema y `data-tema="oscuro"`, que antes existía pero no
  pintaba nada.
- Cuatro radios en escalera y tres alturas de elevación con significado
  (`plana` / `elevada` / `flotante`), donde antes había un radio y una sombra
  para todo.

Cuatro restos de tema claro que el oscuro dejó al descubierto, ya corregidos:
la cabecera pegajosa se quedaba blanca sobre todo lo demás, el wordmark KLIP
desaparecía (negro sobre negro), el aviso emergente era invisible y el barrido
del esqueleto oscurecía en vez de aclarar.

---

## Fase 2 · Shell

- **Enlace "Saltar al contenido"**, el primer tabulador de la página.
- **Buscador con Ctrl+K**. Busca pantallas, vídeos, clips, cuentas y **las 27
  perillas de Ajustes**. Al elegir un ajuste te lleva a su pantalla, baja hasta
  él y lo resalta dos segundos. Busca por todas las palabras en cualquier
  orden, no por la frase seguida.
- **Página 404** con la marca y la vuelta al panel. Un navegador recibe la
  página; la API sigue recibiendo su JSON de siempre.
- **Foco de teclado arreglado.** Había un `:focus-visible` universal, pero dos
  reglas lo anulaban en la práctica: `textarea:focus { outline: none }` pesa
  más y se lo comía, así que recorrer los ajustes con el tabulador era a
  ciegas. Y el anillo usaba el mismo azul que el botón principal, o sea que
  sobre un botón azul no se veía. Ahora es un anillo de dos tonos en índigo,
  que funciona encima de cualquier cosa y en los dos temas.

---

## Fase 3 · Inicio

El título de cada vídeo es ahora un botón que abre su detalle, y cada ficha
lleva su línea de tiempo compacta (ver fase 4).

---

## Fase 4 · Detalle de VOD, con la línea de tiempo

Es el elemento memorable del plan, y **no es decorativo**. Responde de un
vistazo a la pregunta que nadie podía contestar: por qué un directo de tres
horas sólo dio quince momentos. Mirando la lista de Inicio se ve que el VOD de
45 minutos los tiene repartidos de punta a punta y el de 182 minutos los tiene
todos apelotonados en el primer tercio. Eso es información sobre el material,
no sobre el programa.

Aparece en dos sitios y en ninguno más: compacta en cada ficha de Inicio,
completa en el detalle del vídeo, con eje de tiempos y leyenda.

El detalle es una profundidad más, no una entrada de menú: tiene rastro de
migas para volver, y debajo del eje la misma lista de momentos en orden de
aparición, porque desde el móvil no se puede acertar con el dedo en un
marcador de tres píxeles.

Endpoint nuevo: `GET /api/sources/:id`.

---

## Fase 5 · Revisar

- **Selección múltiple**, con casilla sobre cada miniatura y una barra pegada
  arriba: marcar todos, descartar o aprobar lo marcado.
- **Atajos de teclado de verdad.** Antes la A y la R actuaban siempre sobre la
  primera tarjeta de la rejilla, así que revisar era: mirar la primera,
  decidir, esperar a que la rejilla se recoloque, mirar la primera otra vez.
  Ahora hay una tarjeta en foco que se mueve con las flechas (o j/k), espacio
  la marca, Escape limpia la selección, y con algo marcado la A y la R
  resuelven la selección entera.
- Endpoint nuevo `POST /api/clips/lote`, con tope de 100 por petición. El
  reparto se dispara una vez por VOD al final, no una por clip.

---

## Fase 6 · Editar el clip

**El rótulo de título quemado en el vídeo**, que es lo que me pediste hace dos
semanas: la migración `014` estaba aplicada desde entonces pero ningún código
la usaba. Ahora la cadena está completa, de la base al fichero `.ass`:

- Siete ajustes nuevos (encendido, texto, altura, tamaño, dos colores y
  grosor), con sus límites y sus validaciones.
- El `.ass` declara un segundo estilo alineado arriba, y el rótulo va en la
  capa 1 para quedar por encima si llegara a solaparse con un subtítulo.
- Nace **apagado**: encenderlo cambia cómo salen todos los vídeos nuevos y esa
  decisión es tuya, no una que heredes por actualizar.
- Se puede tener rótulo **sin** subtítulos. Antes el fichero `.ass` sólo se
  escribía si había subtítulos, así que esa combinación habría hecho
  desaparecer el rótulo sin decir por qué.
- Las plantillas lo arrastran solas, porque salen de la misma lista de
  columnas.

**Arrastrar para colocar.** El rótulo y el subtítulo se agarran con el ratón
en la vista previa y se sueltan donde van; o se pulsan y se mueven con las
flechas, de 10 en 10 píxeles (de 50 en 50 con Mayúsculas). Elegir "alto" o
"casi en el centro" en un desplegable era elegir a ciegas: no dice si tapa la
cara de quien habla. El valor que sale del arrastre se añade como opción al
propio desplegable, así que sigue habiendo una sola fuente de verdad.

**Ajustar el corte de un momento**, plegado dentro de cada tarjeta de Revisar.
Pones el vídeo donde quieres que empiece y pulsas "Empieza aquí". Rehace **ese
clip solo** (`--solo clip-03`), que son veinte segundos de GPU en vez de los
veinte minutos de rehacer el VOD entero, y lo devuelve a pendientes: lo que
apruebes tiene que ser lo que se publica.

**Sobre la forma de onda que pedía el encargo: no la hice, y es deliberado.**
Obligaría a descargar y decodificar el audio de cada clip para enseñar un
dibujo del que se deduce lo mismo que ya ves y oyes en el reproductor que
tienes delante. El gesto útil aquí es parar el vídeo y decir "empieza aquí".
Si la quieres igualmente, dímelo y la hago.

---

## Fase 7 · Ajustes

El panel compara los ajustes vigentes con cada plantilla para marcar cuál está
puesta. Esa comparación miraba **ocho** campos de los veintisiete que existen,
así que una plantilla que sólo se diferenciara en el color del subtítulo salía
marcada como puesta sin serlo. Ahora recorre todos, derivados de la misma
lista que se manda al guardar, y no puede quedarse corta al añadir el
siguiente.

Lo demás de esta pantalla lo cubre el buscador: con 27 perillas en 8 tarjetas,
encontrar una era bajar leyendo títulos.

---

## Fase 8 · Movimiento

La regla de movimiento reducido ya era un `*` universal que cubría duraciones,
repeticiones, retardos y scroll. Lo que **no** cubría es
`scrollIntoView({behavior:'smooth'})` llamado desde JavaScript: la opción del
método pesa más que la propiedad CSS, así que el desplazamiento animado seguía
ocurriendo justo para quien había pedido que no ocurriera. Arreglado.

Añadido un desvanecido corto al cambiar de pantalla, sólo al cambiar y no en
cada repintado: `render()` corre varias veces por minuto mientras hay un
trabajo en marcha, y animar eso sería una página que palpita sola.

---

## Fase 9 · QA

- `npm run build` y `tsc --noEmit` limpios.
- **Todas las comprobaciones del proyecto pasan**, 230 en total:
  `panel 68/68`, `ajustes 29/29`, `metrics 27/27`, `nube 14/14`,
  `jobs 13/13`, `publicar 12/12`, `publish 11/11`, `cola 11/11`,
  `select 10/10`, `schema 10/10`, `texto 10/10`, `uploadpost 7/7`,
  `reparto 6/6`, `proyectos` correcto.
- `verify:db` sigue fallando 2 de 8. **No es una regresión:** compara el
  almacén en fichero, muerto desde el 2026-09-13, contra Postgres. Ya fallaba
  igual antes de empezar.
- Comprobaciones nuevas (10): rehacer un momento con identificador raro,
  cortes imposibles, que `--solo` llega bien y sin `--limit`, la 404 en sus
  tres formas, el enlace de salto, el buscador, y que **ningún color de tema
  está escrito a mano en el CSS** — ésta última probada contra la regresión
  real de la cabecera blanca, que detecta.
- Barrido por navegador de las nueve vistas, en claro y en oscuro, sin ningún
  error de consola nuevo. Móvil a 375 px sin desbordes.

---

## Lo que queda pendiente, y no es del rediseño

- Vídeo de demostración para la auditoría de TikTok (`GUION-DEMO.md`).
- El permiso `video.list` y volver a autorizar, para las estadísticas.
- `LEGAL_TITULAR` sin poner, y una inexactitud en la página de términos.
- Página pública de presentación.
- Saldo de la API de Anthropic agotado.
- Este proyecto **no está en control de versiones**. Vive dentro de
  `C:\Users\ssanc`, cuyo `.gitignore` lo excluye, y ese repositorio tiene
  remoto público. No lo meto ahí porque contiene el `.env` con las claves. Si
  quieres versionarlo, lo inicializo como repositorio propio y local.

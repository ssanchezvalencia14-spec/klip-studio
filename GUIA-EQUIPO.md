# KLIP studio: guia para el equipo

El panel vive aqui y se abre con un enlace propio:

    https://TU-PANEL.hostingersite.com/?k=LA-LLAVE

La llave hace falta solo la primera vez en cada movil u ordenador. Despues se
entra con la direccion sin nada detras.

**La llave es la contraseña.** Quien tenga ese enlace completo entra al panel.
No lo pegueis en grupos ni en documentos compartidos.

---

## El panel tiene cuatro secciones

| Seccion | Para que |
|---|---|
| **Inicio** | Añadir un video y ver en que punto esta cada uno |
| **Revisar** | Aprobar o descartar los clips. Es el trabajo del dia a dia |
| **Agenda** | Que se publica, cuando y en que cuenta. Y los resultados |
| **Ajustes** | Clientes, cuentas, horarios, textos e historial |

---

## El unico trabajo manual es revisar

Todo lo demas va solo. El circuito completo es:

    añadir el video -> se descarga y se transcribe -> se eligen los momentos
    -> se cortan y se subtitulan -> se suben para revisar
    -> [TU APRUEBAS]
    -> se preparan las copias por cuenta -> se colocan en el calendario
    -> se van entregando a TikTok

Las unicas dos cosas que hace una persona son **añadir el video** y **aprobar
los clips**. No hay que lanzar nada mas.

### Revisar

En **Revisar** salen los clips cortados, con su video y su texto.

- **Aprobar**: el clip entra en el reparto.
- **Descartar**: no se vuelve a proponer.
- El texto se puede editar antes de aprobar.

Desde el ordenador hay atajos: `A` aprueba y `R` descarta.

**Cuando terminas un video entero, el reparto arranca solo.** Mientras queden
clips sin mirar de ese video no se mueve nada: esta esperando a que decidas.

Si dejas un video a medias a proposito y quieres repartir lo que ya aprobaste,
en Inicio, dentro de "Reparto", esta el boton para hacerlo a mano.

### Añadir un video

En **Inicio**, pegando un enlace o subiendo un MP4. Se puede elegir a que
campaña va.

Si el video es **musica**, en su ficha hay un boton aparte: *"Es musica: buscar
estribillos"*. Encuentra los momentos midiendo el audio en vez de preguntarle a
la IA, asi que no gasta saldo y va mas rapido. Para entrevistas y charlas usa el
boton normal.

### Agenda

**Calendario** enseña que se publica, en que cuenta y a que hora, por dia. Si
algo tenia hora y no salio, sale en rojo.

**Resultados** son las cifras de lo publicado. Ahora mismo estan vacias: hacen
falta un permiso mas en TikTok y volver a autorizar las cuentas.

---

## Lo que NO se puede hacer desde el panel remoto

No es un fallo, es como esta montado.

**El trabajo pesado.** Descargar, transcribir, cortar y quemar subtitulos
necesitan la tarjeta grafica del ordenador de casa. El panel de Hostinger es
hosting compartido: no tiene GPU ni sitio para un video de 900 MB. El panel lo
dice en claro en vez de aceptarlo y dejarlo colgado.

Por eso **el ordenador de casa tiene que estar encendido** para que los videos
nuevos avancen. Lo aprobado ya repartido se sigue entregando igual.

---

## Lo que todavia no esta listo

### TikTok no ha aprobado la aplicacion

Mientras no pase la auditoria, TikTok **rechaza la publicacion directa**:

    unaudited_client_can_only_post_to_private_accounts

Lo que SI funciona es dejar el video en la **bandeja de entrada** de la cuenta:
llega una notificacion al movil, el titular la toca y publica desde TikTok
eligiendo sonido y portada.

O sea: el programa selecciona, corta, subtitula y entrega. El ultimo toque lo da
una persona.

**Ojo donde se busca.** No aparecen en "Borradores" ni en el perfil. Llegan a la
bandeja de entrada de la app movil, como notificacion.

### Las cifras de resultados

Hace falta añadir el permiso `video.list` en el portal de TikTok y volver a
autorizar las ocho cuentas. El recolector ya esta escrito y esperando.

---

## Limites que conviene conocer

- **Sandbox de TikTok: 10 cuentas como maximo.** Ahora hay 8 enlazadas.
- **Tope de la bandeja**: TikTok bloquea subidas nuevas si se acumulan sin
  publicar. El sintoma es `spam_risk_too_many_pending_share`. Se arregla
  publicando o descartando lo que espera en el movil. **Este es el cuello de
  botella real**: el programa entrega mas rapido de lo que se vacia la bandeja.
- **Supabase gratuito: 1 GB** para las copias de revision. Un clip ronda 4 MB.

---

## Si algo va mal

| Sintoma | Que mirar |
|---|---|
| El panel pide la llave otra vez | Se borraron las cookies. Volver a abrir el enlace con `?k=` |
| "Vencidas" en el Calendario | El ordenador de casa estuvo apagado. Se recupera solo al encenderlo |
| Una cuenta dice "sin enlazar" | Falta autorizarla, en Ajustes > Cuentas |
| Un video no avanza | Su ficha en Inicio dice en que paso esta y que falta |
| Algo fallo | Sale en Inicio, en "Algo fallo", con el motivo. El resto esta en Ajustes > Historial |

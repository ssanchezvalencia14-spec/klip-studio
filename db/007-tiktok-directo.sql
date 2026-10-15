-- Tokens de la API directa de TikTok, uno por cuenta.
--
-- Hasta ahora la publicacion pasaba por upload-post, que guardaba las
-- credenciales de cada cuenta en su lado y nos dejaba mandar solo un nombre de
-- perfil. Con la API directa el permiso lo guardamos nosotros.
--
-- QUE HAY AQUI EXACTAMENTE. No hay contraseñas de TikTok: nunca las vemos. Lo
-- que se guarda es lo que devuelve el flujo de autorizacion, que es un permiso
-- revocable desde la propia cuenta de TikTok en cualquier momento.
--
-- Aun asi, un access_token permite publicar en nombre de esa cuenta hasta que
-- caduca, asi que esta tabla es lo mas sensible de la base. No se expone por
-- ninguna ruta del panel: se lee solo desde el trabajador.
--
-- Tabla aparte y no columnas en `accounts` a proposito. Una cuenta existe y
-- tiene franjas horarias aunque nadie la haya autorizado todavia; mezclar las
-- dos cosas obligaria a llenar de nulos la fila de cada cuenta sin enlazar, y a
-- recordar limpiarlos al revocar.
create table if not exists tiktok_tokens (
  owner_id           uuid not null references owners(id) on delete cascade,
  -- La cuenta nuestra (acc-01...). Si se borra, el permiso deja de tener dueño.
  account_id         text not null,

  -- El identificador que TikTok da a esa cuenta. Es lo unico que nos permite
  -- saber que dos autorizaciones distintas son en realidad la misma cuenta.
  open_id            text not null,

  access_token       text not null,
  refresh_token      text not null,

  -- Cuando caduca cada uno. Se guarda el instante y no la duracion: "86400
  -- segundos" solo significa algo junto al momento en que se pidio, y ese dato
  -- se pierde en cuanto el proceso termina.
  --
  -- Medido en la documentacion de TikTok: el de acceso dura 24 h y el de
  -- refresco 365 dias.
  access_expires_at  timestamptz not null,
  refresh_expires_at timestamptz not null,

  -- Los permisos concedidos de verdad, que pueden ser menos que los pedidos si
  -- el usuario desmarco alguno en la pantalla de autorizacion.
  scope              text not null default '',

  -- Nombre visible de la cuenta en TikTok. Solo para que el panel pueda decir
  -- "acc-01 es @cuenta-ejemplo" en vez de un open_id ilegible.
  username           text not null default '',

  updated_at         timestamptz not null default now(),

  primary key (owner_id, account_id)
);

-- Una misma cuenta de TikTok no puede estar enlazada a dos cuentas nuestras.
-- Sin esto, autorizar la misma cuenta dos veces por error repartiria el mismo
-- destino entre dos franjas y publicaria el doble de lo previsto.
create unique index if not exists tiktok_tokens_open_id_idx
  on tiktok_tokens (owner_id, open_id);

-- ---------------------------------------------------------------------------
-- Autorizaciones a medias
-- ---------------------------------------------------------------------------
--
-- TikTok devuelve al usuario a nuestra direccion de retorno, y esa peticion NO
-- lleva la llave del panel: viene del navegador siguiendo una redireccion de
-- tiktok.com. Es la unica ruta del panel que tiene que atender a alguien sin
-- autenticar.
--
-- Sin esta tabla, esa ruta aceptaria cualquier cosa que le llegara. Con ella,
-- solo se admite un `state` que emitimos nosotros, que vale una vez y caduca:
-- el enlace que abre el navegador y la respuesta que vuelve quedan atados.
--
-- Vive en la base y no en memoria porque quien emite el enlace es el PC y quien
-- recibe la vuelta es el servidor. No comparten nada mas.
create table if not exists tiktok_pendientes (
  state      text primary key,
  owner_id   uuid not null references owners(id) on delete cascade,
  account_id text not null,
  created_at timestamptz not null default now()
);

-- Para barrer los que nadie completo. Una autorizacion abandonada no debe
-- quedarse valida para siempre.
create index if not exists tiktok_pendientes_edad_idx
  on tiktok_pendientes (created_at);

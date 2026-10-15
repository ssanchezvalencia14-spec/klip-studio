-- Un solo tope de cuentas, configurable, en lugar de tres numeros escritos a mano.
--
-- Hasta aqui el limite de cuentas vivia en tres sitios que no se hablaban:
--
--   queue/settings.ts   LIMITS.accounts = [1, 100]
--   review/server.ts    existentes.length + cuantas > 100
--   review/server.ts    maximo 50 por tanda al crear
--
-- Y un cuarto que no tenia ninguno: `npm run accounts -- --init` aceptaba
-- cualquier entero positivo. O sea que por consola se podian crear doscientas
-- cuentas y despues el panel se negaba a crear la numero ciento uno. Esa
-- incoherencia ya era un fallo antes de pensar en escalar.
--
-- Ahora el tope es un ajuste del propietario y sale de la base. Sube y baja
-- desde Horarios sin tocar codigo ni desplegar.
--
-- POR QUE 25 POR DEFECTO, y no 100 ni 20. El tope que manda no es este: es el
-- plan contratado de upload-post, que admite 25 perfiles (documentado en
-- publish/providers/uploadPost.ts). Un tope de 100 en el panel invita a crear
-- cuentas que despues fallan una por una al publicar, porque el perfil no
-- existe al otro lado. 25 es el numero real; quien cambie de plan sube el
-- ajuste.
alter table settings
  add column if not exists max_cuentas integer not null default 25;

-- El rango es amplio a proposito: el techo de 1000 no es una capacidad
-- medida, es un seguro contra un dedazo (escribir 10000 y que el panel intente
-- pintar diez mil filas). La capacidad real la deciden el plan del proveedor y
-- la concurrencia del trabajador, no esta columna.
do $$ begin
  alter table settings add constraint settings_max_cuentas_ok
    check (max_cuentas between 1 and 1000);
exception
  when duplicate_object then null;
end $$;

-- El tope nunca queda por debajo de las cuentas que YA existen.
--
-- Bajar un limite por debajo de lo que alguien ya tiene creado convierte una
-- actualizacion en una averia: el panel pasaria a decir "estas por encima del
-- tope" sin que nadie haya hecho nada. Con veinte cuentas creadas y un tope
-- nuevo de 25 no pasa nada, pero quien tenga mas de 25 conserva las suyas.
--
-- Escrito con GREATEST y no con un UPDATE condicional porque este fichero,
-- como todos los de db/, se vuelve a ejecutar entero en cada `db:setup`. Una
-- version anterior ponia `set max_cuentas = 100 where max_cuentas = 25`, que
-- la primera vez hacia lo correcto y en cada arranque posterior le deshacia el
-- ajuste a quien lo hubiera bajado a 25 a mano. Asi es idempotente: aplicarlo
-- mil veces da el mismo resultado que aplicarlo una.
update settings s
   set max_cuentas = greatest(
         s.max_cuentas,
         (select count(*) from accounts a where a.owner_id = s.owner_id)
       );

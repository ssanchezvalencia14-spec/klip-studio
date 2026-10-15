/**
 * El propietario de todo lo que hay en la base.
 *
 * Hoy hay uno solo y su identificador esta fijado. Las tablas llevan owner_id
 * desde el primer dia precisamente para que el dia que entren clientes solo
 * haya que dejar de usar esta constante, en vez de añadir una columna a ocho
 * tablas con datos dentro y revisar cada consulta.
 *
 * Es el mismo valor que escribe `npm run db:setup`.
 */
export const OWNER_ID = '11111111-1111-1111-1111-111111111111'

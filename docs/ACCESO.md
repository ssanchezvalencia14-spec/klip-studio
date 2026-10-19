# Acceso al panel: usuarios y contraseñas

Desde la Fase 2 se entra en el panel con **correo y contraseña**. La llave en
la dirección (`?k=...`) queda solo para la transición y se va a borrar.

---

## Cómo funciona

- **Sin registro público.** Las cuentas las crea un administrador.
- **Dos roles:**
  - **Administrador:** todo.
  - **Operador:** añade videos, revisa, aprueba y ve la agenda. No toca
    clientes, cuentas, horarios, estilo, plantillas, IA ni usuarios.

  Los permisos los aplica el servidor (`permitido()` en `src/auth/auth.ts`).
  Esconder pestañas en la pantalla es solo comodidad.
- **Contraseñas** con bcrypt, de 10 caracteres como mínimo.
- **Sesión** en una galleta `klip_sesion` con `HttpOnly`, `SameSite=Lax` y
  `Secure` detrás de https. Dura **7 días** y se renueva sola mientras se usa.
  En la base solo se guarda el hash del token. No hay tokens en
  `localStorage` ni en la URL.
- **Bloqueo por intentos:** 5 fallos del mismo correo o 20 desde la misma
  dirección en 15 minutos bloquean los intentos durante 15 minutos.
- **Mensaje genérico:** "Correo o contraseña incorrectos." Nunca dice si el
  correo existe.
- **Contraseña olvidada:** no hay correo configurado, así que un administrador
  le pone una nueva desde **Ajustes → Usuarios**. Se cierran sus sesiones y, al
  entrar, el panel le pide elegir la suya.
- **Peticiones desde otra web:** se rechaza cualquier cambio cuya cabecera
  `Origin` no sea la del panel.

### Programas, no personas: `WORKER_TOKEN`

Un programa que llame al panel lleva `Authorization: Bearer <WORKER_TOKEN>`,
nunca la sesión de una persona. **Hoy el trabajador no llama al panel**: los
dos solo comparten la base de datos (`docs/ARQUITECTURA.md`). Por eso el
trabajador sigue funcionando igual y no necesita el token. Queda preparado por
si algún día lo necesita.

### Vista previa de desarrollo: `KLIP_SIN_LOGIN=1`

Abre el panel sin login, solo para quien está sentado en ese ordenador:
escucha en `127.0.0.1` y rechaza cualquier petición que llegue por un proxy.
`npm run` con `scripts/preview-panel.ts` lo usa. **Nunca en Hostinger.**

---

## Pasos para activarlo (en este orden)

1. **Migrar la base** desde el PC (crea `usuarios`, `sesiones` e
   `intentos_acceso`; no toca datos existentes):

   ```
   npm run db:setup
   ```

2. **Crear el primer administrador.** La contraseña se pide por teclado y no
   se ve al escribirla:

   ```
   npm run crear-admin -- tu-correo@ejemplo.com "Tu nombre"
   ```

3. **En Hostinger**, en las variables del panel, poner durante la transición:

   ```
   LEGACY_KEY_ENABLED=true
   ```

   Así el enlace con la llave sigue funcionando mientras se prueba el login.

4. **Desplegar** (`npm run desplegar`) y entrar en `/login` con el
   administrador.

5. Crear al resto del equipo desde **Ajustes → Usuarios**.

6. **Cuando el login esté confirmado:**
   - En Hostinger: `LEGACY_KEY_ENABLED=false` y borrar `REVIEW_KEY` y
     `REVIEW_PASSWORD`.
   - **Rotar la llave antigua:** se compartió en un chat. Aunque deje de
     funcionar al quitarla, no la reutilices en ningún otro sitio.
   - Avisar para borrar el código de la llave (`?k=`) del servidor.

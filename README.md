# vMix Audio Console

Consola web para controlar y monitorear el audio de una o varias instancias
de vMix por su API TCP (puerto 8099 por defecto): volumen, mute, gain,
ruteo de inputs a buses, solo, vúmetros con escala en dB, y selección de
qué entradas mostrar (con selecciones guardadas por servidor).

## Requisitos

- Node.js 18 o superior (o Docker).
- vMix corriendo con la API TCP habilitada (activada por defecto en el
  puerto 8099).

## Instalación manual

```
npm install
npm start
```

Por defecto la consola queda en `http://localhost:3099`, accesible solo
desde la misma máquina. Variables de entorno disponibles:

- `WEB_HOST` (default `127.0.0.1`) — poné `0.0.0.0` para que sea accesible
  desde otras máquinas de la red.
- `WEB_PORT` (default `3099`).
- `SERVERS_FILE` — ruta del archivo donde se guarda la lista de servidores
  vMix configurados (default `servers.json` en la raíz del proyecto).
- `AUTH_FILE` — ruta del archivo donde se guarda el usuario/contraseña de
  acceso (default `auth.json` en la raíz del proyecto).

### Login

La primera vez que arranca crea un usuario **admin / admin** (guardado con
hash, no en texto plano). Entrá y cambiala desde el ícono 🔒 de la consola
(sección Cuenta) antes de dejarla expuesta a nadie más.

## Instalación con Docker

```
docker compose up -d --build
```

Esto deja la consola en `http://localhost:3099` (o el puerto que uses en
el `docker-compose.yml`), con la lista de servidores vMix y el
usuario/contraseña persistidos en `./data/` en el host, para que
sobrevivan a un rebuild del contenedor.

## Seguridad

La consola pide usuario y contraseña (admin/admin por defecto, cambiala
apenas entres). Aun así, si la exponés con `WEB_HOST=0.0.0.0` o la
publicás fuera de tu red local, cualquiera que adivine o consiga esas
credenciales puede controlar el audio de los servidores vMix configurados.
Se recomienda usarla en red local o detrás de un túnel/VPN, y con una
contraseña propia (no dejarla en admin/admin).

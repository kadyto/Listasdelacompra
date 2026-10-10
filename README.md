# La Compra

Listas de la compra para un espacio familiar compartido, con catálogo común y comparación de los precios que tú registras. Interfaz en español, pensada para Android y escritorio. React + TypeScript + Vite, API Fastify y SQLite; un contenedor, sin cuentas ni servicios comerciales.

## Empieza aquí

La versión de uso está en la rama **`main`**. Sigue la [guía paso a paso para instalar y probar](docs/INSTALACION.md): incluye los comandos para descargarla, configurar las carpetas y permisos, arrancar Docker, acceder desde Android y comprobar las listas, los precios y la persistencia. No necesitas instalar Node.js en el sistema anfitrión.

Si creas el stack pegando YAML en **Dockhand**, utiliza la [guía de Dockhand](docs/DOCKHAND.md) y [compose.dockhand.yaml](compose.dockhand.yaml). Ese stack descarga el código comprimido por HTTPS y no necesita Git para construir la imagen.

```sh
git clone --branch main https://github.com/kadyto/Listasdelacompra.git
cd Listasdelacompra
```

Si ya tienes el repositorio, conserva tu `.env` y tus carpetas de datos. Comprueba `git status`, cambia a `main` con `git switch main` y actualiza con `git pull --ff-only origin main`. No descartes cambios locales para actualizar. Antes de arrancar, completa los pasos de configuración de la guía.

## Funcionalidades

- Crear, editar y desactivar supermercados. Carrefour, Costco, DIA y Mercadona se crean en la primera instalación; no se incluyen productos ni precios ficticios.
- Crear y editar productos con marca, categoría, formato, EAN y notas. Seleccionar varias listas al crearlos y añadirlos a otras después. Buscar por nombre, marca o EAN y gestionar categorías.
- Comprar con cantidades y estados independientes por lista, notas, pendientes/comprados, orden por categoría/nombre/manual y vaciado con confirmación.
- Registrar precios aunque el producto no esté en una lista. Consultar el último por comercio, fecha, historial, ofertas, menor registrado, diferencias en euros y porcentaje y precio por litro, kilo o unidad.
- Corregir o eliminar registros erróneos sin perder los demás. El historial permanece al retirar artículos o marcar compras.
- Modo claro/oscuro y PWA instalable en un origen HTTPS compatible.

Los precios son **referencias históricas**, nunca precios actuales garantizados. Los de más de 30 días se señalan como antiguos. La estimación suma solo pendientes con precio registrado en ese comercio (precio del envase × cantidad); los desconocidos se indican y **no equivalen a cero**. El porcentaje de ahorro es `(precio de referencia − menor registrado) / precio de referencia × 100`; con referencia cero, no hay porcentaje.

## Desarrollo y pruebas

Requisitos: **Node.js 24**, npm y Chromium para las pruebas de navegador. `node:sqlite` está incluido en Node y evita compilar módulos nativos.

```sh
npm ci
npm run dev
```

Vite usa el puerto 5173 y envía `/api` a Fastify en el 3000. La base local es `data/compra.sqlite`, excluida de Git. No abras los puertos de desarrollo a Internet. Si el entorno en la nube no permite escribir en la caché del usuario, usa `npm ci --cache /workspace/.cache/npm`.

```sh
npm run build
npm test
npm run test:e2e
npm run test:docker
```

`build` verifica TypeScript y compila cliente y servidor. `npm start` sirve aplicación y API desde el mismo puerto 3000. Las pruebas de integración usan SQLite temporales; las E2E usan otra base en `test-results` y prueban tamaños Android y escritorio. No utilizan la base real. Capturas e informes quedan en carpetas ignoradas.

Playwright utiliza `/usr/bin/chromium` si existe; puedes indicar `PLAYWRIGHT_CHROMIUM_PATH`. Si no tienes Chromium, instala con `npx playwright install --with-deps chromium`. Las pruebas Docker requieren Docker Engine y Compose v2: construyen una imagen y usan un proyecto y directorios temporales para verificar API, reinicio, recreación y backup/restauración.

Si el entorno de pruebas utiliza un proxy TLS propio, las pruebas Docker admiten `BUILD_CA_CERT` con una ruta al certificado/bundle de confianza proporcionado por ese entorno. Se monta solo durante el build mediante un secret de BuildKit y no se copia a la imagen ni al repositorio. La verificación TLS y los hashes del lockfile permanecen activos. Los entornos sin ese proxy no necesitan esta opción.

## Despliegue en entornos Docker

Necesitas Docker Engine con Compose v2 y una terminal; no hace falta Node.js en el sistema anfitrión. Ejecuta los comandos desde la carpeta de este repositorio.

1. Descarga la rama `main` en una carpeta del sistema anfitrión con los comandos de «Empieza aquí».
2. Copia `.env.example` a `.env`. Adapta `DATA_DIR` y `BACKUP_DIR` a carpetas persistentes **fuera del código**; puedes usar rutas absolutas privadas. No subas esas rutas a GitHub.
3. Averigua el UID y GID del propietario (`id -u`, `id -g`) y configúralos en `APP_UID`/`APP_GID`. Crea ambas carpetas antes de arrancar: Docker podría crearlas como root si no existen.

```sh
cp .env.example .env
mkdir -p data backups
chmod 700 data backups
# Ajusta el propietario a los UID/GID de .env con las herramientas del sistema.
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=100 app
```

El ejemplo crea las rutas relativas predeterminadas; con rutas absolutas, crea **esas** carpetas. El usuario del contenedor debe poder leer y escribir `/data` y `/backups`, incluidos los archivos `-wal`/`-shm`. No uses permisos 777. Guarda SQLite en un disco local del sistema anfitrión, con bloqueo fiable, no en un montaje SMB/NFS. Mantén una sola instancia por base de datos.

`HTTP_PORT` configura el puerto exterior (3080 por defecto); el interior es 3000. `BIND_ADDRESS=127.0.0.1` limita el acceso al sistema anfitrión y es lo recomendado con Tailscale Serve. Se incluyen reinicio `unless-stopped`, healthcheck con consulta SQLite, cierre al recibir SIGTERM, usuario sin privilegios, aplicación de solo lectura y volumen persistente.

### A. Tailscale Serve con HTTPS privado (recomendado)

Requiere Tailscale instalado **en el sistema anfitrión**, CLI con Serve, permisos de la tailnet y certificados HTTPS habilitados. La disponibilidad de Serve depende del entorno y de la instalación de Tailscale; consulta [Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve). Si no está disponible, utiliza B.

Con el contenedor escuchando en loopback, ejecuta en el sistema anfitrión:

```sh
tailscale serve --bg http://127.0.0.1:3080
tailscale serve status
```

Sustituye 3080 por tu `HTTP_PORT`. Usa la URL HTTPS privada que devuelve Tailscale. Si ya tienes otra aplicación en Serve, revisa su configuración y asigna un puerto HTTPS independiente. La Compra debe estar en la **raíz del origen**, no en un subdirectorio. Serve permite acceso privado en la tailnet; **no uses Funnel ni abras puertos del router**.

Si Tailscale está en otro contenedor, su `127.0.0.1` puede ser distinto del sistema anfitrión. Debe alcanzar el puerto del host con una configuración compatible (por ejemplo red de host, si tu instalación lo permite). No lo publiques para resolverlo. Si un proxy privado cambia `Host` y ves «Origen no autorizado», configura `ALLOWED_ORIGINS` con tu origen HTTPS exacto; nunca `*`. Normalmente se deja vacío.

### B. IP LAN o Tailscale del servidor y puerto HTTP

Configura `BIND_ADDRESS` con la **IP de interfaz** que quieras usar, o `0.0.0.0` para ambas redes (escucha en todas las interfaces). Aplica con `docker compose up -d`. Abre `http://IP_DEL_SERVIDOR:PUERTO` desde un dispositivo autorizado, usando tus valores reales.

Restringe acceso con el firewall del entorno y ACL/grants de Tailscale. IP LAN + HTTP no cifra la aplicación. El transporte Tailscale está cifrado, pero el navegador sigue viendo HTTP sin contexto seguro. No configures UPnP ni redirecciones del router y verifica que el puerto solo sea accesible por los dispositivos autorizados.

## Instalar en Android (PWA)

Abre la URL **HTTPS** de Tailscale Serve en Chrome para Android y usa «Instalar aplicación»/«Añadir a la pantalla de inicio» cuando Chrome lo ofrezca. Incluye manifiesto, iconos PNG 192/512, icono maskable y service worker; se abre sin las barras del navegador.

Una IP privada **HTTP** normalmente no admite service workers ni instalación completa; la excepción de localhost no se aplica al acceder a un servidor remoto desde Android. La web funciona conectada en HTTP y puede haber un acceso directo simple, pero la PWA depende de HTTPS y los criterios del navegador.

No hay sincronización offline. El service worker cachea recursos estáticos y muestra una página clara sin conexión; **no cachea `/api` ni encola escrituras**. Si la conexión falla, no presenta cambios como guardados. Mantén la conectividad/Tailscale activos durante la compra. Los datos se refrescan cada 20 segundos mientras la página es visible y al volver a ella.

## Actualizar sin perder datos

Haz una copia consistente antes de actualizar. Desde el repositorio en el entorno de despliegue:

```sh
git pull --ff-only
docker compose build --pull
docker compose up -d --wait
docker compose ps
```

Mantén el checkout en `main` para recibir la versión de uso. Reconstruir/recrear no elimina las carpetas montadas. No borres `DATA_DIR`, no guardes la base en la imagen ni ejecutes limpieza sobre los datos. Las migraciones SQL se aplican transaccionalmente al arrancar y se registran por versión. Para volver a código con esquema incompatible, detén la aplicación y restaura una copia compatible; no hay downgrade automático.

## Copias SQLite consistentes

La base usa WAL. **No copies solo `compra.sqlite` mientras esté abierta**: perderías transacciones del WAL. La herramienta usa la API de backup de SQLite, incluso con el servicio activo, y verifica integridad y claves foráneas.

```sh
docker compose exec -T app node dist/server/maintenance.js backup /backups/compra-2026-10-09.sqlite
```

Elige un nombre nuevo por copia; se rechaza sobrescribir destinos. El archivo aparece en `BACKUP_DIR` con permisos 600. Cópialo a otro dispositivo protegido y prueba su restauración. Contiene datos familiares: nunca lo subas al repositorio. Conserva también la versión desplegada y tu `.env` de forma privada.

En local:

```sh
npm run db:backup -- ./backups/compra-copia.sqlite
```

### Restaurar

**Detén todas las instancias y herramientas que utilicen la base.** Coloca la copia en `BACKUP_DIR`:

```sh
docker compose stop app
docker compose run --rm --no-deps app node dist/server/maintenance.js restore /backups/compra-2026-10-09.sqlite --confirm-stopped
docker compose up -d --wait
docker compose logs --tail=100 app
```

La confirmación indica que has detenido los accesos; no se pueden detectar procesos en otros contenedores. Se valida la copia, se guarda otra consistente del estado anterior junto a la base (`compra.sqlite.before-restore-….sqlite`) y se sustituye el archivo atómicamente, retirando WAL/SHM antiguos. Si la copia o el backup previo fallan, se aborta antes de sustituir los datos.

En local, detén `npm run dev`/`npm start` y ejecuta `npm run db:restore -- ./backups/compra-copia.sqlite --confirm-stopped`. `DATABASE_PATH` permite seleccionar otra base. Después verifica productos, listas e historial desde la interfaz.

## Arquitectura y seguridad

```
src/                  React, formularios, pantallas y estilos
server/               Fastify, Zod, SQLite y mantenimiento
server/migrations/    SQL versionado y vista de últimos precios
tests/                Lógica, API, persistencia y backups
e2e/                  Navegador Android/escritorio
scripts/              Validación Docker aislada
public/               PWA e iconos locales
```

Tablas normalizadas: `stores`, `categories`, `products`, `shopping_lists`, `list_items` y `price_records`, con claves foráneas y restricciones. Identificadores estables, una lista activa por comercio (índice parcial) y un producto por lista. El modelo permite futuras listas adicionales.

Los precios son céntimos enteros; cocientes unitarios/porcentajes solo se calculan y redondean para presentar. Se convierten gramos/ml a kg/l. Se compara **el mismo identificador de producto**, nunca formatos incompatibles. Se normalizan nombre/marca y formatos equivalentes para evitar duplicados; el EAN es único. Cambiar el formato con precios registrados requiere otro producto para conservar la validez del historial.

API bajo `/api`: comercios, categorías, catálogo/ficha, listas/artículos/orden, precios, resumen y healthcheck. SQL parametrizado, validación, transacciones, límites de tamaño y errores en español. «Último» depende de la fecha registrada, desempata por identificador; corregir edita ese registro, registrar un nuevo precio siempre añade otro.

**No hay autenticación: cualquier dispositivo que alcance el puerto puede leer y modificar todos los datos.** Tailscale/LAN son el límite de acceso; una LAN no identifica por sí sola usuarios autorizados. Hay cabeceras de seguridad y protección de origen para mutaciones del navegador; no sustituyen autenticación ni protegen de un dispositivo autorizado comprometido. El hook global Fastify permite añadir autenticación más adelante. No expongas esta versión a Internet.

No se incluyen escaneo, CSV, gráficos, cuentas, alertas ni sincronización offline. `.gitignore`/`.dockerignore` excluyen datos, copias, secretos y configuración local. Las pruebas solo utilizan datos sintéticos.

## Validación en el entorno de despliegue

Las pruebas cubren creación en dos listas, precios distintos, selección por fecha, historial, estados independientes, retirada sin perder precios y reapertura de SQLite. Las E2E cubren crear/registrar/comparar en pantalla móvil, modo oscuro y recursos PWA. La prueba Docker verifica persistencia al reiniciar y **recrear**, y backup/restauración en caliente.

Los permisos de las carpetas, el firewall, Tailscale Serve, los certificados y la instalación desde Chrome en Android se deben comprobar en cada entorno de despliegue. Las pruebas automatizadas no verifican la configuración de acceso de cada instalación.

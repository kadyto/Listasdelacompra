# Desplegar en Dockhand

Utiliza [compose.dockhand.yaml](../compose.dockhand.yaml) como contenido del stack. Docker descarga el código público de `main` por HTTPS y construye la imagen en tu entorno; no necesitas una cuenta de registro de imágenes ni Git en Dockhand o en el constructor.

## Preparar carpetas y variables

1. Crea dos carpetas persistentes en el sistema anfitrión: una para los datos y otra para las copias. Utiliza disco local y rutas absolutas, fuera de la carpeta del código. Conserva las rutas existentes si ya tienes datos.
2. Asigna ambas carpetas a una cuenta sin privilegios que pueda escribir en ellas. Consulta su UID/GID con `id -u` e `id -g`, ejecutados como esa cuenta. Configura permisos `700`; no utilices `777` ni UID `0`.
3. En las variables del stack de Dockhand, configura estos valores. Las rutas son ejemplos que debes sustituir por las carpetas que has creado:

```dotenv
APP_UID=1000
APP_GID=1000
DATA_DIR=/ruta/a/listas/data
BACKUP_DIR=/ruta/a/listas/backups
BIND_ADDRESS=127.0.0.1
HTTP_PORT=3080
ALLOWED_ORIGINS=
```

Sustituye `1000` por el UID/GID de la cuenta propietaria. `127.0.0.1` permite acceder desde el propio sistema anfitrión y utilizar Tailscale Serve. Para abrir la aplicación por IP desde otro dispositivo de la red privada, usa la IP de la interfaz del anfitrión en `BIND_ADDRESS`; `0.0.0.0` escucha en todas las interfaces. Los detalles de acceso HTTPS y prueba están en [Instalar y probar](INSTALACION.md#5-acceder-desde-el-móvil).

## Crear y probar el stack

1. Crea el stack mediante el editor YAML de Dockhand y pega el contenido completo de [compose.dockhand.yaml](../compose.dockhand.yaml). Si ya existe, edita ese stack conservando sus variables y rutas.
2. Configura las variables anteriores y despliega el stack. La primera construcción descarga Node y las dependencias; espera a que termine.
3. Comprueba que el contenedor `app` está en ejecución y su estado de salud es `healthy`. Si falla, consulta los logs del contenedor.
4. Abre `http://IP_DEL_SERVIDOR:3080` si has configurado acceso por IP, o la URL HTTPS de Tailscale Serve. Usa el puerto que hayas elegido.
5. Sigue las [pruebas de listas y precios](INSTALACION.md#6-probar-listas-y-comparación-de-precios). Reinicia y recrea el contenedor desde Dockhand, conservando los montajes, y comprueba que siguen los datos.

Si dispones de terminal en el contenedor, puedes verificar la API con:

```sh
node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Debe responder `{"status":"ok"}`.

## Actualizar

Antes de actualizar, ejecuta una [copia consistente](../README.md#copias-sqlite-consistentes) desde la terminal del contenedor, con un nombre nuevo:

```sh
node dist/server/maintenance.js backup /backups/antes-de-actualizar-001.sqlite
```

Después, solicita en Dockhand la reconstrucción de la imagen y el despliegue del stack. La construcción descarga la versión actual de `main`; reiniciar el contenedor por sí solo no actualiza el código. Conserva las mismas variables, carpetas y montajes.

## Error: `git` no está en `$PATH`

Un contexto como `https://github.com/kadyto/Listasdelacompra.git#main` requiere Git en el componente que descarga ese contexto. Si falta, la construcción falla antes de leer el Dockerfile; instalar Git dentro de la imagen de la aplicación no resuelve ese paso.

El stack de esta guía utiliza un archivo `.tar.gz` público. Son necesarias las tres opciones, porque GitHub incluye una carpeta raíz en el archivo:

```yaml
build:
  context: https://github.com/kadyto/Listasdelacompra/archive/refs/heads/main.tar.gz
  dockerfile: Listasdelacompra-main/Dockerfile
  args:
    SOURCE_DIR: Listasdelacompra-main
  target: production
```

Mantén el nombre de la carpeta y las opciones indicadas. Cambiar solo la URL dejaría el Dockerfile y los archivos de construcción en otra ubicación.

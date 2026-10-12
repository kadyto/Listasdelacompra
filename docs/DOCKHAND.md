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

### Desde la aplicación, a partir de 1.3.0

Instala primero esta funcionalidad **reconstruyendo la imagen y desplegando el stack una vez**, con las mismas variables y montajes. Si el pie todavía muestra 1.1.0 o 1.2.x, el arranque instalado aún no incorpora el actualizador.

Después, cuando el pie indique **Actualización disponible**:

1. Guarda los cambios de los formularios y pulsa **Actualizar**.
2. Confirma con **Actualizar aplicación**. La ventana muestra descarga, instalación de dependencias, compilación, prueba y reinicio. Puedes cerrarla mientras se prepara la versión; el proceso sigue en el servidor.
3. Espera a que la página se recargue y comprueba la versión del pie. Se hace una copia SQLite automática antes de cambiar de versión; aparece en **Ajustes → Copias de seguridad**, con el nombre `antes-de-actualizar-...sqlite`.

El código se descarga de un commit de `main` que haya pasado las pruebas de GitHub. Si esas pruebas aún están ejecutándose, espera a que terminen y reintenta. La actualización se prepara en `DATA_DIR/.app-runtime` con el usuario del contenedor, y queda guardada al reiniciar o recrear el stack. Si el nuevo arranque falla, se recuperan automáticamente el código y los datos anteriores. La imagen permanece de solo lectura; las dependencias y versiones nuevas se escriben en el volumen de datos existente.

Permite HTTPS hacia GitHub (`api.github.com` y `codeload.github.com`) y `registry.npmjs.org`. El volumen de datos necesita espacio para versiones, caché y copias: se comprueban al menos 512 MB libres adicionales al espacio de SQLite. Ese montaje debe permitir ejecutar las herramientas de compilación. Si aparece un error, revisa el mensaje y los logs del contenedor. Las actualizaciones de Node.js o del arranque de la imagen se realizan desde Dockhand.

### Reconstruir la imagen desde Dockhand

Al pie de la aplicación tienes **Proyecto en GitHub**, el número de versión, el identificador de la compilación instalada y la fecha de comprobación. El indicador consulta la rama `main` desde el servidor y muestra **Al día**, **Actualización disponible** o **No se pudo comprobar**. La comprobación automática se guarda durante una hora, o cinco minutos si falla. El botón de recarga solicita una consulta nueva, con un límite compartido de una comprobación manual por minuto. No necesitas añadir variables al stack.

Antes de actualizar, abre **Ajustes → Copias de seguridad** y pulsa **Crear copia**. También puedes hacer una [copia consistente](../README.md#copias-sqlite-consistentes) desde la terminal del contenedor, con un nombre nuevo:

```sh
node dist/server/maintenance.js backup /backups/antes-de-actualizar-001.sqlite
```

Después, solicita en Dockhand la reconstrucción de la imagen y el despliegue del stack. La construcción descarga la versión actual de `main`; reiniciar el contenedor por sí solo no actualiza el código. Conserva las mismas variables, carpetas y montajes.

Recarga la aplicación y comprueba la versión del pie. **Actualización disponible** abre el historial de GitHub, pero no modifica el stack. Si aparece **No se pudo comprobar**, revisa que el contenedor puede salir por HTTPS a `api.github.com`; la aplicación sigue funcionando y vuelve a intentarlo pasados cinco minutos.

### Probar el aviso sin actualizar la aplicación

En las versiones 1.1.0 y 1.2.0, el botón de comprobar reutiliza la caché de una hora. Si acabas de publicar una actualización y sigue apareciendo **Al día**, reinicia únicamente el contenedor `app` desde Dockhand y recarga la aplicación. Ese reinicio borra la caché de comprobación, conserva la imagen instalada y permite detectar la actualización. A partir de 1.2.1, utiliza el botón para consultar GitHub de nuevo y revisa la fecha que muestra el pie.

Reiniciar y actualizar son operaciones distintas: para instalar el código nuevo hay que reconstruir la imagen y volver a desplegar. Si tras una reconstrucción permanece el número de versión anterior, solicita una construcción sin caché y la recreación del contenedor, conservando las variables y los montajes.

## Copias y restauración desde Ajustes

Abre **Ajustes → Copias de seguridad** en la aplicación. **Crear copia** guarda el archivo SQLite en la carpeta que tienes configurada en `BACKUP_DIR`; dentro del contenedor se llama `/backups`. **Descargar** guarda otra copia en tu móvil u ordenador.

Para recuperar datos, pulsa **Restaurar** en el archivo elegido y lee la confirmación. Se sustituirán los datos del espacio familiar por los de la copia. La aplicación guarda primero una copia automática del estado actual en la misma carpeta, pausa el acceso a los datos durante la operación y actualiza las pantallas al terminar. No necesitas SSH ni detener el stack. Si una copia no es válida o no es compatible, se conservan los datos actuales.

Las carpetas de datos y copias deben permitir escribir al UID/GID del contenedor. Si utilizas una versión antigua sin estos botones, reconstruye y despliega el stack desde `main`, y recarga la aplicación. Para recuperar una instalación que no arranca, utiliza la [restauración desde terminal](../README.md#restaurar-desde-terminal).

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

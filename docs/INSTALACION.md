# Instalar y probar La Compra

Esta guía utiliza la rama **`main`** y Docker Compose para instalar la aplicación en un entorno Docker. No necesitas Node.js en el sistema anfitrión. La aplicación se construye desde el código: no hay que descargar una imagen publicada en un registro propio del proyecto.

## 1. Preparar el entorno

Instala o activa Docker Engine con Compose v2 y abre una terminal del sistema anfitrión, localmente o mediante SSH autorizado. Elige una carpeta del disco local para el proyecto. Comprueba:

```sh
git --version
docker version
docker compose version
```

Docker debe mostrar también información del **servidor**, y Compose debe ser v2. Si aparece «permission denied» al acceder a Docker, utiliza una cuenta autorizada para gestionar Docker en ese entorno. Si no tienes Git, descarga el ZIP de `main` desde GitHub, descomprímelo y abre una terminal en esa carpeta. En ese caso, las actualizaciones del código se harán descargando otro ZIP y conservando la configuración y los datos fuera de la carpeta del código.

## 2. Descargar `main`

Desde la carpeta que has elegido:

```sh
git clone --branch main https://github.com/kadyto/Listasdelacompra.git
cd Listasdelacompra
```

Si ya lo descargaste con Git:

```sh
cd Listasdelacompra
git status
git switch main
git pull --ff-only origin main
```

Si Git detecta cambios locales o no puede avanzar, conserva esos cambios y resuelve la situación antes de actualizar; no uses `reset --hard`. No vuelvas a copiar `.env.example` sobre un `.env` que ya has configurado.

## 3. Configurar datos, permisos y puerto

En una instalación **nueva**, empieza con:

```sh
cp .env.example .env
mkdir -p data backups
chmod 700 data backups
id -u
id -g
```

Edita `.env` con un editor de texto:

| Variable | Qué poner |
| --- | --- |
| `APP_UID` | El UID de la cuenta propietaria de las carpetas. Lo muestra `id -u` si esa es tu cuenta. |
| `APP_GID` | El GID de esa cuenta, mostrado por `id -g`. |
| `DATA_DIR` | Carpeta persistente para SQLite. `./data` sirve para probar; para uso diario es preferible una ruta absoluta del sistema anfitrión fuera de la carpeta del código. |
| `BACKUP_DIR` | Carpeta persistente para copias. `./backups` sirve para probar; también puedes usar una ruta absoluta aparte. |
| `HTTP_PORT` | Puerto libre del sistema anfitrión; por ejemplo `3080`. |
| `BIND_ADDRESS` | `127.0.0.1` si vas a usar Tailscale Serve. Para acceder por IP, consulta el paso 5. |
| `ALLOWED_ORIGINS` | Déjalo vacío salvo que tu proxy privado reescriba `Host`; consulta el README en ese caso. |

Si usas rutas absolutas, crea **esas carpetas** y asigna su propietario al UID/GID elegido; el `mkdir` anterior solo crea las rutas relativas. Si la terminal es de root, configura una cuenta sin privilegios que sea propietaria de las carpetas, no UID 0. No uses permisos 777. SQLite necesita disco local y bloqueo fiable; no guardes la base en una carpeta montada por SMB/NFS.

## 4. Construir y arrancar

Desde la raíz del repositorio:

```sh
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
```

La primera construcción descarga dependencias y tarda más. La última orden debe mostrar el servicio `app` en ejecución y **healthy**. Comprueba la API desde el propio contenedor, sin necesitar `curl` en el sistema anfitrión:

```sh
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Resultado esperado: `{"status":"ok"}`. Si no arranca:

```sh
docker compose logs --tail=100 app
```

Con `BIND_ADDRESS=127.0.0.1`, el puerto todavía no es accesible directamente desde Android: completa el paso siguiente.

## 5. Acceder desde el móvil

### Opción recomendada: Tailscale Serve y HTTPS

Tailscale debe estar instalado y conectado a tu tailnet en el sistema anfitrión y en el dispositivo Android. La instalación del anfitrión debe admitir Serve y certificados HTTPS. Con el puerto de ejemplo `3080`, ejecuta **en el sistema anfitrión**:

```sh
tailscale serve --bg http://127.0.0.1:3080
tailscale serve status
```

Sustituye `3080` si cambiaste `HTTP_PORT`. Abre en Chrome para Android la **URL HTTPS que devuelve Tailscale**. No es `localhost` del teléfono. Si ya utilizas Serve para otra aplicación, revisa su configuración antes de añadir esta; La Compra requiere la raíz de su origen, no un subdirectorio. Si Tailscale está dentro de otro contenedor, consulta las indicaciones de red del [README](../README.md#a-tailscale-serve-con-https-privado-recomendado).

Este acceso es privado para la tailnet. No actives Funnel ni abras puertos del router. Una vez abierta la aplicación por HTTPS, Chrome puede ofrecer «Instalar aplicación» o «Añadir a la pantalla de inicio».

### Alternativa: IP LAN o Tailscale y puerto

Si no puedes usar Serve, cambia `BIND_ADDRESS` en `.env` a la IP de la interfaz del sistema anfitrión que quieres utilizar. `0.0.0.0` permite ambas interfaces, pero escucha en todas ellas: limita el acceso con el firewall del entorno y las reglas de Tailscale.

```sh
docker compose up -d --wait
```

Abre `http://IP_DEL_SERVIDOR:3080` en el móvil, sustituyendo la IP y el puerto por los tuyos. Para la IP LAN debes estar en esa red; para la IP Tailscale debes tener Tailscale conectado. La aplicación web funciona con conexión, pero una IP privada HTTP normalmente no permite la instalación PWA completa. HTTPS con Serve es lo recomendado.

## 6. Probar listas y comparación de precios

En una instalación nueva aparecen Carrefour, Costco, DIA y Mercadona, con listas vacías. Estas cifras son **ejemplos de prueba**, no precios reales: utiliza una instalación de prueba o tus propios productos y precios comprobados para el uso diario.

1. En **Inicio**, pulsa **Nuevo producto**. Escribe «Pepsi Zero», marca «Pepsi», categoría «Bebidas», cantidad de envase **2** y unidad **Litros**. Marca las casillas **Carrefour** y **Costco** y pulsa **Crear producto**.
2. Abre la lista de **Carrefour**. El producto debe aparecer pendiente. Pulsa su botón **Precio**, introduce **2,19** y guarda. Debe aparecer el importe con su fecha.
3. Pulsa el nombre del producto para abrir su ficha. Pulsa **Registrar precio**, elige **Costco**, introduce **1,79** y guarda.
4. En la ficha, Costco debe señalarse como **Menor registrado**. Carrefour debe mostrar **0,40 €** de diferencia. Las fechas deben estar visibles.
5. Vuelve a la lista de Carrefour desde **En tus listas**. El artículo debe mostrar **0,40 € menos en Costco** con la fecha del registro. Pulsa su precio y registra ahora **1,89**.
6. Abre la ficha otra vez: el historial debe conservar **2,19**, **1,79** y **1,89**. La comparación debe usar el nuevo precio de Carrefour.
7. Marca el artículo como comprado en Carrefour. Abre Costco: allí debe continuar **pendiente**. Cambiar la cantidad en una lista tampoco debe cambiarla en la otra.
8. En Carrefour, pulsa **Vaciar comprados** y confirma. El artículo debe desaparecer solo de esa lista. La ficha del catálogo debe seguir conservando el producto y sus tres registros de precio.
9. Si era una prueba con precios ficticios, elimina esos registros desde las papeleras del **Historial de precios**. Retirar un artículo de una lista no elimina su historial. Evita mezclar ejemplos con tus referencias reales.

También puedes añadir productos ya creados desde **Añadir productos**, buscar en el catálogo mientras escribes, editar cantidades/notas y cambiar el orden a categoría, nombre o manual. El modo oscuro se activa con el botón de la luna y se recuerda en cada dispositivo.

## 7. Comprobar la persistencia

Con algún producto y precio que quieras conservar, toma nota de lo que muestra la interfaz. Reinicia:

```sh
docker compose restart app
docker compose up -d --wait
```

Recarga la aplicación: productos, cantidades, estados e historial deben seguir iguales. Después comprueba una recreación del contenedor, manteniendo las mismas rutas del `.env`:

```sh
docker compose up -d --force-recreate --wait
```

Vuelve a recargar y verifica los mismos datos. No borres las carpetas de datos durante esta prueba. Si los datos desaparecen, comprueba `DATA_DIR` y que no hayas cambiado de carpeta/configuración Compose.

## 8. Hacer una copia y actualizar

Antes de actualizar, crea una copia consistente con un nombre nuevo:

```sh
docker compose exec -T app node dist/server/maintenance.js backup /backups/antes-de-actualizar-001.sqlite
git pull --ff-only origin main
docker compose build --pull
docker compose up -d --wait
```

Comprueba `docker compose ps` y tus datos desde la interfaz. La copia aparece en `BACKUP_DIR`; conserva otra copia en un dispositivo o ubicación independiente del entorno de despliegue. **No copies solo el archivo SQLite con la aplicación abierta**, porque utiliza WAL. La [sección de copias y restauración del README](../README.md#copias-sqlite-consistentes) explica cómo recuperar esa copia con todas las instancias detenidas.

## Problemas habituales

| Síntoma | Qué comprobar |
| --- | --- |
| Error de permisos o «unable to open database» | Carpetas creadas, propietario correcto, UID/GID del `.env` y permisos de escritura. |
| «Address already in use» o puerto ocupado | Otro servicio usa `HTTP_PORT`; elige uno libre y aplica `docker compose up -d`. |
| Funciona en el sistema anfitrión pero no en Android | El binding por defecto es loopback. Activa Serve o configura la IP del paso 5; comprueba la red/Tailscale y firewall. |
| No aparece «Instalar aplicación» | Usa el origen HTTPS de Serve, comprueba el certificado y los requisitos de Chrome. HTTP por IP no equivale a una PWA instalada. |
| «Origen no autorizado» detrás de un proxy privado | Sigue las indicaciones de `ALLOWED_ORIGINS` en el README; configura solo tu origen exacto. |
| Datos diferentes tras reiniciar | Confirma que el contenedor monta el mismo `DATA_DIR` y que no cambiaste de configuración. |
| Error al descargar dependencias | Comprueba la conexión y los certificados de confianza del entorno. No desactives TLS. |

## Pruebas automatizadas (opcional en un ordenador de desarrollo)

Si quieres ejecutar toda la comprobación del proyecto, instala **Node.js 24** y, para el último comando, Docker con Compose v2:

```sh
npm ci
npm run build
npm test
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:docker
```

Los tests usan bases temporales, separadas de tus datos. `test:docker` construye una imagen y comprueba reinicio, recreación, backup en caliente y restauración. No necesitas ejecutar estos tests para desplegar la aplicación: los pasos 4, 6 y 7 permiten comprobar tu instalación concreta.

La aplicación no tiene login. Todo dispositivo autorizado que alcance su puerto comparte acceso a los datos familiares. Mantén el acceso limitado a tu red privada y a dispositivos de confianza.

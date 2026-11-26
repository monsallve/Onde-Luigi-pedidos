# Arquitectura del Módulo de Autoservicio (O'NDE LUIGI)

## 1. Separación Estricta de PWA, Roles y Bundles
- **PWA Independiente de Autoservicio (`/autoservicio/`)**:
  - Compilada como entrada independiente (`autoservicio/index.html` → `src/autoservicio-main.tsx` → `src/SelfServiceApp.tsx` → `src/views/SelfServiceView.tsx`).
  - **Cero código del POS en su bundle**: No importa `<PosProvider />`, `<AuthGate />`, ajustes administrativos ni vistas de caja/cocina/inventario.
  - **Manifiesto y Service Worker propios**: `public/autoservicio/manifest.webmanifest` (`start_url: "./"`, `scope: "./"`, `display: "standalone"`) y `public/autoservicio/sw.js` registrado con `{ scope: './' }` únicamente bajo `/autoservicio/`.
  - **Aislamiento de rutas**: `src/utils/autoservicioRouteGuard.ts` valida `pathname`, `search` y `hash`; cualquier intento de navegar fuera de `/autoservicio/` o hacia `?tab=...`, `/admin/pagos` o rutas internas redirige de inmediato de vuelta a `/autoservicio/`.
  - Enlaces heredados hacia raíz (`/?autoservicio=1`, `#/autoservicio`) son redirigidos desde `src/main.tsx` a `/autoservicio/` antes de cargar la app del POS.
  - Solo acepta pagos digitales (**Transferencia / QR / Llave Bre-B**) y bloquea el envío si falta la imagen del comprobante.
- **App Interna POS (`/` — Personal Autenticado)**:
  - No incluye manifiesto PWA ni botón de instalación; únicamente registra `sw-notifications.js` para notificaciones de caja/comandas.
  - Protegida por Firebase Auth (`AuthGate`) y permisos de rol (`admin`, `cajero`, `mesero`, `cocina`).
  - Solo los administradores pueden editar el catálogo, habilitar/deshabilitar productos y administrar los datos de pago / QR desde **Datos de Pago** o **Ajustes**.

## 2. Esquema de Colecciones en Firestore
Para proteger la privacidad (PII) y evitar exponer colecciones internas `/workspaces/{workspaceId}/*` al público, el autoservicio utiliza una proyección pública aislada bajo `/publicStorefronts/{workspaceId}`:

| Colección | Lectura pública | Escritura | Propósito |
| --- | --- | --- | --- |
| `/publicStorefronts/{ws}` | `get` (sin `list`) | Solo `admin` del workspace | Configuración pública de pago digital (`qrImageUrl`, `brebKey`, `accountHolder`, `bankName`, `enabled`, instrucciones). |
| `/publicStorefronts/{ws}/products/{id}` | `get, list` | Sincronizado por `admin` desde POS | Carta pública sin costos internos ni recetas de inventario privado. |
| `/publicStorefronts/{ws}/sauces/{id}` | `get, list` | Sincronizado por `admin` desde POS | Salsas activas/inactivas en tiempo real. |
| `/publicStorefronts/{ws}/queueTickets/{orderId}` | `get, list` | Cliente (al crear junto a `selfOrders`) y Staff POS (actualizaciones) | Proyección **sin PII** (`orderNumber`, `status`, `deliveryType`, `createdAtMs`) para calcular en vivo cuántos pedidos activos hay antes en la fila. |
| `/publicStorefronts/{ws}/selfOrders/{orderId}` | `get` por enlace único (`list` **bloqueado** al público; solo staff) | Cliente (`create` restringido) y Staff POS (`update`/`delete`) | Pedido completo de autoservicio con modalidad (`local` / `domicilio`), dirección si aplica, ítems, total y URL del comprobante. |

## 3. Reglas de Seguridad (`firestore.rules` y `storage.rules`) y Estrategia Offline-Safe
- **Creación segura en `selfOrders`**:
  - Solo permite `create` cuando la tienda está habilitada (`enabled == true`), el estado inicial es exactamente `pendiente_validacion`, `paymentStatus == 'pendiente'`, `paymentMethod == 'transferencia'`, `receiptCount == 1`, `latestReceiptUrl` no vacío, existe su ticket hermano en `queueTickets` en el mismo batch y, si `deliveryType == 'domicilio'`, dirección, barrio y teléfono cumplen longitudes mínimas.
- **Validación en `storage.rules`**:
  - Subida de comprobantes en `/selfOrders/{workspaceId}/{orderId}/{fileName}` validada a `image/*` hasta `5 MB`, sin `list` ni sobreescritura (`allow update: if false`).
  - Configuración QR en `/workspaces/{workspaceId}/storefront/{fileName}` con lectura pública y escritura exclusiva para administradores.
- **Service Worker seguro para tiempo real (`public/autoservicio/sw.js`)**:
  - Cachea el shell HTML de `/autoservicio/`, fuentes y assets compilados (`/assets/*`, `/menu/*`).
  - Excluye explícitamente cualquier petición a `googleapis.com`, `firebaseio.com`, `firebaseapp.com`, `firebasestorage.app` y `cloudfunctions.net` para garantizar que Firestore (`onSnapshot`) y la subida de comprobantes a Storage nunca reciban datos obsoletos.

## 4. Sincronización en Tiempo Real con Comandas y Galería de Pagos
1. El cliente confirma su pedido desde `/autoservicio/`:
   - La imagen se comprime automáticamente en cliente (`storageService.ts`) y se sube a Firebase Storage (con respaldo inline comprimido si Storage aún no tiene reglas desplegadas).
   - Un `writeBatch` crea atómicamente `selfOrders/{orderId}` y `queueTickets/{orderId}`.
2. En el POS (`posStore.tsx`):
   - El listener en tiempo real de `publicStorefronts/{ws}/selfOrders` fusiona de inmediato el pedido en **Comandas (`OrdersView.tsx`)** y su comprobante en **Pagos y Transferencias (`TransfersGalleryView.tsx`)**.
   - Se dispara alerta sonora y notificación en vivo (`nueva_comanda`) al llegar un pedido nuevo.
   - Al validar/avanzar estado, cobrar o anular desde el POS, `posStore.tsx` actualiza atómicamente `workspaces/{ws}/orders/{orderId}`, `publicStorefronts/{ws}/selfOrders/{orderId}` y `publicStorefronts/{ws}/queueTickets/{orderId}`, descontando/restaurando inventario de receta cuando corresponde.
3. En la pantalla de seguimiento del cliente (`/autoservicio/?pedido={orderId}`):
   - Escucha en tiempo real `selfOrders/{orderId}` y `queueTickets`.
   - Muestra el paso actual (`Validando pago` → `Confirmado` → `En preparación` → `¡Listo!`) y la cantidad de pedidos activos delante.
   - Al cambiar a **`listo`**, activa aviso visual destacado, sonido (Web Audio API) y vibración.

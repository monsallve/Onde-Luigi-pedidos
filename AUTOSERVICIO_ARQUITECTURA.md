# Arquitectura del Módulo de Autoservicio (O'NDE LUIGI)

## 1. Separación de Roles y Rutas
- **App Pública de Autoservicio (`?autoservicio=1`, `/autoservicio`, `#/autoservicio`)**:
  - Se renderiza directamente desde `src/App.tsx` **fuera** de `<PosProvider>` y `<AuthGate />`.
  - Nunca descarga credenciales de staff, listados de empleados, costos de inventario, bitácoras internas ni órdenes de otros clientes.
  - Solo acepta pagos digitales (**Transferencia / QR / Llave Bre-B**) y bloquea el envío si falta la imagen del comprobante.
- **App Interna POS (Personal Autenticado)**:
  - Protegida por Firebase Auth (`AuthGate`) y permisos de rol (`admin`, `cajero`, `mesero`, `cocina`).
  - Solo los administradores pueden editar el catálogo, habilitar/deshabilitar productos y configurar la imagen QR / llave Bre-B desde **Ajustes → Autoservicio QR / Llave Bre-B**.

## 2. Esquema de Colecciones en Firestore
Para proteger la privacidad (PII) y evitar exponer colecciones internas `/workspaces/{workspaceId}/*` al público, el autoservicio utiliza una proyección pública aislada bajo `/publicStorefronts/{workspaceId}`:

| Colección | Lectura pública | Escritura | Propósito |
| --- | --- | --- | --- |
| `/publicStorefronts/{ws}` | `get` (sin `list`) | Solo `admin` del workspace | Configuración pública de pago digital (`qrImageUrl`, `brebKey`, `accountHolder`, `bankName`, `enabled`, instrucciones). |
| `/publicStorefronts/{ws}/products/{id}` | `get, list` | Sincronizado por `admin` desde POS | Carta pública sin costos internos ni recetas de inventario privado. |
| `/publicStorefronts/{ws}/sauces/{id}` | `get, list` | Sincronizado por `admin` desde POS | Salsas activas/inactivas en tiempo real. |
| `/publicStorefronts/{ws}/queueTickets/{orderId}` | `get, list` | Cliente (al crear junto a `selfOrders`) y Staff POS (actualizaciones) | Proyección **sin PII** (`orderNumber`, `status`, `deliveryType`, `createdAtMs`) para calcular en vivo cuántos pedidos activos hay antes en la fila. |
| `/publicStorefronts/{ws}/selfOrders/{orderId}` | `get` por enlace único (`list` **bloqueado** al público; solo staff) | Cliente (`create` restringido) y Staff POS (`update`/`delete`) | Pedido completo de autoservicio con modalidad (`local` / `domicilio`), dirección si aplica, ítems, total y URL del comprobante. |

## 3. Reglas de Seguridad (`firestore.rules` y `storage.rules`)
- **Creación segura en `selfOrders`**:
  - Solo permite `create` cuando la tienda está habilitada (`enabled == true`), el estado inicial es exactamente `pendiente_validacion`, `paymentStatus == 'pendiente'`, `paymentMethod == 'transferencia'`, `receiptCount == 1`, `latestReceiptUrl` no vacío, existe su ticket hermano en `queueTickets` en el mismo batch y, si `deliveryType == 'domicilio'`, dirección, barrio y teléfono cumplen longitudes mínimas.
- **Validación en `storage.rules`**:
  - Subida de comprobantes en `/selfOrders/{workspaceId}/{orderId}/{fileName}` validada a `image/*` hasta `5 MB`, sin `list` ni sobreescritura (`allow update: if false`).

## 4. Sincronización en Tiempo Real con Comandas y Galería de Pagos
1. El cliente confirma su pedido desde `?autoservicio=1`:
   - La imagen se comprime automáticamente en cliente (`storageService.ts`) y se sube a Firebase Storage (con respaldo inline comprimido si Storage aún no tiene reglas desplegadas).
   - Un `writeBatch` crea atómicamente `selfOrders/{orderId}` y `queueTickets/{orderId}`.
2. En el POS (`posStore.tsx`):
   - El listener en tiempo real de `publicStorefronts/{ws}/selfOrders` fusiona de inmediato el pedido en **Comandas (`OrdersView.tsx`)** y su comprobante en **Pagos y Transferencias (`TransfersGalleryView.tsx`)**.
   - Se dispara alerta sonora y notificación en vivo (`nueva_comanda`) al llegar un pedido nuevo.
   - Al validar/avanzar estado, cobrar o anular desde el POS, `posStore.tsx` actualiza atómicamente `workspaces/{ws}/orders/{orderId}`, `publicStorefronts/{ws}/selfOrders/{orderId}` y `publicStorefronts/{ws}/queueTickets/{orderId}`, descontando/restaurando inventario de receta cuando corresponde.
3. En la pantalla de seguimiento del cliente (`?autoservicio=1&pedido={orderId}`):
   - Escucha en tiempo real `selfOrders/{orderId}` y `queueTickets`.
   - Muestra el paso actual (`Validando pago` → `Confirmado` → `En preparación` → `¡Listo!`) y la cantidad de pedidos activos delante.
   - Al cambiar a **`listo`**, activa aviso visual destacado, sonido (Web Audio API) y vibración.

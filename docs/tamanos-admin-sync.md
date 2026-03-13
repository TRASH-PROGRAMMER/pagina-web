# Gestion de Tamano de Fotos (Admin + Sync Index)

## Objetivo
Permitir que el administrador agregue, edite o desactive tamanos de foto desde el panel de administracion y que los cambios se reflejen automaticamente en la pagina principal sin recargar.

## Modelo de datos
Se agrego la entidad `foto_tamanos` en el backend.

Campos:
- `id`: entero, PK
- `clave`: texto unico (ej. `10x15`)
- `nombre`: texto visible para el usuario (ej. `10x15cm (4R)`)
- `precio_base`: decimal
- `activo`: boolean
- `updated_at`: timestamp

## Endpoints

### Publico
- `GET /api/tamanos`
  - Devuelve solo tamanos activos.
  - Incluye `version` del catalogo para sincronizacion.

Respuesta ejemplo:
```json
{
  "version": "2026-03-13T10:00:00+00:00",
  "tamanos": [
    {
      "id": 1,
      "clave": "10x15",
      "nombre": "10x15cm (4R)",
      "precio_base": 1.7,
      "activo": true,
      "updated_at": "2026-03-13T10:00:00+00:00"
    }
  ]
}
```

### Admin
- `GET /api/admin/tamanos`
  - Lista todos (activos e inactivos).
- `POST /api/admin/tamanos`
  - Crea nuevo tamano.
  - Body: `{ "clave": "12x18", "nombre": "12x18cm", "precio_base": 2.2 }`
- `PATCH /api/admin/tamanos/<id>`
  - Edita nombre, clave, precio o estado.
- `PATCH /api/admin/tamanos/<id>/desactivar`
  - Desactiva logicamente un tamano.

## Flujo de sincronizacion (sin recarga)

1. En Admin, el usuario crea/edita/desactiva un tamano.
2. El backend actualiza `updated_at`.
3. En Index, `precios_fotos.js` consulta `GET /api/tamanos` al iniciar.
4. Luego hace polling cada 8 segundos.
5. Si cambia `version`, reconstruye el `<select id="tamaño">`.
6. Conserva seleccion actual cuando las claves siguen existiendo.

## Integracion Frontend

### Admin
- Vista: `SEVER/templates/admin.html`
- Script: `SEVER/static/script/dasbord_admin.js`
- Seccion nueva en Configuracion > Opciones con:
  - formulario de alta
  - tabla con botones Editar, Activar, Desactivar

### Index
- Vista: `SEVER/templates/index.html`
- Script: `SEVER/static/script/precios_fotos.js`
- El select de tamanos se repuebla dinamicamente desde API.

## Precio y compatibilidad

- El calculo de precios en backend ahora usa `precio_base` de `foto_tamanos`.
- Se mantiene fallback de compatibilidad para claves historicas definidas en constantes.
- Los descuentos especiales existentes (10x15 y 15x15 por cantidad) se mantienen.

## Verificacion rapida

1. Abrir `/admin` y crear un tamano nuevo.
2. Confirmar que aparece en la tabla de opciones.
3. Abrir `/` en otra pestana.
4. Esperar hasta 8 segundos (sin recargar).
5. Verificar que el nuevo tamano aparece en el selector.
6. Editar precio/nombre en admin y verificar actualizacion automatica.
7. Desactivar tamano y confirmar que desaparece del index.

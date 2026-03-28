// Se inicializa automaticamente al importar el modulo
const dbReady = new Promise((resolve, reject) => {
    const request = indexedDB.open("ClientesDB", 1);

    request.onupgradeneeded = function(event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("clientes")) {
            db.createObjectStore("clientes", {
                keyPath: "id",
                autoIncrement: true
            });
        }
    };

    request.onsuccess = function(event) {
        console.log("Base de datos lista");
        resolve(event.target.result);
    };

    request.onerror = function(event) {
        reject(event.target.error);
    };
});

// Guardar cliente + fotos: usa FormData -> API Flask -> PostgreSQL
export async function guardarCliente(formData) {
    const response = await fetch("/api/clientes", {
        method: "POST",
        body: formData
    });

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    let data = {};

    if (contentType.includes("application/json")) {
        data = await response.json().catch(function() { return {}; });
    } else {
        const text = await response.text().catch(function() { return ""; });
        data = { error: (text || "").trim() };
    }

    if (!response.ok) {
        if (response.status === 413) {
            throw new Error(data.error || "La carga supera el limite permitido del servidor.");
        }
        throw new Error(data.error || `Error al guardar cliente (HTTP ${response.status})`);
    }

    if (!data || typeof data !== "object" || !data.cliente) {
        throw new Error("Respuesta invalida del servidor al guardar el pedido.");
    }

    return data.cliente;
}

// Eliminar cliente por ID
export async function eliminarCliente(id) {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("clientes", "readwrite");
        const store = transaction.objectStore("clientes");
        const request = store.delete(id);
        request.onsuccess = () => resolve("Eliminado correctamente");
        request.onerror = (e) => reject(e.target.error);
    });
}

// Obtener clientes
export async function obtenerClientes() {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction("clientes", "readonly");
        const store = transaction.objectStore("clientes");
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

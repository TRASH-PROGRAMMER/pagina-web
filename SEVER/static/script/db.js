// Se inicializa automáticamente al importar el módulo
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

// ✅ Guardar cliente + fotos — usa FormData → API Flask → PostgreSQL
export async function guardarCliente(formData) {
    const response = await fetch("/api/clientes", {
        method: "POST",
        body: formData   // FormData — el navegador pone el Content-Type automáticamente
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Error al guardar cliente");
    }

    return data.cliente;
}

// ✅ Eliminar cliente por ID
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

// ✅ Obtener clientes
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
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
    const TIMEOUT_MS = 120000;
    const MAX_INTENTOS = 2;
    let ultimoError = null;

    for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(function() {
            controller.abort();
        }, TIMEOUT_MS);

        try {
            const response = await fetch("/api/clientes", {
                method: "POST",
                body: formData,
                signal: controller.signal,
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
                const esTransitorio = [502, 503, 504].includes(response.status);
                if (esTransitorio && intento < MAX_INTENTOS) {
                    await new Promise(function(resolve) { setTimeout(resolve, 900); });
                    continue;
                }

                if (response.status === 413) {
                    throw new Error(data.error || "La carga supera el limite permitido del servidor.");
                }
                throw new Error(data.error || `Error al guardar cliente (HTTP ${response.status})`);
            }

            if (!data || typeof data !== "object" || !data.cliente) {
                throw new Error("Respuesta invalida del servidor al guardar el pedido.");
            }

            return {
                cliente: data.cliente,
                mensaje: data.mensaje || "",
                fallos: Array.isArray(data.fallos) ? data.fallos : [],
            };
        } catch (error) {
            ultimoError = error;
            if (error && error.name === "AbortError") {
                throw new Error("El envio tardo demasiado. Revisa tu conexion y vuelve a intentarlo.");
            }

            if (intento >= MAX_INTENTOS) {
                throw error;
            }
        } finally {
            clearTimeout(timeoutId);
        }
    }

    throw ultimoError || new Error("No se pudo guardar el pedido.");
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

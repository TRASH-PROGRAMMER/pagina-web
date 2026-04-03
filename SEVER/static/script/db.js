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

function esperar(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

function esErrorDeRed(error) {
    const texto = String((error && error.message) || "").toLowerCase();
    return texto.includes("network_error")
        || texto.includes("failed to fetch")
        || texto.includes("load failed")
        || texto.includes("network request failed")
        || texto.includes("conexion")
        || texto.includes("internet");
}

function enviarClienteConXhr(formData, opciones) {
    const timeoutMs = Number(opciones && opciones.timeoutMs) || 120000;
    const onUploadProgress = typeof (opciones && opciones.onUploadProgress) === "function"
        ? opciones.onUploadProgress
        : null;
    const onSlowUpload = typeof (opciones && opciones.onSlowUpload) === "function"
        ? opciones.onSlowUpload
        : null;

    return new Promise(function(resolve, reject) {
        const xhr = new XMLHttpRequest();
        let timeoutLento = null;

        if (onSlowUpload) {
            timeoutLento = setTimeout(function() {
                onSlowUpload();
            }, 12000);
        }

        function limpiarTimers() {
            if (timeoutLento) {
                clearTimeout(timeoutLento);
                timeoutLento = null;
            }
        }

        xhr.open("POST", "/api/clientes", true);
        xhr.timeout = timeoutMs;

        xhr.upload.onprogress = function(event) {
            if (!onUploadProgress || !event || !event.lengthComputable) return;
            onUploadProgress(event.loaded, event.total);
        };

        xhr.onload = function() {
            limpiarTimers();
            resolve({
                status: xhr.status,
                body: String(xhr.responseText || ""),
                contentType: String(xhr.getResponseHeader("content-type") || "").toLowerCase(),
            });
        };

        xhr.onerror = function() {
            limpiarTimers();
            reject(new Error("NETWORK_ERROR"));
        };

        xhr.ontimeout = function() {
            limpiarTimers();
            reject(new Error("TIMEOUT_ERROR"));
        };

        xhr.onabort = function() {
            limpiarTimers();
            reject(new Error("ABORT_ERROR"));
        };

        try {
            xhr.send(formData);
        } catch (_error) {
            limpiarTimers();
            reject(new Error("NETWORK_ERROR"));
        }
    });
}

// Guardar cliente + fotos: usa FormData -> API Flask -> PostgreSQL
export async function guardarCliente(formData, opciones = {}) {
    const TIMEOUT_MS = 120000;
    const MAX_INTENTOS = 2;
    let ultimoError = null;

    for (let intento = 1; intento <= MAX_INTENTOS; intento += 1) {
        try {
            const response = await enviarClienteConXhr(formData, {
                timeoutMs: TIMEOUT_MS,
                onUploadProgress: opciones.onUploadProgress,
                onSlowUpload: opciones.onSlowUpload,
            });

            let data = {};
            if (response.contentType.includes("application/json")) {
                data = JSON.parse(response.body || "{}");
            } else {
                data = { error: String(response.body || "").trim() };
            }

            if (!(response.status >= 200 && response.status < 300)) {
                const esTransitorio = [502, 503, 504].includes(response.status);
                if (esTransitorio && intento < MAX_INTENTOS) {
                    await esperar(900);
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
                operacion: data.operacion || "",
                pedidoActivo: data.pedidoActivo || null,
                fallos: Array.isArray(data.fallos) ? data.fallos : [],
            };
        } catch (error) {
            ultimoError = error;

            const mensaje = String((error && error.message) || "");
            const esTimeout = mensaje === "TIMEOUT_ERROR";
            const esRed = esErrorDeRed(error) || !navigator.onLine;
            const esTransitorio = esTimeout || esRed;

            if (esTransitorio && intento < MAX_INTENTOS) {
                await esperar(900);
                continue;
            }

            if (esTimeout) {
                throw new Error("Tu conexión parece lenta y el envío tardó demasiado. Revisa tu red y vuelve a intentarlo.");
            }

            if (esRed) {
                throw new Error("Se perdió la conexión a Internet. Revisa tu red y vuelve a intentarlo.");
            }

            throw error;
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

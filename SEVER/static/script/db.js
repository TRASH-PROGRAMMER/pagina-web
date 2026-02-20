let db;

// Abrir DB
const request = indexedDB.open("ClientesDB", 1);

request.onupgradeneeded = function(event) {
    db = event.target.result;

    db.createObjectStore("clientes", {
        keyPath: "id",
        autoIncrement: true
    });
};

request.onsuccess = function(event) {
    db = event.target.result;
    console.log("Base de datos lista");
};

request.onerror = function(event) {
    console.error("Error DB:", event.target.error);
};

// ✅ Exportamos función para guardar
export function guardarCliente(datos) {
    return new Promise((resolve, reject) => {

        if (!db) {
            reject("DB no inicializada");
            return;
        }

        const transaction = db.transaction(["clientes"], "readwrite");
        const store = transaction.objectStore("clientes");

        const request = store.add(datos);

        request.onsuccess = () => resolve("Guardado correctamente");
        request.onerror = (e) => reject(e.target.error);
    });
}
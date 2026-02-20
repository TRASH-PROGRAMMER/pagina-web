let db;

// 🔹 Abrir o crear base de datos
const request = indexedDB.open("ClientesDB", 1);

request.onupgradeneeded = function(event) {
    db = event.target.result;

    db.createObjectStore("clientes", {
        keyPath: "id",
        autoIncrement: true
    });

    console.log("Base de datos creada");
};

request.onsuccess = function(event) {
    db = event.target.result;
    console.log("Base de datos lista");
};

request.onerror = function(event) {
    console.error("Error al abrir DB:", event.target.error);
};

// 🔹 Guardar datos al enviar formulario
document.getElementById("formDatos").addEventListener("submit", function(e) {

    e.preventDefault(); // Evita recarga

    const datos = {
        nombre: document.getElementById("nombre").value,
        apellido: document.getElementById("apellido").value,
        correo: document.getElementById("correo").value,
        telefono: document.getElementById("telefono").value,
        fechaRegistro: new Date().toLocaleString()
    };

    const transaction = db.transaction(["clientes"], "readwrite");
    const store = transaction.objectStore("clientes");

    const guardar = store.add(datos);

    guardar.onsuccess = function() {
        alert("Datos guardados correctamente ✅");
        document.getElementById("formDatos").reset();
    };

    guardar.onerror = function(event) {
        console.error("Error al guardar:", event.target.error);
    };

});
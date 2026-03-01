// Variables globales
const input = document.getElementById("inputImagenes");
const container = document.getElementById("previewContainer");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const cancelButton = document.getElementById("cancelButton");
const retryButton = document.getElementById("retryButton");
const errorMessage = document.getElementById("errorMessage");
const successMessage = document.getElementById("successMessage");
// Variables para control de estado
let cancelado = false;
let archivosGlobal = [];

// Función para procesar los archivos seleccionados
function procesarArchivos(archivos) {
    container.innerHTML = "";
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    errorMessage.textContent = "";
    successMessage.textContent = "";
    cancelado = false;
    // Validación de cantidad de archivos seleccionados
    if (archivos.length === 0) return;
    // Limitar a 50 imágenes
    if (archivos.length > 150) {
        alert("Solo puedes subir máximo 150 imágenes.");
        return;
    }
    // Limitar a 10MB por imagen
    let procesados = 0;
    const total = archivos.length;
    // Procesar cada archivo
    archivos.forEach(archivo => {
        // Validar tipo de archivo
        if (cancelado) return;
        // Validar tipo de archivo
        const tiposValidos = ["image/jpeg", "image/png", "image/gif"];
        if (!tiposValidos.includes(archivo.type)) {
            errorMessage.textContent = `❌ Tipo de archivo no válido: ${archivo.name}`;
            return;
        }
        // Validar tamaño de archivo (10MB)
        if (archivo.size > 10 * 1024 * 1024) {
            errorMessage.textContent = `❌ Archivo demasiado grande: ${archivo.name}`;
            return;
        }
        const reader = new FileReader();
        // Leer el archivo como Data URL
        reader.onload = function(e) {
            // Si se cancela la carga, se sale de la función y se vuelve a llamar a la función para procesar los archivos restantes
            if (cancelado) return;
            // Crear una imagen para procesar el archivo y obtener sus dimensiones
            const img = new Image();
            img.src = e.target.result;
            // Si se cancela la carga, se sale de la función y se vuelve a llamar a la función para procesar los archivos restantes
            img.onload = function() {

                if (cancelado) return;
                // Crear un elemento de tarjeta para mostrar la imagen cargada
                const card = document.createElement("div");
                card.className = "card";
                // Crear un elemento de imagen para mostrar la imagen cargada
                const imagen = document.createElement("img");
                imagen.src = img.src;
                // Crear un elemento de mensaje para mostrar la calidad de la imagen cargada
                const mensaje = document.createElement("div");
                mensaje.className = "mensaje";
                // Evaluar la calidad de la imagen basada en sus dimensiones
                if (img.width < 800 || img.height < 600) {
                    mensaje.textContent = `Baja calidad (${img.width}x${img.height})`;
                    mensaje.classList.add("baja");
                } else {
                    mensaje.textContent = `Buena calidad (${img.width}x${img.height})`;
                    mensaje.classList.add("alta");
                }
                // Crear un elemento de botón para descargar la imagen cargada
                const boton = document.createElement("button");
                boton.textContent = "Descargar";
                boton.onclick = function() {
                    const link = document.createElement("a");
                    link.href = img.src;
                    link.download = archivo.name;
                    link.click();
                };
                // Crear un elemento de botón para eliminar la imagen cargada
                const botonEliminar = document.createElement("button");
                botonEliminar.textContent = "Eliminar";
                botonEliminar.onclick = function() {
                    container.removeChild(card);
                };
                // Crear un elemento de botón para agrupar ambos botones
                const btnGroup = document.createElement("div");
                btnGroup.classList.add("btn-group");
                btnGroup.appendChild(boton);
                btnGroup.appendChild(botonEliminar);
                // Agregar los elementos a la tarjeta y luego a la vista previa
                card.appendChild(imagen);
                card.appendChild(mensaje);
                card.appendChild(btnGroup);
                container.appendChild(card);
                // Incrementar el contador de procesados y actualizar el progreso
                procesados++;
                const porcentaje = Math.round((procesados / total) * 100);
                progressBar.style.width = porcentaje + "%";
                progressBar.textContent = porcentaje + "%";
                // Si se ha procesado todas las imágenes, se muestra un mensaje de éxito
                if (procesados === total) {
                    successMessage.textContent = "✅ Carga completada con éxito.";
                }
            };
        };
        // Si ocurre un error al leer el archivo, se muestra un mensaje de error
        reader.onerror = function() {
            errorMessage.textContent = "❌ Error al cargar una imagen.";
        };

        reader.readAsDataURL(archivo);
    });
}
// Evento para manejar la selección de archivos en el input
input.addEventListener("change", function() {
    archivosGlobal = Array.from(this.files);
    procesarArchivos(archivosGlobal);
});
// Evento para manejar el botón de cancelar carga
cancelButton.addEventListener("click", function() {
    cancelado = true;
    container.innerHTML = "";
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    successMessage.textContent = "";
    errorMessage.textContent = "⚠️ Carga cancelada.";
});
// Evento para manejar el botón de reintentar carga
retryButton.addEventListener("click", function() {
    if (archivosGlobal.length === 0) {
        errorMessage.textContent = "⚠️ No hay imágenes para reintentar.";
        return;
    }
    procesarArchivos(archivosGlobal);
});

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DB inicializada desde main");

    // 🔥 ahora sí carga el dashboard
    await import("./dasbord_admin.js");
});


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

// Sincroniza el input.files con archivosGlobal para que formulario_clientes.js
// siempre vea todos los archivos acumulados
function sincronizarInputFiles() {
    const dt = new DataTransfer();
    archivosGlobal.forEach(f => dt.items.add(f));
    input.files = dt.files;
}

// Agrega las previews de los archivos nuevos al contenedor (sin limpiar los anteriores)
function procesarArchivos(archivos) {
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    progressBar.setAttribute("aria-valuenow", 0);
    errorMessage.textContent = "";
    successMessage.textContent = "";
    cancelado = false;
    if (archivos.length === 0) return;

    let procesados = 0;
    const total = archivos.length;

    archivos.forEach(archivo => {
        if (cancelado) return;

        const tiposValidos = ["image/jpeg", "image/png", "image/gif"];
        if (!tiposValidos.includes(archivo.type)) {
            errorMessage.textContent = `❌ Tipo de archivo no válido: ${archivo.name}`;
            return;
        }
        if (archivo.size > 10 * 1024 * 1024) {
            errorMessage.textContent = `❌ Archivo demasiado grande: ${archivo.name}`;
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            if (cancelado) return;
            const img = new Image();
            img.src = e.target.result;
            img.onload = function() {
                if (cancelado) return;

                const card = document.createElement("div");
                card.className = "card";

                const imagen = document.createElement("img");
                imagen.src = img.src;

                const mensaje = document.createElement("div");
                mensaje.className = "mensaje";
                if (img.width < 800 || img.height < 600) {
                    mensaje.textContent = `Baja calidad (${img.width}x${img.height})`;
                    mensaje.classList.add("baja");
                } else {
                    mensaje.textContent = `Buena calidad (${img.width}x${img.height})`;
                    mensaje.classList.add("alta");
                }

                const boton = document.createElement("button");
                boton.textContent = "Descargar";
                boton.onclick = function() {
                    const link = document.createElement("a");
                    link.href = img.src;
                    link.download = archivo.name;
                    link.click();
                };

                const botonEliminar = document.createElement("button");
                botonEliminar.textContent = "Eliminar";
                botonEliminar.onclick = function() {
                    container.removeChild(card);
                    // Quitar el archivo de la lista acumulada
                    const idx = archivosGlobal.indexOf(archivo);
                    if (idx > -1) archivosGlobal.splice(idx, 1);
                    sincronizarInputFiles();
                };

                const btnGroup = document.createElement("div");
                btnGroup.classList.add("btn-group");
                btnGroup.appendChild(boton);
                btnGroup.appendChild(botonEliminar);

                card.appendChild(imagen);
                card.appendChild(mensaje);
                card.appendChild(btnGroup);
                container.appendChild(card);

                procesados++;
                const porcentaje = Math.round((procesados / total) * 100);
                progressBar.style.width = porcentaje + "%";
                progressBar.textContent = porcentaje + "%";
                progressBar.setAttribute("aria-valuenow", porcentaje);
                if (procesados === total) {
                    successMessage.textContent = `✅ ${archivosGlobal.length} foto(s) seleccionada(s) en total.`;
                }
            };
        };
        reader.onerror = function() {
            errorMessage.textContent = "❌ Error al cargar una imagen.";
        };
        reader.readAsDataURL(archivo);
    });
}

// Al seleccionar archivos nuevos, se ACUMULAN a los anteriores (sin reemplazar)
input.addEventListener("change", function() {
    const nuevos = Array.from(this.files).filter(f =>
        !archivosGlobal.some(a => a.name === f.name && a.size === f.size)
    );

    if (archivosGlobal.length + nuevos.length > 150) {
        alert("Solo puedes subir máximo 150 imágenes en total.");
        return;
    }

    archivosGlobal = archivosGlobal.concat(nuevos);
    sincronizarInputFiles();
    procesarArchivos(nuevos);
});

// Cancelar limpia todo
cancelButton.addEventListener("click", function() {
    cancelado = true;
    archivosGlobal = [];
    sincronizarInputFiles();
    container.innerHTML = "";
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    progressBar.setAttribute("aria-valuenow", 0);
    successMessage.textContent = "";
    errorMessage.textContent = "⚠️ Carga cancelada.";
});

// Reintentar muestra todas las fotos acumuladas desde cero
retryButton.addEventListener("click", function() {
    if (archivosGlobal.length === 0) {
        errorMessage.textContent = "⚠️ No hay imágenes para reintentar.";
        return;
    }
    container.innerHTML = "";
    procesarArchivos(archivosGlobal);
});


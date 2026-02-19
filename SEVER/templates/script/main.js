const input = document.getElementById("inputImagenes"); 
const container = document.getElementById("previewContainer"); 
const progressBar = document.getElementById("progressBar"); 
const progressText = document.getElementById("progressText"); 
const cancelButton = document.getElementById("cancelButton"); 
const retryButton = document.getElementById("retryButton"); 
const errorMessage = document.getElementById("errorMessage"); 
const successMessage = document.getElementById("successMessage"); 
let cancelado = false; 
let archivosGlobal = [];




input.addEventListener("change", function () {

    container.innerHTML = "";
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";

    errorMessage.textContent = "";
    successMessage.textContent = "";
    cancelado = false;

    const archivos = Array.from(this.files);
    archivosGlobal = archivos;

    if (archivos.length > 50) {
        alert("Solo puedes subir máximo 50 imágenes.");
        return;
    }

    let procesados = 0;
    const total = archivos.length;

    archivos.forEach(archivo => {

        if (cancelado) return;

        const reader = new FileReader();

        reader.onload = function (e) {

            if (cancelado) return;

            const img = new Image();
            img.src = e.target.result;

            img.onload = function () {

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
                boton.onclick = function () {
                    const link = document.createElement("a");
                    link.href = img.src;
                    link.download = archivo.name;
                    link.click();
                };

                const botonEliminar = document.createElement("button");
                botonEliminar.textContent = "Eliminar";
                botonEliminar.onclick = function () {
                    container.removeChild(card);
                };

                card.appendChild(imagen);
                card.appendChild(mensaje);
                card.appendChild(boton);
                card.appendChild(botonEliminar);
                container.appendChild(card);

                procesados++;
                const porcentaje = Math.round((procesados / total) * 100);
                progressBar.style.width = porcentaje + "%";
                progressBar.textContent = porcentaje + "%";

                if (procesados === total) {
                    successMessage.textContent = "✅ Carga completada con éxito.";
                }
            };
        };

        reader.onerror = function () {
            errorMessage.textContent = "Error al cargar una imagen.";
        };

        reader.readAsDataURL(archivo);
    });
});

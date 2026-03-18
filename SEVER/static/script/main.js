// Variables globales
const input = document.getElementById("inputImagenes");
const container = document.getElementById("previewContainer");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const cancelButton = document.getElementById("cancelButton");
const retryButton = document.getElementById("retryButton");
const errorMessage = document.getElementById("errorMessage");
const successMessage = document.getElementById("successMessage");
const paginationContainer = document.getElementById("previewPagination");
const prevPageButton = document.getElementById("prevPageButton");
const nextPageButton = document.getElementById("nextPageButton");
const pageInfo = document.getElementById("pageInfo");
const previewHelp = document.getElementById("previewHelp");
const MAX_IMAGENES = 150;
const ITEMS_POR_PAGINA = 20;
// Variables para control de estado
let cancelado = false;
let archivosGlobal = []; // Acumula todos los archivos seleccionados, incluso después de cancelar o reintentar
let previewsGlobal = [];
let paginaActual = 1;

function mostrarError(texto, esAdvertencia = false) {
    errorMessage.textContent = texto;
    if (esAdvertencia) {
        errorMessage.classList.add("warning-message");
    } else {
        errorMessage.classList.remove("warning-message");
    }
}

function emitirImagenesActualizadas() {
    document.dispatchEvent(new CustomEvent("imagenesActualizadas", {
        detail: {
            total: archivosGlobal.length
        }
    }));
}

// Sincroniza el input.files con archivosGlobal para que formulario_clientes.js
// siempre vea todos los archivos acumulados
function sincronizarInputFiles() {
    const dt = new DataTransfer();
    archivosGlobal.forEach(f => dt.items.add(f));
    input.files = dt.files;
    emitirImagenesActualizadas();
}

function totalPaginas() {
    return Math.max(1, Math.ceil(previewsGlobal.length / ITEMS_POR_PAGINA));
}

function actualizarMensajeExito() {
    if (archivosGlobal.length === 0) {
        successMessage.textContent = "";
        return;
    }
    successMessage.textContent = `✅ ${archivosGlobal.length} foto(s) seleccionada(s) en total.`;
}

function actualizarMensajeVistaPrevia() {
    if (!previewHelp) return;

    if (previewsGlobal.length === 0) {
        previewHelp.textContent = "Las imágenes seleccionadas se mostrarán aquí, debajo del selector de archivos.";
        return;
    }

    const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA + 1;
    const fin = Math.min(inicio + ITEMS_POR_PAGINA - 1, previewsGlobal.length);
    previewHelp.textContent = `Vista previa de imágenes: mostrando ${inicio}-${fin} de ${previewsGlobal.length}.`;
}

function actualizarControlesPaginacion() {
    const total = totalPaginas();
    if (paginaActual > total) {
        paginaActual = total;
    }

    if (paginationContainer) {
        const mostrar = previewsGlobal.length > ITEMS_POR_PAGINA;
        paginationContainer.hidden = !mostrar;
    }

    if (pageInfo) {
        pageInfo.textContent = `Página ${paginaActual} de ${total}`;
    }
    if (prevPageButton) {
        prevPageButton.disabled = paginaActual <= 1;
    }
    if (nextPageButton) {
        nextPageButton.disabled = paginaActual >= total;
    }
}

function eliminarPreview(archivo) {
    const idxArchivo = archivosGlobal.indexOf(archivo);
    if (idxArchivo > -1) {
        archivosGlobal.splice(idxArchivo, 1);
    }

    const idxPreview = previewsGlobal.findIndex(item => item.archivo === archivo);
    if (idxPreview > -1) {
        previewsGlobal.splice(idxPreview, 1);
    }

    sincronizarInputFiles();
    actualizarMensajeExito();
    renderizarPaginaActual();
}

function crearCardPreview(item) {
    const card = document.createElement("div");
    card.className = "card";

    const botonEliminar = document.createElement("button");
    botonEliminar.type = "button";
    botonEliminar.className = "delete-image-button";
    botonEliminar.setAttribute("aria-label", "Eliminar imagen");
    botonEliminar.setAttribute("data-tooltip", "Eliminar imagen");
    botonEliminar.textContent = "×";
    botonEliminar.onclick = function() {
        eliminarPreview(item.archivo);
    };

    const imagen = document.createElement("img");
    imagen.src = item.src;

    const mensaje = document.createElement("div");
    mensaje.className = "mensaje";
    if (item.width < 800 || item.height < 600) {
        mensaje.textContent = `Baja calidad (${item.width}x${item.height})`;
        mensaje.classList.add("baja");
    } else {
        mensaje.textContent = `Buena calidad (${item.width}x${item.height})`;
        mensaje.classList.add("alta");
    }

    card.appendChild(botonEliminar);
    card.appendChild(imagen);
    card.appendChild(mensaje);
    return card;
}

function renderizarPaginaActual() {
    container.innerHTML = "";

    const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
    const fin = inicio + ITEMS_POR_PAGINA;
    const pagina = previewsGlobal.slice(inicio, fin);

    pagina.forEach(item => {
        container.appendChild(crearCardPreview(item));
    });

    actualizarControlesPaginacion();
    actualizarMensajeVistaPrevia();
}

// Agrega las previews de los archivos nuevos al contenedor (sin limpiar los anteriores)
function procesarArchivos(archivos) {
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    progressBar.setAttribute("aria-valuenow", 0);
    mostrarError("");
    successMessage.textContent = "";
    cancelado = false;
    if (archivos.length === 0) return;

    let procesados = 0;
    const total = archivos.length;

    archivos.forEach(archivo => {
        if (cancelado) return;

        const tiposValidos = ["image/jpeg", "image/png", "image/gif"];
        if (!tiposValidos.includes(archivo.type)) {
            mostrarError(`❌ Tipo de archivo no válido: ${archivo.name}`);
            return;
        }
        if (archivo.size > 10 * 1024 * 1024) {
            mostrarError(`❌ Archivo demasiado grande: ${archivo.name}`);
            return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            if (cancelado) return;
            const img = new Image();
            img.src = e.target.result;
            img.onload = function() {
                if (cancelado) return;
                previewsGlobal.push({
                    archivo,
                    src: img.src,
                    width: img.width,
                    height: img.height
                });
                paginaActual = totalPaginas();
                renderizarPaginaActual();

                procesados++;
                const porcentaje = Math.round((procesados / total) * 100);
                progressBar.style.width = porcentaje + "%";
                progressBar.textContent = porcentaje + "%";
                progressBar.setAttribute("aria-valuenow", porcentaje);
                if (procesados === total) {
                    actualizarMensajeExito();
                }
            };
        };
        reader.onerror = function() {
            mostrarError("❌ Error al cargar una imagen.");
        };
        reader.readAsDataURL(archivo);
    });
}

// Al seleccionar archivos nuevos, se ACUMULAN a los anteriores (sin reemplazar)
input.addEventListener("change", function() {
    const seleccionados = Array.from(this.files);
    const disponibles = MAX_IMAGENES - archivosGlobal.length;

    if (disponibles <= 0) {
        mostrarError(`⚠️ Ya alcanzaste el máximo de ${MAX_IMAGENES} imágenes.`, true);
        sincronizarInputFiles();
        return;
    }

    const noDuplicados = seleccionados.filter(f =>
        !archivosGlobal.some(a => a.name === f.name && a.size === f.size)
    );
    const nuevos = noDuplicados.slice(0, disponibles);
    const excedentes = noDuplicados.length - nuevos.length;

    if (nuevos.length === 0) {
        sincronizarInputFiles();
        mostrarError("⚠️ No se agregaron nuevas imágenes.", true);
        return;
    }

    if (excedentes > 0) {
        mostrarError(`⚠️ Seleccionaste más de ${MAX_IMAGENES} imágenes. Se agregaron ${nuevos.length} y se ignoraron ${excedentes} para respetar el límite.`, true);
    }

    archivosGlobal = archivosGlobal.concat(nuevos);
    sincronizarInputFiles();
    procesarArchivos(nuevos);
});

// Cancelar limpia todo
cancelButton.addEventListener("click", function() {
    cancelado = true;
    archivosGlobal = [];
    previewsGlobal = [];
    paginaActual = 1;
    sincronizarInputFiles();
    renderizarPaginaActual();
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    progressBar.setAttribute("aria-valuenow", 0);
    successMessage.textContent = "";
    mostrarError("⚠️ Carga cancelada.", true);
});

// Reintentar muestra todas las fotos acumuladas desde cero
retryButton.addEventListener("click", function() {
    if (archivosGlobal.length === 0) {
        mostrarError("⚠️ No hay imágenes para reintentar.", true);
        return;
    }
    previewsGlobal = [];
    paginaActual = 1;
    renderizarPaginaActual();
    procesarArchivos(archivosGlobal);
});

if (prevPageButton) {
    prevPageButton.addEventListener("click", function() {
        if (paginaActual > 1) {
            paginaActual--;
            renderizarPaginaActual();
        }
    });
}

if (nextPageButton) {
    nextPageButton.addEventListener("click", function() {
        if (paginaActual < totalPaginas()) {
            paginaActual++;
            renderizarPaginaActual();
        }
    });
}


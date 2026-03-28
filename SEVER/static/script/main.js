const input = document.getElementById("inputImagenes");
const container = document.getElementById("previewContainer");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressStatusText = document.getElementById("progressStatusText");
const progressStatusLive = document.getElementById("progressStatusLive");
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
const MAX_BYTES_POR_ARCHIVO = 10 * 1024 * 1024;
const TIPOS_VALIDOS = ["image/jpeg", "image/png", "image/gif", "image/pjpeg", "image/jpg"];
const ITEMS_POR_PAGINA = 20;

const ESTADO_CARGA = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    COMPLETED: "completed",
    ERROR: "error",
    CANCELLED: "cancelled",
});

let archivosGlobal = [];
let previewsGlobal = [];
let paginaActual = 1;
let cargaEnCurso = false;
let cargaToken = 0;
let ultimoAnuncioLive = "";

function claveFoto(file) {
    return `${file.name}__${file.size}__${file.lastModified}`;
}

function nombreArchivoSeguro(archivo) {
    return String((archivo && archivo.name) || "archivo").trim() || "archivo";
}

function compactarMensajes(mensajes, maxItems = 3) {
    if (!Array.isArray(mensajes) || mensajes.length === 0) return "";
    const top = mensajes.slice(0, maxItems).join(" | ");
    if (mensajes.length <= maxItems) return top;
    return `${top} | +${mensajes.length - maxItems} mas`;
}

function mostrarError(texto, esAdvertencia = false) {
    if (!errorMessage) return;
    errorMessage.textContent = String(texto || "");
    if (esAdvertencia) {
        errorMessage.classList.add("warning-message");
    } else {
        errorMessage.classList.remove("warning-message");
    }
}

function mostrarExito(texto) {
    if (!successMessage) return;
    successMessage.textContent = String(texto || "");
}

function validarArchivo(archivo) {
    if (!archivo) return "Archivo invalido.";

    const tipo = String(archivo.type || "").toLowerCase();
    if (!TIPOS_VALIDOS.includes(tipo)) {
        return `Tipo no valido: ${nombreArchivoSeguro(archivo)}.`;
    }

    if (archivo.size <= 0) {
        return `Archivo vacio: ${nombreArchivoSeguro(archivo)}.`;
    }

    if (archivo.size > MAX_BYTES_POR_ARCHIVO) {
        return `Archivo demasiado grande: ${nombreArchivoSeguro(archivo)} (max 10 MB).`;
    }

    return "";
}

function anunciarLive(texto) {
    if (!progressStatusLive) return;
    const limpio = String(texto || "").trim();
    if (!limpio || limpio === ultimoAnuncioLive) return;
    progressStatusLive.textContent = limpio;
    ultimoAnuncioLive = limpio;
}

function actualizarBotonesCarga(estado) {
    if (cancelButton) {
        cancelButton.disabled = estado !== ESTADO_CARGA.LOADING;
    }
    if (retryButton) {
        retryButton.disabled = estado === ESTADO_CARGA.LOADING || archivosGlobal.length === 0;
    }
}

function actualizarBarraProgreso(procesados, total, estado, mensaje, announce = false) {
    const totalSeguro = total > 0 ? total : 0;
    const procesadosSeguros = Math.max(0, Math.min(procesados, totalSeguro || procesados));
    const pct = totalSeguro > 0 ? Math.round((procesadosSeguros / totalSeguro) * 100) : 0;

    if (progressContainer) {
        progressContainer.dataset.state = estado;
        progressContainer.setAttribute("aria-busy", estado === ESTADO_CARGA.LOADING ? "true" : "false");
    }

    if (container) {
        container.setAttribute("aria-busy", estado === ESTADO_CARGA.LOADING ? "true" : "false");
    }

    if (progressBar) {
        progressBar.style.width = `${pct}%`;
        progressBar.textContent = `${pct}%`;
        progressBar.setAttribute("aria-valuenow", String(pct));
        progressBar.setAttribute("aria-valuemin", "0");
        progressBar.setAttribute("aria-valuemax", "100");

        const detalle = totalSeguro > 0
            ? `${procesadosSeguros} de ${totalSeguro} imagenes procesadas (${pct}%).`
            : `${pct}%`;
        const valueText = `${String(mensaje || "").trim()} ${detalle}`.trim();
        progressBar.setAttribute("aria-valuetext", valueText);
    }

    if (progressStatusText) {
        progressStatusText.textContent = String(mensaje || "").trim() || "Listo para cargar imagenes.";
    }

    if (announce) {
        anunciarLive(mensaje);
    }

    actualizarBotonesCarga(estado);
}

function emitirImagenesActualizadas() {
    document.dispatchEvent(new CustomEvent("imagenesActualizadas", {
        detail: {
            total: archivosGlobal.length,
        },
    }));
}

function emitirGaleriaRenderizada() {
    const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
    const fin = Math.min(inicio + ITEMS_POR_PAGINA, previewsGlobal.length);

    document.dispatchEvent(new CustomEvent("galeriaRenderizada", {
        detail: {
            paginaActual,
            inicio,
            fin,
            total: previewsGlobal.length,
        },
    }));
}

function sincronizarInputFiles() {
    if (!input) return;

    try {
        const dt = new DataTransfer();
        archivosGlobal.forEach(function(file) {
            dt.items.add(file);
        });
        input.files = dt.files;
    } catch (_error) {
        // Fallback silencioso.
    }

    emitirImagenesActualizadas();
}

function totalPaginas() {
    return Math.max(1, Math.ceil(previewsGlobal.length / ITEMS_POR_PAGINA));
}

function actualizarMensajeVistaPrevia() {
    if (!previewHelp) return;

    if (previewsGlobal.length === 0) {
        previewHelp.textContent = "Las imagenes seleccionadas se mostraran aqui, debajo del selector de archivos.";
        return;
    }

    const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA + 1;
    const fin = Math.min(inicio + ITEMS_POR_PAGINA - 1, previewsGlobal.length);
    previewHelp.textContent = `Vista previa de imagenes: mostrando ${inicio}-${fin} de ${previewsGlobal.length}.`;
}

function actualizarControlesPaginacion() {
    const total = totalPaginas();
    if (paginaActual > total) {
        paginaActual = total;
    }

    if (paginationContainer) {
        paginationContainer.hidden = previewsGlobal.length <= ITEMS_POR_PAGINA;
    }

    if (pageInfo) {
        pageInfo.textContent = `Pagina ${paginaActual} de ${total}`;
    }

    if (prevPageButton) {
        prevPageButton.disabled = paginaActual <= 1;
    }

    if (nextPageButton) {
        nextPageButton.disabled = paginaActual >= total;
    }
}

function renderizarPaginaActual() {
    if (!container) return;
    container.innerHTML = "";

    const inicio = (paginaActual - 1) * ITEMS_POR_PAGINA;
    const fin = inicio + ITEMS_POR_PAGINA;
    const pagina = previewsGlobal.slice(inicio, fin);

    pagina.forEach(function(item) {
        container.appendChild(crearCardPreview(item));
    });

    actualizarControlesPaginacion();
    actualizarMensajeVistaPrevia();
    emitirGaleriaRenderizada();
}

function crearCardPreview(item) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.fotoKey = claveFoto(item.archivo);

    const botonEliminar = document.createElement("button");
    botonEliminar.type = "button";
    botonEliminar.className = "delete-image-button";
    botonEliminar.setAttribute("aria-label", "Eliminar imagen");
    botonEliminar.setAttribute("data-tooltip", "Eliminar imagen");
    botonEliminar.textContent = "x";
    botonEliminar.addEventListener("click", function() {
        eliminarPreview(item.archivo);
    });

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

function establecerMensajeSeleccion() {
    if (archivosGlobal.length === 0) {
        mostrarExito("");
        return;
    }
    mostrarExito(`${archivosGlobal.length} foto(s) seleccionada(s) en total.`);
}

function invalidarCargaActual() {
    cargaToken += 1;
    cargaEnCurso = false;
}

function procesarArchivos(archivos, opciones = {}) {
    const lista = Array.isArray(archivos) ? archivos.slice() : [];
    const advertencias = Array.isArray(opciones.advertencias) ? opciones.advertencias.slice() : [];
    const reiniciarVista = !!opciones.reiniciarVista;

    if (reiniciarVista) {
        previewsGlobal = [];
        paginaActual = 1;
        renderizarPaginaActual();
    }

    if (lista.length === 0) {
        establecerMensajeSeleccion();
        if (archivosGlobal.length === 0) {
            actualizarBarraProgreso(0, 0, ESTADO_CARGA.IDLE, "Listo para cargar imagenes.", true);
        } else {
            actualizarBarraProgreso(0, 0, ESTADO_CARGA.IDLE, `${archivosGlobal.length} imagen(es) pendientes de revision.`, false);
        }
        return;
    }

    mostrarError("");
    mostrarExito("");

    const token = cargaToken + 1;
    cargaToken = token;
    cargaEnCurso = true;

    let procesados = 0;
    const total = lista.length;

    actualizarBarraProgreso(0, total, ESTADO_CARGA.LOADING, `Cargando imagenes... 0 de ${total}`, true);

    function finalizarCarga() {
        if (token !== cargaToken) return;

        cargaEnCurso = false;
        establecerMensajeSeleccion();

        if (advertencias.length > 0) {
            mostrarError(compactarMensajes(advertencias), true);
            if (previewsGlobal.length > 0) {
                actualizarBarraProgreso(
                    total,
                    total,
                    ESTADO_CARGA.COMPLETED,
                    `Carga completada con advertencias. ${previewsGlobal.length} imagen(es) listas.`,
                    true
                );
            } else {
                actualizarBarraProgreso(total, total, ESTADO_CARGA.ERROR, "No se pudieron cargar imagenes validas.", true);
            }
            return;
        }

        if (previewsGlobal.length > 0) {
            mostrarError("");
            actualizarBarraProgreso(
                total,
                total,
                ESTADO_CARGA.COMPLETED,
                `Carga completada. ${previewsGlobal.length} imagen(es) listas.`,
                true
            );
            return;
        }

        actualizarBarraProgreso(total, total, ESTADO_CARGA.ERROR, "No se pudieron cargar imagenes.", true);
    }

    function marcarProcesado() {
        if (token !== cargaToken) return;
        procesados += 1;
        const valor = Math.min(procesados, total);
        actualizarBarraProgreso(valor, total, ESTADO_CARGA.LOADING, `Cargando imagenes... ${valor} de ${total}`, false);
        if (valor >= total) {
            finalizarCarga();
        }
    }

    lista.forEach(function(archivo) {
        if (token !== cargaToken) return;

        const errorArchivo = validarArchivo(archivo);
        if (errorArchivo) {
            advertencias.push(errorArchivo);
            marcarProcesado();
            return;
        }

        const reader = new FileReader();

        reader.onload = function(event) {
            if (token !== cargaToken) return;

            const img = new Image();
            img.src = event.target.result;

            img.onload = function() {
                if (token !== cargaToken) return;

                previewsGlobal.push({
                    archivo,
                    src: img.src,
                    width: img.width,
                    height: img.height,
                });

                paginaActual = totalPaginas();
                renderizarPaginaActual();
                marcarProcesado();
            };

            img.onerror = function() {
                if (token !== cargaToken) return;
                advertencias.push(`No se pudo leer la imagen: ${nombreArchivoSeguro(archivo)}.`);
                marcarProcesado();
            };
        };

        reader.onerror = function() {
            if (token !== cargaToken) return;
            advertencias.push(`Error al cargar: ${nombreArchivoSeguro(archivo)}.`);
            marcarProcesado();
        };

        reader.readAsDataURL(archivo);
    });
}

function eliminarPreview(archivo) {
    const idxArchivo = archivosGlobal.indexOf(archivo);
    if (idxArchivo > -1) {
        archivosGlobal.splice(idxArchivo, 1);
    }

    const idxPreview = previewsGlobal.findIndex(function(item) {
        return item.archivo === archivo;
    });
    if (idxPreview > -1) {
        previewsGlobal.splice(idxPreview, 1);
    }

    sincronizarInputFiles();

    if (archivosGlobal.length === 0) {
        invalidarCargaActual();
        previewsGlobal = [];
        paginaActual = 1;
        renderizarPaginaActual();
        mostrarError("No hay imagenes seleccionadas.", true);
        mostrarExito("");
        actualizarBarraProgreso(0, 0, ESTADO_CARGA.IDLE, "Listo para cargar imagenes.", true);
        return;
    }

    if (cargaEnCurso) {
        invalidarCargaActual();
        procesarArchivos(archivosGlobal, {
            reiniciarVista: true,
            advertencias: ["Se elimino una imagen durante la carga. Reiniciando progreso."],
        });
        return;
    }

    renderizarPaginaActual();
    mostrarError("");
    establecerMensajeSeleccion();
    actualizarBarraProgreso(0, 0, ESTADO_CARGA.IDLE, `${archivosGlobal.length} imagen(es) listas para enviar.`, false);
}

if (input) {
    input.addEventListener("change", function() {
        const seleccionados = Array.from(this.files || []);
        if (seleccionados.length === 0) return;

        const disponibles = MAX_IMAGENES - archivosGlobal.length;
        if (disponibles <= 0) {
            const texto = `Ya alcanzaste el maximo de ${MAX_IMAGENES} imagenes.`;
            mostrarError(texto, true);
            actualizarBarraProgreso(0, 0, ESTADO_CARGA.ERROR, texto, true);
            sincronizarInputFiles();
            return;
        }

        const rechazados = [];
        const candidatosValidos = [];
        seleccionados.forEach(function(archivo) {
            const errorArchivo = validarArchivo(archivo);
            if (errorArchivo) {
                rechazados.push(errorArchivo);
            } else {
                candidatosValidos.push(archivo);
            }
        });

        const existentes = new Set(archivosGlobal.map(claveFoto));
        const noDuplicados = candidatosValidos.filter(function(file) {
            return !existentes.has(claveFoto(file));
        });

        const nuevos = noDuplicados.slice(0, disponibles);
        const advertencias = rechazados.slice();
        const excedentes = noDuplicados.length - nuevos.length;

        if (excedentes > 0) {
            advertencias.push(
                `Seleccionaste mas de ${MAX_IMAGENES} imagenes. Se agregaron ${nuevos.length} y se ignoraron ${excedentes}.`
            );
        }

        if (nuevos.length === 0) {
            sincronizarInputFiles();
            const texto = advertencias.length > 0
                ? compactarMensajes(advertencias)
                : "No se agregaron nuevas imagenes.";
            mostrarError(texto, true);
            actualizarBarraProgreso(0, 0, ESTADO_CARGA.ERROR, "No se agregaron imagenes validas.", true);
            return;
        }

        archivosGlobal = archivosGlobal.concat(nuevos);
        sincronizarInputFiles();

        if (cargaEnCurso) {
            const notas = ["Se agregaron archivos durante la carga. Reiniciando progreso."].concat(advertencias);
            procesarArchivos(archivosGlobal, { reiniciarVista: true, advertencias: notas });
            return;
        }

        procesarArchivos(nuevos, { reiniciarVista: false, advertencias });
    });
}

if (cancelButton) {
    cancelButton.addEventListener("click", function() {
        invalidarCargaActual();
        archivosGlobal = [];
        previewsGlobal = [];
        paginaActual = 1;
        sincronizarInputFiles();
        renderizarPaginaActual();
        mostrarExito("");
        mostrarError("Carga cancelada.", true);
        actualizarBarraProgreso(0, 0, ESTADO_CARGA.CANCELLED, "Carga cancelada por el usuario.", true);
    });
}

if (retryButton) {
    retryButton.addEventListener("click", function() {
        if (archivosGlobal.length === 0) {
            const texto = "No hay imagenes para reintentar.";
            mostrarError(texto, true);
            actualizarBarraProgreso(0, 0, ESTADO_CARGA.ERROR, texto, true);
            return;
        }

        procesarArchivos(archivosGlobal, {
            reiniciarVista: true,
            advertencias: ["Reintentando carga de imagenes seleccionadas."],
        });
    });
}

if (prevPageButton) {
    prevPageButton.addEventListener("click", function() {
        if (paginaActual > 1) {
            paginaActual -= 1;
            renderizarPaginaActual();
        }
    });
}

if (nextPageButton) {
    nextPageButton.addEventListener("click", function() {
        if (paginaActual < totalPaginas()) {
            paginaActual += 1;
            renderizarPaginaActual();
        }
    });
}

sincronizarInputFiles();
renderizarPaginaActual();
actualizarBarraProgreso(0, 0, ESTADO_CARGA.IDLE, "Listo para cargar imagenes.", false);

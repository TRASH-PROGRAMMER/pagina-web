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
const ITEMS_POR_PAGINA = 10;

const ESTADO_CARGA = Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    COMPLETED: "completed",
    ERROR: "error",
    CANCELLED: "cancelled",
});

let archivosGlobal = [];
let previewsGlobal = [];
// Exponer como globales para otros scripts (como formulario_clientes.js)
window.archivosGlobal = archivosGlobal;
window.previewsGlobal = previewsGlobal;
let paginaActual = 1;
let cargaEnCurso = false;
let cargaToken = 0;
let ultimoAnuncioLive = "";
let rafRenderPendiente = 0;
let slowNetworkTimeout = null;
let lastEstadoCarga = ESTADO_CARGA.IDLE;
const btnEnviar = document.getElementById("btnVerResumen");

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
    // Estado Inicial: ambos ocultos
    if (cancelButton) cancelButton.style.display = 'none';
    if (retryButton) retryButton.style.display = 'none';

    // Estado "Subiendo": solo Cancelar visible
    if (estado === ESTADO_CARGA.LOADING) {
        if (cancelButton) {
            cancelButton.style.display = '';
            cancelButton.disabled = false;
        }
        if (retryButton) retryButton.style.display = 'none';
        return;
    }
    // Estado "Error": solo Reintentar visible (y Cancelar opcional)
    if (estado === ESTADO_CARGA.ERROR) {
        if (retryButton) {
            retryButton.style.display = '';
            retryButton.disabled = false;
        }
        if (cancelButton) {
            cancelButton.style.display = '';
            cancelButton.disabled = false;
        }
        return;
    }
    // Estado "Completado" o "Idle": ambos ocultos
    if (cancelButton) cancelButton.style.display = 'none';
    if (retryButton) retryButton.style.display = 'none';
}

function actualizarBarraProgreso(procesados, total, estado, mensaje, announce = false) {

        // Bloqueo de navegación y botón durante subida
        if (btnEnviar) btnEnviar.disabled = (estado === ESTADO_CARGA.LOADING);
        window.onbeforeunload = (estado === ESTADO_CARGA.LOADING) ? () => true : null;

        // Mensaje amigable si la red es lenta
        if (estado === ESTADO_CARGA.LOADING && lastEstadoCarga !== ESTADO_CARGA.LOADING) {
            if (slowNetworkTimeout) clearTimeout(slowNetworkTimeout);
            slowNetworkTimeout = setTimeout(() => {
                if (progressStatusText && progressContainer.dataset.state === ESTADO_CARGA.LOADING) {
                    progressStatusText.textContent = 'Tu conexión parece un poco lenta, pero seguimos subiendo tus fotos. Por favor, no cierres esta ventana.';
                }
            }, 12000);
        }
        if (estado !== ESTADO_CARGA.LOADING && slowNetworkTimeout) {
            clearTimeout(slowNetworkTimeout);
            slowNetworkTimeout = null;
        }
        lastEstadoCarga = estado;
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

function solicitarRenderPaginaActual() {
    if (rafRenderPendiente) return;
    rafRenderPendiente = requestAnimationFrame(function() {
        rafRenderPendiente = 0;
        renderizarPaginaActual();
    });
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

    // Selector de cantidad
    const cantidadContainer = document.createElement("div");
    cantidadContainer.className = "cantidad-selector";
    
    // Inicializar cantidad desde el item o por defecto 1
    const cantidadActual = item.cantidad || 1;
    
    cantidadContainer.innerHTML = `
        <div class="cantidad-selector__controls">
            <button type="button" class="cantidad-selector__btn" data-action="restar" aria-label="Disminuir cantidad">−</button>
            <input type="number" class="cantidad-selector__input" value="${cantidadActual}" min="1" max="99" aria-label="Cantidad de copias">
            <button type="button" class="cantidad-selector__btn" data-action="sumar" aria-label="Aumentar cantidad">+</button>
        </div>
    `;
    
    // Event listeners para los botones de cantidad
    const btnRestar = cantidadContainer.querySelector('[data-action="restar"]');
    const btnSumar = cantidadContainer.querySelector('[data-action="sumar"]');
    const inputCantidad = cantidadContainer.querySelector('.cantidad-selector__input');
    
    const actualizarCantidad = (nuevaCantidad) => {
        nuevaCantidad = Math.max(1, Math.min(99, parseInt(nuevaCantidad) || 1));
        inputCantidad.value = nuevaCantidad;
        btnRestar.disabled = nuevaCantidad <= 1;
        
        // Guardar cantidad en el item
        item.cantidad = nuevaCantidad;
        
        // Actualizar en archivosGlobal (contiene objetos File con propiedad cantidad)
        const idx = archivosGlobal.findIndex(f => f === item.archivo);
        if (idx >= 0) {
            archivosGlobal[idx].cantidad = nuevaCantidad;
        }
        
        // Actualizar en previewsGlobal
        const previewIdx = previewsGlobal.findIndex(p => p.archivo === item.archivo);
        if (previewIdx >= 0) {
            previewsGlobal[previewIdx].cantidad = nuevaCantidad;
        }
        
        // Actualizar precios si hay tamaño seleccionado
        actualizarPreciosConCantidad();
        
        // Guardar en localStorage
        guardarFotosEnStorage();
    };
    
    btnRestar.addEventListener('click', () => {
        actualizarCantidad(parseInt(inputCantidad.value) - 1);
    });
    
    btnSumar.addEventListener('click', () => {
        actualizarCantidad(parseInt(inputCantidad.value) + 1);
    });
    
    inputCantidad.addEventListener('change', () => {
        actualizarCantidad(inputCantidad.value);
    });
    
    inputCantidad.addEventListener('input', () => {
        let val = parseInt(inputCantidad.value);
        if (val < 1) inputCantidad.value = 1;
        if (val > 99) inputCantidad.value = 99;
    });
    
    // Inicializar estado del botón restar
    btnRestar.disabled = cantidadActual <= 1;

    card.appendChild(botonEliminar);
    card.appendChild(imagen);
    card.appendChild(mensaje);
    card.appendChild(cantidadContainer);
    return card;
}

// Función para actualizar precios considerando cantidades
function actualizarPreciosConCantidad() {
    // Disparar evento para que otros scripts actualicen los precios
    window.dispatchEvent(new CustomEvent('cantidades:actualizadas', {
        detail: { fotos: archivosGlobal }
    }));
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
    if (rafRenderPendiente) {
        cancelAnimationFrame(rafRenderPendiente);
        rafRenderPendiente = 0;
    }
}

function resetearEstadoImagenes(opciones = {}) {
    const conservarMensajes = !!opciones.conservarMensajes;

    invalidarCargaActual();
    archivosGlobal = [];
    previewsGlobal = [];
    window.archivosGlobal = archivosGlobal;
    window.previewsGlobal = previewsGlobal;
    paginaActual = 1;

    if (input) {
        try {
            input.value = "";
        } catch (_error) {
            // Algunos navegadores restringen esta asignacion en ciertos estados.
        }
    }

    sincronizarInputFiles();
    renderizarPaginaActual();

    if (!conservarMensajes) {
        mostrarError("");
        mostrarExito("");
    }

    actualizarBarraProgreso(0, 0, ESTADO_CARGA.IDLE, "Listo para cargar imagenes.", false);
    actualizarPreciosConCantidad();

    try {
        localStorage.removeItem("fotos_cantidades");
    } catch (_error) {
        // Si localStorage no esta disponible, continuar sin bloquear la UX.
    }
}

window.resetearEstadoImagenes = resetearEstadoImagenes;

function procesarArchivos(archivos, opciones = {}) {
    const lista = Array.isArray(archivos) ? archivos.slice() : [];
    const advertencias = Array.isArray(opciones.advertencias) ? opciones.advertencias.slice() : [];
    const reiniciarVista = !!opciones.reiniciarVista;

    if (reiniciarVista) {
        previewsGlobal = [];
        window.previewsGlobal = previewsGlobal;
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

        actualizarBarraProgreso(total, total, ESTADO_CARGA.ERROR, "No se pudieron cargar imagenes. Vuelve a seleccionarlas e intenta de nuevo.", true);
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

    // En moviles, demasiadas lecturas en paralelo pueden provocar errores de lectura.
    const esMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    const MAX_CONCURRENCIA = esMobile ? 2 : 4;
    let cursor = 0;
    let activos = 0;

    function mensajeErrorLectura(archivo, reader) {
        const nombre = nombreArchivoSeguro(archivo);
        const detalle = String((reader && reader.error && (reader.error.name || reader.error.message)) || "").trim();
        if (/notreadable|security|abort/i.test(detalle)) {
            return `Error al cargar: ${nombre}. Vuelve a seleccionar este archivo.`;
        }
        return detalle
            ? `Error al cargar: ${nombre}. (${detalle})`
            : `Error al cargar: ${nombre}.`;
    }

    function procesarUno(archivo, onDone) {
        let finalizado = false;
        function done() {
            if (finalizado) return;
            finalizado = true;
            onDone();
        }

        if (token !== cargaToken) {
            done();
            return;
        }

        const errorArchivo = validarArchivo(archivo);
        if (errorArchivo) {
            advertencias.push(errorArchivo);
            done();
            return;
        }

        const reader = new FileReader();

        reader.onload = function(event) {
            if (token !== cargaToken) {
                done();
                return;
            }

            const img = new Image();
            img.src = event.target.result;

            img.onload = function() {
                if (token !== cargaToken) {
                    done();
                    return;
                }

                previewsGlobal.push({
                    archivo,
                    src: img.src,
                    width: img.width,
                    height: img.height,
                    cantidad: 1,
                });

                // Mantener navegacion natural: iniciar/continuar desde la primera pagina.
                paginaActual = 1;
                // Render por lotes para evitar stuttering al cargar muchas imagenes.
                solicitarRenderPaginaActual();
                done();
            };

            img.onerror = function() {
                if (token !== cargaToken) {
                    done();
                    return;
                }
                advertencias.push(`No se pudo leer la imagen: ${nombreArchivoSeguro(archivo)}.`);
                done();
            };
        };

        reader.onerror = function() {
            if (token !== cargaToken) {
                done();
                return;
            }
            advertencias.push(mensajeErrorLectura(archivo, reader));
            done();
        };

        try {
            reader.readAsDataURL(archivo);
        } catch (_error) {
            advertencias.push(`Error al cargar: ${nombreArchivoSeguro(archivo)}.`);
            done();
        }
    }

    function drenarCola() {
        if (token !== cargaToken) return;

        while (activos < MAX_CONCURRENCIA && cursor < lista.length) {
            const archivo = lista[cursor];
            cursor += 1;
            activos += 1;

            procesarUno(archivo, function() {
                activos = Math.max(0, activos - 1);
                marcarProcesado();
                drenarCola();
            });
        }
    }

    drenarCola();
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
        window.previewsGlobal = previewsGlobal;
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
        window.archivosGlobal = archivosGlobal;

        // Aplicar cantidades guardadas en localStorage a los nuevos archivos
        archivosGlobal.forEach(archivo => {
            if (!archivo.cantidad) {
                archivo.cantidad = obtenerCantidadGuardada(archivo);
            }
        });
        
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
        resetearEstadoImagenes({ conservarMensajes: true });
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

/**
 * Guarda las fotos y sus cantidades en localStorage
 * Solo guarda los metadatos necesarios (nombre, cantidad) no las imágenes en base64
 */
function guardarFotosEnStorage() {
    try {
        const datosParaGuardar = previewsGlobal.map(preview => ({
            nombre: preview.archivo.name,
            cantidad: preview.cantidad || 1,
            size: preview.archivo.size,
            lastModified: preview.archivo.lastModified,
        }));
        localStorage.setItem("fotos_cantidades", JSON.stringify(datosParaGuardar));
    } catch (e) {
        console.warn("No se pudo guardar en localStorage:", e);
    }
}

/**
 * Carga las cantidades guardadas en localStorage
 * @returns {Array} Array de objetos con nombre y cantidad
 */
function cargarCantidadesDeStorage() {
    try {
        const datos = localStorage.getItem("fotos_cantidades");
        return datos ? JSON.parse(datos) : [];
    } catch (e) {
        console.warn("No se pudo cargar de localStorage:", e);
        return [];
    }
}

/**
 * Obtiene la cantidad guardada para un archivo específico
 * @param {File} archivo - El archivo a buscar
 * @returns {number} La cantidad guardada o 1 por defecto
 */
function obtenerCantidadGuardada(archivo) {
    const cantidades = cargarCantidadesDeStorage();
    const guardado = cantidades.find(c => 
        c.nombre === archivo.name && 
        c.size === archivo.size && 
        c.lastModified === archivo.lastModified
    );
    return guardado ? guardado.cantidad : 1;
}

/**
 * Actualiza archivosGlobal con las cantidades guardadas en localStorage
 */
function aplicarCantidadesGuardadas() {
    archivosGlobal.forEach(archivo => {
        archivo.cantidad = obtenerCantidadGuardada(archivo);
    });
}

// Exponer funciones necesarias globalmente
window.obtenerCantidadGuardada = obtenerCantidadGuardada;
window.guardarFotosEnStorage = guardarFotosEnStorage;

// --- Lógica para el botón "Mis pedidos" en index ---
document.addEventListener('DOMContentLoaded', function () {
    const btnMisPedidos = document.querySelector('.btn-ver-mis-pedidos');
    if (!btnMisPedidos) return;

    // Intenta obtener el correo del usuario guardado (si existe)
    let correo = null;
    try {
        correo = localStorage.getItem('misPedidos_email') || null;
    } catch (e) {
        correo = null;
    }

    // Si no hay correo, deshabilita el botón y muestra mensaje
    if (!correo) {
        btnMisPedidos.classList.add('btn-mis-pedidos-disabled');
        btnMisPedidos.setAttribute('aria-disabled', 'true');
        btnMisPedidos.style.opacity = '0.6';
        btnMisPedidos.style.pointerEvents = 'none';
        btnMisPedidos.textContent = 'Aún no tienes pedidos';
        // Opcional: mostrar tooltip o ayuda
        btnMisPedidos.title = 'Realiza un pedido para poder consultarlo aquí.';
        return;
    }

    // Consulta al backend si hay pedidos para este correo
    fetch('/api/mis-pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo })
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (Array.isArray(data.pedidos) && data.pedidos.length > 0) {
            // Hay pedidos: botón destacado
            btnMisPedidos.classList.remove('btn-mis-pedidos-disabled');
            btnMisPedidos.removeAttribute('aria-disabled');
            btnMisPedidos.style.opacity = '1';
            btnMisPedidos.style.pointerEvents = '';
            btnMisPedidos.textContent = '📦 Ver mis pedidos';
            btnMisPedidos.title = 'Consulta el estado de tus pedidos aquí.';
        } else {
            // No hay pedidos: deshabilitar y mostrar mensaje
            btnMisPedidos.classList.add('btn-mis-pedidos-disabled');
            btnMisPedidos.setAttribute('aria-disabled', 'true');
            btnMisPedidos.style.opacity = '0.6';
            btnMisPedidos.style.pointerEvents = 'none';
            btnMisPedidos.textContent = 'Aún no tienes pedidos';
            btnMisPedidos.title = 'Realiza un pedido para poder consultarlo aquí.';
        }
    })
    .catch(() => {
        // Error de red: mostrar botón deshabilitado
        btnMisPedidos.classList.add('btn-mis-pedidos-disabled');
        btnMisPedidos.setAttribute('aria-disabled', 'true');
        btnMisPedidos.style.opacity = '0.6';
        btnMisPedidos.style.pointerEvents = 'none';
        btnMisPedidos.textContent = 'No se pudo verificar pedidos';
        btnMisPedidos.title = 'Intenta recargar la página o revisa tu conexión.';
    });
});

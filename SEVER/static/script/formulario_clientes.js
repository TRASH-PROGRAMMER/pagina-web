import { guardarCliente } from './db.js';

const clienteChannel = new BroadcastChannel("clientes_channel");

const form = document.getElementById("formDatos");
const btnEnviar = document.querySelector(".enviar-button");
const errorMessage = document.getElementById("mensajeError");
const nameInput = document.getElementById("nombre");
const apellidoInput = document.getElementById("apellido");
const correoInput = document.getElementById("correo");
const telefonoInput = document.getElementById("telefono");
const prefijoPaisSelect = document.getElementById("prefijoPais");
const telefonoHelp = document.getElementById("telefonoHelp");
const inputImagenes = document.getElementById("inputImagenes");
const tamanoSelect = document.getElementById("tamaño");
const tamanoChipsContainer = document.getElementById("tamanoChips");
const tamanoBaseIndicator = document.getElementById("tamanoBaseIndicator");
const toggleAsignacionFotos = document.getElementById("toggleAsignacionFotos");
const previewContainer = document.getElementById("previewContainer");
const pedidoSpinnerOverlay = document.getElementById("pedidoSpinnerOverlay");
const btnFinalizarPedido = document.getElementById("btnFinalizarPedido");
const cropImageModal = document.getElementById("cropImageModal");
const cropImageTarget = document.getElementById("cropImageTarget");
const cancelCropBtn = document.getElementById("cancelCropBtn");
const applyCropBtn = document.getElementById("applyCropBtn");
const frameImageModal = document.getElementById("frameImageModal");
const frameImagePreview = document.getElementById("frameImagePreview");
const frameOptions = document.getElementById("frameOptions");
const cancelFrameBtn = document.getElementById("cancelFrameBtn");
const applyFrameAllBtn = document.getElementById("applyFrameAllBtn");
const clearFrameAllBtn = document.getElementById("clearFrameAllBtn");
const applyFrameBtn = document.getElementById("applyFrameBtn");
const facturaOverlay = document.getElementById("facturaOverlay");
const facturaInfo = document.getElementById("facturaInfo");
const facturaBody = document.getElementById("facturaBody");
const pedidoExitoOverlay = document.getElementById("pedidoExitoOverlay");
const pedidoExitoNumero = document.getElementById("pedidoExitoNumero");
const pedidoExitoInfo = document.getElementById("pedidoExitoInfo");
const pedidoExitoBody = document.getElementById("pedidoExitoBody");
const pedidoExitoClose = document.getElementById("pedidoExitoClose");
const pedidoExitoEstado = document.getElementById("pedidoExitoEstado");
const pedidoExitoMasFotos = document.getElementById("pedidoExitoMasFotos");

const asignacionesPorFoto = new Map();
const edicionesPorFoto = new Map();
const previewUrlPorFoto = new Map();
const frameCatalogo = [
    { value: "none", label: "🚫 Ninguno" },
    { value: "polaroid", label: "📸 Polaroid" },
    { value: "gold", label: "🏆 Dorado" },
    { value: "dark", label: "⬛ Oscuro" },
    { value: "museum", label: "🖼️ Museo" },
];

let cropperInstance = null;
let fotoKeyEnEdicion = "";
let frameSeleccionadoTemporal = "none";
let bloquearMensajesValidacion = false;
let restaurarClientePendiente = null;
let pedidoSeguimientoPendiente = { id: "", correo: "" };

btnEnviar.disabled = true;

function usaAsignacionPorFoto() {
    return !!(toggleAsignacionFotos && toggleAsignacionFotos.checked);
}

function actualizarVisibilidadAsignacion() {
    if (!toggleAsignacionFotos) return;
    const activa = usaAsignacionPorFoto();
    toggleAsignacionFotos.setAttribute("aria-expanded", activa ? "true" : "false");
}

function obtenerPrefijoSeleccionado() {
    return prefijoPaisSelect ? String(prefijoPaisSelect.value || "").replace(/\D/g, "") : "";
}

function detectarPrefijoPorNumero(numeroConPrefijo) {
    if (!prefijoPaisSelect) return null;
    const limpio = String(numeroConPrefijo || "").replace(/\D/g, "");
    if (!limpio) return null;

    const prefijos = Array.from(prefijoPaisSelect.options)
        .map(function(opt) { return String(opt.value || "").replace(/\D/g, ""); })
        .filter(Boolean)
        .sort(function(a, b) { return b.length - a.length; });

    return prefijos.find(function(pref) {
        return limpio.startsWith(pref);
    }) || null;
}

function actualizarAyudaTelefono() {
    if (!telefonoHelp || !prefijoPaisSelect) return;
    const prefijo = obtenerPrefijoSeleccionado();
    telefonoHelp.textContent = `Prefijo seleccionado: +${prefijo}. Ingresa el número local sin el +.`;
}

function autoDetectarPaisInicial() {
    if (!prefijoPaisSelect) return;
    const region = (navigator.language || "").split("-")[1] || "EC";
    const option = Array.from(prefijoPaisSelect.options).find(function(opt) {
        return (opt.dataset.iso || "").toUpperCase() === region.toUpperCase();
    });
    if (option) {
        prefijoPaisSelect.value = option.value;
    }
    actualizarAyudaTelefono();
}

function normalizarTelefonoInput() {
    if (!telefonoInput) return;

    let valor = telefonoInput.value.trim();
    if (valor.startsWith("+")) {
        const prefijoDetectado = detectarPrefijoPorNumero(valor);
        if (prefijoDetectado && prefijoPaisSelect) {
            prefijoPaisSelect.value = prefijoDetectado;
            const digitos = valor.replace(/\D/g, "");
            valor = digitos.slice(prefijoDetectado.length);
            actualizarAyudaTelefono();
        }
    }

    telefonoInput.value = valor.replace(/\D/g, "").slice(0, 12);
}

function telefonoInternacionalCompleto() {
    const prefijo = obtenerPrefijoSeleccionado();
    const local = telefonoInput.value.replace(/\D/g, "");
    return `+${prefijo}${local}`;
}

function claveFoto(file) {
    return `${file.name}__${file.size}__${file.lastModified}`;
}

function obtenerArchivoPorKey(key) {
    return Array.from(inputImagenes.files || []).find(function(file) {
        return claveFoto(file) === key;
    }) || null;
}

function limpiarPreviewUrl(key) {
    const previewUrl = previewUrlPorFoto.get(key);
    if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrlPorFoto.delete(key);
    }
}

function limpiarEdicionFoto(key) {
    const edit = edicionesPorFoto.get(key);
    if (edit && edit.previewUrl) {
        URL.revokeObjectURL(edit.previewUrl);
    }
    edicionesPorFoto.delete(key);
}

function depurarRecursosDeFotos() {
    const vigentes = new Set(Array.from(inputImagenes.files || []).map(claveFoto));

    Array.from(previewUrlPorFoto.keys()).forEach(function(key) {
        if (!vigentes.has(key)) {
            limpiarPreviewUrl(key);
        }
    });

    Array.from(edicionesPorFoto.keys()).forEach(function(key) {
        if (!vigentes.has(key)) {
            limpiarEdicionFoto(key);
        }
    });
}

function obtenerPreviewFoto(file) {
    const key = claveFoto(file);
    const edit = edicionesPorFoto.get(key);
    if (edit && edit.previewUrl) {
        return edit.previewUrl;
    }
    if (!previewUrlPorFoto.has(key)) {
        previewUrlPorFoto.set(key, URL.createObjectURL(file));
    }
    return previewUrlPorFoto.get(key);
}

function abrirModal(modal) {
    if (!modal) return;
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
}

function cerrarModal(modal) {
    if (!modal) return;
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
}

function destruirCropper() {
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
}

function actualizarClaseMarcoPreview(frameValue) {
    if (!frameImagePreview) return;
    frameImagePreview.dataset.frame = frameValue;
}

function renderOpcionesMarco(frameActual) {
    if (!frameOptions) return;
    frameOptions.innerHTML = "";

    frameCatalogo.forEach(function(item) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "frame-option";
        btn.textContent = item.label;
        btn.setAttribute("role", "radio");

        const isActive = item.value === frameActual;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-checked", isActive ? "true" : "false");
        btn.setAttribute("aria-label", `Marco ${item.label}`);

        btn.addEventListener("click", function() {
            frameSeleccionadoTemporal = item.value;
            actualizarClaseMarcoPreview(item.value);
            renderOpcionesMarco(frameSeleccionadoTemporal);
        });

        frameOptions.appendChild(btn);
    });
}

function abrirModalRecorte(key) {
    const file = obtenerArchivoPorKey(key);
    if (!file || !cropImageTarget || typeof Cropper === "undefined") {
        errorMessage.textContent = "No se pudo abrir el recorte. Recarga la pagina e intenta de nuevo.";
        errorMessage.style.color = "red";
        return;
    }

    fotoKeyEnEdicion = key;
    const src = obtenerPreviewFoto(file);

    destruirCropper();
    cropImageTarget.onload = function() {
        destruirCropper();
        cropperInstance = new Cropper(cropImageTarget, {
            viewMode: 1,
            dragMode: "move",
            autoCropArea: 0.86,
            responsive: true,
            background: false,
            guides: true,
            movable: true,
            zoomable: true,
            scalable: false,
            rotatable: false,
        });
    };
    cropImageTarget.src = src;
    abrirModal(cropImageModal);
}

function abrirModalMarco(key) {
    const file = obtenerArchivoPorKey(key);
    if (!file || !frameImagePreview) return;

    fotoKeyEnEdicion = key;
    const edit = edicionesPorFoto.get(key);
    frameSeleccionadoTemporal = edit && edit.frame ? edit.frame : "none";
    frameImagePreview.src = obtenerPreviewFoto(file);
    actualizarClaseMarcoPreview(frameSeleccionadoTemporal);
    renderOpcionesMarco(frameSeleccionadoTemporal);
    abrirModal(frameImageModal);
}

async function cargarImagenDesdeUrl(url) {
    return new Promise(function(resolve, reject) {
        const img = new Image();
        img.onload = function() { resolve(img); };
        img.onerror = reject;
        img.src = url;
    });
}

async function blobDesdeCanvas(canvas, tipo = "image/jpeg", calidad = 0.92) {
    return new Promise(function(resolve, reject) {
        canvas.toBlob(function(blob) {
            if (!blob) {
                reject(new Error("No se pudo generar imagen editada"));
                return;
            }
            resolve(blob);
        }, tipo, calidad);
    });
}

async function aplicarMarcoABlob(baseBlob, frameValue, tipoMime) {
    if (!frameValue || frameValue === "none") return baseBlob;

    const srcUrl = URL.createObjectURL(baseBlob);
    try {
        const img = await cargarImagenDesdeUrl(srcUrl);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        let pad = 0;
        let bottomExtra = 0;

        if (frameValue === "polaroid") {
            pad = Math.max(14, Math.round(img.width * 0.045));
            bottomExtra = Math.max(26, Math.round(img.height * 0.12));
            canvas.width = img.width + pad * 2;
            canvas.height = img.height + pad * 2 + bottomExtra;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, pad, pad, img.width, img.height);
        } else {
            pad = Math.max(12, Math.round(Math.min(img.width, img.height) * 0.04));
            canvas.width = img.width + pad * 2;
            canvas.height = img.height + pad * 2;

            if (frameValue === "gold") ctx.fillStyle = "#d4ac2f";
            else if (frameValue === "dark") ctx.fillStyle = "#2f3340";
            else if (frameValue === "museum") ctx.fillStyle = "#e8dfcf";
            else ctx.fillStyle = "#ffffff";

            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (frameValue === "museum") {
                ctx.strokeStyle = "#a28763";
                ctx.lineWidth = 2;
                ctx.strokeRect(pad - 1, pad - 1, img.width + 2, img.height + 2);
            }

            ctx.drawImage(img, pad, pad, img.width, img.height);
        }

        return await blobDesdeCanvas(canvas, tipoMime);
    } finally {
        URL.revokeObjectURL(srcUrl);
    }
}

function aplicarMarcoATodasLasFotos(frameValue) {
    Array.from(inputImagenes.files || []).forEach(function(file) {
        const key = claveFoto(file);
        const prevEdit = edicionesPorFoto.get(key);

        if (prevEdit) {
            edicionesPorFoto.set(key, {
                blob: prevEdit.blob || null,
                previewUrl: prevEdit.previewUrl || null,
                frame: frameValue,
            });
            return;
        }

        edicionesPorFoto.set(key, {
            blob: null,
            previewUrl: null,
            frame: frameValue,
        });
    });
}

function obtenerOpcionesTamano() {
    return Array.from(tamanoSelect.options).map(function(opt) {
        return { value: opt.value, text: opt.textContent };
    });
}

function obtenerTamanoBaseSeleccionado() {
    if (!tamanoSelect || !tamanoSelect.selectedOptions || tamanoSelect.selectedOptions.length === 0) {
        return "";
    }
    return tamanoSelect.selectedOptions[0].value;
}

function sincronizarTamanoBaseEnAsignacion(sobrescribirTodo = false) {
    if (!usaAsignacionPorFoto()) return;

    const tamanoBase = obtenerTamanoBaseSeleccionado();
    if (!tamanoBase) return;

    Array.from(inputImagenes.files || []).forEach(function(file) {
        const key = claveFoto(file);
        if (sobrescribirTodo || !asignacionesPorFoto.has(key)) {
            asignacionesPorFoto.set(key, tamanoBase);
        }
    });
}

function setTamanoSeleccionUnica(valor) {
    Array.from(tamanoSelect.options).forEach(function(opt) {
        opt.selected = !!valor && opt.value === valor;
    });
}

function actualizarIndicadorTamanoBase() {
    if (!tamanoBaseIndicator || !tamanoSelect) return;

    const seleccionado = tamanoSelect.selectedOptions && tamanoSelect.selectedOptions[0]
        ? tamanoSelect.selectedOptions[0].textContent
        : "ninguno";

    tamanoBaseIndicator.textContent = `Tamano base activo: ${seleccionado}`;
}

function renderTamanoChips() {
    if (!tamanoChipsContainer || !tamanoSelect) return;

    tamanoChipsContainer.innerHTML = "";

    Array.from(tamanoSelect.options).forEach(function(opt) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "choice-chip";
        chip.dataset.value = opt.value;
        chip.textContent = opt.textContent;

        const activo = !!opt.selected;
        chip.classList.toggle("is-active", activo);
        chip.setAttribute("aria-pressed", activo ? "true" : "false");

        chip.addEventListener("click", function() {
            if (opt.selected) {
                setTamanoSeleccionUnica("");
            } else {
                setTamanoSeleccionUnica(opt.value);
            }

            if (usaAsignacionPorFoto() && opt.selected) {
                sincronizarTamanoBaseEnAsignacion(true);
            }

            tamanoSelect.dispatchEvent(new Event("change", { bubbles: true }));
        });

        tamanoChipsContainer.appendChild(chip);
    });
}

function obtenerResumenTamanosAsignados() {
    const resumen = {};
    Array.from(inputImagenes.files || []).forEach(function(file) {
        const clave = claveFoto(file);
        const tamano = asignacionesPorFoto.get(clave);
        if (!tamano) return;

        const option = Array.from(tamanoSelect.options).find(function(opt) {
            return opt.value === tamano;
        });
        const nombre = option ? option.textContent : tamano;

        if (!resumen[tamano]) {
            resumen[tamano] = { nombre, cantidad: 0 };
        }
        resumen[tamano].cantidad += 1;
    });
    return resumen;
}

function emitirAsignacionesActualizadas() {
    document.dispatchEvent(new CustomEvent("asignacionesTamanosActualizadas", {
        detail: {
            resumen: obtenerResumenTamanosAsignados()
        }
    }));
}

function renderAsignacionesFotos() {
    if (!previewContainer) return;

    const files = Array.from(inputImagenes.files || []);
    const clavesActuales = new Set(files.map(claveFoto));
    const filesPorClave = new Map(files.map(function(file, index) {
        return [claveFoto(file), { file, index }];
    }));

    depurarRecursosDeFotos();

    Array.from(asignacionesPorFoto.keys()).forEach(function(key) {
        if (!clavesActuales.has(key)) {
            asignacionesPorFoto.delete(key);
        }
    });

    Array.from(previewContainer.querySelectorAll(".card-advanced-controls")).forEach(function(node) {
        node.remove();
    });

    const opciones = obtenerOpcionesTamano();

    if (files.length === 0) {
        emitirAsignacionesActualizadas();
        return;
    }

    Array.from(previewContainer.querySelectorAll(".card[data-foto-key]")).forEach(function(card) {
        const key = card.dataset.fotoKey || "";
        const data = filesPorClave.get(key);
        if (!data) return;

        const preview = card.querySelector("img");
        if (preview) {
            preview.src = obtenerPreviewFoto(data.file);
        }

        if (!usaAsignacionPorFoto()) {
            return;
        }

        const advanced = document.createElement("div");
        advanced.className = "card-advanced-controls";

        const titulo = document.createElement("div");
        titulo.className = "card-advanced-title";
        titulo.textContent = `Edicion Foto ${data.index + 1}`;

        const nombre = document.createElement("div");
        nombre.className = "card-advanced-name";
        nombre.textContent = data.file.name;

        const select = document.createElement("select");
        select.className = "foto-tamano-select card-advanced-size";
        select.setAttribute("aria-label", `Seleccionar tamaño para Foto ${data.index + 1}`);

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Selecciona tamaño";
        select.appendChild(placeholder);

        opciones.forEach(function(op) {
            const option = document.createElement("option");
            option.value = op.value;
            option.textContent = op.text;
            select.appendChild(option);
        });

        const seleccion = asignacionesPorFoto.get(key);
        if (seleccion) {
            select.value = seleccion;
        }

        select.addEventListener("change", function() {
            if (select.value) {
                asignacionesPorFoto.set(key, select.value);
            } else {
                asignacionesPorFoto.delete(key);
            }
            emitirAsignacionesActualizadas();
            validarFormulario();
        });

        const actions = document.createElement("div");
        actions.className = "foto-actions card-advanced-actions";

        const recortarBtn = document.createElement("button");
        recortarBtn.type = "button";
        recortarBtn.className = "foto-action-btn";
        recortarBtn.textContent = "✂ Recortar";
        recortarBtn.setAttribute("aria-label", `Recortar Foto ${data.index + 1}`);
        recortarBtn.addEventListener("click", function() {
            abrirModalRecorte(key);
        });

        const marcoBtn = document.createElement("button");
        marcoBtn.type = "button";
        marcoBtn.className = "foto-action-btn";
        marcoBtn.textContent = "🖼 Marco";
        marcoBtn.setAttribute("aria-label", `Aplicar marco a Foto ${data.index + 1}`);
        marcoBtn.addEventListener("click", function() {
            abrirModalMarco(key);
        });

        actions.appendChild(recortarBtn);
        actions.appendChild(marcoBtn);

        advanced.appendChild(titulo);
        advanced.appendChild(nombre);
        advanced.appendChild(select);
        advanced.appendChild(actions);
        card.appendChild(advanced);
    });

    emitirAsignacionesActualizadas();
}

function renderMiniaturasSubidas(thumbnails) {
    if (!previewContainer) return;

    previewContainer.innerHTML = "";

    if (!Array.isArray(thumbnails) || thumbnails.length === 0) {
        return;
    }

    thumbnails.forEach((thumbUrl, index) => {
        const card = document.createElement("div");
        card.className = "card cloud-thumb";

        const imagen = document.createElement("img");
        imagen.src = thumbUrl;
        imagen.alt = `Miniatura subida ${index + 1}`;
        imagen.loading = "lazy";

        const mensaje = document.createElement("div");
        mensaje.className = "mensaje alta";
        mensaje.textContent = `Miniatura ${index + 1}`;

        card.appendChild(imagen);
        card.appendChild(mensaje);
        previewContainer.appendChild(card);
    });
}

function mostrarSpinnerPedido() {
    if (pedidoSpinnerOverlay) {
        pedidoSpinnerOverlay.classList.add("active");
        pedidoSpinnerOverlay.setAttribute("aria-hidden", "false");
    }
    if (btnFinalizarPedido) {
        btnFinalizarPedido.disabled = true;
    }
}

function ocultarSpinnerPedido() {
    if (pedidoSpinnerOverlay) {
        pedidoSpinnerOverlay.classList.remove("active");
        pedidoSpinnerOverlay.setAttribute("aria-hidden", "true");
    }
    if (btnFinalizarPedido) {
        btnFinalizarPedido.disabled = false;
    }
}

function abrirModalExitoPedido(clienteId, correoCliente, infoHtml, bodyHtml) {
    if (!pedidoExitoOverlay) return;
    pedidoSeguimientoPendiente = {
        id: clienteId ? String(clienteId) : "",
        correo: String(correoCliente || "").trim(),
    };
    if (pedidoExitoNumero) pedidoExitoNumero.textContent = String(clienteId || "-");
    if (pedidoExitoInfo) pedidoExitoInfo.innerHTML = infoHtml || "";
    if (pedidoExitoBody) pedidoExitoBody.innerHTML = bodyHtml || "";
    pedidoExitoOverlay.classList.add("active");
}

function cerrarModalExitoPedido() {
    if (!pedidoExitoOverlay) return;
    pedidoExitoOverlay.classList.remove("active");
}

// 🔹 Validación completa (datos + fotos + tamaño + papel)
function validarFormulario() {

    const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,}$/;
    const nombreValido = nameRegex.test(nameInput.value.trim());
    const apellidoRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,}$/;
    const apellidoValido = apellidoRegex.test(apellidoInput.value.trim());

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const correoValido = emailRegex.test(correoInput.value.trim());

    normalizarTelefonoInput();
    const prefijo = obtenerPrefijoSeleccionado();
    const telefonoLocal = telefonoInput.value.trim();
    const phoneRegex = /^\d{6,12}$/;
    const totalDigitos = `${prefijo}${telefonoLocal}`.length;
    const telefonoValido = !!prefijo && phoneRegex.test(telefonoLocal) && totalDigitos >= 7 && totalDigitos <= 15;

    // Validar que haya al menos 1 foto
    const fotosValidas = inputImagenes.files && inputImagenes.files.length > 0;

    const fotos = Array.from(inputImagenes.files || []);
    let tamanoValido = false;
    if (usaAsignacionPorFoto()) {
        tamanoValido = fotos.length > 0 && fotos.every(function(file) {
            return !!asignacionesPorFoto.get(claveFoto(file));
        });
    } else {
        tamanoValido = tamanoSelect.selectedOptions.length > 0;
    }

    // Validar que se haya elegido tipo de papel
    const papelSeleccionado = document.querySelector('input[name="papel"]:checked');
    const papelValido = !!papelSeleccionado;

    const esValido = nombreValido && apellidoValido && correoValido
                  && telefonoValido && fotosValidas && tamanoValido && papelValido;

    btnEnviar.disabled = !esValido;

    if (bloquearMensajesValidacion) {
        return esValido;
    }

    // Mensajes de ayuda
    if (!fotosValidas && inputImagenes.files.length === 0) {
        errorMessage.textContent = "Selecciona al menos una foto para imprimir.";
    } else if (!tamanoValido) {
        errorMessage.textContent = usaAsignacionPorFoto()
            ? "Asigna un tamaño a cada foto para continuar."
            : "Selecciona al menos un tamaño de foto.";
    } else if (!papelValido) {
        errorMessage.textContent = "Elige un tipo de papel.";
    } else if (!esValido) {
        errorMessage.textContent = "Completa todos los campos correctamente del formulario de datos personales.";
    } else {
        errorMessage.textContent = "";
    }

    errorMessage.style.color = "red";
    return esValido;
}

// Validación en tiempo real
[nameInput, apellidoInput, correoInput, telefonoInput].forEach(input => {
    input.addEventListener("input", validarFormulario);
});
if (prefijoPaisSelect) {
    prefijoPaisSelect.addEventListener("change", function() {
        actualizarAyudaTelefono();
        validarFormulario();
    });
}
inputImagenes.addEventListener("change", validarFormulario);
tamanoSelect.addEventListener("change", function() {
    sincronizarTamanoBaseEnAsignacion(false);
    actualizarIndicadorTamanoBase();
    renderTamanoChips();
    renderAsignacionesFotos();
    validarFormulario();
});
document.querySelectorAll('input[name="papel"]').forEach(radio => {
    radio.addEventListener("change", validarFormulario);
});

document.addEventListener("imagenesActualizadas", function() {
    sincronizarTamanoBaseEnAsignacion(false);
    validarFormulario();
});

document.addEventListener("galeriaRenderizada", function() {
    renderAsignacionesFotos();
});

if (toggleAsignacionFotos) {
    toggleAsignacionFotos.addEventListener("change", function() {
        actualizarVisibilidadAsignacion();
        sincronizarTamanoBaseEnAsignacion(false);
        renderAsignacionesFotos();
        validarFormulario();
    });
}

window.obtenerResumenTamanosAsignados = obtenerResumenTamanosAsignados;
window.usaAsignacionPorFoto = usaAsignacionPorFoto;
autoDetectarPaisInicial();
actualizarVisibilidadAsignacion();
actualizarIndicadorTamanoBase();
renderTamanoChips();
renderAsignacionesFotos();

if (cancelCropBtn) {
    cancelCropBtn.addEventListener("click", function() {
        destruirCropper();
        cerrarModal(cropImageModal);
    });
}

if (applyCropBtn) {
    applyCropBtn.addEventListener("click", async function() {
        if (!cropperInstance || !fotoKeyEnEdicion) return;

        const fileBase = obtenerArchivoPorKey(fotoKeyEnEdicion);
        if (!fileBase) return;

        try {
            const canvas = cropperInstance.getCroppedCanvas({
                imageSmoothingEnabled: true,
                imageSmoothingQuality: "high",
            });
            const blob = await blobDesdeCanvas(canvas, fileBase.type || "image/jpeg");

            const prevEdit = edicionesPorFoto.get(fotoKeyEnEdicion);
            if (prevEdit && prevEdit.previewUrl) {
                URL.revokeObjectURL(prevEdit.previewUrl);
            }

            const previewUrl = URL.createObjectURL(blob);
            edicionesPorFoto.set(fotoKeyEnEdicion, {
                blob,
                previewUrl,
                frame: prevEdit && prevEdit.frame ? prevEdit.frame : "none",
            });

            renderAsignacionesFotos();
            destruirCropper();
            cerrarModal(cropImageModal);
            errorMessage.textContent = "Recorte aplicado correctamente.";
            errorMessage.style.color = "#00a76f";
        } catch (error) {
            errorMessage.textContent = "No se pudo aplicar el recorte.";
            errorMessage.style.color = "red";
        }
    });
}

if (cancelFrameBtn) {
    cancelFrameBtn.addEventListener("click", function() {
        cerrarModal(frameImageModal);
    });
}

if (applyFrameBtn) {
    applyFrameBtn.addEventListener("click", function() {
        if (!fotoKeyEnEdicion) return;

        const prevEdit = edicionesPorFoto.get(fotoKeyEnEdicion);
        if (prevEdit) {
            edicionesPorFoto.set(fotoKeyEnEdicion, {
                blob: prevEdit.blob || null,
                previewUrl: prevEdit.previewUrl || null,
                frame: frameSeleccionadoTemporal,
            });
        } else {
            edicionesPorFoto.set(fotoKeyEnEdicion, {
                blob: null,
                previewUrl: null,
                frame: frameSeleccionadoTemporal,
            });
        }

        renderAsignacionesFotos();
        cerrarModal(frameImageModal);
        errorMessage.textContent = "Marco guardado correctamente.";
        errorMessage.style.color = "#00a76f";
    });
}

if (applyFrameAllBtn) {
    applyFrameAllBtn.addEventListener("click", function() {
        const totalFotos = inputImagenes.files ? inputImagenes.files.length : 0;
        if (totalFotos === 0) return;

        aplicarMarcoATodasLasFotos(frameSeleccionadoTemporal);
        renderAsignacionesFotos();
        cerrarModal(frameImageModal);

        errorMessage.textContent = `Marco aplicado a ${totalFotos} foto(s).`;
        errorMessage.style.color = "#00a76f";
    });
}

if (clearFrameAllBtn) {
    clearFrameAllBtn.addEventListener("click", function() {
        const totalFotos = inputImagenes.files ? inputImagenes.files.length : 0;
        if (totalFotos === 0) return;

        aplicarMarcoATodasLasFotos("none");
        frameSeleccionadoTemporal = "none";
        renderAsignacionesFotos();
        cerrarModal(frameImageModal);

        errorMessage.textContent = `Marcos quitados de ${totalFotos} foto(s).`;
        errorMessage.style.color = "#00a76f";
    });
}

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        destruirCropper();
        cerrarModal(cropImageModal);
        cerrarModal(frameImageModal);
        cerrarModalExitoPedido();
    }
});

if (cropImageModal) {
    cropImageModal.addEventListener("click", function(e) {
        if (e.target === cropImageModal) {
            destruirCropper();
            cerrarModal(cropImageModal);
        }
    });
}

if (frameImageModal) {
    frameImageModal.addEventListener("click", function(e) {
        if (e.target === frameImageModal) {
            cerrarModal(frameImageModal);
        }
    });
}

if (pedidoExitoClose) {
    pedidoExitoClose.addEventListener("click", function() {
        cerrarModalExitoPedido();
    });
}

if (pedidoExitoEstado) {
    pedidoExitoEstado.addEventListener("click", function() {
        const id = pedidoSeguimientoPendiente.id;
        const correo = pedidoSeguimientoPendiente.correo;
        if (!id || !correo) {
            cerrarModalExitoPedido();
            return;
        }

        const params = new URLSearchParams({
            pedido: id,
            correo,
        });
        window.location.href = `/seguimiento?${params.toString()}`;
    });
}

if (pedidoExitoOverlay) {
    pedidoExitoOverlay.addEventListener("click", function(e) {
        if (e.target === pedidoExitoOverlay) {
            cerrarModalExitoPedido();
        }
    });
}

if (pedidoExitoMasFotos) {
    pedidoExitoMasFotos.addEventListener("click", function() {
        if (typeof restaurarClientePendiente === "function") {
            restaurarClientePendiente();
        }
        cerrarModalExitoPedido();
        if (inputImagenes) {
            inputImagenes.focus();
            inputImagenes.click();
        }
    });
}

async function construirArchivoFinal(file) {
    const key = claveFoto(file);
    const edit = edicionesPorFoto.get(key);

    if (!edit) {
        return file;
    }

    let blobBase = edit.blob || file;
    if (edit.frame && edit.frame !== "none") {
        blobBase = await aplicarMarcoABlob(blobBase, edit.frame, file.type || "image/jpeg");
    }

    return new File([blobBase], file.name, {
        type: file.type || blobBase.type || "image/jpeg",
        lastModified: Date.now(),
    });
}

// 🔹 Submit — valida y abre resumen; si ya fue confirmado, envía el pedido
form.addEventListener("submit", async function(e) {
    e.preventDefault();

    if (!validarFormulario()) return;

    // Si no está confirmado, abrir modal de resumen primero
    if (!form.dataset.confirmed) {
        if (typeof window.abrirResumenPedido === "function") {
            window.abrirResumenPedido();
        }
        return;
    }
    delete form.dataset.confirmed;

    mostrarSpinnerPedido();
    bloquearMensajesValidacion = true;
    btnEnviar.disabled = true;
    errorMessage.textContent = "Subiendo fotos…⏳";
    errorMessage.style.color = "#00ff4c";

    // Construir FormData
    const formData = new FormData();
    formData.append('nombre', nameInput.value.trim());
    formData.append('apellido', apellidoInput.value.trim());
    formData.append('correo', correoInput.value.trim());
    formData.append('telefono', telefonoInternacionalCompleto());
    formData.append('fechaRegistro', new Date().toLocaleString());

    if (usaAsignacionPorFoto()) {
        const resumenTamanos = obtenerResumenTamanosAsignados();
        const clavesResumen = Object.keys(resumenTamanos);
        const tamanosTexto = clavesResumen.map(function(clave) {
            const item = resumenTamanos[clave];
            return `${item.nombre} x${item.cantidad}`;
        }).join(', ');
        formData.append('tamano', tamanosTexto);

        const tamanosKeys = clavesResumen.map(function(clave) {
            return `${clave}:${resumenTamanos[clave].cantidad}`;
        }).join(',');
        formData.append('tamano_keys', tamanosKeys);
    } else {
        const tamanosTexto = Array.from(tamanoSelect.selectedOptions)
            .map(function(o) { return o.text; })
            .join(', ');
        formData.append('tamano', tamanosTexto);

        const tamanosKeys = Array.from(tamanoSelect.selectedOptions)
            .map(function(o) { return o.value; })
            .join(',');
        formData.append('tamano_keys', tamanosKeys);
    }

    // Papel
    const papel = document.querySelector('input[name="papel"]:checked').value;
    formData.append('papel', papel);

    // Fotos (con recorte/marco aplicado si existe edición)
    for (const foto of inputImagenes.files) {
        const fotoFinal = await construirArchivoFinal(foto);
        formData.append('fotos', fotoFinal);
    }

    try {
        const infoResumenHtml = facturaInfo ? facturaInfo.innerHTML : "";
        const bodyResumenHtml = facturaBody ? facturaBody.innerHTML : "";
        const clientePersistido = {
            nombre: nameInput.value,
            apellido: apellidoInput.value,
            correo: correoInput.value,
            telefono: telefonoInput.value,
            prefijoPais: prefijoPaisSelect ? prefijoPaisSelect.value : "",
        };

        const clienteGuardado = await guardarCliente(formData);
        clienteChannel.postMessage({ tipo: "nuevo_cliente", cliente: clienteGuardado });
        renderMiniaturasSubidas(clienteGuardado.thumbnails || []);

        restaurarClientePendiente = function() {
            if (nameInput) nameInput.value = clientePersistido.nombre || "";
            if (apellidoInput) apellidoInput.value = clientePersistido.apellido || "";
            if (correoInput) correoInput.value = clientePersistido.correo || "";
            if (telefonoInput) telefonoInput.value = clientePersistido.telefono || "";
            if (prefijoPaisSelect && clientePersistido.prefijoPais) {
                prefijoPaisSelect.value = clientePersistido.prefijoPais;
            }
            actualizarAyudaTelefono();
            validarFormulario();
        };

        form.reset();
        // Limpiar selección y actualizar UI sin disparar mensajes de validación
        asignacionesPorFoto.clear();
        Array.from(previewUrlPorFoto.keys()).forEach(limpiarPreviewUrl);
        Array.from(edicionesPorFoto.keys()).forEach(limpiarEdicionFoto);
        Array.from(tamanoSelect.options).forEach(function(opt) {
            opt.selected = false;
        });
        actualizarIndicadorTamanoBase();
        renderTamanoChips();
        actualizarVisibilidadAsignacion();
        renderAsignacionesFotos();

        // Cerrar/resetear modal factura
        if (facturaOverlay) facturaOverlay.classList.remove("active");
        const btnResumen = document.getElementById("btnVerResumen");
        if (btnResumen) btnResumen.disabled = true;
        btnEnviar.disabled = true;

        errorMessage.textContent = "Pedido enviado con exito!";
        errorMessage.style.color = "#00ff4c";
        bloquearMensajesValidacion = false;
        ocultarSpinnerPedido();
        abrirModalExitoPedido(clienteGuardado.id, clienteGuardado.correo, infoResumenHtml, bodyResumenHtml);

    } catch (error) {
        bloquearMensajesValidacion = false;
        errorMessage.textContent = error.message;
        errorMessage.style.color = "red";
        btnEnviar.disabled = false;
        ocultarSpinnerPedido();
        console.error("Error al guardar:", error);
    }
});
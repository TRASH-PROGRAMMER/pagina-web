// Calcula el total de copias sumando la cantidad de cada foto
function escapeHtml(str) {
    const s = String(str == null ? "" : str);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function calcularTotalCopias() {
    return (window.archivosGlobal || []).reduce(function(acc, item) {
        return acc + (item.cantidad || 1);
    }, 0);
}

// Renderiza el resumen del pedido en el modal factura
function renderResumenFactura() {
    if (!window.facturaBody) return;
    const resumen = window.obtenerResumenTamanosAsignados ? window.obtenerResumenTamanosAsignados() : {};
    const claves = Object.keys(resumen);
    const totalFotos = (window.archivosGlobal || []).length;
    const totalCopias = calcularTotalCopias();
    let html = `<div><b>Fotos distintas:</b> ${escapeHtml(totalFotos)}</div>`;
    html += `<div><b>Total de copias:</b> ${escapeHtml(totalCopias)}</div>`;
    if (claves.length > 0) {
        html += '<ul style="margin-top:8px;">';
        claves.forEach(function(clave) {
            const item = resumen[clave];
            html += `<li><b>${escapeHtml(item.nombre)}:</b> ${escapeHtml(item.cantidad)} copia${item.cantidad === 1 ? '' : 's'}</li>`;
        });
        html += '</ul>';
    }
    window.facturaBody.innerHTML = html;
}

// Actualizar resumen cada vez que cambian cantidades o asignaciones
window.addEventListener('cantidades:actualizadas', renderResumenFactura);
document.addEventListener('asignacionesTamanosActualizadas', renderResumenFactura);
document.addEventListener('imagenesActualizadas', renderResumenFactura);

if (window.abrirResumenPedido) {
    const originalAbrirResumen = window.abrirResumenPedido;
    window.abrirResumenPedido = function() {
        renderResumenFactura();
        originalAbrirResumen.apply(this, arguments);
    };
}

window.calcularTotalCopias = calcularTotalCopias;
window.renderResumenFactura = renderResumenFactura;
import { guardarCliente } from './db.js';

const clienteChannel = new BroadcastChannel("clientes_channel");

const form = document.getElementById("formDatos");
const btnEnviar = document.getElementById("btnVerResumen");
const errorMessage = document.getElementById("mensajeError");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressStatusText = document.getElementById("progressStatusText");

// Toast visual para mensajes de éxito
function mostrarToastExito(mensaje) {
    let toast = document.getElementById("toastExito");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toastExito";
        toast.style.position = "fixed";
        toast.style.bottom = "32px";
        toast.style.left = "50%";
        toast.style.transform = "translateX(-50%)";
        toast.style.background = "#00a76f";
        toast.style.color = "#fff";
        toast.style.padding = "14px 32px";
        toast.style.borderRadius = "24px";
        toast.style.fontSize = "1.1rem";
        toast.style.fontWeight = "700";
        toast.style.boxShadow = "0 4px 24px rgba(0,0,0,0.13)";
        toast.style.zIndex = "9999";
        toast.style.opacity = "0";
        toast.style.pointerEvents = "none";
        toast.style.transition = "opacity 0.4s cubic-bezier(.4,2,.6,1), bottom 0.4s cubic-bezier(.4,2,.6,1)";
        document.body.appendChild(toast);
    }
    toast.textContent = mensaje;
    toast.style.opacity = "1";
    toast.style.bottom = "48px";
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.bottom = "32px";
    }, 1700);
}
const nameInput = document.getElementById("nombre");
const nombreHelp = document.getElementById("nombreHelp");
const apellidoInput = document.getElementById("apellido");
const apellidoHelp = document.getElementById("apellidoHelp");
const correoInput = document.getElementById("correo");
const correoHelp = document.getElementById("correoHelp");
const telefonoInput = document.getElementById("telefono");
const prefijoPaisSelect = document.getElementById("prefijoPais");
const telefonoHelp = document.getElementById("telefonoHelp");
const inputImagenes = document.getElementById("inputImagenes");
const inputImagenesHelp = document.getElementById("inputImagenesHelp");
const tamanoSelect = document.getElementById("tamaño");
const tamanoHelp = document.getElementById("tamanoHelp");
const tamanoChipsContainer = document.getElementById("tamanoChips");
const tamanoBaseIndicator = document.getElementById("tamanoBaseIndicator");
const toggleAsignacionFotos = document.getElementById("toggleAsignacionFotos");
const opcionesPapelGroup = document.querySelector(".opciones-papel");
const papelHelp = document.getElementById("papelHelp");
const previewContainer = document.getElementById("previewContainer");
const pasoTamanoSection = document.getElementById("pasoTamano");
const pasoPapelSection = document.getElementById("pasoPapel");
const pasoDatosSection = document.getElementById("pasoDatos");
const pedidoFlowGuideTitle = document.getElementById("pedidoFlowGuideTitle");
const pedidoFlowGuideText = document.getElementById("pedidoFlowGuideText");
const pedidoSpinnerOverlay = document.getElementById("pedidoSpinnerOverlay");
const pedidoSpinnerText = pedidoSpinnerOverlay
    ? pedidoSpinnerOverlay.querySelector(".pedido-spinner-text")
    : null;
const btnFinalizarPedido = document.getElementById("btnFinalizarPedido");
const cropImageModal = document.getElementById("cropImageModal");
const cropImageTarget = document.getElementById("cropImageTarget");
const cropImageHelp = cropImageModal ? cropImageModal.querySelector(".image-action-help") : null;
const cropCompareBefore = document.getElementById("cropCompareBefore");
const cropCompareAfter = document.getElementById("cropCompareAfter");
const cancelCropBtn = document.getElementById("cancelCropBtn");
const applyCropBtn = document.getElementById("applyCropBtn");
const frameImageModal = document.getElementById("frameImageModal");
const frameImagePreview = document.getElementById("frameImagePreview");
const frameOverlayPreview = document.getElementById("frameOverlayPreview");
const frameOptions = document.getElementById("frameOptions");
const cancelFrameBtn = document.getElementById("cancelFrameBtn");
const applyFrameAllBtn = document.getElementById("applyFrameAllBtn");
const clearFrameAllBtn = document.getElementById("clearFrameAllBtn");
const applyFrameBtn = document.getElementById("applyFrameBtn");
const facturaOverlay = document.getElementById("facturaOverlay");
const facturaInfo = document.getElementById("facturaInfo");
const facturaBody = document.getElementById("facturaBody");
const pedidoExitoOverlay = document.getElementById("pedidoExitoOverlay");
const pedidoExitoTitle = document.getElementById("pedidoExitoTitle");
const pedidoExitoNumero = document.getElementById("pedidoExitoNumero");
const pedidoExitoInfo = document.getElementById("pedidoExitoInfo");
const pedidoExitoBody = document.getElementById("pedidoExitoBody");
const pedidoExitoClose = document.getElementById("pedidoExitoClose");
const pedidoExitoEstado = document.getElementById("pedidoExitoEstado");
const pedidoExitoMasFotos = document.getElementById("pedidoExitoMasFotos");

const asignacionesPorFoto = new Map();
const edicionesPorFoto = new Map();
const previewUrlPorFoto = new Map();
window.fotosSubidasEnSegundoPlano = new Map();
let uploadQueue = [];
let uploadInProgress = 0;
const MAX_CONCURRENT = 3;

async function procesarSubidasBackground() {
    if (uploadQueue.length === 0 || uploadInProgress >= MAX_CONCURRENT) return;
    
    // Extraer siguiente archivo de la cola
    const item = uploadQueue.shift();
    uploadInProgress++;
    
    try {
        const fileFinal = await construirArchivoFinal(item.file);
        const formDataBg = new FormData();
        formDataBg.append("foto", fileFinal);
        
        // Usar draftKey para organizar la sesión
        const draftUrlParam = window.location.pathname.split("/").pop() || "temp_" + Date.now();
        formDataBg.append("draftKey", draftUrlParam);
        
        const res = await fetch("/api/upload-temporal", {
            method: "POST",
            body: formDataBg
        });
        
        if (res.ok) {
            const data = await res.json();
            window.fotosSubidasEnSegundoPlano.set(item.key, {
                secure_url: data.secure_url,
                public_id: data.public_id,
            });
            
            // Remover skeleton
            const cardUI = document.querySelector(`.card[data-foto-key="${item.key}"]`);
            if (cardUI) {
                cardUI.classList.remove("skeleton");
                cardUI.style.border = "2px solid #65b4f1";
            }
        }
    } catch(e) {
        console.warn("Error background upload:", e);
    } finally {
        uploadInProgress--;
        procesarSubidasBackground();
    }
}
const frameCatalogoBase = [
    { value: "none", label: "🚫 Ninguno" },
    { value: "polaroid", label: "📸 Polaroid" },
    { value: "gold", label: "🏆 Dorado" },
    { value: "dark", label: "⬛ Oscuro" },
    { value: "museum", label: "🖼️ Museo" },
];
let frameCatalogo = frameCatalogoBase.slice();
const imagenesMarcosCache = new Map();
const proporcionesTamanoFijas = Object.freeze({
    instax: 5 / 8,
    polaroid: 1,
});

let cropperInstance = null;
let rafComparadorRecorte = 0;
let fotoKeyEnEdicion = "";
let frameSeleccionadoTemporal = "none";
let bloquearMensajesValidacion = false;
let enviandoPedido = false;
let bloqueoSalidaEnvioActivo = false;
let restaurarClientePendiente = null;
let pedidoSeguimientoPendiente = { id: "", correo: "" };
let ultimoEstadoValidacion = null;
const PEDIDO_ACTIVO_SESSION_KEY = "imageManager_pedido_activo";
let contextoEnvioPedido = { modo: "create_new", pedidoId: "", correo: "" };

function _esRecargaPagina() {
    const navEntries = (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function")
        ? performance.getEntriesByType("navigation")
        : [];
    if (Array.isArray(navEntries) && navEntries.length > 0) {
        return navEntries[0] && navEntries[0].type === "reload";
    }
    return false;
}

function _guardarPedidoActivoEnSesion(pedidoId, correo) {
    if (!pedidoId) return;
    const payload = {
        id: String(pedidoId),
        correo: String(correo || "").trim(),
        ts: Date.now(),
    };
    try {
        sessionStorage.setItem(PEDIDO_ACTIVO_SESSION_KEY, JSON.stringify(payload));
    } catch (_error) {
        // Si sessionStorage no esta disponible, continuamos en memoria.
    }
}

function _obtenerPedidoActivoSesion() {
    try {
        const raw = sessionStorage.getItem(PEDIDO_ACTIVO_SESSION_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.id) return null;
        return {
            id: String(data.id),
            correo: String(data.correo || "").trim(),
        };
    } catch (_error) {
        return null;
    }
}

function _limpiarPedidoActivoSesion() {
    try {
        sessionStorage.removeItem(PEDIDO_ACTIVO_SESSION_KEY);
    } catch (_error) {
        // Ignorar errores de almacenamiento.
    }
}

function activarModoAnexarPedidoActual() {
    const pedidoActivo = _obtenerPedidoActivoSesion();
    if (!pedidoActivo || !pedidoActivo.id) {
        contextoEnvioPedido = { modo: "create_new", pedidoId: "", correo: "" };
        return false;
    }

    contextoEnvioPedido = {
        modo: "append_existing",
        pedidoId: pedidoActivo.id,
        correo: pedidoActivo.correo,
    };
    return true;
}

function resetearModoEnvioPedido() {
    contextoEnvioPedido = { modo: "create_new", pedidoId: "", correo: "" };
}

if (_esRecargaPagina()) {
    _limpiarPedidoActivoSesion();
    resetearModoEnvioPedido();
}
const estadoInteraccionValidacion = {
    intentoEnvio: false,
    blur: {
        fotos: false,
        tamano: false,
        papel: false,
        nombre: false,
        apellido: false,
        correo: false,
        telefono: false,
    },
};

const estadoInteraccionFlujo = {
    tamano: false,
    papel: false,
};

const nombreApellidoRegex = /^(?=.{2,60}$)[A-Za-zÀ-ÖØ-öø-ÿÑñ]+(?:[ '’-][A-Za-zÀ-ÖØ-öø-ÿÑñ]+)*$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneLocalRegex = /^\d{6,12}$/;
const ordenErroresVisual = ["fotos", "tamano", "papel", "nombre", "apellido", "correo", "telefono"];
const mensajesAyudaBase = Object.freeze({
    nombre: "Usa letras y separadores internos validos (espacio, apostrofe o guion). Ej: Maria Jose, O'Connor, Marie-Claire.",
    apellido: "Usa letras y separadores internos validos (espacio, apostrofe o guion). Ej: Lopez, Iñaki, D'Angelo.",
    correo: "Formato recomendado: usuario@dominio.com",
    imagenes: "",
    tamano: "Elige un solo tamano base. Toca el mismo chip otra vez para quitar la seleccion.",
    papel: "Selecciona el tipo de papel para tu impresion.",
});

btnEnviar.disabled = false;

function usaAsignacionPorFoto() {
    return !!(toggleAsignacionFotos && toggleAsignacionFotos.checked);
}

function setPasoVisible(seccion, visible) {
    if (!seccion) return;

    if (visible) {
        if (seccion.hidden) {
            seccion.hidden = false;
        }
        seccion.setAttribute("aria-hidden", "false");
        requestAnimationFrame(function() {
            seccion.classList.add("paso-seccion-visible");
        });
        return;
    }

    seccion.setAttribute("aria-hidden", "true");
    seccion.classList.remove("paso-seccion-visible");

    window.setTimeout(function() {
        if (seccion.getAttribute("aria-hidden") === "true") {
            seccion.hidden = true;
        }
    }, 230);
}

function tamanoPasoCompletado() {
    const fotosActuales = obtenerFotosActuales();
    if (fotosActuales.length === 0) return false;

    if (usaAsignacionPorFoto()) {
        return fotosActuales.every(function(file) {
            return !!asignacionesPorFoto.get(claveFoto(file));
        });
    }

    return !!(tamanoSelect && tamanoSelect.selectedOptions && tamanoSelect.selectedOptions.length > 0);
}

function marcarInteraccionFlujo(paso) {
    if (!Object.prototype.hasOwnProperty.call(estadoInteraccionFlujo, paso)) return;
    estadoInteraccionFlujo[paso] = true;
}

function reiniciarInteraccionFlujo() {
    estadoInteraccionFlujo.tamano = false;
    estadoInteraccionFlujo.papel = false;
}

function pasoHabilitado(seccion) {
    if (!seccion) return false;
    return String(seccion.dataset.stepDisabled || "").toLowerCase() !== "true";
}

function construirPasosFlujo(tieneFotos, tamanoCompletoInteractivo, papelCompletoInteractivo) {
    const pasos = [
        {
            key: "fotos",
            completed: tieneFotos,
            texto: "Selecciona tus fotos para empezar.",
        },
    ];

    if (pasoHabilitado(pasoTamanoSection)) {
        pasos.push({
            key: "tamano",
            completed: tamanoCompletoInteractivo,
            texto: usaAsignacionPorFoto()
                ? "Asigna un tamano a cada foto para continuar."
                : "Elige el tamano de impresion para tus fotos.",
        });
    }

    if (pasoHabilitado(pasoPapelSection)) {
        pasos.push({
            key: "papel",
            completed: papelCompletoInteractivo,
            texto: "Selecciona el tipo de papel.",
        });
    }

    if (pasoHabilitado(pasoDatosSection)) {
        pasos.push({
            key: "datos",
            completed: false,
            texto: "Completa tus datos personales y revisa el pedido.",
        });
    }

    return pasos;
}

function actualizarFlujoGuiadoPedido() {
    const totalFotos = obtenerFotosActuales().length;
    const miniaturasVisibles = previewContainer
        ? previewContainer.querySelectorAll(".card").length
        : 0;
    const tieneFotos = totalFotos > 0 && miniaturasVisibles > 0;

    if (!tieneFotos) {
        reiniciarInteraccionFlujo();
    }

    const tamanoCompleto = tamanoPasoCompletado();
    const tamanoCompletoInteractivo = tamanoCompleto && estadoInteraccionFlujo.tamano;
    const tienePapel = !!document.querySelector('input[name="papel"]:checked');
    const papelCompletoInteractivo = tienePapel && estadoInteraccionFlujo.papel;

    setPasoVisible(pasoTamanoSection, tieneFotos);
    setPasoVisible(pasoPapelSection, tieneFotos && tamanoCompletoInteractivo);
    setPasoVisible(pasoDatosSection, tieneFotos && tamanoCompletoInteractivo && papelCompletoInteractivo);

    if (!pedidoFlowGuideTitle || !pedidoFlowGuideText) return;

    const pasos = construirPasosFlujo(tieneFotos, tamanoCompletoInteractivo, papelCompletoInteractivo);
    const totalPasos = Math.max(1, pasos.length);
    let idxActual = pasos.findIndex(function(paso) {
        return !paso.completed;
    });
    if (idxActual < 0) {
        idxActual = totalPasos - 1;
    }
    const pasoActual = pasos[idxActual] || pasos[0];

    pedidoFlowGuideTitle.textContent = `Paso ${idxActual + 1} de ${totalPasos}`;
    pedidoFlowGuideText.textContent = pasoActual
        ? pasoActual.texto
        : "Completa tus datos personales y revisa el pedido.";
}

function actualizarVisibilidadAsignacion() {
    if (!toggleAsignacionFotos) return;
    const activa = usaAsignacionPorFoto();
    toggleAsignacionFotos.setAttribute("aria-expanded", activa ? "true" : "false");
}

function obtenerPrefijoSeleccionado() {
    return prefijoPaisSelect ? String(prefijoPaisSelect.value || "").replace(/\D/g, "") : "";
}

function obtenerAyudaTelefonoBase() {
    const prefijo = obtenerPrefijoSeleccionado() || "---";
    return `Prefijo seleccionado: +${prefijo}. Escribe solo el numero local (6 a 12 digitos).`;
}

function actualizarEstadoCampo(input, helpElement, isValid, mensajeBase, mensajeError, mostrarError = false) {
    if (!input || !helpElement) return;

    const aplicarError = !!mostrarError && !isValid;

    input.classList.toggle("input-validacion-error", aplicarError);
    input.setAttribute("aria-invalid", aplicarError ? "true" : "false");

    helpElement.classList.toggle("campo-ayuda-error", aplicarError);
    helpElement.textContent = aplicarError ? mensajeError : mensajeBase;
}

function actualizarEstadoAyuda(helpElement, isValid, mensajeBase, mensajeError, mostrarError = false) {
    if (!helpElement) return;

    const aplicarError = !!mostrarError && !isValid;

    helpElement.classList.toggle("campo-ayuda-error", aplicarError);
    helpElement.textContent = aplicarError ? mensajeError : mensajeBase;
}

function actualizarEstadoGrupo(groupElement, isValid, mostrarError = false) {
    if (!groupElement) return;
    const aplicarError = !!mostrarError && !isValid;
    groupElement.classList.toggle("group-validacion-error", aplicarError);
}

function marcarBlurCampo(campo) {
    if (!Object.prototype.hasOwnProperty.call(estadoInteraccionValidacion.blur, campo)) return;
    estadoInteraccionValidacion.blur[campo] = true;
}

function debeMostrarError(campo) {
    return !!estadoInteraccionValidacion.intentoEnvio || !!estadoInteraccionValidacion.blur[campo];
}

function reiniciarInteraccionValidacion() {
    estadoInteraccionValidacion.intentoEnvio = false;
    Object.keys(estadoInteraccionValidacion.blur).forEach(function(campo) {
        estadoInteraccionValidacion.blur[campo] = false;
    });
}

function obtenerPrimerKeyError(errores) {
    return ordenErroresVisual.find(function(key) {
        return !!errores[key];
    }) || "";
}

function primerSelectTamanoInvalido() {
    const candidatos = Array.from(document.querySelectorAll(".foto-tamano-select"));
    return candidatos.find(function(select) {
        return !String(select.value || "").trim();
    }) || null;
}

function enfocarElementoAccesible(elemento) {
    if (!elemento) return;
    try {
        elemento.focus({ preventScroll: true });
    } catch (_error) {
        elemento.focus();
    }
}

function elementoEsVisible(elemento) {
    if (!elemento) return false;
    return elemento.getClientRects().length > 0;
}

function obtenerObjetivoErrorPorClave(claveError) {
    if (!claveError) return null;

    if (claveError === "fotos") {
        return inputImagenes;
    }

    if (claveError === "tamano") {
        if (usaAsignacionPorFoto()) {
            const selectInvalido = primerSelectTamanoInvalido();
            if (selectInvalido) return selectInvalido;
        }

        const primerChip = tamanoChipsContainer ? tamanoChipsContainer.querySelector(".choice-chip") : null;
        if (primerChip && elementoEsVisible(primerChip)) return primerChip;
        if (tamanoSelect && elementoEsVisible(tamanoSelect)) return tamanoSelect;
        if (primerChip) return primerChip;
        return tamanoSelect;
    }

    if (claveError === "papel") {
        return document.querySelector('input[name="papel"]:checked')
            || document.querySelector('input[name="papel"]');
    }

    if (claveError === "nombre") return nameInput;
    if (claveError === "apellido") return apellidoInput;
    if (claveError === "correo") return correoInput;
    if (claveError === "telefono") return telefonoInput;

    return null;
}

function navegarAlPrimerError(estadoValidacion) {
    if (!estadoValidacion || estadoValidacion.esValido) return;

    const objetivo = obtenerObjetivoErrorPorClave(estadoValidacion.primerError);
    if (!objetivo) return;

    objetivo.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(function() {
        enfocarElementoAccesible(objetivo);
    }, 180);
}

function obtenerEstadoValidacion() {
    const nombre = nameInput.value.trim();
    const apellido = apellidoInput.value.trim();
    const correo = correoInput.value.trim();

    const nombreValido = nombreApellidoRegex.test(nombre);
    const apellidoValido = nombreApellidoRegex.test(apellido);
    const correoValido = emailRegex.test(correo);

    normalizarTelefonoInput();
    const prefijo = obtenerPrefijoSeleccionado();
    const telefonoLocal = telefonoInput.value.trim();
    const totalDigitos = `${prefijo}${telefonoLocal}`.length;
    const telefonoValido = !!prefijo && phoneLocalRegex.test(telefonoLocal) && totalDigitos >= 7 && totalDigitos <= 15;

    const MAX_FILES_PER_ORDER = 100;
    const MAX_IMAGE_BYTES_PER_FILE = 20 * 1024 * 1024; // 20 MB
    const LIMITE_MB = Math.floor(MAX_IMAGE_BYTES_PER_FILE / (1024 * 1024));

    const fotos = obtenerFotosActuales();
    let fotosValidas = false;
    let fotosError = "";

    if (fotos.length === 0) {
        fotosValidas = false;
        fotosError = "Selecciona al menos una foto para imprimir.";
    } else if (fotos.length > MAX_FILES_PER_ORDER) {
        fotosValidas = false;
        fotosError = `Maximo permitido: ${MAX_FILES_PER_ORDER} fotos por pedido.`;
    } else {
        const extPermitidas = new Set(["png", "jpg", "jpeg", "gif"]);
        const mimePermitidos = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/pjpeg"]);
        const errores = [];

        fotos.forEach((file) => {
            const nombre = String(file.name || "archivo");
            const ext = nombre.includes(".") ? nombre.split(".").pop().toLowerCase() : "";
            const mime = String(file.type || "")
                .toLowerCase()
                .split(";")[0]
                .trim();

            let extValida = extPermitidas.has(ext);
            let mimeValido = mimePermitidos.has(mime);

            // Browsers moviles pueden omitir MIME; se acepta si extension es valida.
            // La validacion fuerte de contenido la hace backend por firma y decodificacion.
            if (!extValida && !mimeValido) {
                errores.push(`Archivo ${nombre}: extensión y tipo MIME no permitidos. (Extensión: .${ext || 'desconocida'}, MIME: ${mime || 'desconocido'})`);
                return;
            }
            if (!extValida && mimeValido) {
                // Sin extension confiable, permitimos por MIME y backend vuelve a validar.
                extValida = true;
            }
            if (!mimeValido && extValida) {
                // MIME vacio o no reportado: permitir por extension.
                mimeValido = true;
            }

            const sizeBytes = file.size;
            if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
                errores.push(`Archivo vacío o corrupto: ${nombre}`);
                return;
            }

            if (sizeBytes > MAX_IMAGE_BYTES_PER_FILE) {
                errores.push(`${nombre} supera ${LIMITE_MB} MB`);
                return;
            }
        });

        if (errores.length) {
            fotosValidas = false;
            fotosError = errores.slice(0, 3).join("; ");
            if (errores.length > 3) {
                fotosError += `; y ${errores.length - 3} archivo(s) mas`;
            }
        } else {
            fotosValidas = true;
            fotosError = "";
        }
    }

    let tamanoValido = false;
    if (usaAsignacionPorFoto()) {
        tamanoValido = fotos.length > 0 && fotos.every(function(file) {
            return !!asignacionesPorFoto.get(claveFoto(file));
        });
    } else {
        tamanoValido = tamanoSelect.selectedOptions.length > 0;
    }

    const papelSeleccionado = document.querySelector('input[name="papel"]:checked');
    const papelValido = !!papelSeleccionado;

    let nombreError = "";
    if (!nombre) {
        nombreError = "Ingresa tus nombres.";
    } else if (!nombreValido) {
        nombreError = "Nombre invalido. Usa letras y separadores internos (espacio, apostrofe o guion), sin iniciar ni terminar con ellos.";
    }

    let apellidoError = "";
    if (!apellido) {
        apellidoError = "Ingresa tus apellidos.";
    } else if (!apellidoValido) {
        apellidoError = "Apellido invalido. Usa letras y separadores internos (espacio, apostrofe o guion), sin iniciar ni terminar con ellos.";
    }

    let correoError = "";
    if (!correo) {
        correoError = "Ingresa tu correo electronico.";
    } else if (!correoValido) {
        correoError = "Correo invalido. Ejemplo correcto: usuario@dominio.com";
    }

    let telefonoError = "";
    if (!prefijo) {
        telefonoError = "Selecciona un prefijo internacional.";
    } else if (!telefonoLocal) {
        telefonoError = "Ingresa tu numero local.";
    } else if (!phoneLocalRegex.test(telefonoLocal)) {
        telefonoError = "El numero local debe contener solo digitos (6 a 12).";
    } else if (totalDigitos < 7 || totalDigitos > 15) {
        telefonoError = "Con el prefijo internacional, el telefono completo debe tener entre 7 y 15 digitos.";
    }

    // fotosError ya calculado arriba (tipo/mime/tamano).

    let tamanoError = "";
    if (!tamanoValido) {
        tamanoError = usaAsignacionPorFoto()
            ? "Asigna un tamano a cada foto para continuar."
            : "Selecciona un tamano base para las fotos.";
    }

    const papelError = papelValido ? "" : "Selecciona un tipo de papel.";

    const errores = {
        fotos: fotosError,
        tamano: tamanoError,
        papel: papelError,
        nombre: nombreError,
        apellido: apellidoError,
        correo: correoError,
        telefono: telefonoError,
    };

    const esValido = !Object.values(errores).some(Boolean);

    return {
        esValido,
        errores,
        valores: {
            fotosValidas,
            tamanoValido,
            papelValido,
        },
        primerError: obtenerPrimerKeyError(errores),
    };
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
    if (!telefonoHelp.classList.contains("campo-ayuda-error")) {
        telefonoHelp.textContent = obtenerAyudaTelefonoBase();
    }
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

function etiquetaFotoVisible(file, index) {
    const nombre = file && typeof file.name === "string" ? file.name.trim() : "";
    return nombre || `Foto ${index + 1}`;
}

function esArchivoCargadoValido(file) {
    return !!(
        file
        && typeof file.name === "string"
        && Number.isFinite(Number(file.size))
        && Number(file.size) > 0
    );
}

function obtenerFotosGlobalesConFallback() {
    const desdeGlobal = Array.isArray(window.archivosGlobal)
        ? window.archivosGlobal.filter(esArchivoCargadoValido)
        : [];
    if (desdeGlobal.length > 0) return desdeGlobal;

    const desdePreviews = Array.isArray(window.previewsGlobal)
        ? window.previewsGlobal
            .map(function(item) { return item && item.archivo ? item.archivo : null; })
            .filter(esArchivoCargadoValido)
        : [];

    return desdePreviews;
}

function sincronizarInputConEstadoGlobalSiHaceFalta() {
    if (!inputImagenes || !window.DataTransfer) return;
    const inputCount = inputImagenes.files ? inputImagenes.files.length : 0;
    if (inputCount > 0) return;

    const respaldo = obtenerFotosGlobalesConFallback();
    if (respaldo.length === 0) return;

    try {
        const dt = new DataTransfer();
        respaldo.forEach(function(file) {
            dt.items.add(file);
        });
        inputImagenes.files = dt.files;
    } catch (_error) {
        // Fallback silencioso: la validacion usa respaldo global aunque no se pueda escribir en input.files.
    }
}

function obtenerFotosActuales() {
    sincronizarInputConEstadoGlobalSiHaceFalta();

    const desdeInput = inputImagenes && inputImagenes.files
        ? Array.from(inputImagenes.files)
        : [];

    if (desdeInput.length > 0) {
        return desdeInput;
    }

    return obtenerFotosGlobalesConFallback();
}

function obtenerArchivoPorKey(key) {
    return obtenerFotosActuales().find(function(file) {
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
    const vigentes = new Set(obtenerFotosActuales().map(claveFoto));

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
    if (rafComparadorRecorte) {
        cancelAnimationFrame(rafComparadorRecorte);
        rafComparadorRecorte = 0;
    }
    if (cropperInstance) {
        cropperInstance.destroy();
        cropperInstance = null;
    }
}

function limpiarComparadorRecorte() {
    if (cropCompareBefore) {
        cropCompareBefore.removeAttribute("src");
    }
    if (cropCompareAfter) {
        cropCompareAfter.removeAttribute("src");
    }
}

function actualizarComparadorRecorte() {
    if (!cropperInstance || !cropCompareAfter) return;
    const canvas = cropperInstance.getCroppedCanvas({
        maxWidth: 420,
        maxHeight: 420,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
    });
    if (!canvas) return;
    cropCompareAfter.src = canvas.toDataURL("image/jpeg", 0.9);
}

function programarActualizacionComparadorRecorte() {
    if (rafComparadorRecorte) return;
    rafComparadorRecorte = requestAnimationFrame(function() {
        rafComparadorRecorte = 0;
        actualizarComparadorRecorte();
    });
}

function esMarcoPersonalizado(frameValue) {
    return String(frameValue || "").startsWith("custom:");
}

function obtenerMarcoCatalogo(frameValue) {
    return frameCatalogo.find(function(item) {
        return item.value === frameValue;
    }) || null;
}

async function cargarMarcosPersonalizados() {
    // Mostrar spinner de carga en el contenedor de marcos
    if (frameOptions) {
        frameOptions.innerHTML = '<div class="spinner-marcos">Cargando marcos...</div>';
    }
    try {
        const res = await fetch("/api/marcos", {
            method: "GET",
            cache: "no-store",
            headers: {
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
        });
        if (!res.ok) {
            throw new Error("No se pudo cargar el catalogo de marcos");
        }
        const data = await res.json();
        const marcos = Array.isArray(data.marcos)
            ? data.marcos.filter(function(m) {
                return !!(m && m.id != null && String(m.imagen_url || "").trim());
            })
            : [];
        const marcosDinamicos = marcos.map(function(m) {
            return {
                value: `custom:${m.id}`,
                label: `✨ ${m.nombre}`,
                imageUrl: m.imagen_url,
                kind: "custom",
            };
        });
        frameCatalogo = frameCatalogoBase.concat(marcosDinamicos);
    } catch (_error) {
        frameCatalogo = frameCatalogoBase.slice();
        if (frameOptions) {
            frameOptions.innerHTML = '<div class="error-marcos">No se pudo cargar el catálogo de marcos.</div>';
        }
    }
}

function actualizarClaseMarcoPreview(frameValue) {
    if (!frameImagePreview) return;
    const marco = obtenerMarcoCatalogo(frameValue);
    const personalizado = !!(marco && marco.kind === "custom");
    frameImagePreview.dataset.frame = personalizado ? "none" : frameValue;
    if (frameOverlayPreview) {
        if (personalizado && marco.imageUrl) {
            frameOverlayPreview.onerror = function() {
                frameOverlayPreview.hidden = true;
                frameOverlayPreview.removeAttribute("src");
            };
            frameOverlayPreview.src = marco.imageUrl;
            frameOverlayPreview.hidden = false;
        } else {
            frameOverlayPreview.hidden = true;
            frameOverlayPreview.removeAttribute("src");
        }
    }
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
        btn.setAttribute("aria-label", `Marco ${item.label.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ-]/g, "").trim()}`);
        // Si tiene imagen, mostrar miniatura
        if (item.imageUrl) {
            const img = document.createElement("img");
            img.src = item.imageUrl;
            img.alt = item.label;
            img.className = "frame-thumb";
            img.onerror = function() { img.style.display = "none"; };
            btn.prepend(img);
        }
        btn.addEventListener("click", function() {
            frameSeleccionadoTemporal = item.value;
            actualizarClaseMarcoPreview(item.value);
            renderOpcionesMarco(frameSeleccionadoTemporal);
        });
        frameOptions.appendChild(btn);
    });
}

function obtenerTamanoSeleccionadoParaFoto(key) {
    if (!key) return obtenerTamanoBaseSeleccionado();

    const tamanoPorFoto = asignacionesPorFoto.get(key);
    if (tamanoPorFoto) return tamanoPorFoto;

    return obtenerTamanoBaseSeleccionado();
}

function obtenerRelacionTamano(claveTamano) {
    const clave = String(claveTamano || "").trim().toLowerCase();
    if (!clave) return null;

    if (Object.prototype.hasOwnProperty.call(proporcionesTamanoFijas, clave)) {
        return proporcionesTamanoFijas[clave];
    }

    const match = clave.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/i);
    if (!match) return null;

    const ancho = Number(match[1]);
    const alto = Number(match[2]);
    if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) {
        return null;
    }

    return ancho / alto;
}

function ajustarRelacionSegunOrientacion(relacion, ancho, alto) {
    if (!Number.isFinite(relacion) || relacion <= 0) return NaN;
    if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) {
        return relacion;
    }

    if (ancho >= alto && relacion < 1) {
        return 1 / relacion;
    }
    if (alto > ancho && relacion > 1) {
        return 1 / relacion;
    }

    return relacion;
}

function nombreTamanoPorClave(claveTamano) {
    const clave = String(claveTamano || "").trim();
    if (!clave || !tamanoSelect) return clave;

    const option = Array.from(tamanoSelect.options).find(function(opt) {
        return opt.value === clave;
    });
    return option ? option.textContent : clave;
}

function abrirModalRecorte(key) {
    const file = obtenerArchivoPorKey(key);
    if (!file || !cropImageTarget || typeof Cropper === "undefined") {
        errorMessage.textContent = "No se pudo abrir el recorte. Recarga la pagina e intenta de nuevo.";
        errorMessage.style.color = "red";
        return;
    }

    const tamanoClave = obtenerTamanoSeleccionadoParaFoto(key);
    const relacionBase = obtenerRelacionTamano(tamanoClave);
    if (!tamanoClave || !Number.isFinite(relacionBase) || relacionBase <= 0) {
        errorMessage.textContent = "Selecciona un tamano valido antes de recortar para mantener la proporcion.";
        errorMessage.style.color = "red";
        return;
    }

    fotoKeyEnEdicion = key;
    const src = obtenerPreviewFoto(file);
    if (cropCompareBefore) {
        cropCompareBefore.src = src;
    }
    if (cropCompareAfter) {
        cropCompareAfter.src = src;
    }

    destruirCropper();
    cropImageTarget.onload = function() {
        destruirCropper();
        const relacionFinal = ajustarRelacionSegunOrientacion(
            relacionBase,
            cropImageTarget.naturalWidth,
            cropImageTarget.naturalHeight
        );

        if (cropImageHelp) {
            const tamanoNombre = nombreTamanoPorClave(tamanoClave);
            cropImageHelp.textContent = `Recorte proporcional bloqueado a ${tamanoNombre}. Arrastra para mover el encuadre y usa la rueda para hacer zoom.`;
        }

        cropperInstance = new Cropper(cropImageTarget, {
            viewMode: 1,
            aspectRatio: relacionFinal,
            dragMode: "move",
            autoCropArea: 0.86,
            responsive: true,
            background: false,
            guides: true,
            movable: true,
            zoomable: true,
            scalable: false,
            rotatable: false,
            ready: function() {
                programarActualizacionComparadorRecorte();
            },
            crop: function() {
                programarActualizacionComparadorRecorte();
            },
        });
    };
    cropImageTarget.src = src;
    abrirModal(cropImageModal);
}

async function abrirModalMarco(key) {
    const file = obtenerArchivoPorKey(key);
    if (!file || !frameImagePreview) return;

    await cargarMarcosPersonalizados();

    fotoKeyEnEdicion = key;
    const edit = edicionesPorFoto.get(key);
    const frameEditado = edit && edit.frame ? edit.frame : "none";
    frameSeleccionadoTemporal = obtenerMarcoCatalogo(frameEditado) ? frameEditado : "none";
    frameImagePreview.src = obtenerPreviewFoto(file);
    actualizarClaseMarcoPreview(frameSeleccionadoTemporal);
    renderOpcionesMarco(frameSeleccionadoTemporal);
    abrirModal(frameImageModal);
}

async function cargarImagenDesdeUrl(url) {
    return new Promise(function(resolve, reject) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function() { resolve(img); };
        img.onerror = reject;
        img.src = url;
    });
}

async function cargarImagenMarcoConCache(url) {
    if (!url) {
        throw new Error("URL de marco no disponible");
    }
    if (imagenesMarcosCache.has(url)) {
        return imagenesMarcosCache.get(url);
    }

    const imagen = await cargarImagenDesdeUrl(url);
    imagenesMarcosCache.set(url, imagen);
    return imagen;
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
        if (!ctx) return baseBlob;

        const marco = obtenerMarcoCatalogo(frameValue);
        if (marco && marco.kind === "custom" && marco.imageUrl) {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            try {
                const overlay = await cargarImagenMarcoConCache(marco.imageUrl);
                ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
            } catch (_error) {
                return baseBlob;
            }

            return await blobDesdeCanvas(canvas, tipoMime);
        }

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
    obtenerFotosActuales().forEach(function(file) {
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

    obtenerFotosActuales().forEach(function(file) {
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

    tamanoChipsContainer.setAttribute("aria-describedby", "tamanoHelp");
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
        chip.setAttribute("aria-describedby", "tamanoHelp");
        chip.setAttribute("aria-label", `Seleccionar tamano ${opt.textContent}`);

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
    // Buscar cantidades reales desde archivosGlobal (o previewsGlobal si es necesario)
    (window.archivosGlobal || []).forEach(function(item) {
        const clave = claveFoto(item);
        const tamano = asignacionesPorFoto.get(clave);
        if (!tamano) return;

        const option = Array.from(tamanoSelect.options).find(function(opt) {
            return opt.value === tamano;
        });
        const nombre = option ? option.textContent : tamano;

        if (!resumen[tamano]) {
            resumen[tamano] = { nombre, cantidad: 0 };
        }
        // Sumar la cantidad real seleccionada en el stepper
        resumen[tamano].cantidad += (item.cantidad || 1);
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

    const files = obtenerFotosActuales();
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

        const editActual = edicionesPorFoto.get(key);
        const marcoActual = editActual && editActual.frame ? String(editActual.frame) : "none";
        const tieneMarco = marcoActual !== "none";
        let marcoBadge = card.querySelector(".card-frame-badge");

        if (tieneMarco) {
            const infoMarco = obtenerMarcoCatalogo(marcoActual);
            const labelRaw = infoMarco && infoMarco.label ? String(infoMarco.label) : "Marco aplicado";
            const labelLimpio = labelRaw.replace(/^[^A-Za-z0-9]+/, "").trim() || "Marco aplicado";

            if (!marcoBadge) {
                marcoBadge = document.createElement("span");
                marcoBadge.className = "card-frame-badge";
                card.appendChild(marcoBadge);
            }

            marcoBadge.textContent = labelLimpio;
            marcoBadge.setAttribute("aria-label", `Marco activo: ${labelLimpio}`);
            card.classList.add("card-con-marco");
        } else {
            if (marcoBadge) marcoBadge.remove();
            card.classList.remove("card-con-marco");
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

        select.addEventListener("change", function(event) {
            if (select.value) {
                asignacionesPorFoto.set(key, select.value);
            } else {
                asignacionesPorFoto.delete(key);
            }
            if (event && event.isTrusted) {
                marcarInteraccionFlujo("tamano");
            }
            actualizarFlujoGuiadoPedido();
            emitirAsignacionesActualizadas();
            validarFormulario();
        });

        select.addEventListener("focus", function(event) {
            if (event && event.isTrusted) {
                marcarInteraccionFlujo("tamano");
                actualizarFlujoGuiadoPedido();
            }
        });

        select.addEventListener("blur", function() {
            marcarBlurCampo("tamano");
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
    if (pedidoSpinnerText) {
        pedidoSpinnerText.textContent = "Enviando pedido...";
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
    if (pedidoSpinnerText) {
        pedidoSpinnerText.textContent = "Enviando pedido...";
    }
    if (btnFinalizarPedido) {
        btnFinalizarPedido.disabled = false;
    }
}

function activarBloqueoSalidaDuranteEnvio() {
    bloqueoSalidaEnvioActivo = true;
    window.onbeforeunload = function() {
        return "Tu pedido se está enviando. Si sales ahora, se puede interrumpir.";
    };
}

function desactivarBloqueoSalidaDuranteEnvio() {
    if (!bloqueoSalidaEnvioActivo) return;
    bloqueoSalidaEnvioActivo = false;
    window.onbeforeunload = null;
}

function actualizarProgresoSubidaPedido(porcentaje, mensaje, estado = "loading") {
    const pct = Math.max(0, Math.min(100, Math.round(Number(porcentaje) || 0)));

    if (progressContainer) {
        progressContainer.dataset.state = estado;
        progressContainer.setAttribute("aria-busy", estado === "loading" ? "true" : "false");
    }

    if (progressBar) {
        progressBar.style.width = `${pct}%`;
        progressBar.textContent = `${pct}%`;
        progressBar.setAttribute("aria-valuenow", String(pct));
    }

    const texto = String(mensaje || "").trim();
    if (progressStatusText && texto) {
        progressStatusText.textContent = texto;
    }

    if (pedidoSpinnerText && texto) {
        pedidoSpinnerText.textContent = texto;
    }
}

function abrirModalExitoPedido(clienteId, correoCliente, infoHtml, bodyHtml, opciones = {}) {
    if (!pedidoExitoOverlay) return;
    const operacion = String(opciones.operacion || "create_new").trim().toLowerCase();
    pedidoSeguimientoPendiente = {
        id: clienteId ? String(clienteId) : "",
        correo: String(correoCliente || "").trim(),
    };

    _guardarPedidoActivoEnSesion(clienteId, correoCliente);
    
    // Guardar pedido en localStorage para persistencia
    try {
        const STORAGE_KEY = 'imageManager_pedidos';
        const fotosGuardadas = JSON.parse(localStorage.getItem("pedidoFotos") || "[]");
        const papelSeleccionado = document.querySelector('input[name="papel"]:checked')?.value || '';
        const totalElement = document.getElementById('facturaTotal');
        const total = totalElement ? parseFloat(totalElement.textContent.replace(/[^0-9.]/g, '')) : 0;
        
        const pedidoData = {
            id: clienteId,
            correo: correoCliente,
            estado: 'pendiente',
            numFotos: fotosGuardadas.length,
            total: total,
            papel: papelSeleccionado,
            fechaRegistro: new Date().toISOString(),
            fechaGuardado: new Date().toISOString()
        };
        
        const data = localStorage.getItem(STORAGE_KEY);
        const pedidos = data ? JSON.parse(data) : [];
        
        // Evitar duplicados
        const existeIndex = pedidos.findIndex(p => p.id === clienteId);
        if (existeIndex >= 0) {
            pedidos[existeIndex] = { ...pedidos[existeIndex], ...pedidoData };
        } else {
            pedidos.unshift(pedidoData);
        }
        
        // Mantener máximo 5 pedidos
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pedidos.slice(0, 5)));

        try {
            const em = String(correoCliente || '').trim().toLowerCase();
            if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
                localStorage.setItem('misPedidos_email', em);
            }
        } catch (e) { /* ignore */ }
        
        const SP = window.SeguimientoPedidos;
        if (SP && typeof SP.sincronizarPedidosDesdeServidor === 'function') {
            SP.sincronizarPedidosDesdeServidor().finally(() => {
                if (typeof SP.refrescarBannerSeguimiento === 'function') SP.refrescarBannerSeguimiento();
                else if (typeof SP.crearBotonSeguimiento === 'function') SP.crearBotonSeguimiento();
            });
        } else if (SP && typeof SP.crearBotonSeguimiento === 'function') {
            SP.crearBotonSeguimiento();
        }
    } catch (e) {
        console.error('Error guardando pedido en localStorage:', e);
    }
    
    if (pedidoExitoTitle) {
        pedidoExitoTitle.innerHTML = operacion === "append_existing"
            ? `¡Fotos anexadas al Pedido #<span id="pedidoExitoNumero">${String(clienteId || "-")}</span>!`
            : `¡Pedido #<span id="pedidoExitoNumero">${String(clienteId || "-")}</span> Creado con Exito!`;
    } else if (pedidoExitoNumero) {
        pedidoExitoNumero.textContent = String(clienteId || "-");
    }
    if (pedidoExitoInfo) {
        const contextoHtml = operacion === "append_existing"
            ? '<p style="margin:0 0 8px;color:#0a66cc;font-weight:700;">Modo aplicado: se agregaron fotos al pedido existente.</p>'
            : '<p style="margin:0 0 8px;color:#0a8f3d;font-weight:700;">Modo aplicado: se creó un pedido nuevo independiente.</p>';
        pedidoExitoInfo.innerHTML = `${contextoHtml}${infoHtml || ""}`;
    }
    if (pedidoExitoBody) pedidoExitoBody.innerHTML = bodyHtml || "";
    pedidoExitoOverlay.classList.add("active");
}

function cerrarModalExitoPedido() {
    if (!pedidoExitoOverlay) return;
    pedidoExitoOverlay.classList.remove("active");
}

// 🔹 Validación completa (datos + fotos + tamaño + papel)
function validarFormulario() {
    const estado = obtenerEstadoValidacion();
    ultimoEstadoValidacion = estado;

    const nombreError = estado.errores.nombre;
    const apellidoError = estado.errores.apellido;
    const correoError = estado.errores.correo;
    const telefonoError = estado.errores.telefono;
    const fotosError = estado.errores.fotos;
    const tamanoError = estado.errores.tamano;
    const papelError = estado.errores.papel;

    const fotosValidas = estado.valores.fotosValidas;
    const tamanoValido = estado.valores.tamanoValido;
    const papelValido = estado.valores.papelValido;

    const mostrarNombreError = debeMostrarError("nombre");
    const mostrarApellidoError = debeMostrarError("apellido");
    const mostrarCorreoError = debeMostrarError("correo");
    const mostrarTelefonoError = debeMostrarError("telefono");
    const mostrarFotosError = debeMostrarError("fotos");
    const mostrarTamanoError = debeMostrarError("tamano");
    const mostrarPapelError = debeMostrarError("papel");

    const aplicarErrorFotos = mostrarFotosError && !fotosValidas;
    const aplicarErrorTamano = mostrarTamanoError && !tamanoValido;
    const aplicarErrorPapel = mostrarPapelError && !papelValido;

    actualizarEstadoCampo(nameInput, nombreHelp, !nombreError, mensajesAyudaBase.nombre, nombreError, mostrarNombreError);
    actualizarEstadoCampo(apellidoInput, apellidoHelp, !apellidoError, mensajesAyudaBase.apellido, apellidoError, mostrarApellidoError);
    actualizarEstadoCampo(correoInput, correoHelp, !correoError, mensajesAyudaBase.correo, correoError, mostrarCorreoError);
    actualizarEstadoCampo(telefonoInput, telefonoHelp, !telefonoError, obtenerAyudaTelefonoBase(), telefonoError, mostrarTelefonoError);

    if (inputImagenes) {
        inputImagenes.classList.toggle("input-validacion-error", aplicarErrorFotos);
        inputImagenes.setAttribute("aria-invalid", aplicarErrorFotos ? "true" : "false");
    }
    actualizarEstadoAyuda(inputImagenesHelp, fotosValidas, mensajesAyudaBase.imagenes, fotosError, mostrarFotosError);

    if (tamanoSelect) {
        tamanoSelect.classList.toggle("input-validacion-error", aplicarErrorTamano);
        tamanoSelect.setAttribute("aria-invalid", aplicarErrorTamano ? "true" : "false");
    }
    if (tamanoChipsContainer) {
        tamanoChipsContainer.classList.toggle("group-validacion-error", aplicarErrorTamano);
        tamanoChipsContainer.setAttribute("aria-invalid", aplicarErrorTamano ? "true" : "false");
    }
    actualizarEstadoAyuda(tamanoHelp, tamanoValido, mensajesAyudaBase.tamano, tamanoError, mostrarTamanoError);

    actualizarEstadoGrupo(opcionesPapelGroup, papelValido, mostrarPapelError);
    if (opcionesPapelGroup) {
        opcionesPapelGroup.setAttribute("aria-describedby", "papelHelp");
        opcionesPapelGroup.setAttribute("aria-invalid", aplicarErrorPapel ? "true" : "false");
    }
    document.querySelectorAll('input[name="papel"]').forEach(function(radio) {
        radio.setAttribute("aria-describedby", "papelHelp");
        radio.setAttribute("aria-invalid", aplicarErrorPapel ? "true" : "false");
    });
    actualizarEstadoAyuda(papelHelp, papelValido, mensajesAyudaBase.papel, papelError, mostrarPapelError);

    const esValido = estado.esValido;

    // Mantener el primer intento disponible; tras un intento fallido,
    // el botón se habilita solo cuando todo vuelve a estar válido.
    if (btnEnviar && !enviandoPedido) {
        const bloquearRevision = estadoInteraccionValidacion.intentoEnvio && !esValido;
        btnEnviar.disabled = bloquearRevision;
    }

    if (bloquearMensajesValidacion) {
        return esValido;
    }

    return esValido;
}

// Validación en tiempo real
[nameInput, apellidoInput, correoInput, telefonoInput].forEach(input => {
    input.addEventListener("input", validarFormulario);
});

if (nameInput) {
    nameInput.addEventListener("blur", function() {
        marcarBlurCampo("nombre");
        validarFormulario();
    });
}

if (apellidoInput) {
    apellidoInput.addEventListener("blur", function() {
        marcarBlurCampo("apellido");
        validarFormulario();
    });
}

if (correoInput) {
    correoInput.addEventListener("blur", function() {
        marcarBlurCampo("correo");
        validarFormulario();
    });
}

if (telefonoInput) {
    telefonoInput.addEventListener("blur", function() {
        marcarBlurCampo("telefono");
        validarFormulario();
    });
}

if (prefijoPaisSelect) {
    prefijoPaisSelect.addEventListener("change", function() {
        actualizarAyudaTelefono();
        validarFormulario();
    });
    prefijoPaisSelect.addEventListener("blur", function() {
        marcarBlurCampo("telefono");
        validarFormulario();
    });
}

inputImagenes.addEventListener("change", function(e) {
    validarFormulario();
    if(inputImagenes.files) {
        Array.from(inputImagenes.files).forEach(file => {
             const k = claveFoto(file);
             if(!window.fotosSubidasEnSegundoPlano.has(k)) {
                 // Add subtle overlay indicator while uploading
                 uploadQueue.push({key: k, file: file});
                 setTimeout(() => {
                     const cardUI = document.querySelector(`.card[data-foto-key="${k}"]`);
                     if (cardUI && !window.fotosSubidasEnSegundoPlano.has(k)) {
                         cardUI.classList.add("skeleton");
                     }
                 }, 100);
             }
        });
        procesarSubidasBackground();
    }
});
inputImagenes.addEventListener("blur", function() {
    marcarBlurCampo("fotos");
    validarFormulario();
});

tamanoSelect.addEventListener("change", function(event) {
    if (event && event.isTrusted) {
        marcarInteraccionFlujo("tamano");
    }
    sincronizarTamanoBaseEnAsignacion(false);
    actualizarIndicadorTamanoBase();
    renderTamanoChips();
    renderAsignacionesFotos();
    actualizarFlujoGuiadoPedido();
    validarFormulario();
});
tamanoSelect.addEventListener("blur", function() {
    marcarBlurCampo("tamano");
    validarFormulario();
});

tamanoSelect.addEventListener("focus", function(event) {
    if (event && event.isTrusted) {
        marcarInteraccionFlujo("tamano");
        actualizarFlujoGuiadoPedido();
    }
});

if (tamanoChipsContainer) {
    tamanoChipsContainer.addEventListener("click", function(event) {
        if (event && event.isTrusted) {
            marcarInteraccionFlujo("tamano");
            actualizarFlujoGuiadoPedido();
        }
    });

    tamanoChipsContainer.addEventListener("focusout", function(event) {
        const siguiente = event.relatedTarget;
        if (siguiente && tamanoChipsContainer.contains(siguiente)) {
            return;
        }
        marcarBlurCampo("tamano");
        validarFormulario();
    });
}

document.querySelectorAll('input[name="papel"]').forEach(radio => {
    radio.addEventListener("change", function(event) {
        if (event && event.isTrusted) {
            marcarInteraccionFlujo("papel");
        }
        actualizarFlujoGuiadoPedido();
        validarFormulario();
    });
    radio.addEventListener("focus", function(event) {
        if (event && event.isTrusted) {
            marcarInteraccionFlujo("papel");
            actualizarFlujoGuiadoPedido();
        }
    });
    radio.addEventListener("blur", function() {
        const activo = document.activeElement;
        if (activo && activo.getAttribute && activo.getAttribute("name") === "papel") {
            return;
        }
        marcarBlurCampo("papel");
        validarFormulario();
    });
});

if (opcionesPapelGroup) {
    opcionesPapelGroup.addEventListener("focusout", function(event) {
        const siguiente = event.relatedTarget;
        if (siguiente && opcionesPapelGroup.contains(siguiente)) {
            return;
        }
        marcarBlurCampo("papel");
        validarFormulario();
    });
}

document.addEventListener("imagenesActualizadas", function() {
    sincronizarTamanoBaseEnAsignacion(false);
    actualizarFlujoGuiadoPedido();
    validarFormulario();
});

document.addEventListener("asignacionesTamanosActualizadas", function() {
    actualizarFlujoGuiadoPedido();
});

document.addEventListener("galeriaRenderizada", function() {
    renderAsignacionesFotos();
});

if (toggleAsignacionFotos) {
    toggleAsignacionFotos.addEventListener("change", function() {
        estadoInteraccionFlujo.tamano = false;
        actualizarVisibilidadAsignacion();
        sincronizarTamanoBaseEnAsignacion(false);
        renderAsignacionesFotos();
        actualizarFlujoGuiadoPedido();
        validarFormulario();
    });
}

window.obtenerResumenTamanosAsignados = obtenerResumenTamanosAsignados;
window.usaAsignacionPorFoto = usaAsignacionPorFoto;
autoDetectarPaisInicial();
cargarMarcosPersonalizados();
actualizarVisibilidadAsignacion();
actualizarFlujoGuiadoPedido();
actualizarIndicadorTamanoBase();
renderTamanoChips();
renderAsignacionesFotos();

if (cancelCropBtn) {
    cancelCropBtn.addEventListener("click", function() {
        destruirCropper();
        limpiarComparadorRecorte();
        cerrarModal(cropImageModal);
    });
}

if (applyCropBtn) {
    applyCropBtn.addEventListener("click", async function() {
        if (!cropperInstance || !fotoKeyEnEdicion) return;

        const fileBase = obtenerArchivoPorKey(fotoKeyEnEdicion);
        if (!fileBase) return;

        try {
            // Limitar resolución máxima del recorte (igual que preview)
            const canvas = cropperInstance.getCroppedCanvas({
                maxWidth: 1200, // puedes ajustar este valor según lo que consideres óptimo
                maxHeight: 1200,
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
            limpiarComparadorRecorte();
            cerrarModal(cropImageModal);
            mostrarToastExito("Recorte aplicado correctamente.");
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
        edicionesPorFoto.set(fotoKeyEnEdicion, {
            blob: prevEdit ? prevEdit.blob || null : null,
            previewUrl: prevEdit ? prevEdit.previewUrl || null : null,
            frame: frameSeleccionadoTemporal,
        });
        renderAsignacionesFotos();
        cerrarModal(frameImageModal);
        mostrarToastExito("Marco guardado correctamente.");
    });
}

if (applyFrameAllBtn) {
    applyFrameAllBtn.addEventListener("click", function() {
        const totalFotos = obtenerFotosActuales().length;
        if (totalFotos === 0) return;
        aplicarMarcoATodasLasFotos(frameSeleccionadoTemporal);
        renderAsignacionesFotos();
        cerrarModal(frameImageModal);
        mostrarToastExito(`Marco aplicado a ${totalFotos} foto(s).`);
    });
}

if (clearFrameAllBtn) {
    clearFrameAllBtn.addEventListener("click", function() {
        const totalFotos = obtenerFotosActuales().length;
        if (totalFotos === 0) return;
        aplicarMarcoATodasLasFotos("none");
        frameSeleccionadoTemporal = "none";
        renderAsignacionesFotos();
        cerrarModal(frameImageModal);
        mostrarToastExito(`Marcos quitados de ${totalFotos} foto(s).`);
    });
}

document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        destruirCropper();
        limpiarComparadorRecorte();
        cerrarModal(cropImageModal);
        cerrarModal(frameImageModal);
        cerrarModalExitoPedido();
    }
});

if (cropImageModal) {
    cropImageModal.addEventListener("click", function(e) {
        if (e.target === cropImageModal) {
            destruirCropper();
            limpiarComparadorRecorte();
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
        const seActivo = activarModoAnexarPedidoActual();
        if (!seActivo) {
            if (errorMessage) {
                errorMessage.textContent = "No se detecto un pedido activo para anexar. Se creara un pedido nuevo.";
                errorMessage.style.color = "#b45309";
            }
        } else if (errorMessage) {
            errorMessage.textContent = `Modo activo: las fotos se anexaran al pedido #${contextoEnvioPedido.pedidoId}.`;
            errorMessage.style.color = "#0a66cc";
        }
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

    const MAX_DIMENSION = 1600;
    const UMBRAL_COMPRESION = 2 * 1024 * 1024; // 2 MB

    const reemplazarExtPorJpeg = (nombre = "") => {
        const n = String(nombre || "");
        if (!n) return "imagen.jpg";
        return n.replace(/\.[^.]+$/, ".jpg");
    };

    const decodificarImagen = async (blob) => {
        // createImageBitmap suele ser más rápido que Image tradicional
        if (typeof createImageBitmap === "function") {
            return await createImageBitmap(blob);
        }
        return await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    };

    const comprimirABlobJpeg = async (blob, tipoDestino = "image/jpeg") => {
        const tipo = String(blob?.type || "").toLowerCase();
        const metaEsPng = tipo.includes("png");

        const fuente = await decodificarImagen(blob);
        const width = fuente.width || 0;
        const height = fuente.height || 0;
        if (!width || !height) return null;

        const ratio = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        const outW = Math.max(1, Math.round(width * ratio));
        const outH = Math.max(1, Math.round(height * ratio));

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;

        // Evitar fondo transparente al convertir PNG -> JPEG
        if (metaEsPng) {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, outW, outH);
        }

        ctx.drawImage(fuente, 0, 0, outW, outH);

        // Menor calidad para archivos grandes (reduce tiempo de subida)
        const quality =
            blob.size > 6 * 1024 * 1024 ? 0.72 :
                blob.size > 2 * 1024 * 1024 ? 0.82 : 0.9;

        return await new Promise((resolve, reject) => {
            canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error("No se pudo comprimir la imagen."))),
                tipoDestino,
                quality
            );
        });
    };

    const optimizarArchivoParaSubida = async (entrada, metaFile) => {
        const nombreMeta = String(metaFile?.name || entrada?.name || "imagen");
        const tipoEntrada = String(entrada?.type || metaFile?.type || "").toLowerCase();
        // Importante: decidir por el tipo real del contenido a subir (puede cambiar tras recortes/marcos).
        const esGif = tipoEntrada.includes("gif");
        if (esGif) return metaFile || entrada;

        const sizeBytes = Number(entrada?.size || metaFile?.size || 0) || 0;
        const esPng = tipoEntrada.includes("png");
        const esJpeg = tipoEntrada.includes("jpeg") || tipoEntrada.includes("jpg") || tipoEntrada.includes("image/jpg");

        // Compresión solo si conviene (PNG o archivos grandes) para no penalizar CPU.
        if (!esPng && esJpeg && sizeBytes <= UMBRAL_COMPRESION) {
            return metaFile || entrada;
        }

        // Convertir a JPEG suele acelerar el upload y el procesamiento en Cloudinary.
        const blobJpeg = await comprimirABlobJpeg(entrada, "image/jpeg").catch(() => null);
        if (!blobJpeg) return metaFile || entrada;

        // Si no reduce el tamaño de forma significativa, devolvemos el original.
        if (metaFile && Number(metaFile.size) && blobJpeg.size >= metaFile.size * 0.98) {
            return metaFile;
        }

        return new File([blobJpeg], reemplazarExtPorJpeg(nombreMeta), {
            type: "image/jpeg",
            lastModified: Date.now(),
        });
    };

    if (!edit) {
        return await optimizarArchivoParaSubida(file, file);
    }

    let blobBase = edit.blob || file;
    if (edit.frame && edit.frame !== "none") {
        const tipoMime = (file.type && String(file.type).toLowerCase() === "image/gif")
            ? "image/jpeg"
            : (file.type || "image/jpeg");
        try {
            blobBase = await aplicarMarcoABlob(blobBase, edit.frame, tipoMime);
        } catch (_error) {
            blobBase = edit.blob || file;
        }
    }

    return await optimizarArchivoParaSubida(blobBase, file);
}

// 🔹 Submit — valida y abre resumen; si ya fue confirmado, envía el pedido
form.addEventListener("submit", async function(e) {
    e.preventDefault();

    if (enviandoPedido) return;

    sincronizarInputConEstadoGlobalSiHaceFalta();

    estadoInteraccionValidacion.intentoEnvio = true;
    const esValido = validarFormulario();
    if (!esValido) {
        if (errorMessage) {
            errorMessage.textContent = "";
        }
        navegarAlPrimerError(ultimoEstadoValidacion || obtenerEstadoValidacion());
        return;
    }

    // Si no está confirmado, abrir modal de resumen primero
    if (!form.dataset.confirmed) {
        if (typeof window.abrirResumenPedido === "function") {
            window.abrirResumenPedido();
        }
        return;
    }
    delete form.dataset.confirmed;

    enviandoPedido = true;
    mostrarSpinnerPedido();
    activarBloqueoSalidaDuranteEnvio();
    bloquearMensajesValidacion = true;
    btnEnviar.disabled = true;
    errorMessage.textContent = "Procesando fotos…⏳";
    errorMessage.style.color = "#00ff4c";

    // Construir FormData
    const formData = new FormData();
    formData.append('nombre', nameInput.value.trim());
    formData.append('apellido', apellidoInput.value.trim());
    formData.append('correo', correoInput.value.trim());
    formData.append('telefono', telefonoInternacionalCompleto());
    formData.append('fechaRegistro', new Date().toLocaleString());

    if (contextoEnvioPedido.modo === "append_existing" && contextoEnvioPedido.pedidoId) {
        formData.append('append_existing', '1');
        formData.append('pedido_id', String(contextoEnvioPedido.pedidoId));
    } else {
        formData.append('append_existing', '0');
    }
    
    // Stop background queue from initiating new uploads to avoid conflicts with fallback
    uploadQueue = [];

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
        // Modo tamaño único: sumar las copias totales de todas las fotos
        const totalCopias = (window.archivosGlobal || []).reduce(function(acc, item) {
            return acc + (item.cantidad || 1);
        }, 0);

        const tamanosTexto = Array.from(tamanoSelect.selectedOptions)
            .map(function(o) { return o.text; })
            .join(', ');
        formData.append('tamano', tamanosTexto);

        // Enviar clave:cantidad para que el backend calcule precios correctos
        const tamanosKeys = Array.from(tamanoSelect.selectedOptions)
            .map(function(o) { return o.value + ':' + totalCopias; })
            .join(',');
        formData.append('tamano_keys', tamanosKeys);
    }

    // Papel
    const papel = document.querySelector('input[name="papel"]:checked').value;
    formData.append('papel', papel);

    // Fotos (con recorte/marco aplicado si existe edición) + cantidades por foto
    const cantidadesPorFoto = [];
    const fotosPreCargadas = [];
    const fotosConEdicionOmitida = [];
    const cantidadesPorClave = new Map(
        (window.archivosGlobal || []).map(function(file) {
            return [claveFoto(file), file.cantidad || 1];
        })
    );
    let allPreUploaded = true;
    const fotosActuales = obtenerFotosActuales();
    for (let idx = 0; idx < fotosActuales.length; idx++) {
        const foto = fotosActuales[idx];
        const k = claveFoto(foto);
        const cantidadFoto = cantidadesPorClave.get(k) || 1;
        const nombreFoto = etiquetaFotoVisible(foto, idx);
        const edit = edicionesPorFoto.get(k);
        const requiereEdicion = !!(
            edit && (edit.blob || (edit.frame && edit.frame !== "none"))
        );
        cantidadesPorFoto.push(cantidadFoto);

        const subidaFondo = window.fotosSubidasEnSegundoPlano.get(k);
        if (subidaFondo && !requiereEdicion) {
            fotosPreCargadas.push({
                secure_url: subidaFondo.secure_url,
                public_id: subidaFondo.public_id,
                cantidad: cantidadFoto,
            });
            continue;
        }

        try {
            const fotoFinal = await construirArchivoFinal(foto);
            allPreUploaded = false;
            formData.append('fotos', fotoFinal);
        } catch (err) {
            console.warn("Error en edicion", err);
            if (subidaFondo) {
                fotosPreCargadas.push({
                    secure_url: subidaFondo.secure_url,
                    public_id: subidaFondo.public_id,
                    cantidad: cantidadFoto,
                });
                if (requiereEdicion) {
                    fotosConEdicionOmitida.push(nombreFoto);
                }
            } else {
                allPreUploaded = false;
                formData.append('fotos', foto); // fallback
                if (requiereEdicion) {
                    fotosConEdicionOmitida.push(nombreFoto);
                }
            }
        }
    }
    formData.append('cantidades', cantidadesPorFoto.join(','));
    formData.append('fotosPreCargadas', JSON.stringify(fotosPreCargadas));
    
    // Limpiar 'fotos' del formdata si todo subió en fondo
    if (allPreUploaded) {
         formData.delete('fotos');
    }

    try {
        const estadoSubida = {
            porcentaje: 0,
            conexionLentaAvisada: false,
        };

        const mensajeInicio = "Subiendo fotos... 0%";
        errorMessage.textContent = mensajeInicio;
        errorMessage.style.color = "#00a76f";
        actualizarProgresoSubidaPedido(0, mensajeInicio, "loading");

        const infoResumenHtml = facturaInfo ? facturaInfo.innerHTML : "";
        const bodyResumenHtml = facturaBody ? facturaBody.innerHTML : "";
        const clientePersistido = {
            nombre: nameInput.value,
            apellido: apellidoInput.value,
            correo: correoInput.value,
            telefono: telefonoInput.value,
            prefijoPais: prefijoPaisSelect ? prefijoPaisSelect.value : "",
        };

        const respuestaGuardado = await guardarCliente(formData, {
            onUploadProgress: function(loaded, total) {
                if (!enviandoPedido) return;
                if (!total || total <= 0) return;
                const pct = Math.max(1, Math.min(99, Math.round((loaded / total) * 100)));
                estadoSubida.porcentaje = pct;
                const mensaje = `Subiendo fotos... ${pct}%`;
                errorMessage.textContent = mensaje;
                errorMessage.style.color = "#00a76f";
                actualizarProgresoSubidaPedido(pct, mensaje, "loading");
            },
            onSlowUpload: function() {
                if (!enviandoPedido || estadoSubida.conexionLentaAvisada) return;
                estadoSubida.conexionLentaAvisada = true;
                const mensajeLento = "Tu conexión parece un poco lenta, pero seguimos subiendo tus fotos. Por favor, no cierres esta ventana.";
                errorMessage.textContent = mensajeLento;
                errorMessage.style.color = "#c77800";
                actualizarProgresoSubidaPedido(estadoSubida.porcentaje, mensajeLento, "loading");
            },
        });

        actualizarProgresoSubidaPedido(100, "Subida completada. Procesando respuesta del servidor...", "completed");
        const clienteGuardado = respuestaGuardado && respuestaGuardado.cliente
            ? respuestaGuardado.cliente
            : respuestaGuardado;
        const fallosSubida = respuestaGuardado && Array.isArray(respuestaGuardado.fallos)
            ? respuestaGuardado.fallos
            : [];
        clienteChannel.postMessage({ tipo: "nuevo_cliente", cliente: clienteGuardado });

        if (typeof window.resetearEstadoImagenes === "function") {
            window.resetearEstadoImagenes({ conservarMensajes: true });
        }

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
        reiniciarInteraccionValidacion();
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
        btnEnviar.disabled = false;
        enviandoPedido = false;

        if (fallosSubida.length > 0 || fotosConEdicionOmitida.length > 0) {
            const partes = [];
            if (fallosSubida.length > 0) {
                const fallosLegibles = fallosSubida.map(function(item, index) {
                    if (typeof item === "string") return item;
                    if (item && typeof item.filename === "string") return item.filename;
                    if (item && typeof item.name === "string") return item.name;
                    return `Foto ${index + 1}`;
                });
                const resumenFallos = fallosLegibles.slice(0, 2).join(", ");
                const extraFallos = fallosSubida.length > 2 ? ` y ${fallosSubida.length - 2} más` : "";
                partes.push(`Fallaron ${fallosSubida.length} foto(s): ${resumenFallos}${extraFallos}`);
            }
            if (fotosConEdicionOmitida.length > 0) {
                const resumenEdicion = fotosConEdicionOmitida.slice(0, 2).join(", ");
                const extraEdicion = fotosConEdicionOmitida.length > 2 ? ` y ${fotosConEdicionOmitida.length - 2} más` : "";
                partes.push(`No se pudo aplicar marco/edicion en ${fotosConEdicionOmitida.length} foto(s): ${resumenEdicion}${extraEdicion}`);
            }
            errorMessage.textContent = `Pedido enviado parcialmente. ${partes.join(". ")}.`;
            errorMessage.style.color = "#d97706";
        } else {
            errorMessage.textContent = "Pedido enviado con exito!";
            errorMessage.style.color = "#00ff4c";
        }
        desactivarBloqueoSalidaDuranteEnvio();
        bloquearMensajesValidacion = false;
        ocultarSpinnerPedido();
        const advertenciasProcesamiento = [];
        if (fallosSubida.length > 0) {
            advertenciasProcesamiento.push(`${fallosSubida.length} foto(s) fallaron`);
        }
        if (fotosConEdicionOmitida.length > 0) {
            advertenciasProcesamiento.push(`${fotosConEdicionOmitida.length} foto(s) quedaron sin marco/edicion`);
        }
        const bodyConEstado = advertenciasProcesamiento.length > 0
            ? `${bodyResumenHtml}<p style=\"margin-top:10px;color:#b45309;font-weight:700;\">Se procesó el pedido con advertencias: ${advertenciasProcesamiento.join(" y ")}.</p>`
            : bodyResumenHtml;
        abrirModalExitoPedido(
            clienteGuardado.id,
            clienteGuardado.correo,
            infoResumenHtml,
            bodyConEstado,
            { operacion: respuestaGuardado.operacion || "create_new" }
        );
        resetearModoEnvioPedido();
        window.dispatchEvent(new CustomEvent("pedido:enviado", {
            detail: {
                clienteId: clienteGuardado.id,
                correo: clienteGuardado.correo,
            },
        }));

    } catch (error) {
        bloquearMensajesValidacion = false;
        enviandoPedido = false;
        const mensaje = (error && error.message)
            ? error.message
            : "No se pudo completar el envío. Revisa tu conexión e inténtalo de nuevo.";
        errorMessage.textContent = mensaje;
        errorMessage.style.color = "red";
        actualizarProgresoSubidaPedido(0, mensaje, "error");
        btnEnviar.disabled = false;
        desactivarBloqueoSalidaDuranteEnvio();
        ocultarSpinnerPedido();
        console.error("Error al guardar:", error);
    }
});

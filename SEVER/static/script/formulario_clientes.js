import { guardarCliente } from './db.js';

const clienteChannel = new BroadcastChannel("clientes_channel");

const form = document.getElementById("formDatos");
const btnEnviar = document.getElementById("btnVerResumen");
const errorMessage = document.getElementById("mensajeError");
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
const pedidoSpinnerOverlay = document.getElementById("pedidoSpinnerOverlay");
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
const pedidoExitoNumero = document.getElementById("pedidoExitoNumero");
const pedidoExitoInfo = document.getElementById("pedidoExitoInfo");
const pedidoExitoBody = document.getElementById("pedidoExitoBody");
const pedidoExitoClose = document.getElementById("pedidoExitoClose");
const pedidoExitoEstado = document.getElementById("pedidoExitoEstado");
const pedidoExitoMasFotos = document.getElementById("pedidoExitoMasFotos");

const asignacionesPorFoto = new Map();
const edicionesPorFoto = new Map();
const previewUrlPorFoto = new Map();
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
let restaurarClientePendiente = null;
let pedidoSeguimientoPendiente = { id: "", correo: "" };
let ultimoEstadoValidacion = null;
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

const nombreApellidoRegex = /^(?=.{2,60}$)[A-Za-zÀ-ÖØ-öø-ÿÑñ]+(?:[ '’-][A-Za-zÀ-ÖØ-öø-ÿÑñ]+)*$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const phoneLocalRegex = /^\d{6,12}$/;
const ordenErroresVisual = ["fotos", "tamano", "papel", "nombre", "apellido", "correo", "telefono"];
const mensajesAyudaBase = Object.freeze({
    nombre: "Usa letras y separadores internos validos (espacio, apostrofe o guion). Ej: Maria Jose, O'Connor, Marie-Claire.",
    apellido: "Usa letras y separadores internos validos (espacio, apostrofe o guion). Ej: Lopez, Iñaki, D'Angelo.",
    correo: "Formato recomendado: usuario@dominio.com",
    imagenes: "Formatos: PNG, JPG, GIF. Maximo 150 imagenes, 10 MB por archivo.",
    tamano: "Elige un solo tamano base. Toca el mismo chip otra vez para quitar la seleccion.",
    papel: "Selecciona el tipo de papel para tu impresion.",
});

btnEnviar.disabled = false;

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

    const totalFotos = inputImagenes.files ? inputImagenes.files.length : 0;
    const fotosValidas = totalFotos > 0;

    const fotos = Array.from(inputImagenes.files || []);
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

    const fotosError = fotosValidas ? "" : "Selecciona al menos una foto para imprimir.";

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
    try {
        const res = await fetch("/api/marcos");
        if (!res.ok) {
            throw new Error("No se pudo cargar el catalogo de marcos");
        }

        const data = await res.json();
        const marcos = Array.isArray(data.marcos) ? data.marcos : [];
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
        // Mantiene el catálogo base si la API no está disponible.
        frameCatalogo = frameCatalogoBase.slice();
    }
}

function actualizarClaseMarcoPreview(frameValue) {
    if (!frameImagePreview) return;

    const marco = obtenerMarcoCatalogo(frameValue);
    const personalizado = !!(marco && marco.kind === "custom");
    frameImagePreview.dataset.frame = personalizado ? "none" : frameValue;

    if (frameOverlayPreview) {
        if (personalizado && marco.imageUrl) {
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

inputImagenes.addEventListener("change", validarFormulario);
inputImagenes.addEventListener("blur", function() {
    marcarBlurCampo("fotos");
    validarFormulario();
});

tamanoSelect.addEventListener("change", function() {
    sincronizarTamanoBaseEnAsignacion(false);
    actualizarIndicadorTamanoBase();
    renderTamanoChips();
    renderAsignacionesFotos();
    validarFormulario();
});
tamanoSelect.addEventListener("blur", function() {
    marcarBlurCampo("tamano");
    validarFormulario();
});

if (tamanoChipsContainer) {
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
    radio.addEventListener("change", validarFormulario);
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
cargarMarcosPersonalizados();
actualizarVisibilidadAsignacion();
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
            limpiarComparadorRecorte();
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

        errorMessage.textContent = "Pedido enviado con exito!";
        errorMessage.style.color = "#00ff4c";
        bloquearMensajesValidacion = false;
        ocultarSpinnerPedido();
        abrirModalExitoPedido(clienteGuardado.id, clienteGuardado.correo, infoResumenHtml, bodyResumenHtml);
        window.dispatchEvent(new CustomEvent("pedido:enviado", {
            detail: {
                clienteId: clienteGuardado.id,
                correo: clienteGuardado.correo,
            },
        }));

    } catch (error) {
        bloquearMensajesValidacion = false;
        errorMessage.textContent = error.message;
        errorMessage.style.color = "red";
        btnEnviar.disabled = false;
        ocultarSpinnerPedido();
        console.error("Error al guardar:", error);
    }
});

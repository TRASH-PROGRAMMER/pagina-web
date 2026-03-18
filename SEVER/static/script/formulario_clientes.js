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
const toggleAsignacionFotos = document.getElementById("toggleAsignacionFotos");
const asignacionTamanosSection = document.getElementById("asignacionTamanos");
const previewContainer = document.getElementById("previewContainer");
const asignacionFotosList = document.getElementById("asignacionFotosList");
const tamanoGlobal = document.getElementById("tamanoGlobal");
const aplicarTamanoTodasBtn = document.getElementById("aplicarTamanoTodas");

const asignacionesPorFoto = new Map();

btnEnviar.disabled = true;

function usaAsignacionPorFoto() {
    return !!(toggleAsignacionFotos && toggleAsignacionFotos.checked);
}

function actualizarVisibilidadAsignacion() {
    if (!asignacionTamanosSection || !toggleAsignacionFotos) return;
    const activa = usaAsignacionPorFoto();
    asignacionTamanosSection.hidden = !activa;
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

function obtenerOpcionesTamano() {
    return Array.from(tamanoSelect.options).map(function(opt) {
        return { value: opt.value, text: opt.textContent };
    });
}

function actualizarSelectGlobal() {
    if (!tamanoGlobal) return;
    const valorActual = tamanoGlobal.value;
    const opciones = obtenerOpcionesTamano();

    tamanoGlobal.innerHTML = '<option value="">Selecciona un tamaño para todas</option>';
    opciones.forEach(function(op) {
        const option = document.createElement("option");
        option.value = op.value;
        option.textContent = op.text;
        if (op.value === valorActual) {
            option.selected = true;
        }
        tamanoGlobal.appendChild(option);
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
    if (!asignacionFotosList) return;

    const files = Array.from(inputImagenes.files || []);
    const clavesActuales = new Set(files.map(claveFoto));

    Array.from(asignacionesPorFoto.keys()).forEach(function(key) {
        if (!clavesActuales.has(key)) {
            asignacionesPorFoto.delete(key);
        }
    });

    const opciones = obtenerOpcionesTamano();
    asignacionFotosList.innerHTML = "";

    if (files.length === 0) {
        emitirAsignacionesActualizadas();
        return;
    }

    files.forEach(function(file, idx) {
        const key = claveFoto(file);
        const card = document.createElement("div");
        card.className = "asignacion-item";

        const titulo = document.createElement("div");
        titulo.className = "foto-titulo";
        titulo.textContent = `Foto ${idx + 1}`;

        const nombre = document.createElement("div");
        nombre.className = "foto-nombre";
        nombre.textContent = file.name;

        const select = document.createElement("select");
        select.className = "foto-tamano-select";
        select.setAttribute("aria-label", `Seleccionar tamaño para Foto ${idx + 1}`);

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

        card.appendChild(titulo);
        card.appendChild(nombre);
        card.appendChild(select);
        asignacionFotosList.appendChild(card);
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
        errorMessage.textContent = "Completa todos los campos correctamente.";
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
    actualizarSelectGlobal();
    renderAsignacionesFotos();
    validarFormulario();
});
document.querySelectorAll('input[name="papel"]').forEach(radio => {
    radio.addEventListener("change", validarFormulario);
});

document.addEventListener("imagenesActualizadas", function() {
    renderAsignacionesFotos();
    validarFormulario();
});

if (aplicarTamanoTodasBtn) {
    aplicarTamanoTodasBtn.addEventListener("click", function() {
        if (!tamanoGlobal || !tamanoGlobal.value) {
            errorMessage.textContent = "Selecciona un tamaño para aplicar a todas las fotos.";
            errorMessage.style.color = "red";
            return;
        }

        Array.from(inputImagenes.files || []).forEach(function(file) {
            asignacionesPorFoto.set(claveFoto(file), tamanoGlobal.value);
        });
        renderAsignacionesFotos();
        validarFormulario();
    });
}

if (toggleAsignacionFotos) {
    toggleAsignacionFotos.addEventListener("change", function() {
        actualizarVisibilidadAsignacion();
        validarFormulario();
    });
}

window.obtenerResumenTamanosAsignados = obtenerResumenTamanosAsignados;
window.usaAsignacionPorFoto = usaAsignacionPorFoto;
autoDetectarPaisInicial();
actualizarVisibilidadAsignacion();
actualizarSelectGlobal();
renderAsignacionesFotos();

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

    // Fotos
    for (const foto of inputImagenes.files) {
        formData.append('fotos', foto);
    }

    try {
        const clienteGuardado = await guardarCliente(formData);
        clienteChannel.postMessage({ tipo: "nuevo_cliente", cliente: clienteGuardado });
        renderMiniaturasSubidas(clienteGuardado.thumbnails || []);

        errorMessage.textContent = " ¡Pedido enviado con éxito! 🎉";
        errorMessage.style.color = "#00ff4c";
        form.reset();
        // Limpiar selección de tamaño y papel
        tamanoSelect.selectedIndex = -1;
        asignacionesPorFoto.clear();
        document.querySelectorAll('input[name="papel"]').forEach(r => r.checked = false);
        if (tamanoGlobal) tamanoGlobal.value = "";
        renderAsignacionesFotos();
        // Cerrar/resetear modal factura
        const facturaOverlay = document.getElementById("facturaOverlay");
        if (facturaOverlay) facturaOverlay.classList.remove("active");
        const btnResumen = document.getElementById("btnVerResumen");
        if (btnResumen) btnResumen.disabled = true;
        btnEnviar.disabled = true;

    } catch (error) {
        errorMessage.textContent = error.message;
        errorMessage.style.color = "red";
        btnEnviar.disabled = false;
        console.error("Error al guardar:", error);
    }
});
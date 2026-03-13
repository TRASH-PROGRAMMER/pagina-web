import { guardarCliente } from './db.js';

const clienteChannel = new BroadcastChannel("clientes_channel");

const form = document.getElementById("formDatos");
const btnEnviar = document.querySelector(".enviar-button");
const errorMessage = document.getElementById("mensajeError");
const nameInput = document.getElementById("nombre");
const apellidoInput = document.getElementById("apellido");
const correoInput = document.getElementById("correo");
const telefonoInput = document.getElementById("telefono");
const inputImagenes = document.getElementById("inputImagenes");
const tamanoSelect = document.getElementById("tamaño");

btnEnviar.disabled = true;

// 🔹 Validación completa (datos + fotos + tamaño + papel)
function validarFormulario() {

    const nameRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,}$/;
    const nombreValido = nameRegex.test(nameInput.value.trim());
    const apellidoRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]{2,}$/;
    const apellidoValido = apellidoRegex.test(apellidoInput.value.trim());

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const correoValido = emailRegex.test(correoInput.value.trim());

    const phoneRegex = /^\d{7,15}$/;
    const telefonoValido = phoneRegex.test(telefonoInput.value.trim());

    // Validar que haya al menos 1 foto
    const fotosValidas = inputImagenes.files && inputImagenes.files.length > 0;

    // Validar que se haya seleccionado al menos un tamaño
    const tamanoValido = tamanoSelect.selectedOptions.length > 0;

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
        errorMessage.textContent = "Selecciona al menos un tamaño de foto.";
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
inputImagenes.addEventListener("change", validarFormulario);
tamanoSelect.addEventListener("change", validarFormulario);
document.querySelectorAll('input[name="papel"]').forEach(radio => {
    radio.addEventListener("change", validarFormulario);
});

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
    formData.append('telefono', telefonoInput.value.trim());
    formData.append('fechaRegistro', new Date().toLocaleString());

    // Tamaños seleccionados (texto legible + claves para precios)
    const tamanosTexto = Array.from(tamanoSelect.selectedOptions)
                              .map(o => o.text)
                              .join(', ');
    formData.append('tamano', tamanosTexto);

    // Claves de tamaño para cálculo de precios en el backend
    const tamanosKeys = Array.from(tamanoSelect.selectedOptions)
                             .map(o => o.value)
                             .join(',');
    formData.append('tamano_keys', tamanosKeys);

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

        errorMessage.textContent = " ¡Pedido enviado con éxito! 🎉";
        errorMessage.style.color = "#00ff4c";
        form.reset();
        // Limpiar selección de tamaño y papel
        tamanoSelect.selectedIndex = -1;
        document.querySelectorAll('input[name="papel"]').forEach(r => r.checked = false);
        // Limpiar previews
        const previewContainer = document.getElementById("previewContainer");
        if (previewContainer) previewContainer.innerHTML = "";
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
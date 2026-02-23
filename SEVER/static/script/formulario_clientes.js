import { guardarCliente } from './db.js';

const form = document.getElementById("formDatos");
const btnEnviar = document.querySelector(".enviar-button");
const errorMessage = document.getElementById("mensajeError");
const nameInput = document.getElementById("nombre");
const apellidoInput = document.getElementById("apellido");
const correoInput = document.getElementById("correo");
const telefonoInput = document.getElementById("telefono");

btnEnviar.disabled = true;

// 🔹 Validación
function validarFormulario() {

    const nombreValido = nameInput.value.trim() !== "";
    const apellidoValido = apellidoInput.value.trim() !== "";

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const correoValido = emailRegex.test(correoInput.value.trim());

    const phoneRegex = /^\d{7,15}$/;
    const telefonoValido = phoneRegex.test(telefonoInput.value.trim());

    const esValido = nombreValido && apellidoValido && correoValido && telefonoValido;

    btnEnviar.disabled = !esValido;
    errorMessage.textContent = esValido ? "" : "Por favor, completa todos los campos correctamente.";
    return esValido;
}

// Validación en tiempo real
[nameInput, apellidoInput, correoInput, telefonoInput].forEach(input => {
    input.addEventListener("input", validarFormulario);
});

// 🔹 Submit
form.addEventListener("submit", async function(e) {
    e.preventDefault();

    if (!validarFormulario()) return;

    const datos = {
        nombre: nameInput.value.trim(),
        apellido: apellidoInput.value.trim(),
        correo: correoInput.value.trim(),
        telefono: telefonoInput.value.trim(),
        fechaRegistro: new Date().toLocaleString()
    };

    try {
        await guardarCliente(datos);

        alert("Datos guardados correctamente ✅");
        form.reset();
        btnEnviar.disabled = true;

    } catch (error) {
        console.error("Error al guardar:", error);
    }
});
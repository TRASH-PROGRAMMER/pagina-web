// Validación de campos al enviar el formulario

const form = document.getElementById("formDatos");
const nameInput = document.getElementById("nombre");
const apellidoInput = document.getElementById("apellido");
const correoInput = document.getElementById("correo");
const telefonoInput = document.getElementById("telefono");

const erroresDiv = document.createElement("div");
erroresDiv.style.color = "red";
form.prepend(erroresDiv);

form.addEventListener("submit", function(e) {
    e.preventDefault();

    let errores = [];

    if (nameInput.value.trim() === "") {
        errores.push("El nombre es obligatorio.");
    }

    if (apellidoInput.value.trim() === "") {
        errores.push("El apellido es obligatorio.");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correoInput.value.trim())) {
        errores.push("El correo no es válido.");
    }

    const phoneRegex = /^\d{7,15}$/;
    if (!phoneRegex.test(telefonoInput.value.trim())) {
        errores.push("El teléfono debe contener solo números y tener entre 7 y 15 dígitos.");
    }

    if (errores.length > 0) {
        erroresDiv.innerHTML = errores.map(err => `<p>${err}</p>`).join("");
        return;
    }

    erroresDiv.innerHTML = "";

    // Aquí puedes llamar tu función para guardar datos en IndexedDB o enviar formulario
    // Por ejemplo:
    // guardarDatos();

    // Si quieres enviar el formulario al servidor sin validación adicional, puedes usar:
    // form.submit();
});
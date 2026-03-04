// ─── Calculadora de precios en tiempo real ────────────────────────────────────
const preciosContainer = document.getElementById("preciosFotos");
const tamanoSelect     = document.getElementById("tamaño");
const inputImagenes    = document.getElementById("inputImagenes");

// Escuchar cambios en tamaño y fotos para recalcular
tamanoSelect.addEventListener("change", calcularPrecios);
inputImagenes.addEventListener("change", calcularPrecios);

async function calcularPrecios() {
    const seleccionados = Array.from(tamanoSelect.selectedOptions);
    const numFotos      = inputImagenes.files ? inputImagenes.files.length : 0;

    // Si no hay fotos o tamaño seleccionado, ocultar panel
    if (seleccionados.length === 0 || numFotos === 0) {
        preciosContainer.innerHTML = "";
        preciosContainer.classList.remove("visible");
        return;
    }

    let filas = "";
    let totalGeneral = 0;

    for (const opt of seleccionados) {
        const tamano   = opt.value;
        const etiqueta = opt.text;

        try {
            const res = await fetch("/api/precios", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tamano, cantidad: numFotos })
            });

            if (!res.ok) continue;
            const data = await res.json();

            totalGeneral += data.total;

            filas += `
                <tr>
                    <td>${etiqueta}</td>
                    <td>${data.cantidad}</td>
                    <td>$${data.precio_unitario.toFixed(2)}</td>
                    <td class="precio-total-col">$${data.total.toFixed(2)}</td>
                </tr>
            `;
        } catch (err) {
            console.error("Error obteniendo precio:", err);
        }
    }

    if (filas) {
        preciosContainer.innerHTML = `
            <h3>💰 Resumen de precios</h3>
            <table class="tabla-precios">
                <thead>
                    <tr>
                        <th>Tamaño</th>
                        <th>Cantidad</th>
                        <th>Precio c/u</th>
                        <th>Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    ${filas}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" class="total-label">Total estimado</td>
                        <td class="total-valor">$${totalGeneral.toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
            <p class="precio-nota">* Instax y Polaroid: consultar precio. Los descuentos se aplican automáticamente según cantidad.</p>
        `;
        preciosContainer.classList.add("visible");
    }
}
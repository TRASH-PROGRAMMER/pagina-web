// ─── Resumen de precios tipo factura (modal) ──────────────────────────────────
const tamanoSelect  = document.getElementById("tamaño");
const inputImagenes = document.getElementById("inputImagenes");
const btnResumen    = document.getElementById("btnVerResumen");
const overlay       = document.getElementById("facturaOverlay");
const closeBtn      = document.getElementById("facturaClose");
const facturaInfo   = document.getElementById("facturaInfo");
const facturaBody   = document.getElementById("facturaBody");

if (!tamanoSelect || !inputImagenes || !btnResumen || !overlay || !facturaInfo || !facturaBody) {
    console.warn("precios_fotos.js: faltan elementos del DOM, abortando.");
}

// Habilitar/deshabilitar botón según selección
function checkResumenBtn() {
    const tienesFotos  = inputImagenes && inputImagenes.files && inputImagenes.files.length > 0;
    const tieneTamano  = tamanoSelect && tamanoSelect.selectedOptions.length > 0;
    if (btnResumen) btnResumen.disabled = !(tienesFotos && tieneTamano);
}

if (tamanoSelect) tamanoSelect.addEventListener("change", checkResumenBtn);
if (inputImagenes) inputImagenes.addEventListener("change", checkResumenBtn);

// Abrir modal
btnResumen.addEventListener("click", async function () {
    const seleccionados = Array.from(tamanoSelect.selectedOptions);
    const numFotos      = inputImagenes.files ? inputImagenes.files.length : 0;
    const papelRadio    = document.querySelector('input[name="papel"]:checked');
    const papel         = papelRadio ? papelRadio.value : "No seleccionado";

    if (seleccionados.length === 0 || numFotos === 0) return;

    // Info del pedido
    const fecha = new Date().toLocaleDateString("es-EC", {
        day: "2-digit", month: "long", year: "numeric"
    });
    facturaInfo.innerHTML = `
        <div class="factura-info-row">
            <span>📅 Fecha</span><span>${fecha}</span>
        </div>
        <div class="factura-info-row">
            <span>🖼️ Fotos</span><span>${numFotos} imagen${numFotos > 1 ? "es" : ""}</span>
        </div>
        <div class="factura-info-row">
            <span>📄 Papel</span><span class="factura-papel">${papel}</span>
        </div>
    `;

    // Calcular precios
    let filas = "";
    let totalGeneral = 0;

    for (const opt of seleccionados) {
        try {
            const res = await fetch("/api/precios", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tamano: opt.value, cantidad: numFotos })
            });
            if (!res.ok) continue;
            const data = await res.json();
            totalGeneral += data.total;

            filas += `
                <tr>
                    <td>${opt.text}</td>
                    <td class="text-center">${data.cantidad}</td>
                    <td class="text-right">$${data.precio_unitario.toFixed(2)}</td>
                    <td class="text-right subtotal-col">$${data.total.toFixed(2)}</td>
                </tr>
            `;
        } catch (err) {
            console.error("Error precio:", err);
        }
    }

    facturaBody.innerHTML = `
        <table class="factura-tabla">
            <thead>
                <tr>
                    <th>Tamaño</th>
                    <th class="text-center">Cant.</th>
                    <th class="text-right">P/U</th>
                    <th class="text-right">Subtotal</th>
                </tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
        <div class="factura-total">
            <span>TOTAL ESTIMADO</span>
            <span class="factura-total-valor">$${totalGeneral.toFixed(2)}</span>
        </div>
    `;

    overlay.classList.add("active");
});

// Cerrar modal
closeBtn.addEventListener("click", () => overlay.classList.remove("active"));
overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("active");
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.classList.remove("active");
});

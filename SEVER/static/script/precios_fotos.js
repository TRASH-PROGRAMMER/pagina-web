// ─── Resumen de precios tipo factura (modal) ──────────────────────────────────
const tamanoSelect  = document.getElementById("tamaño");
const inputImagenes = document.getElementById("inputImagenes");
const btnResumen    = document.getElementById("btnVerResumen");
const overlay       = document.getElementById("facturaOverlay");
const closeBtn      = document.getElementById("facturaClose");
const facturaInfo   = document.getElementById("facturaInfo");
const facturaBody   = document.getElementById("facturaBody");
let catalogoVersion = "0";

if (!tamanoSelect || !inputImagenes || !btnResumen || !overlay || !facturaInfo || !facturaBody) {
    console.warn("precios_fotos.js: faltan elementos del DOM, abortando.");
}

function normalizarClave(clave) {
    return String(clave || "").trim().toLowerCase();
}

function obtenerResumenAsignado() {
    if (typeof window.obtenerResumenTamanosAsignados !== "function") {
        return {};
    }
    return window.obtenerResumenTamanosAsignados() || {};
}

function usaAsignacionPorFoto() {
    return typeof window.usaAsignacionPorFoto === "function" && window.usaAsignacionPorFoto();
}

function obtenerFotosActualesParaResumen() {
    const desdeInput = inputImagenes && inputImagenes.files
        ? Array.from(inputImagenes.files)
        : [];

    if (desdeInput.length > 0) {
        return desdeInput;
    }

    const desdeGlobal = Array.isArray(window.archivosGlobal)
        ? window.archivosGlobal.filter(function(file) {
            return file && typeof file.name === "string";
        })
        : [];

    if (desdeGlobal.length > 0) {
        return desdeGlobal;
    }

    return Array.isArray(window.previewsGlobal)
        ? window.previewsGlobal
            .map(function(item) { return item && item.archivo ? item.archivo : null; })
            .filter(function(file) {
                return file && typeof file.name === "string";
            })
        : [];
}

function renderTamanosEnSelect(tamanos) {
    if (!tamanoSelect) return;

    const seleccionActual = new Set(Array.from(tamanoSelect.selectedOptions).map(function(opt) {
        return normalizarClave(opt.value);
    }));

    tamanoSelect.innerHTML = "";

    tamanos.forEach(function(t) {
        const option = document.createElement("option");
        option.value = t.clave;
        option.textContent = t.nombre;
        if (seleccionActual.has(normalizarClave(t.clave))) {
            option.selected = true;
        }
        tamanoSelect.appendChild(option);
    });

    tamanoSelect.dispatchEvent(new Event("change"));
}

async function cargarTamanosDinamicos(force = false) {
    try {
        const res = await fetch("/api/tamanos");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cargar catálogo de tamaños");

        const nuevaVersion = data.version || "0";
        if (force || nuevaVersion !== catalogoVersion) {
            catalogoVersion = nuevaVersion;
            renderTamanosEnSelect(Array.isArray(data.tamanos) ? data.tamanos : []);
        }
    } catch (error) {
        console.error("Error cargando tamaños dinámicos:", error);
    }
}

// El botón de resumen siempre queda habilitado; la validación vive en formulario_clientes.js.
if (btnResumen) btnResumen.disabled = false;

// Obtener cantidades por foto desde el sistema de cantidades
function obtenerCantidadesPorFoto() {
    // Intentar obtener desde archivosGlobal o localStorage
    if (typeof archivosGlobal !== 'undefined' && archivosGlobal.length > 0) {
        const cantidades = {};
        archivosGlobal.forEach(foto => {
            cantidades[foto.archivo] = foto.cantidad || 1;
        });
        return cantidades;
    }
    
    // Fallback: todas las fotos tienen cantidad 1
    return {};
}

// Calcular cantidad total considerando copias por foto
function calcularCantidadTotalConCopias(numFotos) {
    const cantidades = obtenerCantidadesPorFoto();
    let total = 0;
    
    if (typeof archivosGlobal !== 'undefined' && archivosGlobal.length > 0) {
        archivosGlobal.forEach(foto => {
            total += (foto.cantidad || 1);
        });
    } else {
        total = numFotos;
    }
    
    return total;
}

// Abrir modal
async function abrirResumenPedido() {
    const modoAsignado = usaAsignacionPorFoto();
    const resumenAsignado = obtenerResumenAsignado();
    
    // Calcular cantidad total considerando copias por foto
    const numFotosArchivos = obtenerFotosActualesParaResumen().length;
    const cantidadTotal = calcularCantidadTotalConCopias(numFotosArchivos);
    
    const seleccionados = modoAsignado
        ? Object.entries(resumenAsignado)
        : Array.from(tamanoSelect.selectedOptions).map(function(opt) {
            return [opt.value, { nombre: opt.text, cantidad: cantidadTotal }];
        });
    const papelRadio    = document.querySelector('input[name="papel"]:checked');
    const papel         = papelRadio ? papelRadio.value : "No seleccionado";

    const totalAsignado = seleccionados.reduce(function(acc, entry) {
        return acc + Number(entry[1].cantidad || 0);
    }, 0);

    if (modoAsignado) {
        if (seleccionados.length === 0 || cantidadTotal === 0 || totalAsignado !== cantidadTotal) return;
    } else {
        if (seleccionados.length === 0 || cantidadTotal === 0) return;
    }

    // Info del pedido
    const fecha = new Date().toLocaleDateString("es-EC", {
        day: "2-digit", month: "long", year: "numeric"
    });
    
    // Mostrar info de fotos con cantidad de copias
    const infoCopias = cantidadTotal !== numFotosArchivos 
        ? `${numFotosArchivos} archivos (${cantidadTotal} copias)`
        : `${cantidadTotal} imagen${cantidadTotal > 1 ? "es" : ""}`;
    
    facturaInfo.innerHTML = `
        <div class="factura-info-row">
            <span>📅 Fecha</span><span>${fecha}</span>
        </div>
        <div class="factura-info-row">
            <span>🖼️ Fotos</span><span>${infoCopias}</span>
        </div>
        <div class="factura-info-row">
            <span>📄 Papel</span><span class="factura-papel">${papel}</span>
        </div>
    `;

    // Calcular precios
    let filas = "";
    let totalGeneral = 0;

    for (const [clave, info] of seleccionados) {
        try {
            const res = await fetch("/api/precios", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tamano: clave, cantidad: info.cantidad })
            });
            if (!res.ok) continue;
            const data = await res.json();
            totalGeneral += data.total;

            filas += `
                <tr>
                    <td>${info.nombre}</td>
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
}

window.abrirResumenPedido = abrirResumenPedido;

// Finalizar pedido desde el modal — confirma y envía
const btnFinalizar = document.getElementById("btnFinalizarPedido");
if (btnFinalizar) {
    btnFinalizar.addEventListener("click", () => {
        const form = document.getElementById("formDatos");
        if (form) {
            form.dataset.confirmed = "true";
            form.requestSubmit();
        }
    });
}

// Cerrar modal
closeBtn.addEventListener("click", () => overlay.classList.remove("active"));
overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.classList.remove("active");
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") overlay.classList.remove("active");
});

document.addEventListener("DOMContentLoaded", async () => {
    await cargarTamanosDinamicos(true);
    setInterval(() => {
        cargarTamanosDinamicos(false);
    }, 8000);
});

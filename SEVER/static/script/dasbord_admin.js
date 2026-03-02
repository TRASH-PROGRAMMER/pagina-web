// ─── BroadcastChannel: escuchar nuevos clientes desde index ─────────────────
const clienteChannel = new BroadcastChannel("clientes_channel");
clienteChannel.onmessage = function(event) {
    if (event.data?.tipo === "nuevo_cliente") {
        renderClienteRow(event.data.cliente);
        actualizarBadge(+1);
    }
};

// ─── Filtrar tabla por búsqueda ───────────────────────────────────────────────
function filterTable() {
    const searchValue = document.getElementById("searchInput").value.toLowerCase();
    const rows = document.querySelectorAll("#tableBody tr");

    rows.forEach(function(row) {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(searchValue) ? "" : "none";
    });
}

// ─── Eliminar fila ────────────────────────────────────────────────────────────
async function deleteRow(btn) {
    const row = btn.closest("tr");
    if (!row || !confirm("¿Eliminar este pedido?")) return;

    const id = Number(row.dataset.id);
    try {
        const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar");
        row.remove();
        actualizarBadge(-1);
    } catch (error) {
        console.error("Error al eliminar:", error);
        alert(error.message);
    }
}

// ─── Cambiar estado ───────────────────────────────────────────────────────────
const estados = ["Pendiente", "Procesando", "Entregado", "Cancelado"];
const clases  = ["status-pendiente", "status-procesando", "status-entregado", "status-cancelado"];

function changeStatus(btn) {
    const row = btn.closest("tr");
    const badge = row.querySelector(".status");
    if (!badge) return;

    let currentIndex = clases.findIndex(c => badge.classList.contains(c));
    const nuevoIndex = (currentIndex + 1) % estados.length;
    const nuevoEstado = estados[nuevoIndex];

    badge.classList.remove(...clases);
    badge.classList.add(clases[nuevoIndex]);
    badge.textContent = nuevoEstado;

    if (nuevoEstado === "Pendiente") {
        actualizarBadge(+1);
    } else if (nuevoEstado === "Entregado" || nuevoEstado === "Cancelado") {
        actualizarBadge(-1);
    }
}

// ─── Exportar CSV ─────────────────────────────────────────────────────────────
function exportCSV() {
    const rows = document.querySelectorAll("#ordersTable tr");
    const lines = [];

    rows.forEach(function(row) {
        const cols = Array.from(row.querySelectorAll("th, td")).map(function(cell) {
            return '"' + cell.innerText.replace(/"/g, '""') + '"';
        });
        lines.push(cols.join(","));
    });

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "pedidos.csv";
    link.click();
    URL.revokeObjectURL(url);
}

// ─── Badge Pedidos ───────────────────────────────────────────────────────────
function getBadge() {
    return document.getElementById("badgePedidos");
}
function actualizarBadge(delta) {
    const badge = getBadge();
    if (!badge) return;
    const actual = parseInt(badge.textContent) || 0;
    badge.textContent = Math.max(0, actual + delta);
}

// ─── Ver fotos en modal ───────────────────────────────────────────────────────
function verFotos(fotosJSON, clienteNombre) {
    const fotos = JSON.parse(fotosJSON);
    const modal = document.getElementById("fotoModal");
    const body  = document.getElementById("fotoModalBody");
    const title = document.getElementById("fotoModalTitle");

    title.textContent = `Fotos — ${clienteNombre}`;
    body.innerHTML = "";

    if (fotos.length === 0) {
        body.innerHTML = '<p style="color:#6b6b85;text-align:center">Sin fotos</p>';
    } else {
        fotos.forEach(function(filename) {
            const div = document.createElement("div");
            div.className = "foto-thumb";
            div.innerHTML = `<img src="/api/uploads/${filename}" alt="${filename}" loading="lazy">`;
            div.onclick = function() {
                window.open(`/api/uploads/${filename}`, '_blank');
            };
            body.appendChild(div);
        });
    }

    modal.classList.add("active");
}

function cerrarModal() {
    document.getElementById("fotoModal").classList.remove("active");
}

// Cerrar modal con Escape o clic fuera
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") cerrarModal();
});
document.getElementById("fotoModal").addEventListener("click", function(e) {
    if (e.target === this) cerrarModal();
});

// ─── Render fila de pedido ────────────────────────────────────────────────────
function renderClienteRow(cliente) {
    const tbody = document.getElementById("tableBody");
    const tr = document.createElement("tr");
    tr.dataset.id = cliente.id;

    const fotos = cliente.fotos || [];
    const fotosJSON = JSON.stringify(fotos).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const nombreCompleto = `${cliente.nombre} ${cliente.apellido}`;
    const numFotos = cliente.numFotos || fotos.length || 0;

    tr.innerHTML = `
        <td><code style="color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">#${String(cliente.id).padStart(4,"0")}</code></td>
        <td>
            <div class="client-name">${cliente.nombre} ${cliente.apellido}</div>
            <div class="client-email">${cliente.correo}</div>
        </td>
        <td>
            ${numFotos > 0
                ? `<span class="fotos-link" onclick="verFotos('${fotosJSON}', '${nombreCompleto}')">${numFotos} foto${numFotos > 1 ? 's' : ''}</span>`
                : '—'}
        </td>
        <td>${cliente.tamano || '—'}</td>
        <td>${cliente.papel || '—'}</td>
        <td><span class="status status-pendiente">Pendiente</span></td>
        <td style="color:var(--muted);font-size:12px">${cliente.fechaRegistro}</td>
        <td>
            <button class="action-btn" onclick="changeStatus(this)">✎ Estado</button>
            <button class="action-btn del" onclick="deleteRow(this)">✕</button>
        </td>
    `;
    tbody.prepend(tr);
}

// ─── Cargar pedidos desde la API Flask al cargar la página ───────────────────
document.addEventListener("DOMContentLoaded", async function() {
    try {
        const res = await fetch("/api/clientes");
        const clientes = await res.json();
        const tbody = document.getElementById("tableBody");
        tbody.innerHTML = "";  // Limpiar filas anteriores
        clientes.forEach(renderClienteRow);
        const badge = getBadge();
        if (badge) badge.textContent = clientes.length;
    } catch (error) {
        console.error("Error al cargar pedidos:", error);
    }
});

// ─── Exponer funciones al scope global (usadas en onclick del HTML) ───────────
window.filterTable   = filterTable;
window.deleteRow     = deleteRow;
window.changeStatus  = changeStatus;
window.exportCSV     = exportCSV;
window.verFotos      = verFotos;
window.cerrarModal   = cerrarModal;
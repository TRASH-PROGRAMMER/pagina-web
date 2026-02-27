import { obtenerClientes, eliminarCliente } from "./db.js";

// ─── BroadcastChannel: escuchar nuevos clientes desde index ─────────────────
const clienteChannel = new BroadcastChannel("clientes_channel");
clienteChannel.onmessage = function(event) {
    if (event.data?.tipo === "nuevo_cliente") {
        renderClienteRow(event.data.cliente);
        actualizarBadge(+1);
    }
};

// ─── Inicialización ───────────────────────────────────────────────────────────

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
    if (!row || !confirm("¿Eliminar este cliente?")) return;

    const id = Number(row.dataset.id);
    try {
        if (id) await eliminarCliente(id);
        row.remove();
        actualizarBadge(-1);
    } catch (error) {
        console.error("Error al eliminar:", error);
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

// ─── Render fila de cliente desde IndexedDB ───────────────────────────────────
function renderClienteRow(cliente) {
    const tbody = document.getElementById("tableBody");
    const tr = document.createElement("tr");
    tr.dataset.id = cliente.id;

    tr.innerHTML = `
        <td><code style="color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">#${String(cliente.id).padStart(4,"0")}</code></td>
        <td>
            <div class="client-name">${cliente.nombre} ${cliente.apellido}</div>
            <div class="client-email">${cliente.correo}</div>
        </td>
        <td>—</td>
        <td>—</td>
        <td>—</td>
        <td><span class="status status-pendiente">Pendiente</span></td>
        <td style="color:var(--muted);font-size:12px">${cliente.fechaRegistro}</td>
        <td>
            <button class="action-btn" onclick="changeStatus(this)">✎ Estado</button>
            <button class="action-btn del" onclick="deleteRow(this)">✕</button>
        </td>
    `;
    tbody.prepend(tr);
}

// ─── Cargar clientes de IndexedDB al cargar la página ────────────────────────
document.addEventListener("DOMContentLoaded", async function() {
    try {
        const clientes = await obtenerClientes();
        clientes.forEach(renderClienteRow);
        // Inicializar badge con el total real
        const badge = getBadge();
        if (badge) badge.textContent = clientes.length;
    } catch (error) {
        console.error("Error al cargar clientes:", error);
    }
});

// ─── Exponer funciones al scope global (usadas en onclick del HTML) ───────────
window.filterTable   = filterTable;
window.deleteRow     = deleteRow;
window.changeStatus  = changeStatus;
window.exportCSV     = exportCSV;
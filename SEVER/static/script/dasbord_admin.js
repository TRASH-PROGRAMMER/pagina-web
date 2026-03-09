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
        fotos.forEach(function(url) {
            const div = document.createElement("div");
            div.className = "foto-thumb";
            // Las URLs ya son de Cloudinary (https://res.cloudinary.com/...)
            div.innerHTML = `<img src="${url}" alt="foto" loading="lazy">`;
            div.onclick = function() {
                window.open(url, '_blank');
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
    const precio = cliente.precioTotal != null ? `$${Number(cliente.precioTotal).toFixed(2)}` : '—';

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
        <td style="color:#22c55e;font-weight:600;font-family:'Space Mono',monospace">${precio}</td>
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

// ─── Chart.js: Pedidos últimos 7 días (tiempo real) ──────────────────────────
let pedidosChart = null;

async function cargarGraficoPedidos() {
    try {
        const res = await fetch('/api/pedidos-semana');
        const data = await res.json();

        const ctx = document.getElementById('pedidosChart');
        if (!ctx) return;

        const chartData = {
            labels: data.labels,
            datasets: [{
                label: 'Pedidos',
                data: data.valores,
                backgroundColor: 'rgba(124, 108, 252, 0.3)',
                borderColor: '#7c6cfc',
                borderWidth: 2,
                borderRadius: 6,
                hoverBackgroundColor: 'rgba(124, 108, 252, 0.6)',
            }]
        };

        const options = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#6b6b85', stepSize: 1 },
                    grid: { color: 'rgba(107,107,133,0.15)' },
                },
                x: {
                    ticks: { color: '#6b6b85' },
                    grid: { display: false },
                }
            }
        };

        if (pedidosChart) {
            pedidosChart.data = chartData;
            pedidosChart.update();
        } else {
            pedidosChart = new Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: options
            });
        }
    } catch (err) {
        console.error('Error cargando gráfico:', err);
    }
}

// Cargar al inicio y actualizar cada 30 segundos
document.addEventListener('DOMContentLoaded', function() {
    cargarGraficoPedidos();
    setInterval(cargarGraficoPedidos, 30000);
});

// ─── Estadísticas en tiempo real ──────────────────────────────────────────────
async function cargarEstadisticas() {
    try {
        const res = await fetch('/api/estadisticas');
        const d = await res.json();

        const fmt = n => n.toLocaleString('es-MX');

        document.getElementById('statPedidosHoy').textContent = fmt(d.pedidos_hoy);
        const flecha = d.cambio_pct >= 0 ? '↑' : '↓';
        document.getElementById('statCambioPct').textContent = `${flecha} ${Math.abs(d.cambio_pct)}% vs ayer`;

        document.getElementById('statTotalFotos').textContent = fmt(d.total_fotos);
        document.getElementById('statFotosSemana').textContent = `↑ ${fmt(d.fotos_semana)} esta semana`;

        document.getElementById('statClientesActivos').textContent = fmt(d.clientes_activos);
        document.getElementById('statNuevosHoy').textContent = `${d.nuevos_hoy} nuevo${d.nuevos_hoy !== 1 ? 's' : ''} hoy`;

        document.getElementById('statPendientes').textContent = fmt(d.pendientes);
    } catch (err) {
        console.error('Error cargando estadísticas:', err);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    cargarEstadisticas();
    setInterval(cargarEstadisticas, 30000);
});

// ─── Últimas subidas (tiempo real) ────────────────────────────────────────────
function tiempoRelativo(fechaStr) {
    try {
        const partes = fechaStr.split(',');
        const [d, m, y] = partes[0].trim().split('/');
        const hora = partes[1] ? partes[1].trim() : '00:00:00';
        const fecha = new Date(+y, +m - 1, +d, ...hora.split(':').map(Number));
        const diff = Date.now() - fecha.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'ahora';
        if (mins < 60) return `hace ${mins} min`;
        const horas = Math.floor(mins / 60);
        if (horas < 24) return `hace ${horas}h`;
        const dias = Math.floor(horas / 24);
        return `hace ${dias} día${dias > 1 ? 's' : ''}`;
    } catch {
        return fechaStr;
    }
}

const iconos = ['📷', '🌄', '🎞️', '🖼️', '📸'];

async function cargarUltimasSubidas() {
    try {
        const res = await fetch('/api/ultimas-subidas');
        const subidas = await res.json();
        const container = document.getElementById('uploadList');
        if (!container) return;

        if (subidas.length === 0) {
            container.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:13px">Sin subidas recientes</p>';
            return;
        }

        container.innerHTML = '';
        subidas.forEach(function(s, i) {
            const icono = iconos[i % iconos.length];
            const div = document.createElement('div');
            div.className = 'upload-item';
            div.innerHTML = `
                <div class="upload-thumb">${icono}</div>
                <div class="upload-info">
                    <div class="upload-name">${s.numFotos} foto${s.numFotos > 1 ? 's' : ''}</div>
                    <div class="upload-meta">${s.cliente} · ${tiempoRelativo(s.fecha)}</div>
                </div>
            `;
            div.style.cursor = 'pointer';
            div.onclick = function() { window.open(s.url, '_blank'); };
            container.appendChild(div);
        });
    } catch (err) {
        console.error('Error cargando subidas:', err);
    }
}

// Cargar al inicio y actualizar cada 30 segundos
document.addEventListener('DOMContentLoaded', function() {
    cargarUltimasSubidas();
    setInterval(cargarUltimasSubidas, 30000);
});

// Actualizar gráfico y subidas cuando llega un nuevo pedido por BroadcastChannel
clienteChannel.addEventListener('message', function(event) {
    if (event.data?.tipo === 'nuevo_cliente') {
        cargarGraficoPedidos();
        cargarUltimasSubidas();
        cargarEstadisticas();
    }
});
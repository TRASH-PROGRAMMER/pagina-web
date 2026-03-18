// ─── BroadcastChannel: escuchar nuevos clientes desde index ─────────────────
const clienteChannel = new BroadcastChannel("clientes_channel");
clienteChannel.onmessage = function(event) {
    if (event.data?.tipo === "nuevo_cliente") {
        clientesCache.unshift(event.data.cliente);
        renderClienteRow(event.data.cliente);
        if (!document.getElementById("clientesCardsContainer")?.hidden) {
            renderClientesCards(clientesCache);
        }
        actualizarBadge(+1);
    }
};

let tamanosAdmin = [];
let tamanoEditandoId = null;
let clientesCache = [];
let fotosModalActuales = [];
let nombrePedidoModal = "pedido";

function mostrarMensajeTamano(texto, ok = true) {
    const msg = document.getElementById("tamanoMensaje");
    if (!msg) return;
    msg.textContent = texto;
    msg.style.color = ok ? "#22c55e" : "#ff7a7a";
}

function formatearPrecio(valor) {
    const n = Number(valor);
    if (Number.isNaN(n)) return "0.00";
    return n.toFixed(2);
}

function setActiveNav(navId) {
    document.querySelectorAll(".sidebar .nav-item").forEach(function(item) {
        item.classList.remove("active");
    });
    const nav = document.getElementById(navId);
    if (nav) nav.classList.add("active");
}

function setAdminMainView(view) {
    const dashboardBlocks = document.querySelectorAll(".dashboard-only");
    const clientesSection = document.getElementById("clientesCardsContainer");
    const title = document.querySelector(".topbar-title");

    if (view === "clientes") {
        dashboardBlocks.forEach(function(el) { el.classList.add("dashboard-hidden"); });
        if (clientesSection) clientesSection.hidden = false;
        if (title) title.innerHTML = "<span>Clientes</span> / Vista en tarjetas";
        setActiveNav("navClientes");
    } else {
        dashboardBlocks.forEach(function(el) { el.classList.remove("dashboard-hidden"); });
        if (clientesSection) clientesSection.hidden = true;
        if (title) title.innerHTML = "<span>Dashboard</span> / Vista general";
        setActiveNav("navDashboard");
    }
}

function renderClienteCard(c) {
    const card = document.createElement("article");
    card.className = "cliente-card";
    card.innerHTML = `
        <h4>${c.nombre || ""} ${c.apellido || ""}</h4>
        <div class="cliente-meta"><strong>Correo:</strong> ${c.correo || "-"}</div>
        <div class="cliente-meta"><strong>Telefono:</strong> ${c.telefono || "-"}</div>
        <div class="cliente-meta"><strong>Tamano:</strong> ${c.tamano || "-"}</div>
        <div class="cliente-meta"><strong>Papel:</strong> ${c.papel || "-"}</div>
        <div class="cliente-meta"><strong>Fotos:</strong> ${c.numFotos || 0}</div>
        <div class="cliente-meta"><strong>Fecha:</strong> ${c.fechaRegistro || "-"}</div>
        <div class="cliente-meta"><strong>Total:</strong> $${Number(c.precioTotal || 0).toFixed(2)}</div>
    `;
    return card;
}

function renderClientesCards(clientes) {
    const grid = document.getElementById("clientesCardsGrid");
    if (!grid) return;

    grid.innerHTML = "";
    clientes.forEach(function(c) {
        grid.appendChild(renderClienteCard(c));
    });
}

async function cargarClientesCards() {
    try {
        const res = await fetch("/api/clientes");
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        const clientes = await res.json();
        if (!res.ok) throw new Error(clientes.error || "No se pudo cargar clientes");
        clientesCache = Array.isArray(clientes) ? clientes : [];
        renderClientesCards(clientesCache);
    } catch (error) {
        console.error("Error cargando clientes en cards:", error);
    }
}

function renderTamanosAdmin() {
    const tbody = document.getElementById("tamanosBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    tamanosAdmin.forEach(function(t) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${t.clave}</td>
            <td>${t.nombre}</td>
            <td>$${formatearPrecio(t.precio_base)}</td>
            <td>${t.activo ? "Activo" : "Inactivo"}</td>
            <td>
                <div class="tamano-actions">
                    <button class="tamano-btn" onclick="editarTamano(${t.id})">Editar</button>
                    ${t.activo
                        ? `<button class="tamano-btn danger" onclick="desactivarTamano(${t.id})">Desactivar</button>`
                        : `<button class="tamano-btn" onclick="activarTamano(${t.id})">Activar</button>`}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function cargarTamanosAdmin() {
    const tbody = document.getElementById("tamanosBody");
    if (!tbody) return;

    try {
        const res = await fetch("/api/admin/tamanos");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar los tamaños");

        tamanosAdmin = Array.isArray(data.tamanos) ? data.tamanos : [];
        renderTamanosAdmin();
    } catch (error) {
        console.error("Error cargando tamaños:", error);
        mostrarMensajeTamano(error.message, false);
    }
}

function abrirModalEditarTamano(tamano) {
    const modal = document.getElementById("editTamanoModal");
    const idInput = document.getElementById("editTamanoId");
    const nombreInput = document.getElementById("editTamanoNombre");
    const precioInput = document.getElementById("editTamanoPrecio");

    if (!modal || !idInput || !nombreInput || !precioInput) return;

    tamanoEditandoId = tamano.id;
    idInput.value = String(tamano.id);
    nombreInput.value = tamano.nombre || "";
    precioInput.value = formatearPrecio(tamano.precio_base);
    modal.classList.add("active");
}

function cerrarModalEditarTamano() {
    const modal = document.getElementById("editTamanoModal");
    if (!modal) return;

    modal.classList.remove("active");
    tamanoEditandoId = null;
}

async function editarTamano(id) {
    const tamano = tamanosAdmin.find(function(t) { return t.id === id; });
    if (!tamano) return;

    abrirModalEditarTamano(tamano);
}

async function desactivarTamano(id) {
    if (!confirm("¿Deseas desactivar este tamaño?")) return;

    try {
        const res = await fetch(`/api/admin/tamanos/${id}/desactivar`, { method: "PATCH" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo desactivar");

        mostrarMensajeTamano("Tamaño desactivado");
        await cargarTamanosAdmin();
    } catch (error) {
        console.error("Error desactivando tamaño:", error);
        mostrarMensajeTamano(error.message, false);
    }
}

async function activarTamano(id) {
    try {
        const res = await fetch(`/api/admin/tamanos/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activo: true })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo activar");

        mostrarMensajeTamano("Tamaño activado");
        await cargarTamanosAdmin();
    } catch (error) {
        console.error("Error activando tamaño:", error);
        mostrarMensajeTamano(error.message, false);
    }
}

// ─── Filtro alfabético activo ─────────────────────────────────────────────────
let currentAlphaRange = 'todos';

function toISODate(value) {
    if (!value) return "";
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

    const match = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!match) return "";

    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${month}-${day}`;
}

// ─── Filtrar tabla por búsqueda + rango alfabético + fecha/estado/precio ────
function filterTable() {
    const searchValue = document.getElementById("searchInput").value.toLowerCase();
    const fechaFiltro = document.getElementById("filterFecha")?.value || "";
    const estadoFiltro = (document.getElementById("filterEstado")?.value || "").toLowerCase();
    const precioMinRaw = document.getElementById("filterPrecioMin")?.value;
    const precioMaxRaw = document.getElementById("filterPrecioMax")?.value;
    const precioMin = precioMinRaw !== "" ? Number(precioMinRaw) : null;
    const precioMax = precioMaxRaw !== "" ? Number(precioMaxRaw) : null;
    const rows = document.querySelectorAll("#tableBody tr");

    rows.forEach(function(row) {
        const text = row.innerText.toLowerCase();
        const nameEl = row.querySelector(".client-name");
        const firstLetter = nameEl ? nameEl.textContent.trim()[0].toUpperCase() : '';
        const rowEstado = (row.dataset.estado || "").toLowerCase();
        const rowFecha = row.dataset.fecha || "";
        const rowPrecio = row.dataset.precio !== "" ? Number(row.dataset.precio) : null;

        const matchesSearch = text.includes(searchValue);
        const matchesAlpha  = currentAlphaRange === 'todos' || currentAlphaRange.includes(firstLetter);
        const matchesFecha = !fechaFiltro || rowFecha === fechaFiltro;
        const matchesEstado = !estadoFiltro || rowEstado === estadoFiltro;
        const matchesPrecioMin = precioMin === null || (rowPrecio !== null && rowPrecio >= precioMin);
        const matchesPrecioMax = precioMax === null || (rowPrecio !== null && rowPrecio <= precioMax);

        row.style.display = (matchesSearch && matchesAlpha && matchesFecha && matchesEstado && matchesPrecioMin && matchesPrecioMax)
            ? ""
            : "none";
    });
}

// ─── Filtrar por rango de letras ──────────────────────────────────────────────
function filterByAlpha(range) {
    currentAlphaRange = range;

    document.querySelectorAll(".alpha-btn").forEach(function(btn) {
        btn.classList.toggle("active", btn.dataset.range === range);
    });

    filterTable();
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
        clientesCache = clientesCache.filter(function(c) { return Number(c.id) !== id; });
        if (!document.getElementById("clientesCardsContainer")?.hidden) {
            renderClientesCards(clientesCache);
        }
        actualizarBadge(-1);
    } catch (error) {
        console.error("Error al eliminar:", error);
        alert(error.message);
    }
}

// ─── Cambiar estado ───────────────────────────────────────────────────────────
const estados = ["Pendiente", "Procesando", "Entregado", "Cancelado"];
const clases  = ["status-pendiente", "status-procesando", "status-entregado", "status-cancelado"];

async function changeStatus(btn) {
    const row = btn.closest("tr");
    const badge = row.querySelector(".status");
    if (!badge) return;

    let currentIndex = clases.findIndex(function(c) { return badge.classList.contains(c); });
    if (currentIndex < 0) currentIndex = 0;
    const nuevoIndex = (currentIndex + 1) % estados.length;
    const nuevoEstado = estados[nuevoIndex];

    try {
        const id = Number(row.dataset.id);
        const res = await fetch(`/api/clientes/${id}/estado`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: nuevoEstado.toLowerCase() })
        });

        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cambiar el estado");

        badge.classList.remove(...clases);
        badge.classList.add(clases[nuevoIndex]);
        badge.textContent = nuevoEstado;
        row.dataset.estado = nuevoEstado.toLowerCase();
        filterTable();
    } catch (error) {
        console.error("Error actualizando estado:", error);
        alert(error.message || "No se pudo cambiar el estado");
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

    fotosModalActuales = Array.isArray(fotos) ? fotos.slice() : [];
    nombrePedidoModal = (clienteNombre || "pedido").trim();

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

async function descargarImagenComoArchivo(url, nombreArchivo) {
    try {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) throw new Error("No se pudo descargar la imagen");

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = nombreArchivo;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(blobUrl);
    } catch (_error) {
        window.open(url, "_blank", "noopener");
    }
}

function normalizarNombreArchivoBase(nombre) {
    return String(nombre || "pedido")
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 60) || "pedido";
}

function extensionDesdeUrl(url) {
    try {
        const parsed = new URL(url);
        const file = parsed.pathname.split("/").pop() || "";
        const dot = file.lastIndexOf(".");
        if (dot >= 0) {
            const ext = file.slice(dot).toLowerCase();
            if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
        }
    } catch (_error) {
        // Si la URL no es parseable, se usa el fallback.
    }
    return ".jpg";
}

async function descargarListaFotos(fotos, nombreBase, btn) {
    if (!Array.isArray(fotos) || fotos.length === 0) {
        alert("Este pedido no tiene imagenes para descargar");
        return;
    }

    const textoOriginal = btn ? btn.textContent : "descargar";
    if (btn) {
        btn.disabled = true;
        btn.textContent = "descargando...";
    }

    const base = normalizarNombreArchivoBase(nombreBase);

    try {
        for (let i = 0; i < fotos.length; i += 1) {
            const ext = extensionDesdeUrl(fotos[i]);
            const nombre = `${base}_${String(i + 1).padStart(2, "0")}${ext}`;
            await descargarImagenComoArchivo(fotos[i], nombre);
            await new Promise(function(resolve) { setTimeout(resolve, 120); });
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = textoOriginal;
        }
    }
}

async function descargarPedido(btn) {
    const row = btn.closest("tr");
    if (!row) return;

    const id = Number(row.dataset.id);
    const cliente = clientesCache.find(function(c) { return Number(c.id) === id; });

    if (!cliente) {
        alert("No se encontro la informacion del pedido");
        return;
    }

    const nombreBase = `${cliente.nombre || "pedido"}_${cliente.apellido || id}`;
    await descargarListaFotos(cliente.fotos || [], nombreBase, btn);
}

async function descargarFotosDelModal() {
    const btn = document.getElementById("descargarpedido");
    await descargarListaFotos(fotosModalActuales, nombrePedidoModal, btn);
}

// Cerrar modal con Escape o clic fuera
document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
        cerrarModal();
        cerrarModalEditarTamano();
    }
});
document.getElementById("fotoModal").addEventListener("click", function(e) {
    if (e.target === this) cerrarModal();
});

const editTamanoModal = document.getElementById("editTamanoModal");
if (editTamanoModal) {
    editTamanoModal.addEventListener("click", function(e) {
        if (e.target === this) cerrarModalEditarTamano();
    });
}

// ─── Render fila de pedido ────────────────────────────────────────────────────
function renderClienteRow(cliente) {
    const tbody = document.getElementById("tableBody");
    const tr = document.createElement("tr");
    tr.dataset.id = cliente.id;

    const fotos = cliente.fotos || [];
    const fotosJSON = JSON.stringify(fotos).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const nombreCompleto = `${cliente.nombre} ${cliente.apellido}`;
    const numFotos = cliente.numFotos || fotos.length || 0;
    const precioNum = cliente.precioTotal != null ? Number(cliente.precioTotal) : null;
    const precio = precioNum != null ? `$${precioNum.toFixed(2)}` : '—';

    const estadoRaw = (cliente.estado || "pendiente").toLowerCase();
    const estadoIndex = estados.findIndex(function(e) { return e.toLowerCase() === estadoRaw; });
    const estadoLabel = estadoIndex >= 0 ? estados[estadoIndex] : "Pendiente";
    const estadoClass = estadoIndex >= 0 ? clases[estadoIndex] : "status-pendiente";

    tr.dataset.estado = estadoRaw;
    tr.dataset.fecha = toISODate(cliente.fechaRegistro);
    tr.dataset.precio = precioNum != null && !Number.isNaN(precioNum) ? String(precioNum) : "";

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
        <td><span class="status ${estadoClass}">${estadoLabel}</span></td>
        <td style="color:var(--muted);font-size:12px">${cliente.fechaRegistro}</td>
        <td>
            <div class="acciones-pedido">
                <button class="action-btn" onclick="changeStatus(this)">✎ Estado</button>
                <button class="action-btn del" onclick="deleteRow(this)">✕</button>
                <button class="action-btn" onclick="descargarPedido(this)">↓ Descargar</button>
            </div>
        </td>
    `;
    tbody.prepend(tr);

    filterTable();
}

// ─── Cargar pedidos desde la API Flask al cargar la página ───────────────────
document.addEventListener("DOMContentLoaded", async function() {
    try {
        const res = await fetch("/api/clientes");
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        const clientes = await res.json();
        clientesCache = Array.isArray(clientes) ? clientes : [];
        const tbody = document.getElementById("tableBody");
        tbody.innerHTML = "";  // Limpiar filas anteriores
        clientesCache.forEach(renderClienteRow);
        const badge = getBadge();
        if (badge) badge.textContent = clientesCache.length;
    } catch (error) {
        console.error("Error al cargar pedidos:", error);
    }

    const navDashboard = document.getElementById("navDashboard");
    const navPedidos = document.getElementById("navPedidos");
    const navClientes = document.getElementById("navClientes");

    if (navDashboard) {
        navDashboard.addEventListener("click", function(e) {
            e.preventDefault();
            setAdminMainView("dashboard");
        });
    }

    if (navPedidos) {
        navPedidos.addEventListener("click", function(e) {
            e.preventDefault();
            setAdminMainView("dashboard");
            setActiveNav("navPedidos");
        });
    }

    if (navClientes) {
        navClientes.addEventListener("click", async function(e) {
            e.preventDefault();
            setAdminMainView("clientes");
            if (clientesCache.length === 0) {
                await cargarClientesCards();
            } else {
                renderClientesCards(clientesCache);
            }
        });
    }

    const formTamano = document.getElementById("formTamano");
    if (formTamano) {
        formTamano.addEventListener("submit", async function(e) {
            e.preventDefault();

            const clave = (document.getElementById("tamanoClave")?.value || "").trim().toLowerCase();
            const nombre = (document.getElementById("tamanoNombre")?.value || "").trim();
            const precio = Number(document.getElementById("tamanoPrecio")?.value || "0");

            if (!clave || !nombre || Number.isNaN(precio) || precio < 0) {
                mostrarMensajeTamano("Completa clave, nombre y precio válidos", false);
                return;
            }

            try {
                const resCreate = await fetch("/api/admin/tamanos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ clave, nombre, precio_base: precio })
                });
                const data = await resCreate.json();
                if (!resCreate.ok) throw new Error(data.error || "No se pudo guardar el tamaño");

                formTamano.reset();
                mostrarMensajeTamano("Tamaño guardado correctamente");
                await cargarTamanosAdmin();
            } catch (error) {
                console.error("Error guardando tamaño:", error);
                mostrarMensajeTamano(error.message, false);
            }
        });
    }

    const formEditTamano = document.getElementById("formEditTamano");
    const editTamanoClose = document.getElementById("editTamanoClose");
    const editTamanoCancel = document.getElementById("editTamanoCancel");

    if (editTamanoClose) {
        editTamanoClose.addEventListener("click", cerrarModalEditarTamano);
    }
    if (editTamanoCancel) {
        editTamanoCancel.addEventListener("click", cerrarModalEditarTamano);
    }

    if (formEditTamano) {
        formEditTamano.addEventListener("submit", async function(e) {
            e.preventDefault();

            const id = tamanoEditandoId || Number(document.getElementById("editTamanoId")?.value || "0");
            const nombre = (document.getElementById("editTamanoNombre")?.value || "").trim();
            const precio = Number(document.getElementById("editTamanoPrecio")?.value || "0");

            if (!id || !nombre || Number.isNaN(precio) || precio < 0) {
                mostrarMensajeTamano("Datos inválidos para edición", false);
                return;
            }

            try {
                const res = await fetch(`/api/admin/tamanos/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre, precio_base: precio })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "No se pudo editar el tamaño");

                mostrarMensajeTamano("Tamaño actualizado correctamente");
                cerrarModalEditarTamano();
                await cargarTamanosAdmin();
            } catch (error) {
                console.error("Error editando tamaño:", error);
                mostrarMensajeTamano(error.message, false);
            }
        });
    }

    await cargarTamanosAdmin();
});

// ─── Exponer funciones al scope global (usadas en onclick del HTML) ───────────
window.filterTable   = filterTable;
window.filterByAlpha = filterByAlpha;
window.deleteRow     = deleteRow;
window.changeStatus  = changeStatus;
window.exportCSV     = exportCSV;
window.verFotos      = verFotos;
window.cerrarModal   = cerrarModal;
window.editarTamano  = editarTamano;
window.desactivarTamano = desactivarTamano;
window.activarTamano = activarTamano;

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

// Descargar imagenes del pedido mostrado en el modal
const descargarPedidoBtn = document.getElementById("descargarpedido");
if (descargarPedidoBtn) {
    descargarPedidoBtn.addEventListener("click", function() {
        descargarFotosDelModal();
    });
}
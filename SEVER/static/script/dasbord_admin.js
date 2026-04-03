// â”€â”€â”€ BroadcastChannel: escuchar nuevos clientes desde index â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const clienteChannel = new BroadcastChannel("clientes_channel");
clienteChannel.onmessage = function(event) {
    if (event.data?.tipo === "nuevo_cliente") {
        clientesCache.unshift(event.data.cliente);
        renderClienteRow(event.data.cliente);
        const fotosNuevas = Number(
            event.data.cliente && event.data.cliente.numFotos != null
                ? event.data.cliente.numFotos
                : (Array.isArray(event.data.cliente && event.data.cliente.fotos)
                    ? event.data.cliente.fotos.length
                    : 0)
        );
        ajustarTotalImagenes(Number.isFinite(fotosNuevas) ? fotosNuevas : 0);
        if (!document.getElementById("clientesCardsContainer")?.hidden) {
            renderClientesCards(clientesCache);
        }
        // Solo incrementar badge si el estado es 'pendiente'
        if (normalizarEstadoPedido(event.data.cliente?.estado) === 'pendiente') {
            actualizarBadge(+1);
        }
    }
};

let tamanosAdmin = [];
let marcosAdmin = [];
let tamanoEditandoId = null;
let clientesCache = [];
let fotosModalActuales = [];
let nombrePedidoModal = "pedido";
let carruselIndiceActual = 0;
let modoCarruselActivo = false;
let currentAlphaRangeCards = "todos";
let currentCardsPage = 1;
const CARDS_PAGE_SIZE = 6;
let currentTablePage = 1;
const TABLE_PAGE_SIZE = 8;
let lastFocusedElementBeforeModal = null;
let lastFocusedElementBeforeConfirm = null;
let confirmDialogResolver = null;
let adminToastTimer = null;
const liveMessageState = { status: "", alert: "" };

function compactAdminMessage(text, isError = false) {
    const raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";

    const lower = raw.toLowerCase();
    if (lower.includes("no se pudieron cargar") && lower.includes("estad")) {
        return "No se cargaron estadisticas. Reintenta.";
    }
    if (lower.includes("no se pudo cargar") && lower.includes("almacenamiento")) {
        return "No se cargo almacenamiento. Reintenta.";
    }
    if (lower.includes("no se pudieron cargar") && lower.includes("pedidos")) {
        return "No se cargaron pedidos. Reintenta.";
    }
    if (lower.includes("no se pudieron cargar") && lower.includes("clientes")) {
        return "No se cargaron clientes. Reintenta.";
    }
    if (lower.includes("no se pudo cambiar el estado")) {
        return "No se actualizo estado. Reintenta.";
    }
    if (lower.includes("no se pudo eliminar") && lower.includes("pedido")) {
        return "No se elimino pedido. Reintenta.";
    }

    if (raw.length <= 120) return raw;

    const corte = raw.split(/[.;:]/)[0].trim();
    if (!corte) return isError ? "Ocurrio un error. Reintenta." : "Operacion completada.";
    if (isError) return `${corte}. Reintenta.`;
    return corte;
}

function setLiveText(elementId, text, channel) {
    const el = document.getElementById(elementId);
    const value = compactAdminMessage(text, channel === "alert");
    if (!el || !value) return;
    if (liveMessageState[channel] === value) return;
    liveMessageState[channel] = value;
    el.textContent = "";
    window.setTimeout(function() {
        el.textContent = value;
    }, 30);
}

function announceAdminStatus(text) {
    const value = compactAdminMessage(text, false);
    if (!value) return;
    setLiveText("adminStatusLive", value, "status");
    showAdminToast(value, false);
}

function showAdminToast(text, isError = false) {
    const value = compactAdminMessage(text, isError);
    if (!value) return;

    let toast = document.getElementById("adminToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "adminToast";
        toast.style.position = "fixed";
        toast.style.right = "16px";
        toast.style.bottom = "16px";
        toast.style.zIndex = "1300";
        toast.style.maxWidth = "min(92vw, 360px)";
        toast.style.padding = "10px 12px";
        toast.style.borderRadius = "10px";
        toast.style.border = "1px solid";
        toast.style.fontSize = "13px";
        toast.style.fontWeight = "600";
        toast.style.lineHeight = "1.35";
        toast.style.boxShadow = "0 10px 24px rgba(0, 0, 0, 0.35)";
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        toast.style.transition = "opacity .16s ease, transform .16s ease";
        document.body.appendChild(toast);
    }

    toast.textContent = value;
    if (isError) {
        toast.style.background = "#3b1b24";
        toast.style.borderColor = "#a34b5f";
        toast.style.color = "#ffd9e0";
    } else {
        toast.style.background = "#1c273d";
        toast.style.borderColor = "#4c77c8";
        toast.style.color = "#d7e6ff";
    }

    if (adminToastTimer) {
        clearTimeout(adminToastTimer);
        adminToastTimer = null;
    }

    requestAnimationFrame(function() {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    });

    adminToastTimer = window.setTimeout(function() {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
    }, 3200);
}

function announceAdminAlert(text) {
    const value = compactAdminMessage(text, true);
    if (!value) return;
    setLiveText("adminAlertLive", value, "alert");
    showAdminToast(value, true);
}

function getErrorMessage(error, fallbackMessage) {
    if (error && typeof error.message === "string" && error.message.trim()) {
        return compactAdminMessage(error.message.trim(), true);
    }
    return compactAdminMessage(fallbackMessage, true);
}

function openFotoModal() {
    const modal = document.getElementById("fotoModal");
    if (!modal) return;
    if (document.activeElement instanceof HTMLElement) {
        lastFocusedElementBeforeModal = document.activeElement;
    }
    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    const closeBtn = modal.querySelector(".foto-modal-close");
    if (closeBtn instanceof HTMLElement) {
        closeBtn.focus();
    }
}

function isAdminConfirmOpen() {
    const dialog = document.getElementById("adminConfirmDialog");
    return Boolean(dialog && !dialog.hidden);
}

function getDialogFocusableElements(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(function(el) {
            return !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden");
        });
}

function closeAdminConfirmDialog(confirmed) {
    const dialog = document.getElementById("adminConfirmDialog");
    const resolve = confirmDialogResolver;
    confirmDialogResolver = null;

    if (!dialog) {
        if (typeof resolve === "function") {
            resolve(Boolean(confirmed));
        }
        return;
    }

    // Move focus OUT of the dialog before hiding it,
    // so the browser does not block inert/hidden on a focused descendant.
    try {
        if (lastFocusedElementBeforeConfirm && document.contains(lastFocusedElementBeforeConfirm)) {
            lastFocusedElementBeforeConfirm.focus();
        } else {
            document.body.focus();
        }
    } catch (_error) {
        // Ignorar errores de foco en elementos removidos o no enfocables.
    }
    lastFocusedElementBeforeConfirm = null;

    dialog.hidden = true;
    dialog.setAttribute("hidden", "");
    dialog.inert = true;

    if (typeof resolve === "function") {
        resolve(Boolean(confirmed));
    }
}


function showAdminConfirmDialog(options) {
    const dialog = document.getElementById("adminConfirmDialog");
    const titleEl = document.getElementById("adminConfirmTitle");
    const messageEl = document.getElementById("adminConfirmMessage");
    const cancelBtn = document.getElementById("adminConfirmCancel");
    const acceptBtn = document.getElementById("adminConfirmAccept");

    const opts = options || {};
    if (!dialog || !titleEl || !messageEl || !cancelBtn || !acceptBtn) {
        return Promise.resolve(window.confirm(String(opts.message || "¿Estás seguro de continuar?")));
    }

    if (typeof confirmDialogResolver === "function") {
        const pending = confirmDialogResolver;
        confirmDialogResolver = null;
        pending(false);
    }

    titleEl.textContent = String(opts.title || "Confirmar acción");
    messageEl.textContent = String(opts.message || "¿Estás seguro de continuar?");
    cancelBtn.textContent = String(opts.cancelText || "Cancelar");
    acceptBtn.textContent = String(opts.acceptText || "Confirmar");

    const tone = String(opts.tone || "danger").toLowerCase();
    acceptBtn.classList.toggle("confirm-danger", tone === "danger");

    if (document.activeElement instanceof HTMLElement) {
        lastFocusedElementBeforeConfirm = document.activeElement;
    }

    dialog.hidden = false;
    dialog.removeAttribute("hidden");
    dialog.inert = false;
    dialog.removeAttribute("inert");

    // Reasignar handlers por seguridad en cada apertura.
    cancelBtn.onclick = onConfirmDialogCancelClick;
    acceptBtn.onclick = onConfirmDialogAcceptClick;

    window.setTimeout(function() {
        if (opts.focusConfirm) {
            acceptBtn.focus();
        } else {
            cancelBtn.focus();
        }
    }, 0);

    return new Promise(function(resolve) {
        confirmDialogResolver = resolve;
    });
}

function onConfirmDialogCancelClick() {
    closeAdminConfirmDialog(false);
}

function onConfirmDialogAcceptClick() {
    closeAdminConfirmDialog(true);
}

function trapConfirmDialogFocus(event) {
    if (!isAdminConfirmOpen() || event.key !== "Tab") return;
    const dialog = document.getElementById("adminConfirmDialog");
    const focusables = getDialogFocusableElements(dialog);
    if (!focusables.length) {
        event.preventDefault();
        dialog.focus();
        return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

/** Hay copias extra solo si el stepper subio alguna cantidad por encima de 1 (o total > archivos). */
function clienteTieneMultiplesCopias(cliente) {
    if (!cliente) return false;
    const fotos = cliente.fotos || [];
    const numFotos = Number(cliente.numFotos != null ? cliente.numFotos : fotos.length) || 0;
    let totalCopias = Number(cliente.totalCopias);
    if (!Number.isFinite(totalCopias)) totalCopias = numFotos;
    if (numFotos > 0 && totalCopias > numFotos) return true;
    const arr = cliente.cantidades;
    if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i += 1) {
            if (Math.max(1, parseInt(arr[i], 10) || 1) > 1) return true;
        }
    }
    return false;
}

function modalDebeMostrarCopias(numArchivos, totalCopias, cantidades) {
    const n = Number(numArchivos) || 0;
    const t = Number(totalCopias);
    if (n > 0 && Number.isFinite(t) && t > n) return true;
    if (Array.isArray(cantidades)) {
        for (let i = 0; i < cantidades.length; i += 1) {
            if (Math.max(1, parseInt(cantidades[i], 10) || 1) > 1) return true;
        }
    }
    return false;
}

function textoImagenesAdmin(cliente) {
    const fotos = cliente.fotos || [];
    const numFotos = Number(cliente.numFotos || fotos.length || 0);
    const totalCopias = Number(cliente.totalCopias != null ? cliente.totalCopias : numFotos);
    const extra = clienteTieneMultiplesCopias(cliente);
    const palFoto = numFotos === 1 ? "foto" : "fotos";
    if (!extra) {
        return `${numFotos}\u00A0${palFoto}`;
    }
    const tc = Number.isFinite(totalCopias) ? totalCopias : numFotos;
    const palCopia = tc === 1 ? "copia" : "copias";
    return `${numFotos}\u00A0${palFoto} · ${tc}\u00A0${palCopia}`;
}

function mostrarMensajeTamano(texto, ok = true) {
    const msg = document.getElementById("tamanoMensaje");
    if (!msg) return;
    msg.textContent = texto;
    msg.style.color = ok ? "#22c55e" : "#ff7a7a";
    if (ok) {
        announceAdminStatus(texto);
    } else {
        announceAdminAlert(texto);
    }
}

function mostrarMensajeMarco(texto, ok = true) {
    const msg = document.getElementById("marcoMensaje");
    if (!msg) return;
    msg.textContent = texto;
    msg.style.color = ok ? "#22c55e" : "#ff7a7a";
    if (ok) {
        announceAdminStatus(texto);
    } else {
        announceAdminAlert(texto);
    }
}

function formatearPrecio(valor) {
    const n = Number(valor);
    if (Number.isNaN(n)) return "0.00";
    return n.toFixed(2);
}

function extensionMarcoDesdeUrl(url) {
    const path = String(url || "").split("?")[0];
    const partes = path.split(".");
    if (partes.length < 2) return "-";
    return (partes.pop() || "-").toUpperCase();
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
    const opcionesSection = document.getElementById("panelOpciones");
    const title = document.querySelector(".topbar-title");

    if (view === "clientes") {
        dashboardBlocks.forEach(function(el) { el.classList.add("dashboard-hidden"); });
        if (clientesSection) clientesSection.hidden = false;
        if (opcionesSection) opcionesSection.hidden = true;
        if (title) title.innerHTML = "<span>Clientes</span> / Vista en tarjetas";
        setActiveNav("navClientes");
    } else if (view === "opciones") {
        dashboardBlocks.forEach(function(el) { el.classList.add("dashboard-hidden"); });
        if (clientesSection) clientesSection.hidden = true;
        if (opcionesSection) opcionesSection.hidden = false;
        if (title) title.innerHTML = "<span>Configuración</span> / Opciones";
        setActiveNav("navOpciones");
    } else {
        dashboardBlocks.forEach(function(el) { el.classList.remove("dashboard-hidden"); });
        if (clientesSection) clientesSection.hidden = true;
        if (opcionesSection) opcionesSection.hidden = true;
        if (title) title.innerHTML = "<span>Dashboard</span> / Vista general";
        setActiveNav("navDashboard");
    }
}

function initOpcionesAccordion() {
    const triggers = document.querySelectorAll(".opciones-accordion-trigger");
    if (!triggers.length) return;

    triggers.forEach(function(trigger) {
        const panelId = trigger.getAttribute("aria-controls");
        const panel = panelId ? document.getElementById(panelId) : null;
        const item = trigger.closest(".opciones-accordion-item");
        if (!panel || !item) return;

        trigger.addEventListener("click", function() {
            const isOpen = item.classList.contains("is-open");
            item.classList.toggle("is-open", !isOpen);
            trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
            panel.hidden = isOpen;
        });
    });
}

function renderClienteCard(c) {
    const card = document.createElement("article");
    card.className = "cliente-card";
    const etiquetaFotos = clienteTieneMultiplesCopias(c) ? "Fotos / copias" : "Fotos";
    const valorFotos = textoImagenesAdmin(c);
    card.innerHTML = `
        <h4>${c.nombre || ""} ${c.apellido || ""}</h4>
        <div class="cliente-meta"><strong>Correo:</strong> ${c.correo || "-"}</div>
        <div class="cliente-meta"><strong>Telefono:</strong> ${c.telefono || "-"}</div>
        <div class="cliente-meta"><strong>Tamano:</strong> ${c.tamano || "-"}</div>
        <div class="cliente-meta"><strong>Papel:</strong> ${c.papel || "-"}</div>
        <div class="cliente-meta"><strong>${etiquetaFotos}:</strong> ${valorFotos}</div>
        <div class="cliente-meta"><strong>Fecha:</strong> ${c.fechaRegistro || "-"}</div>
        <div class="cliente-meta"><strong>Total:</strong> $${Number(c.precioTotal || 0).toFixed(2)}</div>
    `;
    return card;
}

function filtrarClientesParaCards(clientes) {
    const filtro = (document.getElementById("filterImagenesCards")?.value || "").toLowerCase();
    const busqueda = (document.getElementById("searchClientesCards")?.value || "").trim().toLowerCase();

    return clientes.filter(function(c) {
        const nombre = String(c.nombre || "").toLowerCase();
        const apellido = String(c.apellido || "").toLowerCase();
        const nombreCompleto = `${nombre} ${apellido}`.trim();
        const inicial = (nombreCompleto.charAt(0) || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase();
        const numFotos = Number(c.numFotos || (Array.isArray(c.fotos) ? c.fotos.length : 0));

        const matchesBusqueda = !busqueda
            || nombre.includes(busqueda)
            || apellido.includes(busqueda)
            || nombreCompleto.includes(busqueda);

        const matchesImagenes = !filtro
            || (filtro === "con" && numFotos > 0)
            || (filtro === "sin" && numFotos === 0);

        const matchesAlpha = currentAlphaRangeCards === "todos"
            || (inicial && currentAlphaRangeCards.includes(inicial));

        return matchesBusqueda && matchesImagenes && matchesAlpha;
    });
}

function filterCardsByAlpha(range) {
    currentAlphaRangeCards = range;
    currentCardsPage = 1;
    document.querySelectorAll("#alphaFiltersCards .alpha-btn-cards").forEach(function(btn) {
        btn.classList.toggle("active", btn.dataset.range === range);
    });
    renderClientesCards(clientesCache);
}

function renderCardsPagination(totalPages) {
    const pagination = document.getElementById("clientesCardsPagination");
    if (!pagination) return;

    pagination.hidden = false;
    pagination.innerHTML = "";

    const pageInfo = document.createElement("span");
    pageInfo.className = "cards-page-info";
    pageInfo.textContent = `Pagina ${currentCardsPage} de ${totalPages}`;
    pagination.appendChild(pageInfo);

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "cards-page-btn";
    prevBtn.textContent = "Anterior";
    prevBtn.disabled = currentCardsPage <= 1;
    prevBtn.addEventListener("click", function() {
        if (currentCardsPage > 1) {
            currentCardsPage -= 1;
            renderClientesCards(clientesCache);
        }
    });
    pagination.appendChild(prevBtn);

    for (let page = 1; page <= totalPages; page += 1) {
        const pageBtn = document.createElement("button");
        pageBtn.type = "button";
        pageBtn.className = "cards-page-btn";
        if (page === currentCardsPage) {
            pageBtn.classList.add("active");
            pageBtn.setAttribute("aria-current", "page");
        }
        pageBtn.textContent = String(page);
        pageBtn.addEventListener("click", function() {
            currentCardsPage = page;
            renderClientesCards(clientesCache);
        });
        pagination.appendChild(pageBtn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "cards-page-btn";
    nextBtn.textContent = "Siguiente";
    nextBtn.disabled = currentCardsPage >= totalPages;
    nextBtn.addEventListener("click", function() {
        if (currentCardsPage < totalPages) {
            currentCardsPage += 1;
            renderClientesCards(clientesCache);
        }
    });
    pagination.appendChild(nextBtn);
}

function renderClientesCards(clientes) {
    const grid = document.getElementById("clientesCardsGrid");
    if (!grid) return;

    const lista = Array.isArray(clientes) ? clientes : [];
    const filtrados = filtrarClientesParaCards(lista);
    const countEl = document.getElementById("clientesCardsCount");
    const totalPages = Math.max(1, Math.ceil(filtrados.length / CARDS_PAGE_SIZE));

    if (currentCardsPage > totalPages) currentCardsPage = totalPages;
    if (currentCardsPage < 1) currentCardsPage = 1;

    const inicio = (currentCardsPage - 1) * CARDS_PAGE_SIZE;
    const fin = inicio + CARDS_PAGE_SIZE;
    const paginaActual = filtrados.slice(inicio, fin);

    grid.innerHTML = "";
    paginaActual.forEach(function(c) {
        grid.appendChild(renderClienteCard(c));
    });

    if (countEl) {
        countEl.textContent = `${filtrados.length} resultado${filtrados.length === 1 ? "" : "s"}`;
    }

    if (filtrados.length === 0) {
        const empty = document.createElement("p");
        empty.className = "clientes-cards-empty";
        empty.textContent = "No hay clientes para este filtro";
        grid.appendChild(empty);
    }

    renderCardsPagination(totalPages);
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
        currentCardsPage = 1;
        renderClientesCards(clientesCache);
    } catch (error) {
        console.error("Error cargando clientes en cards:", error);
        announceAdminAlert("No se pudieron cargar los clientes");
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
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar los tamaÃ±os");

        tamanosAdmin = Array.isArray(data.tamanos) ? data.tamanos : [];
        renderTamanosAdmin();
    } catch (error) {
        console.error("Error cargando tamaÃ±os:", error);
        mostrarMensajeTamano(error.message, false);
    }
}

function setFormMarcoVisible(visible) {
    const form = document.getElementById("formMarco");
    const btn = document.getElementById("btnToggleFormMarco");
    if (!form || !btn) return;

    form.hidden = !visible;
    btn.textContent = visible ? "Ocultar formulario" : "AÃ±adir nuevo marco";
}

function renderMarcosAdmin() {
    const tbody = document.getElementById("marcosBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    marcosAdmin.forEach(function(marco) {
        const tr = document.createElement("tr");

        const tdPreview = document.createElement("td");
        const img = document.createElement("img");
        img.className = "marco-thumb";
        img.src = marco.imagen_url;
        img.alt = `Marco ${marco.nombre}`;
        img.loading = "lazy";
        tdPreview.appendChild(img);

        const tdNombre = document.createElement("td");
        tdNombre.textContent = marco.nombre;

        const tdFormato = document.createElement("td");
        tdFormato.textContent = extensionMarcoDesdeUrl(marco.imagen_url);

        const tdEstado = document.createElement("td");
        const chip = document.createElement("span");
        chip.className = `estado-chip ${marco.activo ? "activo" : "inactivo"}`;
        chip.textContent = marco.activo ? "Activo" : "Inactivo";
        tdEstado.appendChild(chip);

        const tdAcciones = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "tamano-actions";

        const estadoBtn = document.createElement("button");
        estadoBtn.type = "button";
        estadoBtn.className = marco.activo ? "tamano-btn danger" : "tamano-btn";
        estadoBtn.textContent = marco.activo ? "Desactivar" : "Activar";
        estadoBtn.addEventListener("click", function() {
            cambiarEstadoMarco(marco.id, !marco.activo);
        });

        wrap.appendChild(estadoBtn);
        tdAcciones.appendChild(wrap);

        tr.appendChild(tdPreview);
        tr.appendChild(tdNombre);
        tr.appendChild(tdFormato);
        tr.appendChild(tdEstado);
        tr.appendChild(tdAcciones);
        tbody.appendChild(tr);
    });
}

async function cargarMarcosAdmin() {
    const tbody = document.getElementById("marcosBody");
    if (!tbody) return;

    try {
        const res = await fetch("/api/admin/marcos");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudieron cargar los marcos");

        marcosAdmin = Array.isArray(data.marcos) ? data.marcos : [];
        renderMarcosAdmin();
    } catch (error) {
        console.error("Error cargando marcos:", error);
        mostrarMensajeMarco(error.message, false);
    }
}

async function cambiarEstadoMarco(id, activo) {
    try {
        const res = await fetch(`/api/admin/marcos/${id}/estado`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activo })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo actualizar el estado del marco");

        mostrarMensajeMarco(`Marco ${activo ? "activado" : "desactivado"}`);
        await cargarMarcosAdmin();
    } catch (error) {
        console.error("Error actualizando estado del marco:", error);
        mostrarMensajeMarco(error.message, false);
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
    const confirmed = await showAdminConfirmDialog({
        title: "Desactivar tamaño",
        message: "Este tamaño dejará de estar disponible para nuevos pedidos.",
        cancelText: "Cancelar",
        acceptText: "Desactivar",
        tone: "danger",
        focusConfirm: false
    });
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/admin/tamanos/${id}/desactivar`, { method: "PATCH" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo desactivar");

        mostrarMensajeTamano("TamaÃ±o desactivado");
        await cargarTamanosAdmin();
    } catch (error) {
        console.error("Error desactivando tamaÃ±o:", error);
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

        mostrarMensajeTamano("TamaÃ±o activado");
        await cargarTamanosAdmin();
    } catch (error) {
        console.error("Error activando tamaÃ±o:", error);
        mostrarMensajeTamano(error.message, false);
    }
}

// â”€â”€â”€ Filtro alfabÃ©tico activo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Filtrar tabla por bÃºsqueda + rango alfabÃ©tico + fecha/estado/precio â”€â”€â”€â”€
function renderOrdersTablePagination(totalPages, totalResults) {
    const pagination = document.getElementById("ordersTablePagination");
    if (!pagination) return;

    pagination.innerHTML = "";

    const info = document.createElement("span");
    info.className = "orders-page-info";
    info.textContent = `${totalResults} resultado${totalResults === 1 ? "" : "s"} - Pagina ${currentTablePage} de ${totalPages}`;
    pagination.appendChild(info);

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "orders-page-btn";
    prevBtn.textContent = "Anterior";
    prevBtn.disabled = currentTablePage <= 1;
    prevBtn.addEventListener("click", function() {
        if (currentTablePage > 1) {
            currentTablePage -= 1;
            filterTable(false);
        }
    });
    pagination.appendChild(prevBtn);

    for (let page = 1; page <= totalPages; page += 1) {
        const pageBtn = document.createElement("button");
        pageBtn.type = "button";
        pageBtn.className = "orders-page-btn";
        pageBtn.textContent = String(page);
        if (page === currentTablePage) {
            pageBtn.classList.add("active");
            pageBtn.setAttribute("aria-current", "page");
        }
        pageBtn.addEventListener("click", function() {
            currentTablePage = page;
            filterTable(false);
        });
        pagination.appendChild(pageBtn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "orders-page-btn";
    nextBtn.textContent = "Siguiente";
    nextBtn.disabled = currentTablePage >= totalPages;
    nextBtn.addEventListener("click", function() {
        if (currentTablePage < totalPages) {
            currentTablePage += 1;
            filterTable(false);
        }
    });
    pagination.appendChild(nextBtn);
}

function filterTable(resetPage = true) {
    const searchValue = document.getElementById("searchInput").value.toLowerCase();
    const fechaFiltro = document.getElementById("filterFecha")?.value || "";
    const estadoFiltro = (document.getElementById("filterEstado")?.value || "").toLowerCase();
    const imagenesFiltro = (document.getElementById("filterImagenes")?.value || "").toLowerCase();
    const precioMinRaw = document.getElementById("filterPrecioMin")?.value;
    const precioMaxRaw = document.getElementById("filterPrecioMax")?.value;
    const precioMin = precioMinRaw !== "" ? Number(precioMinRaw) : null;
    const precioMax = precioMaxRaw !== "" ? Number(precioMaxRaw) : null;
    const rows = Array.from(document.querySelectorAll("#tableBody tr[data-id]"));
    const tbody = document.getElementById("tableBody");
    const emptyRow = document.getElementById("ordersTableEmptyRow");
    const filtrados = [];

    if (emptyRow) emptyRow.remove();

    if (resetPage) currentTablePage = 1;

    rows.forEach(function(row) {
        const text = row.innerText.toLowerCase();
        const nameEl = row.querySelector(".client-name");
        const firstLetter = nameEl ? nameEl.textContent.trim()[0].toUpperCase() : '';
        const rowEstado = (row.dataset.estado || "").toLowerCase();
        const rowFecha = row.dataset.fecha || "";
        const rowPrecio = row.dataset.precio !== "" ? Number(row.dataset.precio) : null;
        const rowNumFotos = row.dataset.numFotos !== "" ? Number(row.dataset.numFotos) : 0;

        const matchesSearch = text.includes(searchValue);
        const matchesAlpha  = currentAlphaRange === 'todos' || currentAlphaRange.includes(firstLetter);
        const matchesFecha = !fechaFiltro || rowFecha === fechaFiltro;
        const matchesEstado = !estadoFiltro || rowEstado === estadoFiltro;
        const matchesPrecioMin = precioMin === null || (rowPrecio !== null && rowPrecio >= precioMin);
        const matchesPrecioMax = precioMax === null || (rowPrecio !== null && rowPrecio <= precioMax);
        const matchesImagenes = !imagenesFiltro
            || (imagenesFiltro === "con" && rowNumFotos > 0)
            || (imagenesFiltro === "sin" && rowNumFotos === 0);

        const matches = matchesSearch && matchesAlpha && matchesFecha && matchesEstado && matchesPrecioMin && matchesPrecioMax && matchesImagenes;
        if (matches) filtrados.push(row);
    });

    const totalPages = Math.max(1, Math.ceil(filtrados.length / TABLE_PAGE_SIZE));
    if (currentTablePage > totalPages) currentTablePage = totalPages;
    if (currentTablePage < 1) currentTablePage = 1;

    rows.forEach(function(row) {
        row.style.display = "none";
    });

    const inicio = (currentTablePage - 1) * TABLE_PAGE_SIZE;
    const fin = inicio + TABLE_PAGE_SIZE;
    filtrados.slice(inicio, fin).forEach(function(row) {
        row.style.display = "";
    });

    if (filtrados.length === 0 && tbody) {
        const tr = document.createElement("tr");
        tr.id = "ordersTableEmptyRow";
        tr.innerHTML = '<td colspan="9" class="orders-table-empty">No hay pedidos para este filtro</td>';
        tbody.appendChild(tr);
    }

    renderOrdersTablePagination(totalPages, filtrados.length);
}

// â”€â”€â”€ Filtrar por rango de letras â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function filterByAlpha(range) {
    currentAlphaRange = range;
    currentTablePage = 1;

    document.querySelectorAll(".alpha-btn").forEach(function(btn) {
        btn.classList.toggle("active", btn.dataset.range === range);
    });

    filterTable(false);
}

// â”€â”€â”€ Eliminar fila â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function deleteRow(btn) {
    const row = btn.closest("tr");
    if (!row) return;

    const confirmed = await showAdminConfirmDialog({
        title: "Eliminar pedido",
        message: "Esta acción elimina el pedido y no se puede deshacer.",
        cancelText: "Cancelar",
        acceptText: "Eliminar",
        tone: "danger",
        focusConfirm: false
    });
    if (!confirmed) return;

    const id = Number(row.dataset.id);
    const estadoActual = (row.dataset.estado || 'pendiente').toLowerCase();
    const numFotosEliminadas = Math.max(0, parseInt(row.dataset.numFotos || "0", 10) || 0);
    try {
        const res = await fetch(`/api/clientes/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error al eliminar");
        row.remove();
        clientesCache = clientesCache.filter(function(c) { return Number(c.id) !== id; });
        ajustarTotalImagenes(-numFotosEliminadas);
        if (!document.getElementById("clientesCardsContainer")?.hidden) {
            renderClientesCards(clientesCache);
        }
        // Solo decrementar badge si el pedido eliminado estaba en estado 'pendiente'
        if (estadoActual === 'pendiente') {
            actualizarBadge(-1);
        }
        announceAdminStatus("Pedido eliminado");
    } catch (error) {
        console.error("Error al eliminar:", error);
        announceAdminAlert(getErrorMessage(error, "No se pudo eliminar el pedido"));
    }
}

// â”€â”€â”€ Cambiar estado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ESTADOS_ORDEN = ["pendiente", "procesando", "listo_retiro", "entregado", "cancelado"];
const ESTADO_LABELS = {
    pendiente: "Pendiente",
    procesando: "Procesando",
    listo_retiro: "Listo para retirar",
    entregado: "Entregado",
    cancelado: "Cancelado",
};
const ESTADO_CLASSES = {
    pendiente: "status-pendiente",
    procesando: "status-procesando",
    listo_retiro: "status-listo_retiro",
    entregado: "status-entregado",
    cancelado: "status-cancelado",
};

function normalizarEstadoPedido(estado) {
    const raw = String(estado || "pendiente").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (raw === "enviado" || raw === "listo_para_retirar") return "listo_retiro";
    if (raw === "en_proceso") return "procesando";
    return raw || "pendiente";
}

function etiquetaEstadoPedido(estado) {
    const key = normalizarEstadoPedido(estado);
    return ESTADO_LABELS[key] || ESTADO_LABELS.pendiente;
}

function claseEstadoPedido(estado) {
    const key = normalizarEstadoPedido(estado);
    return ESTADO_CLASSES[key] || ESTADO_CLASSES.pendiente;
}

async function changeStatus(btn) {
    const row = btn.closest("tr");
    if (!row) return;
    const badge = row.querySelector(".status");
    if (!badge) return;

    const estadoActual = normalizarEstadoPedido(row.dataset.estado);
    let currentIndex = ESTADOS_ORDEN.indexOf(estadoActual);
    if (currentIndex < 0) currentIndex = 0;
    const nuevoIndex = (currentIndex + 1) % ESTADOS_ORDEN.length;
    const nuevoEstado = ESTADOS_ORDEN[nuevoIndex];
    const nuevoEstadoLabel = etiquetaEstadoPedido(nuevoEstado);

    try {
        const id = Number(row.dataset.id);
        const res = await fetch(`/api/clientes/${id}/estado`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado: nuevoEstado })
        });

        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cambiar el estado");

        badge.className = `status ${claseEstadoPedido(nuevoEstado)}`;
        badge.textContent = nuevoEstadoLabel;
        row.dataset.estado = nuevoEstado;
        announceAdminStatus(`Estado cambiado a ${nuevoEstadoLabel.toLowerCase()}`);
        
        // Actualizar badge de pedidos pendientes
        // Si el estado anterior era 'pendiente' y el nuevo no lo es â†’ decrementar
        if (estadoActual === 'pendiente' && nuevoEstado !== 'pendiente') {
            actualizarBadge(-1);
        }
        // Si el estado anterior no era 'pendiente' y el nuevo sÃ­ lo es â†’ incrementar
        else if (estadoActual !== 'pendiente' && nuevoEstado === 'pendiente') {
            actualizarBadge(+1);
        }
        
        filterTable(false);
    } catch (error) {
        console.error("Error actualizando estado:", error);
        announceAdminAlert(getErrorMessage(error, "No se pudo cambiar el estado"));
    }
}

// â”€â”€â”€ Exportar CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Badge Pedidos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getBadge() {
    return document.getElementById("badgePedidos");
}

function getBadgeImagenes() {
    return document.getElementById("badgeImagenes");
}

function getStatTotalFotosEl() {
    return document.getElementById("statTotalFotos");
}

function parseEnteroUI(text) {
    const raw = String(text || "").replace(/[^\d-]/g, "");
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

function totalImagenesVisibleActual() {
    const statEl = getStatTotalFotosEl();
    const badge = getBadgeImagenes();
    const desdeStat = statEl ? parseEnteroUI(statEl.textContent) : 0;
    if (desdeStat > 0) return desdeStat;
    return badge ? parseEnteroUI(badge.textContent) : 0;
}

function actualizarBadgeImagenes(total) {
    const badge = getBadgeImagenes();
    const statEl = getStatTotalFotosEl();
    if (!badge && !statEl) return;

    const n = Number(total);
    if (!Number.isFinite(n) || n < 0) {
        if (badge) {
            badge.textContent = "—";
            badge.setAttribute("aria-label", "Total de imagenes no disponible");
        }
        if (statEl) {
            statEl.textContent = "—";
        }
        return;
    }

    const valor = Math.trunc(n);
    const valorFmt = valor.toLocaleString("es-MX");
    if (badge) {
        badge.textContent = valorFmt;
        badge.setAttribute("aria-label", `Total de imagenes subidas: ${valorFmt}`);
    }
    if (statEl) {
        statEl.textContent = valorFmt;
    }
}

function ajustarTotalImagenes(delta) {
    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) return;
    const base = totalImagenesVisibleActual();
    const siguiente = Math.max(0, Math.trunc(base + d));
    actualizarBadgeImagenes(siguiente);
}

const CLIENTES_SYNC_INTERVAL_MS = 12000;
const REALTIME_RETRY_BASE_MS = 3000;
const REALTIME_RETRY_MAX_MS = 20000;
const REALTIME_LAST_EVENT_STORAGE_KEY = "admin_realtime_last_event_id";
let clientesSyncInFlight = false;
let clientesSyncTimerId = null;
let lastClientesSignature = "";
let realtimeSource = null;
let realtimeConnected = false;
let realtimeRetryMs = REALTIME_RETRY_BASE_MS;
let realtimeReconnectTimerId = null;
let realtimeDesktopNoticeCache = new Set();
let notificationPermissionBound = false;

function contarPedidosPendientes(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.filter(function(c) {
        return normalizarEstadoPedido(c && c.estado) === "pendiente";
    }).length;
}

function contarImagenesClientes(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.reduce(function(acc, c) {
        const n = Number(c && c.numFotos != null
            ? c.numFotos
            : (Array.isArray(c && c.fotos) ? c.fotos.length : 0));
        return acc + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
}

function construirFirmaClientes(list) {
    const arr = Array.isArray(list) ? list : [];
    return arr.map(function(c) {
        const id = Number(c && c.id) || 0;
        const estado = normalizarEstadoPedido(c && c.estado);
        const pagado = c && c.pagado ? 1 : 0;
        const nf = Number(c && c.numFotos != null
            ? c.numFotos
            : (Array.isArray(c && c.fotos) ? c.fotos.length : 0)) || 0;
        const tc = Number(c && c.totalCopias != null ? c.totalCopias : nf) || 0;
        const fecha = String(c && c.fechaRegistro || "");
        return `${id}:${estado}:${pagado}:${nf}:${tc}:${fecha}`;
    }).join("|");
}

function aplicarClientesCacheEnUI(resetPage = false) {
    const tbody = document.getElementById("tableBody");
    if (tbody) {
        tbody.innerHTML = "";
        clientesCache.forEach(function(cliente) {
            renderClienteRow(cliente, false);
        });
    }

    filterTable(resetPage);

    const badge = getBadge();
    if (badge) {
        badge.textContent = contarPedidosPendientes(clientesCache);
    }
    actualizarBadgeImagenes(contarImagenesClientes(clientesCache));

    if (!document.getElementById("clientesCardsContainer")?.hidden) {
        renderClientesCards(clientesCache);
    }
}

function setAdminRealtimeBadge(text, online = false) {
    const el = document.getElementById("realtimeBadge");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("online", Boolean(online));
    el.classList.toggle("offline", !online);
}

function parseRealtimePayload(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
        return {};
    }
}

function getStoredRealtimeLastEventId() {
    try {
        const raw = window.sessionStorage.getItem(REALTIME_LAST_EVENT_STORAGE_KEY) || "0";
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    } catch (_error) {
        return 0;
    }
}

function setStoredRealtimeLastEventId(lastEventId) {
    const n = Number(lastEventId);
    if (!Number.isFinite(n) || n < 0) return;
    try {
        window.sessionStorage.setItem(REALTIME_LAST_EVENT_STORAGE_KEY, String(Math.trunc(n)));
    } catch (_error) {
        // Ignorar storage bloqueado.
    }
}

function tryRequestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "default") return;
    Notification.requestPermission().catch(function() {
        // Ignorar errores de permisos del navegador.
    });
}

function bindNotificationPermissionRequest() {
    if (notificationPermissionBound) return;
    notificationPermissionBound = true;

    const onceRequest = function() {
        tryRequestNotificationPermission();
    };

    document.addEventListener("click", onceRequest, { once: true, capture: true });
    document.addEventListener("keydown", onceRequest, { once: true, capture: true });
}

function notifyDesktopAdmin(eventName, payload, eventId) {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const id = Number(payload && payload.order_id);
    const safeId = Number.isFinite(id) && id > 0 ? id : null;
    const dedupeKey = `${String(eventId || "0")}:${eventName}:${safeId || "na"}`;
    if (realtimeDesktopNoticeCache.has(dedupeKey)) return;
    realtimeDesktopNoticeCache.add(dedupeKey);
    if (realtimeDesktopNoticeCache.size > 120) {
        const first = realtimeDesktopNoticeCache.values().next();
        if (!first.done) {
            realtimeDesktopNoticeCache.delete(first.value);
        }
    }

    let title = "Actualizacion de pedidos";
    let body = "Hubo una actualizacion en el panel.";
    if (eventName === "new_order") {
        title = "Nuevo pedido";
        body = safeId ? `Llego el pedido #${String(safeId).padStart(4, "0")}.` : "Llego un nuevo pedido.";
    } else if (eventName === "payment_confirmed") {
        title = "Pago confirmado";
        body = safeId ? `El pedido #${String(safeId).padStart(4, "0")} fue marcado como pagado.` : "Se confirmo un pago.";
    }

    const notice = new Notification(title, {
        body,
        tag: `admin-${eventName}-${safeId || "na"}`,
    });
    notice.onclick = function() {
        window.focus();
        this.close();
    };
}

function resaltarFilaPedido(orderId) {
    const id = Number(orderId);
    if (!Number.isFinite(id) || id <= 0) return;
    const row = document.querySelector(`#tableBody tr[data-id="${id}"]`);
    if (!row) return;

    row.classList.remove("row-realtime-flash");
    void row.offsetWidth;
    row.classList.add("row-realtime-flash");
    window.setTimeout(function() {
        row.classList.remove("row-realtime-flash");
    }, 2600);
}

async function sincronizarClientesEnSegundoPlano(force = false, focusOrderId = null) {
    if (clientesSyncInFlight) return;
    clientesSyncInFlight = true;

    try {
        const res = await fetch("/api/clientes", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const clientes = await res.json();
        const nuevos = Array.isArray(clientes) ? clientes : [];
        const firmaNueva = construirFirmaClientes(nuevos);

        if (!force && firmaNueva === lastClientesSignature) {
            return;
        }

        clientesCache = nuevos;
        lastClientesSignature = firmaNueva;
        aplicarClientesCacheEnUI(false);
        if (focusOrderId != null) {
            resaltarFilaPedido(focusOrderId);
        }
    } catch (error) {
        console.error("Error en sincronizacion automatica de pedidos:", error);
    } finally {
        clientesSyncInFlight = false;
    }
}

function closeAdminRealtimeSource() {
    if (realtimeSource) {
        try {
            realtimeSource.close();
        } catch (_error) {
            // Ignorar errores de cierre.
        }
        realtimeSource = null;
    }
    realtimeConnected = false;
}

function scheduleAdminRealtimeReconnect() {
    if (realtimeReconnectTimerId) return;
    const delay = Math.max(REALTIME_RETRY_BASE_MS, Math.min(realtimeRetryMs, REALTIME_RETRY_MAX_MS));
    realtimeReconnectTimerId = window.setTimeout(function() {
        realtimeReconnectTimerId = null;
        conectarAdminRealtime();
    }, delay);
    realtimeRetryMs = Math.min(Math.round(delay * 1.6), REALTIME_RETRY_MAX_MS);
}

function handleAdminRealtimeEvent(eventName, eventObj) {
    const payload = parseRealtimePayload(eventObj && eventObj.data);
    const eventId = eventObj && eventObj.lastEventId;
    setStoredRealtimeLastEventId(eventId);
    const orderId = Number(payload && payload.order_id);
    const focusOrderId = Number.isFinite(orderId) && orderId > 0 ? orderId : null;

    if (eventName === "new_order") {
        announceAdminStatus("Nuevo pedido recibido.");
        notifyDesktopAdmin(eventName, payload, eventId);
    } else if (eventName === "payment_confirmed") {
        announceAdminStatus("Pago confirmado en tiempo real.");
        notifyDesktopAdmin(eventName, payload, eventId);
    }

    sincronizarClientesEnSegundoPlano(true, focusOrderId);

    if (["new_order", "order_deleted", "payment_confirmed", "status_changed", "order_updated"].includes(eventName)) {
        cargarEstadisticas();
        cargarGraficoPedidos();
        cargarUltimasSubidas();
    }
}

function conectarAdminRealtime() {
    if (typeof EventSource === "undefined") {
        setAdminRealtimeBadge("Tiempo real no soportado", false);
        return;
    }
    if (realtimeSource) return;

    setAdminRealtimeBadge("Conectando…", false);

    const storedLastId = getStoredRealtimeLastEventId();
    const streamUrl = storedLastId > 0
        ? `/api/realtime/pedidos/stream?lastEventId=${storedLastId}`
        : "/api/realtime/pedidos/stream";

    const source = new EventSource(streamUrl, { withCredentials: true });
    realtimeSource = source;

    source.onopen = function() {
        realtimeConnected = true;
        realtimeRetryMs = REALTIME_RETRY_BASE_MS;
        setAdminRealtimeBadge("En vivo", true);
    };

    source.onerror = function() {
        closeAdminRealtimeSource();
        setAdminRealtimeBadge("Reconectando…", false);
        sincronizarClientesEnSegundoPlano(true);
        scheduleAdminRealtimeReconnect();
    };

    source.addEventListener("connected", function(ev) {
        setStoredRealtimeLastEventId(ev && ev.lastEventId);
        realtimeConnected = true;
        realtimeRetryMs = REALTIME_RETRY_BASE_MS;
        setAdminRealtimeBadge("En vivo", true);
    });

    source.addEventListener("sync_needed", function(ev) {
        handleAdminRealtimeEvent("sync_needed", ev);
    });
    source.addEventListener("new_order", function(ev) {
        handleAdminRealtimeEvent("new_order", ev);
    });
    source.addEventListener("order_updated", function(ev) {
        handleAdminRealtimeEvent("order_updated", ev);
    });
    source.addEventListener("order_deleted", function(ev) {
        handleAdminRealtimeEvent("order_deleted", ev);
    });
    source.addEventListener("status_changed", function(ev) {
        handleAdminRealtimeEvent("status_changed", ev);
    });
    source.addEventListener("payment_confirmed", function(ev) {
        handleAdminRealtimeEvent("payment_confirmed", ev);
    });
    source.addEventListener("payment_reverted", function(ev) {
        handleAdminRealtimeEvent("payment_reverted", ev);
    });
}

function iniciarSincronizacionClientes() {
    if (clientesSyncTimerId) return;

    bindNotificationPermissionRequest();
    conectarAdminRealtime();

    clientesSyncTimerId = window.setInterval(function() {
        if (document.visibilityState === "visible") {
            if (!realtimeConnected) {
                sincronizarClientesEnSegundoPlano(false);
            }
        }
    }, CLIENTES_SYNC_INTERVAL_MS);

    document.addEventListener("visibilitychange", function() {
        if (document.visibilityState === "visible") {
            sincronizarClientesEnSegundoPlano(true);
            if (!realtimeConnected) {
                conectarAdminRealtime();
            }
        }
    });

    window.addEventListener("beforeunload", function() {
        closeAdminRealtimeSource();
    });
}

function actualizarBadge(delta) {
    const badge = getBadge();
    if (!badge) return;
    const actual = parseInt(badge.textContent) || 0;
    badge.textContent = Math.max(0, actual + delta);
}

// â”€â”€â”€ Ver fotos en modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function verFotos(fotosJSON, clienteNombre, numArchivos, totalCopias, cantidadesJSON) {
    let fotos = [];
    try {
        const raw = String(fotosJSON || "[]").replace(/&quot;/g, '"');
        fotos = JSON.parse(raw);
    } catch (_error) {
        fotos = [];
    }

    let cantidades = [];
    if (cantidadesJSON != null && String(cantidadesJSON).trim() !== "") {
        try {
            const rawC = String(cantidadesJSON).replace(/&quot;/g, '"');
            const parsed = JSON.parse(rawC);
            cantidades = Array.isArray(parsed) ? parsed : [];
        } catch (_e) {
            cantidades = [];
        }
    }

    const modal = document.getElementById("fotoModal");
    const body  = document.getElementById("fotoModalBody");
    const title = document.getElementById("fotoModalTitle");
    const meta  = document.getElementById("fotoModalMeta");

    fotosModalActuales = Array.isArray(fotos) ? fotos.slice() : [];
    nombrePedidoModal = (clienteNombre || "pedido").trim();
    carruselIndiceActual = 0;
    modoCarruselActivo = false;

    const nArch = Number.isFinite(Number(numArchivos)) ? Number(numArchivos) : fotosModalActuales.length;
    let total = Number(totalCopias);
    if (!Number.isFinite(total) && cantidades.length > 0) {
        total = cantidades.reduce(function(acc, c) {
            return acc + Math.max(1, parseInt(c, 10) || 1);
        }, 0);
    }
    if (!Number.isFinite(total)) {
        total = Math.max(nArch, fotosModalActuales.length);
    }

    const mostrarCopiasEnModal = modalDebeMostrarCopias(nArch, total, cantidades);

    title.textContent = `Fotos - ${nombrePedidoModal || "pedido"}`;
    if (meta) {
        if (mostrarCopiasEnModal) {
            const arch = nArch || fotosModalActuales.length;
            const palArch = arch === 1 ? "archivo" : "archivos";
            meta.textContent = arch > 0
                ? `${total} copias en total (${arch} ${palArch})`
                : "";
        } else {
            meta.textContent = "";
        }
    }

    body.classList.remove("foto-modal-body-carrusel");
    body.classList.add("foto-grid");
    body.innerHTML = "";

    if (fotosModalActuales.length === 0) {
        body.innerHTML = '<p style="color:#6b6b85;text-align:center">Sin fotos</p>';
    } else {
        fotosModalActuales.forEach(function(url, idx) {
            const div = document.createElement("div");
            div.className = "foto-thumb";
            const img = document.createElement("img");
            img.src = url;
            const copias = Math.max(1, parseInt(cantidades[idx], 10) || 1);
            img.alt = mostrarCopiasEnModal
                ? `Foto ${idx + 1}, ${copias} copia${copias > 1 ? "s" : ""}`
                : `Foto ${idx + 1}`;
            img.loading = "lazy";
            div.appendChild(img);
            if (mostrarCopiasEnModal) {
                const badge = document.createElement("span");
                badge.className = "foto-thumb-badge";
                badge.textContent = "\u00d7" + copias;
                div.appendChild(badge);
            }
            div.onclick = function() {
                window.open(url, '_blank');
            };
            body.appendChild(div);
        });
    }

    openFotoModal();
}

function abrirCarruselCliente(clienteNombre, fotos, indiceInicial = 0, resumenCopias) {
    const modal = document.getElementById("fotoModal");
    const body = document.getElementById("fotoModalBody");
    const title = document.getElementById("fotoModalTitle");
    const meta = document.getElementById("fotoModalMeta");

    fotosModalActuales = Array.isArray(fotos) ? fotos.slice() : [];
    nombrePedidoModal = (clienteNombre || "cliente").trim();
    modoCarruselActivo = true;
    carruselIndiceActual = Math.max(0, Math.min(indiceInicial, Math.max(fotosModalActuales.length - 1, 0)));

    title.textContent = `Fotos - ${nombrePedidoModal || "cliente"}`;
    if (meta) {
        const arch = Number(resumenCopias && resumenCopias.numArchivos) || fotosModalActuales.length;
        const total = Number(resumenCopias && resumenCopias.totalCopias);
        if (resumenCopias && Number.isFinite(total) && total > arch) {
            const palArch = arch === 1 ? "archivo" : "archivos";
            meta.textContent = `${total} copias en total (${arch} ${palArch})`;
        } else {
            meta.textContent = "";
        }
    }

    body.classList.remove("foto-grid");
    body.classList.add("foto-modal-body-carrusel");

    if (fotosModalActuales.length === 0) {
        body.innerHTML = '<p style="color:#6b6b85;text-align:center">Sin fotos</p>';
        openFotoModal();
        return;
    }

    body.innerHTML = `
        <div class="foto-carrusel-wrap" role="region" aria-label="Carrusel de fotos del cliente">
            <button type="button" class="foto-carrusel-btn prev" id="fotoCarruselPrev" aria-label="Foto anterior">&#8249;</button>
            <div class="foto-carrusel-frame">
                <img id="fotoCarruselImg" class="foto-carrusel-img" alt="Foto del cliente" loading="lazy">
            </div>
            <button type="button" class="foto-carrusel-btn next" id="fotoCarruselNext" aria-label="Foto siguiente">&#8250;</button>
        </div>
        <div class="foto-carrusel-counter" id="fotoCarruselCounter" aria-live="polite"></div>
    `;

    const prevBtn = document.getElementById("fotoCarruselPrev");
    const nextBtn = document.getElementById("fotoCarruselNext");

    if (prevBtn) {
        prevBtn.addEventListener("click", mostrarFotoAnteriorCarrusel);
    }
    if (nextBtn) {
        nextBtn.addEventListener("click", mostrarFotoSiguienteCarrusel);
    }

    actualizarCarruselFotosModal();
    openFotoModal();
}

function actualizarCarruselFotosModal() {
    if (!modoCarruselActivo) return;
    const total = fotosModalActuales.length;
    if (total === 0) return;

    const img = document.getElementById("fotoCarruselImg");
    const counter = document.getElementById("fotoCarruselCounter");
    const prevBtn = document.getElementById("fotoCarruselPrev");
    const nextBtn = document.getElementById("fotoCarruselNext");

    const idx = ((carruselIndiceActual % total) + total) % total;
    carruselIndiceActual = idx;

    if (img) {
        img.src = fotosModalActuales[idx];
        img.alt = `Foto ${idx + 1} de ${total} - ${nombrePedidoModal || "cliente"}`;
    }

    if (counter) {
        counter.textContent = `${idx + 1} de ${total}`;
    }

    if (prevBtn) prevBtn.disabled = total < 2;
    if (nextBtn) nextBtn.disabled = total < 2;
}

function mostrarFotoAnteriorCarrusel() {
    if (!modoCarruselActivo || fotosModalActuales.length < 2) return;
    carruselIndiceActual = (carruselIndiceActual - 1 + fotosModalActuales.length) % fotosModalActuales.length;
    actualizarCarruselFotosModal();
}

function mostrarFotoSiguienteCarrusel() {
    if (!modoCarruselActivo || fotosModalActuales.length < 2) return;
    carruselIndiceActual = (carruselIndiceActual + 1) % fotosModalActuales.length;
    actualizarCarruselFotosModal();
}

function cerrarModal() {
    modoCarruselActivo = false;
    carruselIndiceActual = 0;
    const meta = document.getElementById("fotoModalMeta");
    if (meta) meta.textContent = "";
    const modal = document.getElementById("fotoModal");
    if (!modal) return;
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
    if (lastFocusedElementBeforeModal && document.contains(lastFocusedElementBeforeModal)) {
        lastFocusedElementBeforeModal.focus();
    }
    lastFocusedElementBeforeModal = null;
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
        announceAdminAlert("Este pedido no tiene imagenes para descargar");
        return;
    }

    const textoOriginal = btn ? btn.textContent : "descargar";
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Descargando...";
    }
    announceAdminStatus("Descarga iniciada");

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
        announceAdminStatus("Descarga finalizada");
    }
}

async function descargarPedido(btn) {
    const row = btn.closest("tr");
    if (!row) return;

    const id = Number(row.dataset.id);
    const cliente = clientesCache.find(function(c) { return Number(c.id) === id; });

    if (!cliente) {
        announceAdminAlert("No se encontro la informacion del pedido");
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
    trapConfirmDialogFocus(e);

    if (isAdminConfirmOpen() && e.key === "Escape") {
        e.preventDefault();
        closeAdminConfirmDialog(false);
        return;
    }

    if (e.key === "Escape") {
        cerrarModal();
        cerrarModalEditarTamano();
        return;
    }

    const fotoModal = document.getElementById("fotoModal");
    const modalAbierto = !!(fotoModal && fotoModal.classList.contains("active"));
    if (!modalAbierto || !modoCarruselActivo) return;

    if (e.key === "ArrowLeft") {
        e.preventDefault();
        mostrarFotoAnteriorCarrusel();
    } else if (e.key === "ArrowRight") {
        e.preventDefault();
        mostrarFotoSiguienteCarrusel();
    }
});
document.getElementById("fotoModal").addEventListener("click", function(e) {
    if (e.target === this) cerrarModal();
});

const adminConfirmDialog = document.getElementById("adminConfirmDialog");
if (adminConfirmDialog) {
    adminConfirmDialog.addEventListener("click", function(e) {
        if (e.target === this) {
            closeAdminConfirmDialog(false);
        }
    });
}

const adminConfirmCancel = document.getElementById("adminConfirmCancel");
if (adminConfirmCancel) {
    adminConfirmCancel.addEventListener("click", onConfirmDialogCancelClick);
}

const adminConfirmAccept = document.getElementById("adminConfirmAccept");
if (adminConfirmAccept) {
    adminConfirmAccept.addEventListener("click", onConfirmDialogAcceptClick);
}

const editTamanoModal = document.getElementById("editTamanoModal");
if (editTamanoModal) {
    editTamanoModal.addEventListener("click", function(e) {
        if (e.target === this) cerrarModalEditarTamano();
    });
}

// â”€â”€â”€ Render fila de pedido â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderClienteRow(cliente, applyFilters = true) {
    const tbody = document.getElementById("tableBody");
    const tr = document.createElement("tr");
    tr.dataset.id = cliente.id;

    const fotos = cliente.fotos || [];
    const fotosJSON = JSON.stringify(fotos).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const cantidadesJSON = JSON.stringify(cliente.cantidades || []).replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const nombreCompleto = `${cliente.nombre} ${cliente.apellido}`;
    const nombreSeguroOnclick = String(nombreCompleto).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const numFotos = Number(cliente.numFotos || fotos.length || 0);
    const totalCopias = Number(cliente.totalCopias || numFotos || 0);
    const precioNum = cliente.precioTotal != null ? Number(cliente.precioTotal) : null;
    const precio = precioNum != null ? `$${precioNum.toFixed(2)}` : "\u2014";

    const estadoRaw = normalizarEstadoPedido(cliente.estado || "pendiente");
    const estadoLabel = etiquetaEstadoPedido(estadoRaw);
    const estadoClass = claseEstadoPedido(estadoRaw);

    tr.dataset.estado = estadoRaw;
    tr.dataset.fecha = toISODate(cliente.fechaRegistro);
    tr.dataset.precio = precioNum != null && !Number.isNaN(precioNum) ? String(precioNum) : "";
    tr.dataset.numFotos = String(numFotos);

    const textoImg = textoImagenesAdmin(cliente);

    tr.innerHTML = `
        <td><code style="color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">#${String(cliente.id).padStart(4,"0")}</code></td>
        <td>
            <div class="client-name">${cliente.nombre} ${cliente.apellido}</div>
            <div class="client-email">${cliente.correo}</div>
        </td>
        <td>
            ${numFotos > 0
                ? `<span class="fotos-link" onclick="verFotos('${fotosJSON}', '${nombreSeguroOnclick}', ${numFotos}, ${totalCopias}, '${cantidadesJSON}')">${textoImg}</span>`
                : "\u2014"}
        </td>
        <td>${cliente.tamano || "\u2014"}</td>
        <td>${cliente.papel || "\u2014"}</td>
        <td style="color:#22c55e;font-weight:600;font-family:'Space Mono',monospace">${precio}</td>
        <td><span class="status ${estadoClass}">${estadoLabel}</span></td>
        <td style="color:var(--muted);font-size:12px">${cliente.fechaRegistro}</td>
        <td>
            <div class="acciones-pedido">
                <button class="action-btn" onclick="changeStatus(this)">\u270e Estado</button>
                <button class="action-btn del" onclick="deleteRow(this)">\u2715</button>
                <button class="action-btn" onclick="descargarPedido(this)">\u2193 Descargar</button>
            </div>
        </td>
    `;
    tbody.prepend(tr);

    if (applyFilters) {
        filterTable(true);
    }
}

// â”€â”€â”€ Cargar pedidos desde la API Flask al cargar la pÃ¡gina â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener("DOMContentLoaded", async function() {
    try {
        const res = await fetch("/api/clientes");
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const clientes = await res.json();
        clientesCache = Array.isArray(clientes) ? clientes : [];
        lastClientesSignature = construirFirmaClientes(clientesCache);
        aplicarClientesCacheEnUI(true);
    } catch (error) {
        console.error("Error al cargar pedidos:", error);
        const tbody = document.getElementById("tableBody");
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" class="orders-table-empty">No se pudieron cargar los pedidos</td></tr>';
        }
        announceAdminAlert("No se pudieron cargar los pedidos");
    }

    const navDashboard = document.getElementById("navDashboard");
    const navPedidos = document.getElementById("navPedidos");
    const navClientes = document.getElementById("navClientes");
    const navOpciones = document.getElementById("navOpciones");

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

    if (navOpciones) {
        navOpciones.addEventListener("click", function(e) {
            e.preventDefault();
            setAdminMainView("opciones");
        });
    }

    const filterImagenesCards = document.getElementById("filterImagenesCards");
    if (filterImagenesCards) {
        filterImagenesCards.addEventListener("change", function() {
            currentCardsPage = 1;
            renderClientesCards(clientesCache);
        });
    }

    const searchClientesCards = document.getElementById("searchClientesCards");
    if (searchClientesCards) {
        searchClientesCards.addEventListener("input", function() {
            currentCardsPage = 1;
            renderClientesCards(clientesCache);
        });
    }

    document.querySelectorAll("#alphaFiltersCards .alpha-btn-cards").forEach(function(btn) {
        btn.addEventListener("click", function() {
            filterCardsByAlpha(btn.dataset.range || "todos");
        });
    });

    const formTamano = document.getElementById("formTamano");
    if (formTamano) {
        formTamano.addEventListener("submit", async function(e) {
            e.preventDefault();

            const clave = (document.getElementById("tamanoClave")?.value || "").trim().toLowerCase();
            const nombre = (document.getElementById("tamanoNombre")?.value || "").trim();
            const precio = Number(document.getElementById("tamanoPrecio")?.value || "0");

            if (!clave || !nombre || Number.isNaN(precio) || precio < 0) {
                mostrarMensajeTamano("Completa clave, nombre y precio vÃ¡lidos", false);
                return;
            }

            try {
                const resCreate = await fetch("/api/admin/tamanos", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ clave, nombre, precio_base: precio })
                });
                const data = await resCreate.json();
                if (!resCreate.ok) throw new Error(data.error || "No se pudo guardar el tamaÃ±o");

                formTamano.reset();
                mostrarMensajeTamano("TamaÃ±o guardado correctamente");
                await cargarTamanosAdmin();
            } catch (error) {
                console.error("Error guardando tamaÃ±o:", error);
                mostrarMensajeTamano(error.message, false);
            }
        });
    }

    const btnToggleFormMarco = document.getElementById("btnToggleFormMarco");
    const cancelFormMarco = document.getElementById("cancelFormMarco");
    const formMarco = document.getElementById("formMarco");

    if (btnToggleFormMarco) {
        btnToggleFormMarco.addEventListener("click", function() {
            const visible = !!(formMarco && !formMarco.hidden);
            setFormMarcoVisible(!visible);
        });
    }

    if (cancelFormMarco) {
        cancelFormMarco.addEventListener("click", function() {
            if (formMarco) formMarco.reset();
            const activo = document.getElementById("marcoActivo");
            if (activo) activo.checked = true;
            setFormMarcoVisible(false);
        });
    }

    if (formMarco) {
        formMarco.addEventListener("submit", async function(e) {
            e.preventDefault();

            const nombre = (document.getElementById("marcoNombre")?.value || "").trim();
            const inputImagen = document.getElementById("marcoImagen");
            const activo = !!document.getElementById("marcoActivo")?.checked;
            const archivos = inputImagen && inputImagen.files
                ? Array.from(inputImagen.files)
                : [];

            if (!nombre || archivos.length === 0) {
                mostrarMensajeMarco("Completa el nombre y selecciona al menos un archivo PNG o SVG", false);
                return;
            }

            const invalido = archivos.find(function(archivo) {
                const nombreArchivo = String(archivo.name || "").toLowerCase();
                return !(nombreArchivo.endsWith(".png") || nombreArchivo.endsWith(".svg"));
            });

            if (invalido) {
                mostrarMensajeMarco(`Archivo no permitido: ${invalido.name}. Solo PNG o SVG`, false);
                return;
            }

            try {
                const payload = new FormData();
                payload.append("nombre", nombre);
                archivos.forEach(function(archivo) {
                    payload.append("imagen", archivo);
                });
                payload.append("activo", activo ? "true" : "false");

                const res = await fetch("/api/admin/marcos", {
                    method: "POST",
                    body: payload
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "No se pudo guardar el marco");

                const totalGuardados = Array.isArray(data.marcos) ? data.marcos.length : 1;

                formMarco.reset();
                const activoInput = document.getElementById("marcoActivo");
                if (activoInput) activoInput.checked = true;
                setFormMarcoVisible(false);
                mostrarMensajeMarco(totalGuardados > 1
                    ? `${totalGuardados} marcos guardados correctamente`
                    : "Marco guardado correctamente");
                await cargarMarcosAdmin();
            } catch (error) {
                console.error("Error guardando marco:", error);
                mostrarMensajeMarco(error.message, false);
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
                mostrarMensajeTamano("Datos invÃ¡lidos para ediciÃ³n", false);
                return;
            }

            try {
                const res = await fetch(`/api/admin/tamanos/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nombre, precio_base: precio })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "No se pudo editar el tamaÃ±o");

                mostrarMensajeTamano("TamaÃ±o actualizado correctamente");
                cerrarModalEditarTamano();
                await cargarTamanosAdmin();
            } catch (error) {
                console.error("Error editando tamaÃ±o:", error);
                mostrarMensajeTamano(error.message, false);
            }
        });
    }

    await cargarTamanosAdmin();
    await cargarMarcosAdmin();
    setFormMarcoVisible(false);
    initOpcionesAccordion();
    setAdminMainView("dashboard");
    iniciarSincronizacionClientes();
});

// â”€â”€â”€ Exponer funciones al scope global (usadas en onclick del HTML) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
window.cambiarEstadoMarco = cambiarEstadoMarco;

// â”€â”€â”€ Chart.js: Pedidos Ãºltimos 7 dÃ­as (tiempo real) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let pedidosChart = null;

async function cargarGraficoPedidos() {
    try {
        const res = await fetch('/api/pedidos-semana');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        console.error('Error cargando grÃ¡fico:', err);
    }
}

// Cargar al inicio y actualizar cada 30 segundos
document.addEventListener('DOMContentLoaded', function() {
    cargarGraficoPedidos();
    setInterval(cargarGraficoPedidos, 30000);
});

// â”€â”€â”€ EstadÃ­sticas en tiempo real â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function cargarEstadisticas() {
    try {
        const res = await fetch('/api/estadisticas');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();

        const fmt = n => n.toLocaleString('es-MX');

        document.getElementById('statPedidosHoy').textContent = fmt(d.pedidos_hoy);
        const flecha = d.cambio_pct >= 0 ? 'â†‘' : 'â†“';
        const elCambioPct = document.getElementById('statCambioPct');
        if (elCambioPct) { elCambioPct.textContent = `${flecha} ${Math.abs(d.cambio_pct)}% vs ayer`; elCambioPct.removeAttribute('aria-busy'); }

        document.getElementById('statTotalFotos').textContent = fmt(d.total_fotos);
        actualizarBadgeImagenes(d.total_fotos);
        document.getElementById('statFotosSemana').textContent = `â†‘ ${fmt(d.fotos_semana)} esta semana`;

        document.getElementById('statClientesActivos').textContent = fmt(d.clientes_activos);
        const elNuevosHoy = document.getElementById('statNuevosHoy');
        if (elNuevosHoy) { elNuevosHoy.textContent = `${d.nuevos_hoy} nuevo${d.nuevos_hoy !== 1 ? 's' : ''} hoy`; elNuevosHoy.removeAttribute('aria-busy'); }

        document.getElementById('statPendientes').textContent = fmt(d.pendientes);
        const _elFotosSemana = document.getElementById('statFotosSemana');
        if (_elFotosSemana) _elFotosSemana.removeAttribute('aria-busy');
        const _elPendSub = document.getElementById('statPendientesSub');
        if (_elPendSub) { _elPendSub.removeAttribute('aria-busy'); _elPendSub.textContent = d.pendientes > 0 ? 'Requieren atención' : 'Al día'; }
    } catch (err) {
        console.error('Error cargando estadÃ­sticas:', err);
        const ids = ["statPedidosHoy", "statTotalFotos", "statClientesActivos", "statPendientes"];
        ids.forEach(function(id) {
            const el = document.getElementById(id);
            if (el) el.textContent = "—";
        });
        const subIds = ["statCambioPct", "statFotosSemana", "statNuevosHoy", "statPendientesSub"];
        subIds.forEach(function(id) {
            const el = document.getElementById(id);
            if (el) { el.textContent = "No disponible"; el.removeAttribute('aria-busy'); }
        });
        announceAdminAlert("No se pudieron cargar las estadisticas del dashboard");
    }
}

// â”€â”€â”€ Cargar stats de almacenamiento Cloudinary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function cargarCloudinaryStats() {
    try {
        const res = await fetch('/api/cloudinary-stats');
        const stats = await res.json();
        const barraEl = document.getElementById('cloudinaryStorageBar');
        const textEl = document.getElementById('cloudinaryStorageText');
        const valueEl = document.getElementById('cloudinaryStorageValue');
        
        if (!res.ok) {
            console.error('Error en API cloudinary-stats:', stats.error);
            if (barraEl) barraEl.style.width = '0%';
            if (valueEl) valueEl.textContent = '—';
            if (textEl) textEl.textContent = 'No disponible';
            announceAdminAlert('No se pudo cargar el uso de almacenamiento');
            return;
        }

        const storageUsedBytes = Number(stats.storage_used_bytes);
        const storageLimitBytes = Number(stats.storage_limit_bytes);
        const hasStorageUsage = Number.isFinite(storageUsedBytes) && storageUsedBytes >= 0;
        const hasStorageLimit = Number.isFinite(storageLimitBytes) && storageLimitBytes > 0;

        const bytesToGb = (bytes) => bytes / (1024 * 1024 * 1024);
        const fmtNum = (n, d = 1) => Number(n).toLocaleString('es-MX', {
            minimumFractionDigits: d,
            maximumFractionDigits: d
        });

        let porcentaje = 0;
        let valueText = 'â€”';
        let detailsText = 'Sin datos de uso disponibles.';

        if (hasStorageUsage) {
            const usadoGb = bytesToGb(storageUsedBytes);
            const limiteGb = hasStorageLimit ? bytesToGb(storageLimitBytes) : 0;
            porcentaje = hasStorageLimit ? Math.min(100, (storageUsedBytes / storageLimitBytes) * 100) : 0;
            valueText = hasStorageLimit ? `${porcentaje.toFixed(1)}%` : `${fmtNum(usadoGb, 2)} GB`;
            detailsText = hasStorageLimit
                ? `${fmtNum(usadoGb, 2)} GB / ${fmtNum(limiteGb, 2)} GB (${porcentaje.toFixed(1)}%)`
                : `${fmtNum(usadoGb, 2)} GB usados (Cloudinary no reporta limite)`;
        } else {
            // Fallback: Cloudinary no devolvio almacenamiento real; usamos transformaciones.
            const usado = Number(stats.transformation_count || 0);
            const limite = Number(stats.transformation_count_limit || 1000);
            porcentaje = limite > 0 ? Math.min(100, (usado / limite) * 100) : 0;
            valueText = `${porcentaje.toFixed(1)}%`;
            detailsText = `${usado.toLocaleString('es-MX')} / ${limite.toLocaleString('es-MX')} transformaciones (${porcentaje.toFixed(1)}%)`;
        }
        
        if (barraEl) {
            barraEl.style.width = porcentaje + '%';
            if (porcentaje >= 80) {
                barraEl.style.background = 'linear-gradient(90deg, #ff7a7a, #ff5555)'; // Rojo
            } else if (porcentaje >= 50) {
                barraEl.style.background = 'linear-gradient(90deg, var(--warning), #ff9500)'; // Naranja
            } else {
                barraEl.style.background = 'linear-gradient(90deg, var(--accent2), var(--accent))'; // Verde
            }
        }
        
        if (textEl) {
            textEl.textContent = detailsText;
            textEl.removeAttribute('aria-busy');
            textEl.setAttribute('aria-label', hasStorageUsage
                ? 'Almacenamiento usado sobre límite del plan en Cloudinary'
                : 'Cloudinary no devuelve almacenamiento; se muestra proxy de transformaciones');
        }

        if (valueEl) {
            valueEl.textContent = valueText;
        }
    } catch (err) {
        console.error('Error cargando stats de Cloudinary:', err);
        const barraEl = document.getElementById('cloudinaryStorageBar');
        const textEl = document.getElementById('cloudinaryStorageText');
        const valueEl = document.getElementById('cloudinaryStorageValue');
        if (barraEl) barraEl.style.width = '0%';
        if (valueEl) valueEl.textContent = '—';
        if (textEl) { textEl.textContent = 'No disponible'; textEl.removeAttribute('aria-busy'); }
        announceAdminAlert('No se pudo cargar el uso de almacenamiento');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    cargarEstadisticas();
    cargarCloudinaryStats();
    setInterval(cargarEstadisticas, 30000);
    setInterval(cargarCloudinaryStats, 60000);
});

// â”€â”€â”€ Ãšltimas subidas (tiempo real) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function tiempoRelativo(fechaStr) {
    try {
        // Manejar formato ISO (YYYY-MM-DDTHH:MM:SS) o formato personalizado (DD/MM/YYYY, HH:MM:SS)
        let fecha;
        if (fechaStr.includes('T') || fechaStr.includes('-')) {
            // Formato ISO
            fecha = new Date(fechaStr);
        } else if (fechaStr.includes('/')) {
            // Formato personalizado DD/MM/YYYY, HH:MM:SS
            const partes = fechaStr.split(',');
            const [d, m, y] = partes[0].trim().split('/');
            const hora = partes[1] ? partes[1].trim() : '00:00:00';
            fecha = new Date(+y, +m - 1, +d, ...hora.split(':').map(Number));
        } else {
            return fechaStr;
        }
        
        if (isNaN(fecha.getTime())) return fechaStr;
        
        const diff = Date.now() - fecha.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'ahora';
        if (mins < 60) return `hace ${mins} min`;
        const horas = Math.floor(mins / 60);
        if (horas < 24) return `hace ${horas}h`;
        const dias = Math.floor(horas / 24);
        return `hace ${dias} dia${dias > 1 ? 's' : ''}`;
    } catch {
        return fechaStr;
    }
}

const iconos = ['&#128247;', '&#127748;', '&#127909;', '&#128444;', '&#128248;'];

async function cargarUltimasSubidas() {
    try {
        const res = await fetch('/api/ultimas-subidas');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const subidas = await res.json();
        const container = document.getElementById('uploadList');
        if (!container) return;

        const ultimosClientes = Array.isArray(subidas) ? subidas.slice(0, 5) : [];

        if (ultimosClientes.length === 0) {
            container.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:13px">Sin subidas recientes</p>';
            return;
        }

        container.innerHTML = '';
        ultimosClientes.forEach(function(s, i) {
            const icono = iconos[i % iconos.length];
            const fotosCliente = Array.isArray(s.fotos) ? s.fotos : [];
            const thumbHtml = s.thumbnail
                ? `<img src="${s.thumbnail}" alt="Miniatura de ${s.cliente}" class="upload-thumb-img" loading="lazy">`
                : icono;
            const div = document.createElement('div');
            div.className = 'upload-item';
            const nf = Number(s.numFotos || 0);
            const tc = Number(s.totalCopias != null ? s.totalCopias : nf);
            const subidasExtra = nf > 0 && tc > nf;
            const uploadTitle = subidasExtra
                ? `${nf} foto${nf > 1 ? 's' : ''} \u00b7 ${tc} copia${tc > 1 ? 's' : ''}`
                : `${nf} foto${nf > 1 ? 's' : ''}`;
            div.innerHTML = `
                <div class="upload-thumb">${thumbHtml}</div>
                <div class="upload-info">
                    <div class="upload-name">${uploadTitle}</div>
                    <div class="upload-meta">${s.cliente} - ${tiempoRelativo(s.fecha)}</div>
                </div>
            `;
            div.style.cursor = 'pointer';
            div.setAttribute('tabindex', '0');
            div.setAttribute('role', 'button');
            div.setAttribute('aria-label', `Ver fotos de ${s.cliente}`);
            div.onclick = function() {
                abrirCarruselCliente(s.cliente, fotosCliente, 0, {
                    numArchivos: s.numFotos,
                    totalCopias: Number(s.totalCopias || s.numFotos || 0),
                });
            };
            div.onkeydown = function(evt) {
                if (evt.key === 'Enter' || evt.key === ' ') {
                    evt.preventDefault();
                    abrirCarruselCliente(s.cliente, fotosCliente, 0, {
                        numArchivos: s.numFotos,
                        totalCopias: Number(s.totalCopias || s.numFotos || 0),
                    });
                }
            };
            container.appendChild(div);
        });
    } catch (err) {
        console.error('Error cargando subidas:', err);
        const container = document.getElementById('uploadList');
        if (container) {
            container.innerHTML = '<p style="color:var(--muted);text-align:center;font-size:13px">No se pudieron cargar las ultimas subidas</p>';
        }
        announceAdminAlert('No se pudieron cargar las ultimas subidas');
    }
}

// Cargar al inicio y actualizar cada 30 segundos
document.addEventListener('DOMContentLoaded', function() {
    cargarUltimasSubidas();
    setInterval(cargarUltimasSubidas, 30000);
});

// Actualizar grÃ¡fico y subidas cuando llega un nuevo pedido por BroadcastChannel
clienteChannel.addEventListener('message', function(event) {
    if (event.data?.tipo === 'nuevo_cliente') {
        cargarGraficoPedidos();
        cargarUltimasSubidas();
        cargarEstadisticas();
        cargarCloudinaryStats(); // Actualizar almacenamiento cuando se suben nuevas fotos
    }
    else if (event.data?.tipo === 'estado_actualizado') {
        // Actualizar cuando cajero marca como pagado y cambia estado a 'procesando'
        const clienteId = event.data.clienteId;
        const nuevoEstado = normalizarEstadoPedido(event.data.nuevoEstado);
        const row = document.querySelector(`tr[data-id="${clienteId}"]`);
        if (row) {
            const estadoActual = normalizarEstadoPedido(row.dataset.estado);
            const statusBadge = row.querySelector('.status');
            if (statusBadge && nuevoEstado !== estadoActual) {
                const nuevoEstadoLabel = etiquetaEstadoPedido(nuevoEstado);
                statusBadge.textContent = nuevoEstadoLabel;
                statusBadge.className = `status ${claseEstadoPedido(nuevoEstado)}`;
                row.dataset.estado = nuevoEstado;
                announceAdminStatus(`Estado actualizado a ${nuevoEstadoLabel.toLowerCase()}`);
                
                // Actualizar badge si cambiÃ³ de pendiente a otro estado
                if (estadoActual === 'pendiente' && nuevoEstado !== 'pendiente') {
                    actualizarBadge(-1);
                }
            }
        }
        cargarGraficoPedidos();
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


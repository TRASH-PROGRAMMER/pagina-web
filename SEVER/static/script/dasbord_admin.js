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
let storageConfigAdmin = null;
let storageImagesAdmin = [];
let storageImagesCurrentPage = 1;
let storageImagesTotalPages = 1;
const STORAGE_IMAGES_PAGE_SIZE = 10;
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
let storageSearchDebounceTimer = null;
const liveMessageState = { status: "", alert: "" };
let isTodayOrdersMode = false;
let activeOrdersFilterMode = "all";
let hasCustomOrdersFilters = false;
let todayOrdersMidnightTimerId = null;
const ORDER_AGE_NOTIFICATION_STORAGE_KEY = "admin_order_age_notifications_v1";
const ADMIN_KPI_STORAGE_KEY = "admin_kpi_metrics_v1";
const ADMIN_KPI_TARGET_TASK_MS = 2 * 60 * 1000;
const ADMIN_KPI_TARGET_ERROR_RATE = 5;
const ADMIN_KPI_TARGET_SATISFACTION = 4;
let orderAgeSnapshotById = new Map();
let orderAgeNotificationCache = loadOrderAgeNotificationCache();
let adminKpiState = loadAdminKpiState();

function createDefaultAdminKpiState() {
    return {
        tasksCompleted: 0,
        tasksUnder2m: 0,
        taskDurationTotalMs: 0,
        operationsTotal: 0,
        operationsError: 0,
        ratingsCount: 0,
        ratingsTotal: 0,
        updatedAt: null,
    };
}

function sanitizeAdminKpiState(rawState) {
    const defaults = createDefaultAdminKpiState();
    const merged = Object.assign({}, defaults, rawState || {});

    function toSafeNumber(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return 0;
        return parsed;
    }

    merged.tasksCompleted = Math.trunc(toSafeNumber(merged.tasksCompleted));
    merged.tasksUnder2m = Math.min(merged.tasksCompleted, Math.trunc(toSafeNumber(merged.tasksUnder2m)));
    merged.taskDurationTotalMs = toSafeNumber(merged.taskDurationTotalMs);
    merged.operationsTotal = Math.trunc(toSafeNumber(merged.operationsTotal));
    merged.operationsError = Math.min(merged.operationsTotal, Math.trunc(toSafeNumber(merged.operationsError)));
    merged.ratingsCount = Math.trunc(toSafeNumber(merged.ratingsCount));
    merged.ratingsTotal = toSafeNumber(merged.ratingsTotal);
    merged.updatedAt = merged.updatedAt ? String(merged.updatedAt) : null;

    return merged;
}

function loadAdminKpiState() {
    try {
        const raw = window.localStorage.getItem(ADMIN_KPI_STORAGE_KEY);
        if (!raw) return createDefaultAdminKpiState();
        const parsed = JSON.parse(raw);
        return sanitizeAdminKpiState(parsed);
    } catch (_error) {
        return createDefaultAdminKpiState();
    }
}

function persistAdminKpiState() {
    try {
        window.localStorage.setItem(ADMIN_KPI_STORAGE_KEY, JSON.stringify(adminKpiState));
    } catch (_error) {
        // Ignorar storage bloqueado.
    }
}

function formatAdminKpiDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return "—";
    if (value < 1000) return `${Math.round(value)}ms`;
    if (value < 60000) return `${(value / 1000).toFixed(1)}s`;
    return `${(value / 60000).toFixed(2)}min`;
}

function adminKpiPercent(part, total) {
    const p = Number(part);
    const t = Number(total);
    if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return null;
    return (p / t) * 100;
}

function setAdminKpiChipValue(elementId, text, tone) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("kpi-pass", "kpi-fail", "kpi-neutral");
    el.classList.add(tone || "kpi-neutral");
}

function renderAdminKpiSummary() {
    const tasksCompleted = Number(adminKpiState.tasksCompleted || 0);
    const taskDurationTotalMs = Number(adminKpiState.taskDurationTotalMs || 0);
    const avgTaskMs = tasksCompleted > 0 ? (taskDurationTotalMs / tasksCompleted) : null;
    const tasksUnder2m = Number(adminKpiState.tasksUnder2m || 0);
    const under2mRate = adminKpiPercent(tasksUnder2m, tasksCompleted);

    if (avgTaskMs == null) {
        setAdminKpiChipValue("kpiTaskTimeValue", "Tiempo <2m: —", "kpi-neutral");
    } else {
        const passTaskTime = avgTaskMs < ADMIN_KPI_TARGET_TASK_MS;
        const rateText = under2mRate == null ? "—" : `${under2mRate.toFixed(0)}%`;
        setAdminKpiChipValue(
            "kpiTaskTimeValue",
            `Tiempo <2m: ${formatAdminKpiDuration(avgTaskMs)} (${rateText})`,
            passTaskTime ? "kpi-pass" : "kpi-fail"
        );
    }

    const operationsTotal = Number(adminKpiState.operationsTotal || 0);
    const operationsError = Number(adminKpiState.operationsError || 0);
    const errorRate = adminKpiPercent(operationsError, operationsTotal);
    if (errorRate == null) {
        setAdminKpiChipValue("kpiErrorRateValue", "Tasa error <5%: —", "kpi-neutral");
    } else {
        const passErrorRate = errorRate < ADMIN_KPI_TARGET_ERROR_RATE;
        setAdminKpiChipValue(
            "kpiErrorRateValue",
            `Tasa error <5%: ${errorRate.toFixed(1)}%`,
            passErrorRate ? "kpi-pass" : "kpi-fail"
        );
    }

    const ratingsCount = Number(adminKpiState.ratingsCount || 0);
    const ratingsTotal = Number(adminKpiState.ratingsTotal || 0);
    const satAvg = ratingsCount > 0 ? (ratingsTotal / ratingsCount) : null;
    if (satAvg == null) {
        setAdminKpiChipValue("kpiSatisfactionValue", "Satisfacción >=4/5: —", "kpi-neutral");
    } else {
        const passSatisfaction = satAvg >= ADMIN_KPI_TARGET_SATISFACTION;
        setAdminKpiChipValue(
            "kpiSatisfactionValue",
            `Satisfacción >=4/5: ${satAvg.toFixed(1)}/5`,
            passSatisfaction ? "kpi-pass" : "kpi-fail"
        );
    }
}

function recordAdminKpiOperation(durationMs, ok) {
    adminKpiState.operationsTotal = Number(adminKpiState.operationsTotal || 0) + 1;
    if (!ok) {
        adminKpiState.operationsError = Number(adminKpiState.operationsError || 0) + 1;
    } else {
        const duration = Math.max(0, Number(durationMs) || 0);
        adminKpiState.tasksCompleted = Number(adminKpiState.tasksCompleted || 0) + 1;
        adminKpiState.taskDurationTotalMs = Number(adminKpiState.taskDurationTotalMs || 0) + duration;
        if (duration < ADMIN_KPI_TARGET_TASK_MS) {
            adminKpiState.tasksUnder2m = Number(adminKpiState.tasksUnder2m || 0) + 1;
        }
    }

    adminKpiState.updatedAt = new Date().toISOString();
    adminKpiState = sanitizeAdminKpiState(adminKpiState);
    persistAdminKpiState();
    renderAdminKpiSummary();
}

function isTrackedAdminMutation(url, method) {
    const m = String(method || "GET").toUpperCase();
    if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
    const urlText = String(url || "");
    return /\/api\//.test(urlText);
}

function extractFetchMeta(resource, init) {
    let url = "";
    let method = "GET";

    if (typeof resource === "string") {
        url = resource;
    } else if (resource && typeof resource.url === "string") {
        url = resource.url;
    }

    if (init && init.method) {
        method = String(init.method);
    } else if (resource && resource.method) {
        method = String(resource.method);
    }

    return {
        url,
        method: method.toUpperCase(),
    };
}

function installAdminKpiFetchInstrumentation() {
    if (window.__adminKpiFetchInstrumented) return;
    if (typeof window.fetch !== "function") return;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = async function(resource, init) {
        const meta = extractFetchMeta(resource, init);
        const trackOperation = isTrackedAdminMutation(meta.url, meta.method);
        const startedAt = trackOperation ? performance.now() : 0;

        try {
            const response = await nativeFetch(resource, init);
            if (trackOperation) {
                const elapsed = Math.max(0, performance.now() - startedAt);
                recordAdminKpiOperation(elapsed, response.ok);
            }
            return response;
        } catch (error) {
            if (trackOperation) {
                const elapsed = Math.max(0, performance.now() - startedAt);
                recordAdminKpiOperation(elapsed, false);
            }
            throw error;
        }
    };

    window.__adminKpiFetchInstrumented = true;
}

function recordAdminKpiSatisfaction(score) {
    const value = Math.trunc(Number(score));
    if (!Number.isFinite(value) || value < 1 || value > 5) return;

    adminKpiState.ratingsCount = Number(adminKpiState.ratingsCount || 0) + 1;
    adminKpiState.ratingsTotal = Number(adminKpiState.ratingsTotal || 0) + value;
    adminKpiState.updatedAt = new Date().toISOString();
    adminKpiState = sanitizeAdminKpiState(adminKpiState);
    persistAdminKpiState();
    renderAdminKpiSummary();
    announceAdminStatus(`Gracias por tu valoración de ${value}/5.`);
}

function initAdminKpiPanel() {
    renderAdminKpiSummary();

    const ratingBox = document.getElementById("adminKpiRating");
    if (!ratingBox) return;

    const buttons = ratingBox.querySelectorAll(".admin-kpi-rate-btn[data-kpi-rating]");
    buttons.forEach(function(btn) {
        btn.addEventListener("click", function() {
            const score = btn.getAttribute("data-kpi-rating");
            recordAdminKpiSatisfaction(score);
        });
    });
}

function setOrdersFilterMode(mode) {
    const normalized = String(mode || "").toLowerCase() === "today" ? "today" : "all";
    activeOrdersFilterMode = normalized;
    isTodayOrdersMode = normalized === "today";
}

function getOrdersFilterContextText() {
    if (activeOrdersFilterMode === "today") {
        return "Viendo: Pedidos de hoy";
    }
    if (hasCustomOrdersFilters) {
        return "Viendo: Pedidos filtrados";
    }
    return "Viendo: Todos los pedidos";
}

function getOrdersFilterContextType() {
    if (activeOrdersFilterMode === "today") return "today";
    if (hasCustomOrdersFilters) return "filtered";
    return "all";
}

function updateOrdersFilterContextState(context) {
    const normalized = String(context || "").toLowerCase();
    hasCustomOrdersFilters = normalized === "filtered";
    syncTodayOrdersUIState();
}

function resetOrdersFilterContextState() {
    updateOrdersFilterContextState("all");
}

function updateOrdersFilterContextByActiveFilters(filterSnapshot) {
    if (activeOrdersFilterMode === "today") {
        updateOrdersFilterContextState("today");
        return;
    }

    const snapshot = filterSnapshot || {};
    const hasSearch = !!String(snapshot.searchValue || "").trim();
    const hasFecha = !!String(snapshot.fechaFiltro || "").trim();
    const hasEstado = !!String(snapshot.estadoFiltro || "").trim();
    const hasImagenes = !!String(snapshot.imagenesFiltro || "").trim();
    const hasPrecioMin = snapshot.precioMin != null;
    const hasPrecioMax = snapshot.precioMax != null;
    const hasAlpha = String(currentAlphaRange || "todos") !== "todos";

    if (hasSearch || hasFecha || hasEstado || hasImagenes || hasPrecioMin || hasPrecioMax || hasAlpha) {
        updateOrdersFilterContextState("filtered");
        return;
    }

    resetOrdersFilterContextState();
}

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

function loadOrderAgeNotificationCache() {
    try {
        const raw = window.sessionStorage.getItem(ORDER_AGE_NOTIFICATION_STORAGE_KEY);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map(function(item) {
            return String(item || "");
        }).filter(Boolean));
    } catch (_error) {
        return new Set();
    }
}

function persistOrderAgeNotificationCache() {
    try {
        window.sessionStorage.setItem(
            ORDER_AGE_NOTIFICATION_STORAGE_KEY,
            JSON.stringify(Array.from(orderAgeNotificationCache.values()))
        );
    } catch (_error) {
        // Ignorar storage bloqueado.
    }
}

function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function parseFechaRegistroAdmin(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const isoCandidate = /^\d{4}-\d{2}-\d{2}/.test(raw) || raw.includes("T")
        ? new Date(raw)
        : null;
    if (isoCandidate && !Number.isNaN(isoCandidate.getTime())) {
        return isoCandidate;
    }

    const isoDate = toISODate(raw);
    if (isoDate) {
        const fromIsoDate = new Date(`${isoDate}T00:00:00`);
        if (!Number.isNaN(fromIsoDate.getTime())) return fromIsoDate;
    }

    const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
        const d = new Date(year, month - 1, day);
        if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
}

function formatAgeDuration(ageDays) {
    const days = Math.max(0, Number(ageDays) || 0);
    if (days >= 365) {
        const years = Math.floor(days / 365);
        const restDays = days % 365;
        const months = Math.floor(restDays / 30);
        if (months > 0) {
            return `${years} ano${years !== 1 ? "s" : ""} ${months} mes${months !== 1 ? "es" : ""}`;
        }
        return `${years} ano${years !== 1 ? "s" : ""}`;
    }
    if (days >= 30) {
        const months = Math.floor(days / 30);
        return `${months} mes${months !== 1 ? "es" : ""}`;
    }
    return `${days} dia${days !== 1 ? "s" : ""}`;
}

function orderAgeContextForState(estado, ageDays) {
    const estadoNorm = normalizarEstadoPedido(estado);
    if (estadoNorm === "cancelado") return "archivado";
    if (estadoNorm === "entregado" && ageDays >= 365) return "archivado";
    if (estadoNorm === "entregado") return "entregado";
    return "activo";
}

function orderAgeMessage(ageDays, context) {
    const passed1Year = ageDays >= 365;
    const passed1Month = ageDays >= 30;

    if (passed1Year) {
        if (context === "activo") return "Tu pedido tiene mas de 1 ano. Sigue activo y requiere seguimiento.";
        if (context === "entregado") return "Tu pedido tiene mas de 1 ano. Ya fue entregado.";
        return "Tu pedido tiene mas de 1 ano. Se considera archivado en historial.";
    }

    if (passed1Month) {
        if (context === "activo") return "Tu pedido tiene mas de 1 mes. Sigue en flujo activo.";
        if (context === "entregado") return "Tu pedido tiene mas de 1 mes. Ya fue entregado.";
        return "Tu pedido tiene mas de 1 mes. Figura como archivado en historial.";
    }

    return "Pedido reciente. Aun no alcanza hitos de antiguedad.";
}

function buildOrderAgeRecords(clientes) {
    const nowMs = Date.now();
    const records = [];
    const nextSnapshot = new Map();

    (Array.isArray(clientes) ? clientes : []).forEach(function(cliente) {
        const id = Number(cliente && cliente.id);
        if (!Number.isFinite(id) || id <= 0) return;

        const edadBackend = (cliente && typeof cliente.antiguedad === "object" && cliente.antiguedad)
            ? cliente.antiguedad
            : null;
        const backendAgeDays = Number(edadBackend && edadBackend.ageDays);

        let ageDays = null;
        let passed1Month = false;
        let passed1Year = false;
        let context = "activo";
        let message = "";
        let ageDuration = "";
        let milestone = "";

        if (Number.isFinite(backendAgeDays) && backendAgeDays >= 0) {
            ageDays = Math.floor(backendAgeDays);
            passed1Month = Boolean(edadBackend && edadBackend.passed1Month);
            passed1Year = Boolean(edadBackend && edadBackend.passed1Year);
            context = String(edadBackend && edadBackend.contextoEstado || "activo");
            message = String(edadBackend && edadBackend.mensaje || "");
            ageDuration = String(edadBackend && edadBackend.etiqueta || "");
            milestone = (edadBackend && (edadBackend.hitoActual === "1m" || edadBackend.hitoActual === "1y"))
                ? edadBackend.hitoActual
                : (passed1Year ? "1y" : (passed1Month ? "1m" : ""));
        } else {
            const parsedDate = parseFechaRegistroAdmin(cliente && cliente.fechaRegistro);
            if (!parsedDate) return;

            ageDays = Math.max(0, Math.floor((nowMs - parsedDate.getTime()) / 86400000));
            passed1Month = ageDays >= 30;
            passed1Year = ageDays >= 365;
            context = orderAgeContextForState(cliente && cliente.estado, ageDays);
            message = orderAgeMessage(ageDays, context);
            ageDuration = formatAgeDuration(ageDays);
            milestone = passed1Year ? "1y" : (passed1Month ? "1m" : "");
        }

        const estadoNorm = normalizarEstadoPedido(cliente && cliente.estado);
        const estadoLabel = etiquetaEstadoPedido(estadoNorm);

        records.push({
            id,
            idPadded: String(id).padStart(4, "0"),
            nombre: `${String(cliente && cliente.nombre || "").trim()} ${String(cliente && cliente.apellido || "").trim()}`.trim() || "Cliente",
            estadoLabel,
            fechaRegistro: String(cliente && cliente.fechaRegistro || "-"),
            ageDays,
            ageDuration: ageDuration || formatAgeDuration(ageDays),
            passed1Month,
            passed1Year,
            milestone,
            context,
            message: message || orderAgeMessage(ageDays, context),
        });

        nextSnapshot.set(String(id), {
            passed1Month,
            passed1Year,
            ageDays,
        });
    });

    records.sort(function(a, b) {
        return b.ageDays - a.ageDays;
    });

    return {
        records,
        nextSnapshot,
    };
}

function notifyOrderAgeMilestones(events) {
    const list = Array.isArray(events) ? events : [];
    if (!list.length) return;

    const nuevos = [];
    list.forEach(function(ev) {
        const cacheKey = `${ev.id}:${ev.milestone}`;
        if (orderAgeNotificationCache.has(cacheKey)) return;
        orderAgeNotificationCache.add(cacheKey);
        nuevos.push(ev);
    });

    if (!nuevos.length) return;
    persistOrderAgeNotificationCache();

    const maxNotify = 2;
    nuevos.slice(0, maxNotify).forEach(function(ev) {
        const milestoneLabel = ev.milestone === "1y" ? "1 ano" : "1 mes";
        announceAdminStatus(`Pedido #${String(ev.id).padStart(4, "0")} alcanzo ${milestoneLabel} de antiguedad.`);
        notifyDesktopAdmin("milestone_reached", {
            order_id: ev.id,
            milestone: ev.milestone,
            context: ev.context,
        }, `milestone-${ev.id}-${ev.milestone}`);
    });

    if (nuevos.length > maxNotify) {
        announceAdminStatus(`Se detectaron ${nuevos.length} hitos de antiguedad.`);
    }
}

function renderOrderAgeMilestones(clientes, options = {}) {
    const panel = document.getElementById("orderAgePanel");
    if (!panel) return;

    const countMonthEl = document.getElementById("orderAgeCountMonth");
    const countYearEl = document.getElementById("orderAgeCountYear");
    const countActiveEl = document.getElementById("orderAgeCountActiveMilestones");
    const oldestEl = document.getElementById("orderAgeOldest");
    const subtitleEl = document.getElementById("orderAgeSubtitle");
    const listEl = document.getElementById("orderAgeList");

    const detectTransitions = !!options.detectTransitions;
    const previousSnapshot = orderAgeSnapshotById;

    const result = buildOrderAgeRecords(clientes);
    const records = result.records;
    orderAgeSnapshotById = result.nextSnapshot;

    const withMonth = records.filter(function(r) { return r.passed1Month; });
    const withYear = records.filter(function(r) { return r.passed1Year; });
    const activeWithMilestone = records.filter(function(r) {
        return r.context === "activo" && !!r.milestone;
    });
    const oldest = records[0] || null;

    if (countMonthEl) countMonthEl.textContent = String(withMonth.length);
    if (countYearEl) countYearEl.textContent = String(withYear.length);
    if (countActiveEl) countActiveEl.textContent = String(activeWithMilestone.length);
    if (oldestEl) oldestEl.textContent = oldest ? oldest.ageDuration : "—";

    if (subtitleEl) {
        subtitleEl.textContent = withMonth.length
            ? `Se detectaron ${withMonth.length} pedido(s) con 1 mes o mas y ${withYear.length} con 1 ano o mas.`
            : "No hay pedidos que hayan alcanzado hitos de 1 mes o 1 ano.";
    }

    if (listEl) {
        const toRender = records.filter(function(r) { return !!r.milestone; }).slice(0, 8);
        if (!toRender.length) {
            listEl.innerHTML = '<li class="order-age-empty">Aun no hay pedidos con hitos de antiguedad.</li>';
        } else {
            listEl.innerHTML = toRender.map(function(r) {
                const milestoneLabel = r.milestone === "1y" ? "1 ano" : "1 mes";
                const contextLabel = r.context === "activo"
                    ? "Activo"
                    : (r.context === "entregado" ? "Entregado" : "Archivado");
                return `
                    <li class="order-age-item">
                        <div class="order-age-item__top">
                            <div>
                                <div class="order-age-item__title">Pedido #${escapeHtml(r.idPadded)} - ${escapeHtml(r.nombre)}</div>
                                <div class="order-age-item__meta">Estado: ${escapeHtml(r.estadoLabel)}</div>
                            </div>
                            <div class="order-age-item__chips">
                                <span class="order-age-chip order-age-chip--${escapeHtml(r.milestone)}">${escapeHtml(milestoneLabel)}</span>
                                <span class="order-age-chip order-age-chip--${escapeHtml(r.context)}">${escapeHtml(contextLabel)}</span>
                            </div>
                        </div>
                        <p class="order-age-item__message">${escapeHtml(r.message)}</p>
                        <p class="order-age-item__foot">Fecha: ${escapeHtml(r.fechaRegistro)} · Antiguedad: ${escapeHtml(r.ageDuration)}</p>
                    </li>
                `;
            }).join("");
        }
    }

    if (detectTransitions) {
        const events = [];
        records.forEach(function(r) {
            const prev = previousSnapshot.get(String(r.id));
            if (!prev) return;
            if (!prev.passed1Month && r.passed1Month) {
                events.push({ id: r.id, milestone: "1m", context: r.context });
            }
            if (!prev.passed1Year && r.passed1Year) {
                events.push({ id: r.id, milestone: "1y", context: r.context });
            }
        });
        notifyOrderAgeMilestones(events);
    }
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
    const ordersSection = document.getElementById("ordersTableCard");
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
    } else if (view === "pedidos") {
        dashboardBlocks.forEach(function(el) { el.classList.add("dashboard-hidden"); });
        if (ordersSection) ordersSection.classList.remove("dashboard-hidden");
        if (clientesSection) clientesSection.hidden = true;
        if (opcionesSection) opcionesSection.hidden = true;
        if (title) title.innerHTML = "<span>Pedidos</span> / Tabla";
        setActiveNav("navPedidos");
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

function mostrarMensajeStorage(texto, ok = true) {
    const msg = document.getElementById("storageMensaje");
    if (!msg) return;
    msg.textContent = texto;
    msg.style.color = ok ? "#22c55e" : "#ff7a7a";
    if (ok) {
        announceAdminStatus(texto);
    } else {
        announceAdminAlert(texto);
    }
}

function toggleStorageCustomDaysField() {
    const modeEl = document.getElementById("storageRetentionMode");
    const daysEl = document.getElementById("storageRetentionDays");
    if (!modeEl || !daysEl) return;
    const isCustom = String(modeEl.value || "").toLowerCase() === "custom";
    daysEl.disabled = !isCustom;
    daysEl.setAttribute("aria-disabled", isCustom ? "false" : "true");
}

function formatStorageDate(isoDate) {
    if (!isoDate) return "-";
    const dt = new Date(isoDate);
    if (Number.isNaN(dt.getTime())) return "-";
    return dt.toLocaleString("es-MX", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatRemainingTime(seconds, status) {
    if (status === "excluded") return "Excluida";
    if (status === "without_expiration") return "Sin expiracion";
    const n = Number(seconds);
    if (!Number.isFinite(n)) return "-";
    if (n <= 0) return "Vencida";

    const dias = Math.floor(n / 86400);
    const horas = Math.floor((n % 86400) / 3600);
    const mins = Math.floor((n % 3600) / 60);
    if (dias > 0) return `${dias}d ${horas}h`;
    if (horas > 0) return `${horas}h ${mins}m`;
    return `${Math.max(1, mins)}m`;
}

function storageStatusLabel(status) {
    if (status === "excluded") return "Excluida";
    if (status === "expired") return "Vencida";
    if (status === "without_expiration") return "Sin expiracion";
    return "Activa";
}

function storageStatusClass(status) {
    if (status === "excluded") return "excluded";
    if (status === "expired") return "expired";
    if (status === "without_expiration") return "without-expiration";
    return "active";
}

function renderStorageSummary(resumen) {
    const r = resumen || {};
    const map = [
        ["storageSummaryTotal", r.totalImagenes],
        ["storageSummaryExpired", r.vencidas],
        ["storageSummaryExcluded", r.excluidas],
        ["storageSummaryNoExpire", r.sinExpiracion],
    ];

    map.forEach(function(entry) {
        const el = document.getElementById(entry[0]);
        if (!el) return;
        const val = Number(entry[1]);
        el.textContent = Number.isFinite(val) ? String(Math.max(0, Math.trunc(val))) : "-";
    });
}

function applyStorageConfigToForm(config) {
    const cfg = config || {};
    const modeEl = document.getElementById("storageRetentionMode");
    const daysEl = document.getElementById("storageRetentionDays");
    const cleanupEl = document.getElementById("storageCleanupMinutes");

    if (modeEl && cfg.retentionMode) {
        modeEl.value = cfg.retentionMode;
    }
    if (daysEl) {
        const days = Number(cfg.retentionDays);
        daysEl.value = Number.isFinite(days) && days > 0 ? String(Math.trunc(days)) : "30";
    }
    if (cleanupEl) {
        const cleanup = Number(cfg.cleanupIntervalMinutes);
        if (Number.isFinite(cleanup) && cleanup > 0) {
            const currentOption = Array.from(cleanupEl.options).find(function(opt) {
                return Number(opt.value) === Math.trunc(cleanup);
            });
            if (!currentOption) {
                const opt = document.createElement("option");
                opt.value = String(Math.trunc(cleanup));
                opt.textContent = `Cada ${Math.trunc(cleanup)} minutos`;
                cleanupEl.appendChild(opt);
            }
            cleanupEl.value = String(Math.trunc(cleanup));
        }
    }

    toggleStorageCustomDaysField();
}

async function cargarStorageSettingsAdmin() {
    const form = document.getElementById("formStorageSettings");
    if (!form) return;

    try {
        const res = await fetch("/api/admin/storage-settings", { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cargar la configuracion de almacenamiento");

        storageConfigAdmin = data.config || null;
        applyStorageConfigToForm(storageConfigAdmin || {});
        renderStorageSummary(data.resumen || {});
    } catch (error) {
        console.error("Error cargando configuracion de almacenamiento:", error);
        mostrarMensajeStorage(error.message || "No se pudo cargar la configuracion", false);
    }
}

function renderStorageImagesAdmin() {
    const tbody = document.getElementById("storageImagesBody");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (!Array.isArray(storageImagesAdmin) || storageImagesAdmin.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = '<td colspan="6" class="orders-table-empty">No hay imagenes para el filtro actual</td>';
        tbody.appendChild(tr);
        return;
    }

    storageImagesAdmin.forEach(function(item) {
        const tr = document.createElement("tr");
        const clienteNombre = String(item.clienteNombre || "-").trim() || "-";
        const clienteCorreo = String(item.clienteCorreo || "").trim();
        const status = String(item.status || "active");
        const statusLabel = storageStatusLabel(status);
        const statusClass = storageStatusClass(status);
        const exclusionButtonText = item.excludeAutoDelete ? "Permitir auto-eliminar" : "Excluir";

        tr.innerHTML = `
            <td><code style="color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">#${String(item.id || "-")}</code></td>
            <td>
                <div class="client-name">${clienteNombre}</div>
                <div class="client-email">${clienteCorreo || "-"}</div>
            </td>
            <td>${formatRemainingTime(item.remainingSeconds, status)}</td>
            <td>${formatStorageDate(item.expiresAt)}</td>
            <td><span class="storage-status-badge ${statusClass}">${statusLabel}</span></td>
            <td><button type="button" class="tamano-btn">${exclusionButtonText}</button></td>
        `;

        const btn = tr.querySelector("button.tamano-btn");
        if (btn) {
            btn.addEventListener("click", function() {
                cambiarExclusionImagen(item.id, !item.excludeAutoDelete);
            });
        }

        tbody.appendChild(tr);
    });
}

function renderStorageImagesPagination(total, page, totalPages) {
    const nav = document.getElementById("storageImagesPagination");
    if (!nav) return;

    const safeTotal = Number(total);
    const safePage = Math.max(1, Number(page) || 1);
    const safeTotalPages = Math.max(1, Number(totalPages) || 1);

    nav.innerHTML = "";
    if (!Number.isFinite(safeTotal) || safeTotal <= 0) {
        nav.hidden = true;
        return;
    }

    nav.hidden = false;

    const info = document.createElement("span");
    info.className = "orders-page-info";
    info.textContent = `${safeTotal} resultado${safeTotal === 1 ? "" : "s"} - Pagina ${safePage} de ${safeTotalPages}`;
    nav.appendChild(info);

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "orders-page-btn";
    prevBtn.textContent = "Anterior";
    prevBtn.disabled = safePage <= 1;
    prevBtn.addEventListener("click", function() {
        if (safePage > 1) {
            cargarStorageImagesAdmin(safePage - 1);
        }
    });
    nav.appendChild(prevBtn);

    const maxButtons = 7;
    let start = Math.max(1, safePage - Math.floor(maxButtons / 2));
    let end = Math.min(safeTotalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    for (let p = start; p <= end; p += 1) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "orders-page-btn";
        btn.textContent = String(p);
        if (p === safePage) {
            btn.classList.add("active");
            btn.setAttribute("aria-current", "page");
        }
        btn.addEventListener("click", function() {
            if (p !== safePage) {
                cargarStorageImagesAdmin(p);
            }
        });
        nav.appendChild(btn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "orders-page-btn";
    nextBtn.textContent = "Siguiente";
    nextBtn.disabled = safePage >= safeTotalPages;
    nextBtn.addEventListener("click", function() {
        if (safePage < safeTotalPages) {
            cargarStorageImagesAdmin(safePage + 1);
        }
    });
    nav.appendChild(nextBtn);
}

async function cargarStorageImagesAdmin(page = storageImagesCurrentPage) {
    const tbody = document.getElementById("storageImagesBody");
    if (!tbody) return;

    const q = (document.getElementById("storageImagesSearch")?.value || "").trim();
    const onlyExcluded = !!document.getElementById("storageOnlyExcluded")?.checked;
    const params = new URLSearchParams();
    const pageNumber = Math.max(1, Number(page) || 1);
    params.set("page", String(pageNumber));
    params.set("page_size", String(STORAGE_IMAGES_PAGE_SIZE));
    if (q) params.set("q", q);
    if (onlyExcluded) params.set("onlyExcluded", "true");

    try {
        const res = await fetch(`/api/admin/storage-images?${params.toString()}`, { cache: "no-store" });
        if (res.status === 401 || res.status === 403) {
            window.location.href = "/login";
            return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo cargar el listado de imagenes");

        storageImagesAdmin = Array.isArray(data.imagenes) ? data.imagenes : [];
        storageImagesCurrentPage = Math.max(1, Number(data.page) || 1);
        storageImagesTotalPages = Math.max(1, Number(data.totalPages) || 1);
        renderStorageImagesAdmin();
        renderStorageImagesPagination(Number(data.total || 0), storageImagesCurrentPage, storageImagesTotalPages);
        renderStorageSummary(data.resumen || {});
    } catch (error) {
        console.error("Error cargando imagenes de almacenamiento:", error);
        storageImagesAdmin = [];
        storageImagesCurrentPage = 1;
        storageImagesTotalPages = 1;
        renderStorageImagesAdmin();
        renderStorageImagesPagination(0, 1, 1);
        mostrarMensajeStorage(error.message || "No se pudo cargar el listado de imagenes", false);
    }
}

async function guardarStorageSettingsAdmin(event) {
    event.preventDefault();

    const modeEl = document.getElementById("storageRetentionMode");
    const daysEl = document.getElementById("storageRetentionDays");
    const cleanupEl = document.getElementById("storageCleanupMinutes");
    const applyExistingEl = document.getElementById("storageApplyExisting");

    if (!modeEl || !daysEl || !cleanupEl) return;

    const mode = String(modeEl.value || "").toLowerCase();
    let retentionDays = Number(daysEl.value || "0");
    if (mode !== "custom") {
        const presets = { "1d": 1, "7d": 7, "30d": 30 };
        retentionDays = Number(presets[mode] || 30);
    }

    const cleanupMinutes = Number(cleanupEl.value || "60");
    const applyExisting = !!applyExistingEl?.checked;

    if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
        mostrarMensajeStorage("Dias de retencion invalidos", false);
        return;
    }
    if (!Number.isFinite(cleanupMinutes) || cleanupMinutes < 5) {
        mostrarMensajeStorage("Frecuencia de limpieza invalida", false);
        return;
    }

    if (applyExisting) {
        const confirmed = await showAdminConfirmDialog({
            title: "Aplicar a imagenes existentes",
            message: "Se recalculara la expiracion de imagenes existentes no excluidas. Esta accion puede provocar eliminaciones automaticas antes de lo esperado.",
            cancelText: "Cancelar",
            acceptText: "Aplicar cambios",
            tone: "danger",
            focusConfirm: false
        });
        if (!confirmed) return;
    }

    try {
        const res = await fetch("/api/admin/storage-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                retention_mode: mode,
                retention_days: Math.trunc(retentionDays),
                cleanup_interval_minutes: Math.trunc(cleanupMinutes),
                apply_existing: applyExisting,
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo guardar la configuracion");

        if (applyExistingEl) applyExistingEl.checked = false;
        mostrarMensajeStorage(data.message || "Configuracion guardada correctamente", true);
        await cargarStorageSettingsAdmin();
        storageImagesCurrentPage = 1;
        await cargarStorageImagesAdmin(1);
    } catch (error) {
        console.error("Error guardando configuracion de almacenamiento:", error);
        mostrarMensajeStorage(error.message || "No se pudo guardar la configuracion", false);
    }
}

async function cambiarExclusionImagen(fotoId, excludeAutoDelete) {
    const id = Number(fotoId);
    if (!Number.isFinite(id) || id <= 0) return;

    const accion = excludeAutoDelete ? "excluir" : "volver a incluir";
    const confirmed = await showAdminConfirmDialog({
        title: "Actualizar exclusion",
        message: `Vas a ${accion} esta imagen del borrado automatico.`,
        cancelText: "Cancelar",
        acceptText: "Confirmar",
        tone: "danger",
        focusConfirm: false
    });
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/admin/storage-images/${id}/exclude`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ exclude_auto_delete: !!excludeAutoDelete })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo actualizar la exclusion");

        mostrarMensajeStorage(excludeAutoDelete
            ? "Imagen marcada como excluida"
            : "Imagen marcada para eliminacion automatica", true);
        await cargarStorageImagesAdmin(storageImagesCurrentPage);
        await cargarStorageSettingsAdmin();
    } catch (error) {
        console.error("Error actualizando exclusion:", error);
        mostrarMensajeStorage(error.message || "No se pudo actualizar la exclusion", false);
    }
}

async function ejecutarLimpiezaStorageManual() {
    const confirmed = await showAdminConfirmDialog({
        title: "Ejecutar limpieza ahora",
        message: "Se eliminaran de Cloudinary las imagenes vencidas no excluidas. Esta accion no se puede deshacer.",
        cancelText: "Cancelar",
        acceptText: "Ejecutar limpieza",
        tone: "danger",
        focusConfirm: false
    });
    if (!confirmed) return;

    try {
        const res = await fetch("/api/admin/storage-images/cleanup", { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "No se pudo ejecutar la limpieza");

        const eliminadas = Number(data.eliminadas || 0);
        const fallos = Number(data.fallos || 0);
        mostrarMensajeStorage(`Limpieza completada: ${eliminadas} eliminada(s), ${fallos} fallo(s).`, true);
        await cargarStorageImagesAdmin(storageImagesCurrentPage);
        await cargarStorageSettingsAdmin();
    } catch (error) {
        console.error("Error ejecutando limpieza manual:", error);
        mostrarMensajeStorage(error.message || "No se pudo ejecutar la limpieza", false);
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

function localTodayISO() {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function syncTodayOrdersUIState() {
    const cardHoy = document.getElementById("statCardPedidosHoy");
    const indicator = document.getElementById("todayOrdersIndicator");
    const tableCard = document.getElementById("ordersTableCard");
    const statCard = document.getElementById("statCardPedidosHoy");
    const title = document.querySelector(".topbar-title");
    const navPedidos = document.getElementById("navPedidos");

    if (cardHoy) {
        cardHoy.setAttribute("aria-pressed", isTodayOrdersMode ? "true" : "false");
    }
    if (indicator) {
        indicator.hidden = false;
        indicator.textContent = getOrdersFilterContextText();
        const contextType = getOrdersFilterContextType();
        indicator.classList.toggle("is-today", contextType === "today");
        indicator.classList.toggle("is-filtered", contextType === "filtered");
        indicator.classList.toggle("is-all", contextType === "all");
    }
    if (tableCard) {
        tableCard.classList.toggle("today-focus-active", isTodayOrdersMode);
    }
    if (statCard) {
        statCard.classList.toggle("today-card-active", isTodayOrdersMode);
    }
    if (title && navPedidos && navPedidos.classList.contains("active")) {
        title.innerHTML = isTodayOrdersMode
            ? "<span>Pedidos</span> / Hoy"
            : "<span>Pedidos</span> / Tabla";
    }
}

function clearTodayOrdersMidnightTimer() {
    if (todayOrdersMidnightTimerId) {
        window.clearTimeout(todayOrdersMidnightTimerId);
        todayOrdersMidnightTimerId = null;
    }
}

function scheduleTodayOrdersMidnightRefresh() {
    clearTodayOrdersMidnightTimer();
    if (!isTodayOrdersMode) return;

    const now = new Date();
    const next = new Date(now.getTime());
    next.setHours(24, 0, 0, 200);
    const waitMs = Math.max(1000, next.getTime() - now.getTime());

    todayOrdersMidnightTimerId = window.setTimeout(function() {
        if (!isTodayOrdersMode) return;
        const fechaInput = document.getElementById("filterFecha");
        if (fechaInput) fechaInput.value = localTodayISO();
        filterTable(true);
        announceAdminStatus("Filtro actualizado al nuevo dia para mostrar pedidos de hoy.");
        scheduleTodayOrdersMidnightRefresh();
    }, waitMs);
}

function focusOrdersTableCard() {
    const tableCard = document.getElementById("ordersTableCard");
    if (!tableCard) return;
    tableCard.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(function() {
        if (typeof tableCard.focus === "function") {
            tableCard.focus({ preventScroll: true });
        }
    }, 140);
}

function focusAdminSearch() {
    const searchInput = document.getElementById("searchInput");
    if (!searchInput) return;
    searchInput.focus({ preventScroll: true });
    if (typeof searchInput.select === "function") {
        searchInput.select();
    }
}

function activarPedidosDeHoy(options = {}) {
    const fechaInput = document.getElementById("filterFecha");
    setOrdersFilterMode("today");
    resetOrdersFilterContextState();
    setAdminMainView("pedidos");
    if (fechaInput) fechaInput.value = localTodayISO();

    syncTodayOrdersUIState();
    filterTable(true);
    scheduleTodayOrdersMidnightRefresh();

    if (options.scrollToTable !== false) {
        focusOrdersTableCard();
    }
    if (!options.silent) {
        announceAdminStatus("Mostrando pedidos de hoy.");
    }
}

function handleAdminGlobalKeydown(event) {
    const activeTag = (document.activeElement && document.activeElement.tagName || "").toLowerCase();
    const isTypingField = ["input", "textarea", "select"].includes(activeTag) || document.activeElement?.isContentEditable;

    if ((event.key === "/" || (event.key.toLowerCase() === "k" && event.ctrlKey)) && !isTypingField) {
        event.preventDefault();
        focusAdminSearch();
        announceAdminStatus("Buscador enfocado.");
        return;
    }

    if (event.altKey && event.key.toLowerCase() === "t" && !isTypingField) {
        event.preventDefault();
        if (isTodayOrdersMode) {
            desactivarPedidosDeHoy({ scrollToTable: true });
        } else {
            activarPedidosDeHoy({ scrollToTable: true });
        }
        return;
    }

    if (event.key !== "Escape") return;
    if (!isTodayOrdersMode) return;

    if (isTypingField) return;

    event.preventDefault();
    desactivarPedidosDeHoy({ scrollToTable: true });
}

function desactivarPedidosDeHoy(options = {}) {
    const fechaInput = document.getElementById("filterFecha");
    setOrdersFilterMode("all");
    resetOrdersFilterContextState();
    if (fechaInput) fechaInput.value = "";

    syncTodayOrdersUIState();
    filterTable(true);
    clearTodayOrdersMidnightTimer();

    if (options.scrollToTable) {
        focusOrdersTableCard();
    }
    if (!options.silent) {
        announceAdminStatus("Vista general de pedidos restaurada.");
    }
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
    const fechaInput = document.getElementById("filterFecha");
    const fechaFiltro = activeOrdersFilterMode === "today"
        ? localTodayISO()
        : (fechaInput?.value || "");
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

    if (isTodayOrdersMode && fechaInput && fechaInput.value !== fechaFiltro) {
        fechaInput.value = fechaFiltro;
    }

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

    updateOrdersFilterContextByActiveFilters({
        searchValue,
        fechaFiltro,
        estadoFiltro,
        imagenesFiltro,
        precioMin,
        precioMax,
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

    renderOrderAgeMilestones(clientesCache, {
        detectTransitions: !resetPage,
    });
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
    } else if (eventName === "milestone_reached") {
        const milestone = String(payload && payload.milestone || "").toLowerCase();
        const milestoneLabel = milestone === "1y" ? "1 ano" : "1 mes";
        title = "Hito de antiguedad";
        body = safeId
            ? `El pedido #${String(safeId).padStart(4, "0")} supero ${milestoneLabel}.`
            : `Se alcanzo un hito de ${milestoneLabel}.`;
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
        clearTodayOrdersMidnightTimer();
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
installAdminKpiFetchInstrumentation();

document.addEventListener("DOMContentLoaded", async function() {
    initAdminKpiPanel();

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
    const statCardPedidosHoy = document.getElementById("statCardPedidosHoy");
    const fechaFiltroInput = document.getElementById("filterFecha");

    syncTodayOrdersUIState();
    document.addEventListener("keydown", handleAdminGlobalKeydown);

    if (statCardPedidosHoy) {
        statCardPedidosHoy.addEventListener("click", function() {
            if (isTodayOrdersMode) {
                desactivarPedidosDeHoy({ scrollToTable: true });
                return;
            }
            activarPedidosDeHoy({ scrollToTable: true });
        });

        statCardPedidosHoy.addEventListener("keydown", function(e) {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            if (isTodayOrdersMode) {
                desactivarPedidosDeHoy({ scrollToTable: true });
                return;
            }
            activarPedidosDeHoy({ scrollToTable: true });
        });
    }

    if (fechaFiltroInput) {
        fechaFiltroInput.addEventListener("change", function() {
            if (!isTodayOrdersMode) return;
            if ((fechaFiltroInput.value || "") !== localTodayISO()) {
                setOrdersFilterMode("all");
                syncTodayOrdersUIState();
                clearTodayOrdersMidnightTimer();
            }
        });
    }

    if (navDashboard) {
        navDashboard.addEventListener("click", function(e) {
            e.preventDefault();
            if (isTodayOrdersMode) {
                desactivarPedidosDeHoy({ silent: true });
            }
            setAdminMainView("dashboard");
        });
    }

    if (navPedidos) {
        navPedidos.addEventListener("click", function(e) {
            e.preventDefault();
            if (isTodayOrdersMode) {
                desactivarPedidosDeHoy({ silent: true });
            }
            setAdminMainView("pedidos");
            focusOrdersTableCard();
        });
    }

    if (navClientes) {
        navClientes.addEventListener("click", async function(e) {
            e.preventDefault();
            if (isTodayOrdersMode) {
                desactivarPedidosDeHoy({ silent: true });
            }
            setAdminMainView("clientes");
            if (clientesCache.length === 0) {
                await cargarClientesCards();
            } else {
                renderClientesCards(clientesCache);
            }
        });
    }

    if (navOpciones) {
        navOpciones.addEventListener("click", async function(e) {
            e.preventDefault();
            if (isTodayOrdersMode) {
                desactivarPedidosDeHoy({ silent: true });
            }
            setAdminMainView("opciones");
            await cargarStorageSettingsAdmin();
            storageImagesCurrentPage = 1;
            await cargarStorageImagesAdmin(1);
        });
    }

    const storageRetentionMode = document.getElementById("storageRetentionMode");
    if (storageRetentionMode) {
        storageRetentionMode.addEventListener("change", toggleStorageCustomDaysField);
    }

    const storageImagesSearch = document.getElementById("storageImagesSearch");
    if (storageImagesSearch) {
        storageImagesSearch.addEventListener("input", function() {
            if (storageSearchDebounceTimer) {
                clearTimeout(storageSearchDebounceTimer);
                storageSearchDebounceTimer = null;
            }
            storageSearchDebounceTimer = window.setTimeout(function() {
                storageImagesCurrentPage = 1;
                cargarStorageImagesAdmin(1);
            }, 260);
        });
    }

    const storageOnlyExcluded = document.getElementById("storageOnlyExcluded");
    if (storageOnlyExcluded) {
        storageOnlyExcluded.addEventListener("change", function() {
            storageImagesCurrentPage = 1;
            cargarStorageImagesAdmin(1);
        });
    }

    const btnRefreshStorageImages = document.getElementById("btnRefreshStorageImages");
    if (btnRefreshStorageImages) {
        btnRefreshStorageImages.addEventListener("click", function() {
            cargarStorageImagesAdmin(storageImagesCurrentPage);
        });
    }

    const btnRunStorageCleanup = document.getElementById("btnRunStorageCleanup");
    if (btnRunStorageCleanup) {
        btnRunStorageCleanup.addEventListener("click", function() {
            ejecutarLimpiezaStorageManual();
        });
    }

    const formStorageSettings = document.getElementById("formStorageSettings");
    if (formStorageSettings) {
        formStorageSettings.addEventListener("submit", guardarStorageSettingsAdmin);
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
    await cargarStorageSettingsAdmin();
    storageImagesCurrentPage = 1;
    await cargarStorageImagesAdmin(1);
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
        const flecha = d.cambio_pct >= 0 ? '↑' : '↓';
        const elCambioPct = document.getElementById('statCambioPct');
        if (elCambioPct) { elCambioPct.textContent = `${flecha} ${Math.abs(d.cambio_pct)}% vs ayer`; elCambioPct.removeAttribute('aria-busy'); }

        document.getElementById('statTotalFotos').textContent = fmt(d.total_fotos);
        actualizarBadgeImagenes(d.total_fotos);
        document.getElementById('statFotosSemana').textContent = `↑ ${fmt(d.fotos_semana)} esta semana`;

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


const form = document.getElementById("formDatos");
const autosaveStatus = document.getElementById("autosaveStatus");
const autosaveStatusText = document.getElementById("autosaveStatusText");
const autosaveStatusMeta = document.getElementById("autosaveStatusMeta");
const autosaveStatusLive = document.getElementById("autosaveStatusLive");

if (form) {
    const AUTOSAVE_DEBOUNCE_MS = 2000;
    const SYNC_INTERVAL_MS = 15000;
    const DRAFT_KEY_STORAGE = "pedido_autosave_key_v1";
    const DRAFT_LOCAL_STORAGE = "pedido_autosave_local_v1";
    const DRAFT_QUEUE_STORAGE = "pedido_autosave_queue_v1";

    let draftKey = obtenerDraftKey();
    let serverVersion = null;
    let timerAutosave = 0;
    let saving = false;
    let dirty = false;
    let restoring = false;
    let reintentoPendiente = false;
    let ultimoComparable = "";
    let asignacionesPendientes = [];
    let ultimoEstadoVisual = "";
    let ultimoTextoVisual = "";
    let ultimoMetaVisual = "";
    let ultimoAnuncio = "";
    let ultimoAnuncioTs = 0;

    const trackedInputIds = new Set([
        "nombre",
        "apellido",
        "correo",
        "telefono",
        "prefijoPais",
        "inputImagenes",
        "toggleAsignacionFotos",
    ]);

    actualizarIndicador("idle", "Autoguardado activado", "Tus cambios se guardan automaticamente.");
    void restaurarBorradorInicial();
    void sincronizarColaPendiente();
    iniciarListeners();

    function iniciarListeners() {
        document.addEventListener("input", function(event) {
            if (debeMonitorear(event.target)) {
                programarAutosave("input");
            }
        }, true);

        document.addEventListener("change", function(event) {
            if (debeMonitorear(event.target)) {
                programarAutosave("change");
            }
        }, true);

        document.addEventListener("imagenesActualizadas", function() {
            programarAutosave("imagenes");
        });

        document.addEventListener("asignacionesTamanosActualizadas", function() {
            programarAutosave("asignaciones");
        });

        document.addEventListener("galeriaRenderizada", function() {
            aplicarAsignacionesPendientes();
            programarAutosave("galeria");
        });

        window.addEventListener("online", function() {
            void sincronizarColaPendiente();
        });

        window.addEventListener("beforeunload", function(event) {
            if (!dirty && !saving) return;
            const estado = capturarEstadoFormulario();
            persistirBorradorLocal(estado, serializarComparable(estado));
            enviarBeaconBorrador(estado);
            event.preventDefault();
            event.returnValue = "";
        });

        window.addEventListener("pagehide", function() {
            if (!dirty && !saving) return;
            const estado = capturarEstadoFormulario();
            persistirBorradorLocal(estado, serializarComparable(estado));
            enviarBeaconBorrador(estado);
        });

        document.addEventListener("visibilitychange", function() {
            if (document.visibilityState !== "hidden") return;
            if (!dirty && !saving) return;
            const estado = capturarEstadoFormulario();
            persistirBorradorLocal(estado, serializarComparable(estado));
            enviarBeaconBorrador(estado);
        });

        window.addEventListener("pedido:enviado", function() {
            void limpiarBorradorDespuesDeEnvio();
        });

        window.setInterval(function() {
            void sincronizarColaPendiente();
        }, SYNC_INTERVAL_MS);
    }

    function debeMonitorear(target) {
        if (!target || !(target instanceof HTMLElement)) return false;
        if (trackedInputIds.has(target.id)) return true;
        if (target.matches('input[name="papel"]')) return true;
        if (target.matches('select[name="tamano[]"]')) return true;
        if (target.matches(".foto-tamano-select")) return true;
        return false;
    }

    function programarAutosave(_motivo) {
        if (restoring) return;
        dirty = true;
        actualizarIndicador(
            "dirty",
            "Cambios pendientes",
            "Se guardaran en 2 segundos de inactividad.",
            { announce: false }
        );
        window.clearTimeout(timerAutosave);
        timerAutosave = window.setTimeout(function() {
            void ejecutarAutosave("debounce");
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    async function ejecutarAutosave(_origen, opciones = {}) {
        if (restoring) return;

        const estado = capturarEstadoFormulario();
        const comparable = serializarComparable(estado);

        if (!opciones.force && comparable === ultimoComparable) {
            dirty = false;
            actualizarIndicador("saved", "Guardado automatico", `Ultimo guardado: ${horaActual()}`);
            return;
        }

        persistirBorradorLocal(estado, comparable);

        if (saving) {
            reintentoPendiente = true;
            return;
        }

        saving = true;
        actualizarIndicador("saving", "Guardando cambios...", "No cierres la pestaña.");

        try {
            await guardarEnServidor(estado, { force: !!opciones.force });
            ultimoComparable = comparable;
            dirty = false;
            limpiarColaPendiente();
            persistirBorradorLocal(estado, comparable);
            actualizarIndicador("saved", "Guardado automatico", `Ultimo guardado: ${horaActual()}`);
        } catch (error) {
            if (error && error.code === "conflict" && error.data && error.data.draft) {
                await resolverConflicto(error.data.draft, estado, comparable);
            } else {
                encolarPendiente(estado, comparable);
                dirty = true;
                actualizarIndicador(
                    "error",
                    "Sin conexion",
                    "Tu progreso quedo guardado en este dispositivo y se sincronizara al volver internet."
                );
            }
        } finally {
            saving = false;
            if (reintentoPendiente) {
                reintentoPendiente = false;
                programarAutosave("reintento");
            }
        }
    }

    async function resolverConflicto(draftServidor, estadoLocal, comparableLocal) {
        const payloadServidor = (draftServidor && draftServidor.payload) || {};
        serverVersion = numeroSeguro(draftServidor && draftServidor.version);

        const tsLocal = fechaMilisegundos(estadoLocal.updatedAt);
        const tsServidor = fechaMilisegundos(payloadServidor.updatedAt);

        if (tsLocal >= tsServidor) {
            await guardarEnServidor(estadoLocal, { force: true });
            ultimoComparable = comparableLocal;
            dirty = false;
            limpiarColaPendiente();
            persistirBorradorLocal(estadoLocal, comparableLocal);
            actualizarIndicador("saved", "Guardado automatico", `Ultimo guardado: ${horaActual()}`);
            return;
        }

        aplicarEstadoGuardado(payloadServidor, false);
        ultimoComparable = serializarComparable(payloadServidor);
        persistirBorradorLocal(payloadServidor, ultimoComparable);
        dirty = false;
        actualizarIndicador("saved", "Borrador restaurado", "Se aplico la version mas reciente.");
    }

    async function guardarEnServidor(payload, opciones = {}) {
        const body = { payload };

        if (Number.isInteger(serverVersion) && !opciones.force) {
            body.baseVersion = serverVersion;
        }
        if (opciones.force) {
            body.force = true;
        }

        const response = await fetch(`/api/autosave/${encodeURIComponent(draftKey)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await response.json().catch(function() { return {}; });

        if (response.status === 409) {
            const conflictError = new Error("conflict");
            conflictError.code = "conflict";
            conflictError.data = data;
            throw conflictError;
        }

        if (!response.ok) {
            throw new Error((data && data.error) || "No se pudo guardar borrador");
        }

        serverVersion = numeroSeguro(data && data.draft && data.draft.version);
        return data;
    }

    async function restaurarBorradorInicial() {
        const local = leerRegistro(DRAFT_LOCAL_STORAGE);
        let candidato = null;
        let comparableCandidato = "";

        if (local && local.draftKey === draftKey && local.payload) {
            candidato = local.payload;
            comparableCandidato = String(local.comparable || "");
            serverVersion = numeroSeguro(local.serverVersion);
        }

        try {
            const response = await fetch(`/api/autosave/${encodeURIComponent(draftKey)}`, { method: "GET" });
            const data = await response.json().catch(function() { return {}; });
            if (response.ok && data && data.draft && data.draft.payload) {
                const draftServidor = data.draft;
                const payloadServidor = draftServidor.payload;
                const usarServidor = !candidato
                    || fechaMilisegundos(payloadServidor.updatedAt) > fechaMilisegundos(candidato.updatedAt);

                serverVersion = numeroSeguro(draftServidor.version);
                if (usarServidor) {
                    candidato = payloadServidor;
                    comparableCandidato = serializarComparable(payloadServidor);
                }
            }
        } catch (_error) {
            // El respaldo local cubre esta falla.
        }

        if (!candidato) {
            actualizarIndicador("idle", "Autoguardado activado", "Tus cambios se guardan automaticamente.");
            return;
        }

        aplicarEstadoGuardado(candidato, true);
        ultimoComparable = comparableCandidato || serializarComparable(candidato);
        persistirBorradorLocal(candidato, ultimoComparable);
    }

    function aplicarEstadoGuardado(payload, inicial) {
        if (!payload || typeof payload !== "object") return;
        const estado = payload;
        const datos = estado.form || {};
        const config = estado.config || {};
        const imagenes = estado.images || {};

        const campoNombre = document.getElementById("nombre");
        const campoApellido = document.getElementById("apellido");
        const campoCorreo = document.getElementById("correo");
        const campoTelefono = document.getElementById("telefono");
        const prefijoPais = document.getElementById("prefijoPais");
        const toggleAsignacion = document.getElementById("toggleAsignacionFotos");
        const tamanoSelect = obtenerTamanoSelect();

        const formularioConDatos = formularioTieneDatos();

        restoring = true;
        try {
            if (campoNombre && ((inicial && !formularioConDatos) || !campoNombre.value.trim())) {
                campoNombre.value = String(datos.nombre || "");
                campoNombre.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (campoApellido && ((inicial && !formularioConDatos) || !campoApellido.value.trim())) {
                campoApellido.value = String(datos.apellido || "");
                campoApellido.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (campoCorreo && ((inicial && !formularioConDatos) || !campoCorreo.value.trim())) {
                campoCorreo.value = String(datos.correo || "");
                campoCorreo.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (campoTelefono && ((inicial && !formularioConDatos) || !campoTelefono.value.trim())) {
                campoTelefono.value = String(datos.telefono || "");
                campoTelefono.dispatchEvent(new Event("input", { bubbles: true }));
            }
            if (prefijoPais && datos.prefijoPais) {
                const aplicarPrefijo = (inicial && !formularioConDatos) || !prefijoPais.value;
                if (aplicarPrefijo) {
                    prefijoPais.value = String(datos.prefijoPais);
                    prefijoPais.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }

            if (tamanoSelect && Array.isArray(config.selectedSizes)) {
                const haySeleccionActual = Array.from(tamanoSelect.options).some(function(opt) { return opt.selected; });
                if ((inicial && !formularioConDatos) || !haySeleccionActual) {
                    const setTamanos = new Set(config.selectedSizes.map(String));
                    Array.from(tamanoSelect.options).forEach(function(opt) {
                        opt.selected = setTamanos.has(String(opt.value));
                    });
                    tamanoSelect.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }

            if (typeof config.asignacionPorFoto === "boolean" && toggleAsignacion) {
                const aplicarToggle = (inicial && !formularioConDatos) || !toggleAsignacion.checked;
                if (aplicarToggle) {
                    toggleAsignacion.checked = !!config.asignacionPorFoto;
                    toggleAsignacion.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }

            if (config.paper) {
                const radioActual = document.querySelector('input[name="papel"]:checked');
                if ((inicial && !formularioConDatos) || !radioActual) {
                    const paperRadio = document.querySelector(`input[name="papel"][value="${cssEscape(config.paper)}"]`);
                    if (paperRadio) {
                        paperRadio.checked = true;
                        paperRadio.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                }
            }

            asignacionesPendientes = Array.isArray(config.perPhotoAssignments)
                ? config.perPhotoAssignments.slice()
                : [];
            aplicarAsignacionesPendientes();
        } finally {
            restoring = false;
        }

        const totalFotos = numeroSeguro(imagenes.count);
        if (totalFotos > 0 && !hayArchivosSeleccionados()) {
            actualizarIndicador(
                "saved",
                "Borrador restaurado",
                `Vuelve a seleccionar ${totalFotos} foto(s) para completar el pedido.`
            );
            return;
        }
        actualizarIndicador("saved", "Borrador restaurado", "Puedes continuar donde te quedaste.");
    }

    function aplicarAsignacionesPendientes() {
        if (!Array.isArray(asignacionesPendientes) || asignacionesPendientes.length === 0) return;

        const restantes = [];
        asignacionesPendientes.forEach(function(item) {
            if (!item || !item.fotoKey) return;
            const card = document.querySelector(`.card[data-foto-key="${cssEscape(item.fotoKey)}"]`);
            if (!card) {
                restantes.push(item);
                return;
            }
            const select = card.querySelector(".foto-tamano-select");
            if (!select) {
                restantes.push(item);
                return;
            }
            if (item.tamano) {
                select.value = item.tamano;
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });

        asignacionesPendientes = restantes;
    }

    async function sincronizarColaPendiente() {
        if (!navigator.onLine) return;
        const pendiente = leerRegistro(DRAFT_QUEUE_STORAGE);
        if (!pendiente || pendiente.draftKey !== draftKey || !pendiente.payload) return;

        try {
            await guardarEnServidor(pendiente.payload, { force: true });
            ultimoComparable = String(pendiente.comparable || serializarComparable(pendiente.payload));
            dirty = false;
            limpiarColaPendiente();
            actualizarIndicador("saved", "Guardado automatico", `Ultimo guardado: ${horaActual()}`);
        } catch (_error) {
            // Se mantiene en cola para reintento automatico.
        }
    }

    async function limpiarBorradorDespuesDeEnvio() {
        window.clearTimeout(timerAutosave);
        dirty = false;
        saving = false;
        reintentoPendiente = false;
        ultimoComparable = "";
        serverVersion = null;
        asignacionesPendientes = [];
        localStorage.removeItem(DRAFT_LOCAL_STORAGE);
        localStorage.removeItem(DRAFT_QUEUE_STORAGE);

        try {
            await fetch(`/api/autosave/${encodeURIComponent(draftKey)}`, {
                method: "DELETE",
                keepalive: true,
            });
        } catch (_error) {
            // Si falla, ya se limpio localmente.
        }

        draftKey = generarDraftKey();
        localStorage.setItem(DRAFT_KEY_STORAGE, draftKey);
        actualizarIndicador("idle", "Autoguardado activado", "Tus cambios se guardan automaticamente.");
    }

    function capturarEstadoFormulario() {
        const tamanoSelect = obtenerTamanoSelect();
        const selectedSizes = tamanoSelect
            ? Array.from(tamanoSelect.options).filter(function(opt) { return !!opt.selected; }).map(function(opt) { return opt.value; })
            : [];

        const paperActual = document.querySelector('input[name="papel"]:checked');
        const toggleAsignacion = document.getElementById("toggleAsignacionFotos");
        const inputImagenes = document.getElementById("inputImagenes");

        const perPhotoAssignments = Array.from(document.querySelectorAll(".card[data-foto-key] .foto-tamano-select"))
            .map(function(select) {
                const card = select.closest(".card[data-foto-key]");
                return {
                    fotoKey: card ? String(card.dataset.fotoKey || "") : "",
                    tamano: String(select.value || ""),
                };
            })
            .filter(function(item) { return item.fotoKey && item.tamano; });

        const files = inputImagenes && inputImagenes.files
            ? Array.from(inputImagenes.files).map(function(file) {
                return {
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    lastModified: file.lastModified,
                };
            })
            : [];

        return {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            form: {
                nombre: valorCampo("nombre"),
                apellido: valorCampo("apellido"),
                correo: valorCampo("correo"),
                telefono: valorCampo("telefono"),
                prefijoPais: valorCampo("prefijoPais"),
            },
            config: {
                selectedSizes,
                paper: paperActual ? String(paperActual.value || "") : "",
                asignacionPorFoto: !!(toggleAsignacion && toggleAsignacion.checked),
                perPhotoAssignments,
            },
            images: {
                count: files.length,
                files,
            },
        };
    }

    function serializarComparable(estado) {
        if (!estado || typeof estado !== "object") return "{}";
        return JSON.stringify({
            schemaVersion: estado.schemaVersion || 1,
            form: estado.form || {},
            config: estado.config || {},
            images: estado.images || {},
        });
    }

    function obtenerTamanoSelect() {
        return document.querySelector('select[name="tamano[]"]')
            || document.getElementById("tamano")
            || document.getElementById("tama\u00f1o")
            || document.getElementById("tama\u00c3\u00b1o");
    }

    function formularioTieneDatos() {
        const datos = [
            valorCampo("nombre"),
            valorCampo("apellido"),
            valorCampo("correo"),
            valorCampo("telefono"),
        ];
        if (datos.some(function(v) { return !!String(v || "").trim(); })) return true;

        if (document.querySelector('input[name="papel"]:checked')) return true;

        const tamanoSelect = obtenerTamanoSelect();
        if (tamanoSelect) {
            const hayTamano = Array.from(tamanoSelect.options).some(function(opt) { return !!opt.selected; });
            if (hayTamano) return true;
        }

        return false;
    }

    function hayArchivosSeleccionados() {
        const inputImagenes = document.getElementById("inputImagenes");
        return !!(inputImagenes && inputImagenes.files && inputImagenes.files.length > 0);
    }

    function valorCampo(id) {
        const el = document.getElementById(id);
        if (!el) return "";
        return String(el.value || "").trim();
    }

    function persistirBorradorLocal(payload, comparable) {
        const record = {
            draftKey,
            payload,
            comparable,
            serverVersion,
            savedAt: Date.now(),
        };
        try {
            localStorage.setItem(DRAFT_LOCAL_STORAGE, JSON.stringify(record));
        } catch (_error) {
            // Si localStorage falla por cuota, el guardado remoto sigue activo.
        }
    }

    function encolarPendiente(payload, comparable) {
        const record = {
            draftKey,
            payload,
            comparable,
            queuedAt: Date.now(),
        };
        try {
            localStorage.setItem(DRAFT_QUEUE_STORAGE, JSON.stringify(record));
        } catch (_error) {
            // Sin cola no bloqueamos al usuario.
        }
    }

    function limpiarColaPendiente() {
        localStorage.removeItem(DRAFT_QUEUE_STORAGE);
    }

    function leerRegistro(storageKey) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function enviarBeaconBorrador(payload) {
        const body = JSON.stringify({ payload });
        const endpoint = `/api/autosave/${encodeURIComponent(draftKey)}/beacon`;
        if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: "application/json" });
            navigator.sendBeacon(endpoint, blob);
            return;
        }

        fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
        }).catch(function() {
            // Fallback sin bloqueo.
        });
    }

    function obtenerDraftKey() {
        const existente = localStorage.getItem(DRAFT_KEY_STORAGE);
        if (esDraftKeyValido(existente)) {
            return existente;
        }

        const nuevo = generarDraftKey();
        localStorage.setItem(DRAFT_KEY_STORAGE, nuevo);
        return nuevo;
    }

    function generarDraftKey() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        const aleatorio = Math.random().toString(36).slice(2, 14);
        return `draft_${Date.now()}_${aleatorio}`;
    }

    function esDraftKeyValido(value) {
        return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
    }

    function actualizarIndicador(state, text, meta, options = {}) {
        if (!autosaveStatus) return;

        const fallback = mensajesBasePorEstado(state);
        const textoVisible = String(text || fallback.text || "").trim();
        const metaVisible = String(meta || fallback.meta || "").trim();

        if (
            state === ultimoEstadoVisual
            && textoVisible === ultimoTextoVisual
            && metaVisible === ultimoMetaVisual
        ) {
            return;
        }

        autosaveStatus.dataset.state = state;
        autosaveStatus.setAttribute("aria-busy", state === "saving" ? "true" : "false");

        if (autosaveStatusText && autosaveStatusMeta) {
            autosaveStatusText.textContent = textoVisible;
            autosaveStatusMeta.textContent = metaVisible;
        } else {
            autosaveStatus.textContent = metaVisible ? `${textoVisible}. ${metaVisible}` : textoVisible;
        }

        ultimoEstadoVisual = state;
        ultimoTextoVisual = textoVisible;
        ultimoMetaVisual = metaVisible;

        anunciarEstadoAccesible(state, textoVisible, metaVisible, options);
    }

    function anunciarEstadoAccesible(state, textoVisible, metaVisible, options = {}) {
        if (!autosaveStatusLive) return;
        if (options && options.announce === false) return;
        if (state === "dirty") return;

        const ahora = Date.now();
        const anuncio = metaVisible ? `${textoVisible}. ${metaVisible}` : textoVisible;

        if (state === "saved" && (ahora - ultimoAnuncioTs) < 3500) {
            return;
        }
        if (anuncio === ultimoAnuncio) {
            return;
        }

        autosaveStatusLive.textContent = anuncio;
        ultimoAnuncio = anuncio;
        ultimoAnuncioTs = ahora;
    }

    function mensajesBasePorEstado(state) {
        if (state === "saving") {
            return {
                text: "Guardando cambios...",
                meta: "No cierres la pestaña.",
            };
        }
        if (state === "saved") {
            return {
                text: "Guardado automatico",
                meta: `Ultimo guardado: ${horaActual()}`,
            };
        }
        if (state === "error") {
            return {
                text: "Sin conexion",
                meta: "Tu progreso queda guardado en este dispositivo.",
            };
        }
        if (state === "dirty") {
            return {
                text: "Cambios pendientes",
                meta: "Se guardaran en 2 segundos de inactividad.",
            };
        }
        return {
            text: "Autoguardado activado",
            meta: "Tus cambios se guardan automaticamente.",
        };
    }

    function horaActual() {
        try {
            return new Intl.DateTimeFormat("es-EC", {
                hour: "2-digit",
                minute: "2-digit",
            }).format(new Date());
        } catch (_error) {
            const ahora = new Date();
            const hh = String(ahora.getHours()).padStart(2, "0");
            const mm = String(ahora.getMinutes()).padStart(2, "0");
            return `${hh}:${mm}`;
        }
    }

    function fechaMilisegundos(value) {
        const ms = Date.parse(String(value || ""));
        return Number.isNaN(ms) ? 0 : ms;
    }

    function numeroSeguro(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(String(value || ""));
        }
        return String(value || "").replace(/["\\]/g, "\\$&");
    }
}

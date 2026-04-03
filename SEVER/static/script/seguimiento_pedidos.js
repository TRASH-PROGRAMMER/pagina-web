/**
 * Módulo de Seguimiento de Pedidos
 * Gestiona la persistencia de pedidos en localStorage y la UI de seguimiento
 */

(function() {
    'use strict';

    const STORAGE_KEY = 'imageManager_pedidos';
    const MAX_PEDIDOS_GUARDADOS = 5;

    // Estados del pedido con sus metadatos
    const ESTADOS_PEDIDO = {
        'pendiente': {
            label: 'En curso',
            descripcion: 'Tu pedido aún no ha sido entregado. Te avisaremos cuando esté listo.',
            icono: '🔄',
            color: '#16477f',
            bgColor: '#edf4ff'
        },
        'procesando': {
            label: 'Procesando',
            descripcion: 'Estamos trabajando en tu pedido. Pronto estará listo.',
            icono: '⚙️',
            color: '#8a5311',
            bgColor: '#fff5e8'
        },
        'listo_retiro': {
            label: 'Listo para retirar',
            descripcion: 'Tu pedido está listo para retirar en el local.',
            icono: '🏪',
            color: '#1e6f47',
            bgColor: '#e8f5ee'
        },
        'entregado': {
            label: 'Entregado',
            descripcion: 'Tu pedido ha sido entregado correctamente.',
            icono: '✅',
            color: '#0f7a4d',
            bgColor: '#eafbf1'
        },
        'cancelado': {
            label: 'Problema con el pedido',
            descripcion: 'Hubo un inconveniente. Por favor, revisa o intenta nuevamente.',
            icono: '❌',
            color: '#9b1c2e',
            bgColor: '#ffeeee'
        },
        'error': {
            label: 'Problema con el pedido',
            descripcion: 'Hubo un inconveniente. Por favor, revisa o intenta nuevamente.',
            icono: '❌',
            color: '#9b1c2e',
            bgColor: '#ffeeee'
        }
    };

    /**
     * Guarda un pedido en localStorage
     * @param {Object} pedido - Datos del pedido
     */
    function guardarPedido(pedido) {
        try {
            const pedidos = obtenerPedidosGuardados();
            const payload = { ...pedido, estado: normalizarEstado(pedido.estado) };
            
            // Evitar duplicados
            const existe = pedidos.find(p => p.id === pedido.id);
            if (existe) {
                // Actualizar pedido existente
                Object.assign(existe, payload, { 
                    fechaActualizacion: new Date().toISOString() 
                });
            } else {
                // Agregar nuevo pedido
                pedidos.unshift({
                    ...payload,
                    fechaGuardado: new Date().toISOString()
                });
            }

            // Mantener solo los últimos MAX_PEDIDOS_GUARDADOS
            const pedidosLimitados = pedidos.slice(0, MAX_PEDIDOS_GUARDADOS);
            
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pedidosLimitados));
            return true;
        } catch (e) {
            console.error('Error guardando pedido:', e);
            return false;
        }
    }

    /**
     * Obtiene todos los pedidos guardados
     * @returns {Array} Lista de pedidos
     */
    function obtenerPedidosGuardados() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error leyendo pedidos:', e);
            return [];
        }
    }

    /**
     * Estados que cuentan como "pedido en curso" (sincronizado con backend).
     * listo_retiro representa la etapa de "Listo para retirar" previa a entregado.
     */
    function normalizarEstado(estado) {
        const raw = String(estado || 'pendiente').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (raw === 'enviado' || raw === 'listo_para_retirar') return 'listo_retiro';
        if (raw === 'en_proceso') return 'procesando';
        return raw;
    }

    function estadoPedidoActivo(estado) {
        const e = normalizarEstado(estado);
        return e === 'pendiente' || e === 'procesando' || e === 'listo_retiro';
    }

    function obtenerMensajeDinamicoEstado(estado) {
        const e = normalizarEstado(estado);

        if (e === 'procesando' || e === 'en proceso') {
            return {
                variant: 'processing',
                badge: '⚙️ Procesando',
                text: 'Estamos trabajando en tu pedido. Pronto estará listo.'
            };
        }

        if (e === 'listo_retiro') {
            return {
                variant: 'shipped',
                badge: '🏪 Listo para retirar',
                text: 'Tu pedido está listo para retirar en el local.'
            };
        }

        if (e === 'entregado') {
            return {
                variant: 'delivered',
                badge: '✅ Entregado',
                text: 'Tu pedido ha sido entregado correctamente.'
            };
        }

        if (e === 'cancelado' || e === 'error') {
            return {
                variant: 'problem',
                badge: '❌ Problema con el pedido',
                text: 'Hubo un inconveniente. Por favor, revisa o intenta nuevamente.'
            };
        }

        return {
            variant: 'pending',
            badge: '🔄 En curso',
            text: 'Tu pedido aún no ha sido entregado. Te avisaremos cuando esté listo.'
        };
    }

    function obtenerPedidosActivos(pedidos) {
        return (pedidos || []).filter(p => estadoPedidoActivo(p.estado));
    }

    function obtenerResumenEstadosActivos(activos) {
        const lista = Array.isArray(activos) ? activos : [];
        if (lista.length <= 1) return '';

        const contador = {
            pendiente: 0,
            procesando: 0,
            listo_retiro: 0,
        };

        lista.forEach((pedido) => {
            const estado = normalizarEstado(pedido.estado);
            if (Object.prototype.hasOwnProperty.call(contador, estado)) {
                contador[estado] += 1;
            }
        });

        const partes = [];
        if (contador.pendiente > 0) partes.push(`${contador.pendiente} en curso`);
        if (contador.procesando > 0) partes.push(`${contador.procesando} procesando`);
        if (contador.listo_retiro > 0) partes.push(`${contador.listo_retiro} listos para retirar`);

        return partes.length > 0 ? `Resumen por estado: ${partes.join(' · ')}.` : '';
    }

    /**
     * Obtiene el pedido más reciente (por id numérico) entre los activos, o null
     */
    function obtenerPedidoActivoMasReciente(pedidos) {
        const activos = obtenerPedidosActivos(pedidos);
        if (!activos.length) return null;
        return activos.reduce((a, b) => {
            const ida = Number(a.id) || 0;
            const idb = Number(b.id) || 0;
            return idb >= ida ? b : a;
        });
    }

    /**
     * Obtiene el pedido más reciente (lista local: primer elemento = más nuevo guardado)
     * @deprecated para banner; usar obtenerPedidoActivoMasReciente
     */
    function obtenerPedidoReciente() {
        const pedidos = obtenerPedidosGuardados();
        return pedidos.length > 0 ? pedidos[0] : null;
    }

    function obtenerCorreoParaSincronizacion() {
        try {
            const key = localStorage.getItem('misPedidos_email');
            if (key && String(key).trim()) return String(key).trim().toLowerCase();
        } catch (e) { /* ignore */ }
        const pedidos = obtenerPedidosGuardados();
        for (let i = 0; i < pedidos.length; i++) {
            const c = (pedidos[i].correo || '').trim().toLowerCase();
            if (c) return c;
        }
        return '';
    }

    function mapApiPedidoALocal(p) {
        return {
            id: p.id,
            correo: p.correo || '',
            estado: normalizarEstado(p.estado),
            numFotos: Number(p.numFotos || 0),
            totalCopias: Number(p.totalCopias != null ? p.totalCopias : p.numFotos || 0),
            total: p.total != null ? p.total : 0,
            papel: p.papel || '',
            fechaRegistro: p.fechaRegistro || new Date().toISOString(),
            fechaActualizacion: new Date().toISOString()
        };
    }

    /**
     * Fusiona respuesta del servidor con localStorage (fuente de verdad: servidor por id).
     */
    function fusionarPedidosConServidor(servidorPedidos) {
        const lista = Array.isArray(servidorPedidos) ? servidorPedidos : [];
        const porId = new Map();
        lista.forEach(p => {
            porId.set(String(p.id), mapApiPedidoALocal(p));
        });
        const locales = obtenerPedidosGuardados();
        const vistos = new Set();
        const merged = [];

        locales.forEach(lp => {
            const sid = String(lp.id);
            const srv = porId.get(sid);
            if (srv) {
                merged.push({
                    ...lp,
                    ...srv,
                    estado: srv.estado,
                    numFotos: srv.numFotos,
                    totalCopias: srv.totalCopias,
                    total: srv.total,
                    papel: srv.papel || lp.papel,
                    fechaRegistro: srv.fechaRegistro || lp.fechaRegistro
                });
                vistos.add(sid);
            } else {
                merged.push({ ...lp, estado: normalizarEstado(lp.estado) });
            }
        });

        lista.forEach(p => {
            const sid = String(p.id);
            if (!vistos.has(sid)) {
                const item = mapApiPedidoALocal(p);
                item.fechaGuardado = new Date().toISOString();
                merged.push(item);
            }
        });

        merged.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
        const limitados = merged.slice(0, MAX_PEDIDOS_GUARDADOS);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(limitados));
        } catch (e) {
            console.error('Error fusionando pedidos:', e);
        }
        return limitados;
    }

    function quitarBannerSeguimiento() {
        const el = document.getElementById('contenedorSeguimientoPedido');
        if (el) el.remove();
    }

    async function sincronizarPedidosDesdeServidor() {
        const correo = obtenerCorreoParaSincronizacion();
        if (!correo) return false;
        try {
            const res = await fetch('/api/mis-pedidos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ correo })
            });
            if (!res.ok) return false;
            const data = await res.json();
            if (!Array.isArray(data.pedidos)) return false;
            fusionarPedidosConServidor(data.pedidos);
            return true;
        } catch (e) {
            console.warn('Sincronización de pedidos no disponible:', e);
            return false;
        }
    }

    function refrescarBannerSeguimiento() {
        quitarBannerSeguimiento();
        crearBotonSeguimiento();
    }

    /**
     * Busca un pedido específico por ID
     * @param {string|number} id - ID del pedido
     * @returns {Object|null} Pedido encontrado o null
     */
    function buscarPedido(id) {
        const pedidos = obtenerPedidosGuardados();
        return pedidos.find(p => String(p.id) === String(id)) || null;
    }

    /**
     * Limpia todos los pedidos guardados
     */
    function limpiarPedidosGuardados() {
        localStorage.removeItem(STORAGE_KEY);
    }

    /**
     * Elimina un pedido específico
     * @param {string|number} id - ID del pedido a eliminar
     */
    function eliminarPedido(id) {
        const pedidos = obtenerPedidosGuardados();
        const filtrados = pedidos.filter(p => String(p.id) !== String(id));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtrados));
    }

    /**
     * Verifica si el usuario tiene pedidos guardados
     * @returns {boolean}
     */
    function tienePedidosGuardados() {
        return obtenerPedidosGuardados().length > 0;
    }

    /**
     * Genera el HTML del timeline de estados
     * @param {string} estadoActual - Estado actual del pedido
     * @returns {string} HTML del timeline
     */
    function generarTimelineHTML(estadoActual) {
        const estadosOrden = ['pendiente', 'procesando', 'listo_retiro', 'entregado'];
        const estadoNormalizado = normalizarEstado(estadoActual);
        
        // Si está cancelado, mostrar estado especial
        if (estadoNormalizado === 'cancelado') {
            return `
                <div class="pedido-timeline cancelado">
                    <div class="timeline-item cancelado active">
                        <div class="timeline-icon">❌</div>
                        <div class="timeline-content">
                            <div class="timeline-titulo">Pedido Cancelado</div>
                            <div class="timeline-descripcion">Este pedido ha sido cancelado</div>
                        </div>
                    </div>
                </div>
            `;
        }

        const indiceActual = estadosOrden.indexOf(estadoNormalizado);
        
        let html = '<div class="pedido-timeline">';
        
        estadosOrden.forEach((estadoKey, index) => {
            const estado = ESTADOS_PEDIDO[estadoKey];
            let clase = '';
            
            if (index < indiceActual) {
                clase = 'completado';
            } else if (index === indiceActual) {
                clase = 'active';
            }
            
            html += `
                <div class="timeline-item ${clase}">
                    <div class="timeline-icon">${estado.icono}</div>
                    <div class="timeline-content">
                        <div class="timeline-titulo">${estado.label}</div>
                        <div class="timeline-descripcion">${estado.descripcion}</div>
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }

    /**
     * Crea y muestra el botón de seguimiento en la página principal
     */
    function crearBotonSeguimiento() {
        quitarBannerSeguimiento();

        const pedidos = obtenerPedidosGuardados();
        const activos = obtenerPedidosActivos(pedidos);
        const pedidoVista = obtenerPedidoActivoMasReciente(pedidos);
        if (!pedidoVista || activos.length === 0) {
            return;
        }

        const n = activos.length;
        const titulo = n === 1
            ? 'Tienes un pedido en curso'
            : `Tienes ${n} pedidos en curso`;
        const mensajeEstado = obtenerMensajeDinamicoEstado(pedidoVista.estado);
        const subtitulo = n === 1
            ? `Pedido #${pedidoVista.id}`
            : `Pedido de referencia: #${pedidoVista.id} (más reciente)`;
        const resumenEstados = obtenerResumenEstadosActivos(activos);

        const contenedor = document.createElement('div');
        contenedor.id = 'contenedorSeguimientoPedido';
        contenedor.className = `seguimiento-pedido-banner seguimiento-pedido-banner--${mensajeEstado.variant}`;
        contenedor.setAttribute('role', 'status');
        contenedor.setAttribute('aria-live', 'polite');
        contenedor.setAttribute('aria-atomic', 'true');
        contenedor.innerHTML = `
            <div class="seguimiento-pedido-info">
                <span class="seguimiento-pedido-icono">📦</span>
                <div class="seguimiento-pedido-detalles">
                    <div class="seguimiento-pedido-titulo">${titulo}</div>
                    <div class="seguimiento-pedido-subtitulo">${subtitulo}</div>
                    ${resumenEstados ? `<div class="seguimiento-pedido-resumen">${resumenEstados}</div>` : ''}
                    <div class="seguimiento-pedido-texto-estado">
                        <span class="seguimiento-pedido-badge-estado">${mensajeEstado.badge}</span>
                        <span>${mensajeEstado.text}</span>
                    </div>
                </div>
            </div>
            <a href="/seguimiento?pedido=${pedidoVista.id}&correo=${encodeURIComponent(pedidoVista.correo || '')}" 
               class="btn-ver-estado" 
               id="btnVerEstadoPedido">
                Ver estado
            </a>
        `;

        const header = document.querySelector('header.container');
        if (header && header.parentNode) {
            header.parentNode.insertBefore(contenedor, header.nextSibling);
        } else {
            document.body.insertBefore(contenedor, document.body.firstChild);
        }
    }

    /**
     * Crea el modal de lista de pedidos guardados
     */
    function crearModalPedidos() {
        // Evitar duplicados
        if (document.getElementById('modalMisPedidos')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'modalMisPedidos';
        modal.className = 'modal-pedidos-overlay';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'modalPedidosTitulo');
        modal.hidden = true;
        
        modal.innerHTML = `
            <div class="modal-pedidos-content">
                <div class="modal-pedidos-header">
                    <h2 id="modalPedidosTitulo">Mis Pedidos</h2>
                    <button type="button" class="modal-pedidos-close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="modal-pedidos-body" id="modalPedidosBody">
                    <!-- Lista de pedidos se carga dinámicamente -->
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        modal.querySelector('.modal-pedidos-close').addEventListener('click', cerrarModalPedidos);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cerrarModalPedidos();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !modal.hidden) {
                cerrarModalPedidos();
            }
        });
    }

    /**
     * Actualiza el contenido del modal con los pedidos guardados
     */
    function ordenarPedidosParaVista(pedidos) {
        const activos = obtenerPedidosActivos(pedidos).sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
        const ids = new Set(activos.map(p => String(p.id)));
        const resto = pedidos
            .filter(p => !ids.has(String(p.id)))
            .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
        return activos.concat(resto);
    }

    function actualizarModalPedidos() {
        const pedidos = ordenarPedidosParaVista(obtenerPedidosGuardados());
        const body = document.getElementById('modalPedidosBody');
        
        if (!body) return;

        if (pedidos.length === 0) {
            body.innerHTML = `
                <div class="sin-pedidos">
                    <div class="sin-pedidos-icono">📭</div>
                    <p>No tienes pedidos guardados en este dispositivo</p>
                    <a href="/" class="btn-nuevo-pedido">Crear nuevo pedido</a>
                </div>
            `;
            return;
        }

        const activos = obtenerPedidosActivos(pedidos);
        let avisoHtml = '';
        if (activos.length === 0) {
            const pedidoRef = pedidos[0] || null;
            const mensajeEstado = obtenerMensajeDinamicoEstado(pedidoRef ? pedidoRef.estado : 'entregado');
            avisoHtml = `
                <div class="modal-pedidos-aviso modal-pedidos-aviso--${mensajeEstado.variant}" role="status" aria-live="polite" aria-atomic="true">
                    <strong>No tienes pedidos activos</strong>
                    <span class="modal-pedidos-aviso-badge">${mensajeEstado.badge}</span>
                    <span>${mensajeEstado.text}</span>
                </div>`;
        } else {
            const pedidoRef = activos[0];
            const mensajeEstado = obtenerMensajeDinamicoEstado(pedidoRef.estado);
            const resumenEstados = obtenerResumenEstadosActivos(activos);
            avisoHtml = `
                <div class="modal-pedidos-aviso modal-pedidos-aviso--${mensajeEstado.variant}" role="status" aria-live="polite" aria-atomic="true">
                    <strong>${activos.length === 1 ? 'Tienes 1 pedido en curso' : `Tienes ${activos.length} pedidos en curso`}</strong>
                    <span class="modal-pedidos-aviso-badge">${mensajeEstado.badge}</span>
                    <span>${mensajeEstado.text}</span>
                    ${resumenEstados ? `<span class="modal-pedidos-aviso-resumen">${resumenEstados}</span>` : ''}
                </div>`;
        }

        const listaHTML = pedidos.map(pedido => {
            const estNorm = normalizarEstado(pedido.estado);
            const estado = ESTADOS_PEDIDO[estNorm] || { label: pedido.estado, icono: '📦' };
            const enCurso = estadoPedidoActivo(estNorm);
            const fecha = new Date(pedido.fechaRegistro || pedido.fechaGuardado).toLocaleDateString('es-EC', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
            const numFotos = Number(pedido.numFotos || 0);
            let totalCopias = Number(pedido.totalCopias);
            if (!Number.isFinite(totalCopias)) totalCopias = numFotos;
            const muestraCopiasModal = numFotos > 0 && totalCopias > numFotos;
            const lineaFotosCard = muestraCopiasModal
                ? `🖼️ ${numFotos} foto${numFotos === 1 ? '' : 's'} · ${totalCopias} copia${totalCopias === 1 ? '' : 's'}`
                : `🖼️ ${numFotos || '?'} foto${numFotos === 1 ? '' : 's'}`;

            return `
                <div class="pedido-card${enCurso ? ' pedido-card--activo' : ''}">
                    <div class="pedido-card-header">
                        <span class="pedido-card-numero">#${pedido.id}</span>
                        <div class="pedido-card-estados">
                            ${enCurso ? '<span class="pedido-chip-en-curso">En curso</span>' : ''}
                            <span class="pedido-card-estado estado-${estNorm}">${estado.icono} ${estado.label}</span>
                        </div>
                    </div>
                    <div class="pedido-card-detalles">
                        <div class="pedido-card-fecha">📅 ${fecha}</div>
                        <div class="pedido-card-fotos">${lineaFotosCard}</div>
                    </div>
                    <div class="pedido-card-acciones">
                        <a href="/seguimiento?pedido=${pedido.id}&correo=${encodeURIComponent(pedido.correo || '')}" 
                           class="btn-ver-pedido">Ver detalle</a>
                        <button type="button" class="btn-eliminar-pedido" data-pedido-id="${pedido.id}">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        body.innerHTML = avisoHtml + `<div class="pedidos-lista">${listaHTML}</div>`;

        // Event listeners para eliminar pedidos
        body.querySelectorAll('.btn-eliminar-pedido').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.pedidoId;
                if (confirm('¿Eliminar este pedido de tu historial?')) {
                    eliminarPedido(id);
                    actualizarModalPedidos();
                    refrescarBannerSeguimiento();
                }
            });
        });
    }

    /**
     * Abre el modal de pedidos
     */
    function abrirModalPedidos() {
        const modal = document.getElementById('modalMisPedidos');
        if (!modal) return;
        const correo = obtenerCorreoParaSincronizacion();
        const mostrar = () => {
            actualizarModalPedidos();
            modal.hidden = false;
            document.body.style.overflow = 'hidden';
        };
        if (correo) {
            sincronizarPedidosDesdeServidor().finally(mostrar);
        } else {
            mostrar();
        }
    }

    /**
     * Cierra el modal de pedidos
     */
    function cerrarModalPedidos() {
        const modal = document.getElementById('modalMisPedidos');
        if (modal) {
            modal.hidden = true;
            document.body.style.overflow = '';
        }
    }

    /**
     * Guarda un pedido cuando se crea exitosamente
     * Esta función se llama desde formulario_clientes.js después de crear un pedido
     * @param {Object} datosPedido - Datos del pedido creado
     */
    function onPedidoCreado(datosPedido) {
        const pedidoData = {
            id: datosPedido.id,
            correo: datosPedido.correo,
            estado: normalizarEstado(datosPedido.estado || 'pendiente'),
            numFotos: datosPedido.numFotos || 0,
            totalCopias: datosPedido.totalCopias || datosPedido.numFotos || 0,
            total: datosPedido.total || 0,
            papel: datosPedido.papel || '',
            fechaRegistro: datosPedido.fechaRegistro || new Date().toISOString()
        };

        guardarPedido(pedidoData);
        try {
            const em = String(datosPedido.correo || '').trim().toLowerCase();
            if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
                localStorage.setItem('misPedidos_email', em);
            }
        } catch (e) { /* ignore */ }
        sincronizarPedidosDesdeServidor().finally(() => refrescarBannerSeguimiento());
    }

    /**
     * Actualiza el estado de un pedido guardado
     * @param {string|number} id - ID del pedido
     * @param {string} nuevoEstado - Nuevo estado
     */
    function actualizarEstadoPedido(id, nuevoEstado) {
        const pedido = buscarPedido(id);
        if (pedido) {
            pedido.estado = normalizarEstado(nuevoEstado);
            pedido.fechaActualizacion = new Date().toISOString();
            guardarPedido(pedido);
        }
    }

    // Exponer funciones públicas
    window.SeguimientoPedidos = {
        guardarPedido,
        obtenerPedidosGuardados,
        obtenerPedidoReciente,
        buscarPedido,
        eliminarPedido,
        limpiarPedidosGuardados,
        tienePedidosGuardados,
        onPedidoCreado,
        actualizarEstadoPedido,
        generarTimelineHTML,
        crearBotonSeguimiento,
        crearModalPedidos,
        abrirModalPedidos,
        cerrarModalPedidos,
        sincronizarPedidosDesdeServidor,
        refrescarBannerSeguimiento,
        estadoPedidoActivo,
        normalizarEstado,
        ESTADOS_PEDIDO
    };

    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        crearModalPedidos();
        const correo = obtenerCorreoParaSincronizacion();
        if (correo) {
            sincronizarPedidosDesdeServidor().finally(() => {
                refrescarBannerSeguimiento();
            });
        } else {
            crearBotonSeguimiento();
        }
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (!obtenerCorreoParaSincronizacion()) return;
            sincronizarPedidosDesdeServidor().finally(() => {
                refrescarBannerSeguimiento();
                const modal = document.getElementById('modalMisPedidos');
                if (modal && !modal.hidden) actualizarModalPedidos();
            });
        });
    }

})();
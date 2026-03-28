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
            label: 'Pendiente',
            descripcion: 'Tu pedido está registrado y espera confirmación de pago',
            icono: '📋',
            color: '#16477f',
            bgColor: '#edf4ff'
        },
        'procesando': {
            label: 'En Proceso',
            descripcion: 'Estamos imprimiendo tus fotos',
            icono: '🖨️',
            color: '#8a5311',
            bgColor: '#fff5e8'
        },
        'enviado': {
            label: 'Enviado',
            descripcion: 'Tu pedido está en camino',
            icono: '🚚',
            color: '#1e6f47',
            bgColor: '#e8f5ee'
        },
        'entregado': {
            label: 'Entregado',
            descripcion: 'Pedido completado exitosamente',
            icono: '✅',
            color: '#0f7a4d',
            bgColor: '#eafbf1'
        },
        'cancelado': {
            label: 'Cancelado',
            descripcion: 'El pedido fue cancelado',
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
            
            // Evitar duplicados
            const existe = pedidos.find(p => p.id === pedido.id);
            if (existe) {
                // Actualizar pedido existente
                Object.assign(existe, pedido, { 
                    fechaActualizacion: new Date().toISOString() 
                });
            } else {
                // Agregar nuevo pedido
                pedidos.unshift({
                    ...pedido,
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
     * Obtiene el pedido más reciente
     * @returns {Object|null} Pedido más reciente o null
     */
    function obtenerPedidoReciente() {
        const pedidos = obtenerPedidosGuardados();
        return pedidos.length > 0 ? pedidos[0] : null;
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
        const estadosOrden = ['pendiente', 'procesando', 'enviado', 'entregado'];
        const estadoNormalizado = String(estadoActual || '').toLowerCase();
        
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
        // Evitar duplicados
        if (document.getElementById('btnVerEstadoPedido')) {
            return;
        }

        const pedidoReciente = obtenerPedidoReciente();
        if (!pedidoReciente) {
            return;
        }

        // Crear el contenedor del botón
        const contenedor = document.createElement('div');
        contenedor.id = 'contenedorSeguimientoPedido';
        contenedor.className = 'seguimiento-pedido-banner';
        contenedor.innerHTML = `
            <div class="seguimiento-pedido-info">
                <span class="seguimiento-pedido-icono">📦</span>
                <div class="seguimiento-pedido-detalles">
                    <div class="seguimiento-pedido-titulo">Tienes un pedido en curso</div>
                    <div class="seguimiento-pedido-subtitulo">Pedido #${pedidoReciente.id} - ${ESTADOS_PEDIDO[pedidoReciente.estado]?.label || pedidoReciente.estado}</div>
                </div>
            </div>
            <a href="/seguimiento?pedido=${pedidoReciente.id}&correo=${encodeURIComponent(pedidoReciente.correo || '')}" 
               class="btn-ver-estado" 
               id="btnVerEstadoPedido">
                Ver estado
            </a>
        `;

        // Insertar al inicio del body o después del header
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
    function actualizarModalPedidos() {
        const pedidos = obtenerPedidosGuardados();
        const body = document.getElementById('modalPedidosBody');
        
        if (!body) return;

        if (pedidos.length === 0) {
            body.innerHTML = `
                <div class="sin-pedidos">
                    <div class="sin-pedidos-icono">📭</div>
                    <p>No tienes pedidos guardados</p>
                    <a href="/" class="btn-nuevo-pedido">Crear nuevo pedido</a>
                </div>
            `;
            return;
        }

        const listaHTML = pedidos.map(pedido => {
            const estado = ESTADOS_PEDIDO[pedido.estado] || { label: pedido.estado, icono: '📦' };
            const fecha = new Date(pedido.fechaRegistro || pedido.fechaGuardado).toLocaleDateString('es-EC', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });

            return `
                <div class="pedido-card">
                    <div class="pedido-card-header">
                        <span class="pedido-card-numero">#${pedido.id}</span>
                        <span class="pedido-card-estado estado-${pedido.estado}">${estado.icono} ${estado.label}</span>
                    </div>
                    <div class="pedido-card-detalles">
                        <div class="pedido-card-fecha">📅 ${fecha}</div>
                        <div class="pedido-card-fotos">🖼️ ${pedido.numFotos || '?'} foto(s)</div>
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

        body.innerHTML = `<div class="pedidos-lista">${listaHTML}</div>`;

        // Event listeners para eliminar pedidos
        body.querySelectorAll('.btn-eliminar-pedido').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.dataset.pedidoId;
                if (confirm('¿Eliminar este pedido de tu historial?')) {
                    eliminarPedido(id);
                    actualizarModalPedidos();
                    // Actualizar botón de seguimiento si es necesario
                    const banner = document.getElementById('contenedorSeguimientoPedido');
                    if (banner && !tienePedidosGuardados()) {
                        banner.remove();
                    }
                }
            });
        });
    }

    /**
     * Abre el modal de pedidos
     */
    function abrirModalPedidos() {
        const modal = document.getElementById('modalMisPedidos');
        if (modal) {
            actualizarModalPedidos();
            modal.hidden = false;
            document.body.style.overflow = 'hidden';
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
            estado: datosPedido.estado || 'pendiente',
            numFotos: datosPedido.numFotos || 0,
            total: datosPedido.total || 0,
            papel: datosPedido.papel || '',
            fechaRegistro: datosPedido.fechaRegistro || new Date().toISOString()
        };

        guardarPedido(pedidoData);
        crearBotonSeguimiento();
    }

    /**
     * Actualiza el estado de un pedido guardado
     * @param {string|number} id - ID del pedido
     * @param {string} nuevoEstado - Nuevo estado
     */
    function actualizarEstadoPedido(id, nuevoEstado) {
        const pedido = buscarPedido(id);
        if (pedido) {
            pedido.estado = nuevoEstado;
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
        ESTADOS_PEDIDO
    };

    // Inicializar cuando el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        // Crear botón de seguimiento si hay pedidos guardados
        crearBotonSeguimiento();
        
        // Crear modal de pedidos (inicialmente oculto)
        crearModalPedidos();
    }

})();
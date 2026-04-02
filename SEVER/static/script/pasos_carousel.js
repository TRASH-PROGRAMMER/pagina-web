(function () {
    const carousel = document.getElementById("pasosCarousel");
    const prevBtn = document.getElementById("pasosPrev");
    const nextBtn = document.getElementById("pasosNext");
    const dotsWrap = document.getElementById("pasosDots");
    const live = document.getElementById("pasoActualLive");
    const hint = document.getElementById("pasosCarouselHint");

    if (!carousel || !prevBtn || !nextBtn || !dotsWrap) return;

    const slides = Array.from(carousel.querySelectorAll(".paso"));
    if (slides.length === 0) return;

    let dots = [];
    let currentPage = 0;
    let visibleCount = 3;
    let rafId = null;
    let bloqueoInicioActivo = true;
    let timerVigilanciaInicio = null;
    const HINT_DISMISS_KEY = "pasosCarouselHintDismissed";

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function esVistaMovil() {
        const anchoMovil = window.matchMedia("(max-width: 820px)").matches;
        const pointerCoarse = window.matchMedia("(pointer: coarse)").matches;
        const sinHover = window.matchMedia("(hover: none)").matches;
        const touchPoints = Number(navigator.maxTouchPoints || 0) > 0;
        return anchoMovil || ((pointerCoarse || touchPoints) && sinHover);
    }

    function actualizarHint() {
        if (!hint) return;
        const hayOverflow = carousel.scrollWidth > carousel.clientWidth + 8;
        const modoMovil = esVistaMovil();
        let hintDescartado = false;
        if (modoMovil) {
            try {
                hintDescartado = sessionStorage.getItem(HINT_DISMISS_KEY) === "1";
            } catch (_error) {
                hintDescartado = false;
            }
        }
        const texto = esVistaMovil()
            ? "Desliza para continuar"
            : "Usa las flechas para navegar";
        hint.textContent = texto;
        hint.hidden = !hayOverflow || hintDescartado;
    }

    function ocultarHintTrasInteraccionMovil() {
        if (!esVistaMovil()) return;
        try {
            sessionStorage.setItem(HINT_DISMISS_KEY, "1");
        } catch (_error) {
            // Ignorar si sessionStorage no esta disponible.
        }
        actualizarHint();
    }

    function aplicarModoNavegacion() {
        const modoMovil = esVistaMovil();
        [prevBtn, nextBtn].forEach(function(btn) {
            btn.hidden = modoMovil;
            btn.setAttribute("aria-hidden", modoMovil ? "true" : "false");
            btn.tabIndex = modoMovil ? -1 : 0;
        });

        if (dotsWrap) {
            dotsWrap.setAttribute("aria-label", modoMovil ? "Progreso de pasos" : "Navegar entre pasos");
        }

        actualizarHint();
    }

    function indexMasCercano() {
        const left = carousel.scrollLeft;
        let idx = 0;
        let minDiff = Infinity;

        slides.forEach(function (slide, i) {
            const diff = Math.abs(slide.offsetLeft - left);
            if (diff < minDiff) {
                minDiff = diff;
                idx = i;
            }
        });

        return idx;
    }

    function obtenerGapPx() {
        const estilos = window.getComputedStyle(carousel);
        const gapRaw = estilos.columnGap || estilos.gap || "0";
        const gap = Number.parseFloat(gapRaw);
        return Number.isFinite(gap) ? gap : 0;
    }

    function obtenerVisibleCount() {
        const primer = slides[0];
        if (!primer) return 1;

        const anchoSlide = primer.getBoundingClientRect().width;
        const anchoContenedor = carousel.getBoundingClientRect().width;
        const gap = obtenerGapPx();

        if (anchoSlide > 0 && anchoContenedor > 0) {
            const estimado = Math.round((anchoContenedor + gap) / (anchoSlide + gap));
            return clamp(estimado, 1, slides.length);
        }

        if (window.matchMedia("(max-width: 559px)").matches) return 1;
        if (window.matchMedia("(max-width: 991px)").matches) return 2;
        return 3;
    }

    function totalPaginas() {
        return Math.max(1, Math.ceil(slides.length / visibleCount));
    }

    function indiceInicialDePagina(pagina) {
        return clamp(pagina, 0, totalPaginas() - 1) * visibleCount;
    }

    function scrollLeftParaSlide(index) {
        const safe = clamp(index, 0, slides.length - 1);
        const slide = slides[safe];
        if (!slide) return 0;

        const rectCarousel = carousel.getBoundingClientRect();
        const rectSlide = slide.getBoundingClientRect();
        return Math.max(0, carousel.scrollLeft + (rectSlide.left - rectCarousel.left));
    }

    function paginaMasCercana() {
        const leftActual = Math.max(0, Number(carousel.scrollLeft) || 0);
        const paginas = totalPaginas();
        let pagina = 0;
        let minDiff = Infinity;

        for (let p = 0; p < paginas; p += 1) {
            const idxInicio = indiceInicialDePagina(p);
            const leftObjetivo = scrollLeftParaSlide(idxInicio);
            const diff = Math.abs(leftActual - leftObjetivo);
            if (diff < minDiff) {
                minDiff = diff;
                pagina = p;
            }
        }

        return pagina;
    }

    function irAPagina(pagina, behavior) {
        const safe = clamp(pagina, 0, totalPaginas() - 1);
        const idxInicio = indiceInicialDePagina(safe);
        const left = scrollLeftParaSlide(idxInicio);
        currentPage = safe;
        carousel.scrollTo({ left, behavior: behavior || "smooth" });
    }

    function forzarInicioPrimerGrupo() {
        if (!bloqueoInicioActivo) return;
        // Evita restauraciones del navegador (bfcache/scroll restoration) que pueden
        // dejar el carrusel en pasos intermedios.
        const snapPrevio = carousel.style.scrollSnapType;
        carousel.style.scrollSnapType = "none";
        carousel.scrollLeft = 0;
        visibleCount = obtenerVisibleCount();
        irAPagina(0, "auto");
        // Forzar layout antes de restaurar snap.
        void carousel.offsetWidth;
        carousel.style.scrollSnapType = snapPrevio;
        actualizarEstado();
    }

    function detenerVigilanciaInicio() {
        if (!timerVigilanciaInicio) return;
        clearInterval(timerVigilanciaInicio);
        timerVigilanciaInicio = null;
    }

    function marcarInteraccionUsuario() {
        bloqueoInicioActivo = false;
        detenerVigilanciaInicio();
    }

    function iniciarVigilanciaInicio() {
        detenerVigilanciaInicio();
        const inicioTs = Date.now();
        timerVigilanciaInicio = setInterval(function () {
            if (!bloqueoInicioActivo) {
                detenerVigilanciaInicio();
                return;
            }

            // Mantener vigilancia mas tiempo para cubrir restauraciones tardias
            // del navegador y cambios de layout luego de cargar recursos.
            if (Date.now() - inicioTs > 12000) {
                detenerVigilanciaInicio();
                return;
            }

            if (carousel.scrollLeft > 8 || paginaMasCercana() !== 0) {
                forzarInicioPrimerGrupo();
            }
        }, 180);
    }

    function actualizarEstado() {
        visibleCount = obtenerVisibleCount();
        currentPage = paginaMasCercana();
        const paginas = totalPaginas();
        const modoMovil = esVistaMovil();

        prevBtn.disabled = currentPage <= 0;
        nextBtn.disabled = currentPage >= paginas - 1;

        dots.forEach(function (dot, i) {
            const activo = i === currentPage;
            dot.setAttribute("aria-selected", activo ? "true" : "false");
            dot.setAttribute("tabindex", modoMovil ? "-1" : (activo ? "0" : "-1"));
            if (modoMovil) {
                dot.setAttribute("aria-disabled", "true");
            } else {
                dot.removeAttribute("aria-disabled");
            }
        });

        aplicarModoNavegacion();

        if (live) {
            const inicio = (currentPage * visibleCount) + 1;
            const fin = Math.min(slides.length, inicio + visibleCount - 1);
            live.textContent = `Pasos ${inicio} a ${fin} de ${slides.length}`;
        }
    }

    function onScroll() {
        if (carousel.scrollLeft > 10) {
            ocultarHintTrasInteraccionMovil();
        }
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(actualizarEstado);
    }

    function crearDots() {
        dotsWrap.innerHTML = "";
        dots = [];

        const paginas = totalPaginas();
        for (let i = 0; i < paginas; i += 1) {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "pasos-dot";
            dot.setAttribute("role", "tab");
            const inicio = (i * visibleCount) + 1;
            const fin = Math.min(slides.length, inicio + visibleCount - 1);
            dot.setAttribute("aria-label", `Ir al grupo de pasos ${inicio} a ${fin}`);
            dot.setAttribute("aria-controls", "pasosCarousel");
            dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
            dot.setAttribute("tabindex", i === 0 ? "0" : "-1");

            dot.addEventListener("click", function () {
                if (esVistaMovil()) return;
                marcarInteraccionUsuario();
                irAPagina(i, "smooth");
            });

            dot.addEventListener("keydown", function (event) {
                if (esVistaMovil()) return;
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    irAPagina(i + 1, "smooth");
                }
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    irAPagina(i - 1, "smooth");
                }
            });

            dotsWrap.appendChild(dot);
            dots.push(dot);
        }
    }

    prevBtn.addEventListener("click", function () {
        marcarInteraccionUsuario();
        irAPagina(currentPage - 1, "smooth");
    });

    nextBtn.addEventListener("click", function () {
        marcarInteraccionUsuario();
        irAPagina(currentPage + 1, "smooth");
    });

    carousel.addEventListener("scroll", onScroll, { passive: true });

    carousel.addEventListener("keydown", function (event) {
        marcarInteraccionUsuario();
        if (event.key === "ArrowRight") {
            event.preventDefault();
            irAPagina(currentPage + 1, "smooth");
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            irAPagina(currentPage - 1, "smooth");
        }
        if (event.key === "Home") {
            event.preventDefault();
            irAPagina(0, "smooth");
        }
        if (event.key === "End") {
            event.preventDefault();
            irAPagina(totalPaginas() - 1, "smooth");
        }
    });

    window.addEventListener("resize", function () {
        const anteriorVisible = visibleCount;
        const paginaAnterior = currentPage;
        visibleCount = obtenerVisibleCount();
        if (visibleCount !== anteriorVisible) {
            crearDots();
        }
        irAPagina(clamp(paginaAnterior, 0, totalPaginas() - 1), "auto");
        actualizarEstado();
        aplicarModoNavegacion();
    });

    ["pointerdown", "touchstart", "wheel", "mousedown"].forEach(function (evt) {
        carousel.addEventListener(evt, function () {
            marcarInteraccionUsuario();
            ocultarHintTrasInteraccionMovil();
        }, { passive: true });
    });

    window.addEventListener("pageshow", function () {
        forzarInicioPrimerGrupo();
    });

    window.addEventListener("load", function () {
        forzarInicioPrimerGrupo();
    });

    visibleCount = obtenerVisibleCount();
    crearDots();
    aplicarModoNavegacion();
    forzarInicioPrimerGrupo();
    // Segunda pasada corta por si cambian anchos tras fuentes/paint inicial.
    requestAnimationFrame(function () {
        forzarInicioPrimerGrupo();
    });
    setTimeout(function () {
        forzarInicioPrimerGrupo();
    }, 450);
    iniciarVigilanciaInicio();
})();

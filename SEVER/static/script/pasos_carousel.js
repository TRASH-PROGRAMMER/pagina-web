(function () {
    const carousel = document.getElementById("pasosCarousel");
    const prevBtn = document.getElementById("pasosPrev");
    const nextBtn = document.getElementById("pasosNext");
    const dotsWrap = document.getElementById("pasosDots");
    const live = document.getElementById("pasoActualLive");

    if (!carousel || !prevBtn || !nextBtn || !dotsWrap) return;

    const slides = Array.from(carousel.querySelectorAll(".paso"));
    if (slides.length === 0) return;

    const dots = [];
    let currentIndex = 0;
    let rafId = null;

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
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

    function irA(index, behavior) {
        const safe = clamp(index, 0, slides.length - 1);
        const destino = slides[safe];
        if (!destino) return;

        carousel.scrollTo({
            left: destino.offsetLeft,
            behavior: behavior || "smooth",
        });
    }

    function actualizarEstado() {
        currentIndex = indexMasCercano();

        prevBtn.disabled = currentIndex <= 0;
        nextBtn.disabled = currentIndex >= slides.length - 1;

        dots.forEach(function (dot, i) {
            const activo = i === currentIndex;
            dot.setAttribute("aria-selected", activo ? "true" : "false");
            dot.setAttribute("tabindex", activo ? "0" : "-1");
        });

        if (live) {
            live.textContent = `Paso ${currentIndex + 1} de ${slides.length}`;
        }
    }

    function onScroll() {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(actualizarEstado);
    }

    function crearDots() {
        dotsWrap.innerHTML = "";

        slides.forEach(function (_, i) {
            const dot = document.createElement("button");
            dot.type = "button";
            dot.className = "pasos-dot";
            dot.setAttribute("role", "tab");
            dot.setAttribute("aria-label", `Ir al paso ${i + 1}`);
            dot.setAttribute("aria-controls", "pasosCarousel");
            dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
            dot.setAttribute("tabindex", i === 0 ? "0" : "-1");

            dot.addEventListener("click", function () {
                irA(i, "smooth");
            });

            dot.addEventListener("keydown", function (event) {
                if (event.key === "ArrowRight") {
                    event.preventDefault();
                    irA(i + 1, "smooth");
                }
                if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    irA(i - 1, "smooth");
                }
            });

            dotsWrap.appendChild(dot);
            dots.push(dot);
        });
    }

    prevBtn.addEventListener("click", function () {
        irA(currentIndex - 1, "smooth");
    });

    nextBtn.addEventListener("click", function () {
        irA(currentIndex + 1, "smooth");
    });

    carousel.addEventListener("scroll", onScroll, { passive: true });

    carousel.addEventListener("keydown", function (event) {
        if (event.key === "ArrowRight") {
            event.preventDefault();
            irA(currentIndex + 1, "smooth");
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            irA(currentIndex - 1, "smooth");
        }
        if (event.key === "Home") {
            event.preventDefault();
            irA(0, "smooth");
        }
        if (event.key === "End") {
            event.preventDefault();
            irA(slides.length - 1, "smooth");
        }
    });

    window.addEventListener("resize", function () {
        irA(currentIndex, "auto");
        actualizarEstado();
    });

    crearDots();
    actualizarEstado();
})();

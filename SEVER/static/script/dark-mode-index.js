const darkModeBtn = document.querySelector(".dark-mode-btn");
const root = document.documentElement;

const darkModeEnabled = localStorage.getItem("darkMode") === "enabled";
root.classList.toggle("dark-mode", darkModeEnabled);

if (darkModeBtn) {
    darkModeBtn.setAttribute("aria-pressed", darkModeEnabled ? "true" : "false");
}

if (darkModeBtn) {
    darkModeBtn.addEventListener("click", () => {
        const enabled = root.classList.toggle("dark-mode");
        localStorage.setItem("darkMode", enabled ? "enabled" : "disabled");
        darkModeBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
    });
}

const darkModeBtn = document.querySelector(".dark-mode-btn");
const root = document.documentElement;

if (localStorage.getItem("darkMode") === "enabled") {
    root.classList.add("dark-mode");
}

darkModeBtn.addEventListener("click", () => {
    root.classList.toggle("dark-mode");

    if (root.classList.contains("dark-mode")) {
        localStorage.setItem("darkMode", "enabled");
    } else {
        localStorage.setItem("darkMode", "disabled");
    }
});

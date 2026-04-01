(function() {
    const TOKEN_KEY = "im.auth.token";
    const USER_KEY = "im.auth.user";
    const SESSION_CHANNEL = "session_events";

    function getToken() {
        return sessionStorage.getItem(TOKEN_KEY) || "";
    }

    function setToken(token) {
        sessionStorage.setItem(TOKEN_KEY, token);
    }

    function setUser(user) {
        sessionStorage.setItem(USER_KEY, JSON.stringify(user || {}));
    }

    function getUser() {
        try {
            return JSON.parse(sessionStorage.getItem(USER_KEY) || "{}");
        } catch (_error) {
            return {};
        }
    }

    function clearAuthSession() {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(USER_KEY);
    }

    function routeForRole(role) {
        if (role === "admin") return "/admin";
        if (role === "operador") return "/operador";
        if (role === "cajero") return "/cajero";
        return "/login";
    }

    function parseRequiredRoles() {
        const raw = (document.body && document.body.dataset && document.body.dataset.authRoles) || "";
        return raw
            .split(",")
            .map(function(item) { return item.trim().toLowerCase(); })
            .filter(Boolean);
    }

    function decorateHeaders(headers, token) {
        const next = new Headers(headers || {});
        if (token && !next.has("Authorization")) {
            next.set("Authorization", "Bearer " + token);
        }
        if (!next.has("Accept")) {
            next.set("Accept", "application/json, text/plain, */*");
        }
        return next;
    }

    function shouldAttachAuth(urlValue) {
        try {
            const url = new URL(urlValue, window.location.origin);
            if (url.origin !== window.location.origin) return false;
            return url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/");
        } catch (_error) {
            return false;
        }
    }

    function patchFetchWithAuthHeader() {
        if (window.__authFetchPatched) return;
        window.__authFetchPatched = true;

        const originalFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
            const token = getToken();
            const initSafe = init || {};
            const targetUrl = typeof input === "string" ? input : (input && input.url ? input.url : "");

            if (!token || !shouldAttachAuth(targetUrl)) {
                return originalFetch(input, initSafe);
            }

            if (input instanceof Request) {
                const requestWithAuth = new Request(input, {
                    headers: decorateHeaders(input.headers, token),
                });
                return originalFetch(requestWithAuth);
            }

            const nextInit = Object.assign({}, initSafe, {
                headers: decorateHeaders(initSafe.headers, token),
            });
            return originalFetch(input, nextInit);
        };
    }

    function paintAuthMeta(user) {
        const username = user && user.username ? String(user.username) : "Usuario";
        const role = user && user.role ? String(user.role) : "-";

        document.querySelectorAll("[data-auth-username]").forEach(function(el) {
            el.textContent = username;
        });
        document.querySelectorAll("[data-auth-role]").forEach(function(el) {
            el.textContent = role;
        });
    }

    async function fetchMeWithToken(token) {
        return fetch("/api/auth/me", {
            method: "GET",
            headers: {
                "Authorization": "Bearer " + token,
                "Accept": "application/json",
            },
        });
    }

    async function fetchMeWithCookie() {
        return fetch("/api/auth/me", {
            method: "GET",
            headers: {
                "Accept": "application/json",
            },
            credentials: "same-origin",
        });
    }

    function hydrateUserFromPayload(payload) {
        const role = String((payload && payload.role) || "").toLowerCase();
        const user = {
            id: payload ? payload.user_id : undefined,
            username: payload ? payload.username : undefined,
            role: role,
        };
        setUser(user);
        paintAuthMeta(user);
        return role;
    }

    async function ensureRoleAccess() {
        const requiredRoles = parseRequiredRoles();
        if (!requiredRoles.length) return;

        const token = getToken();
        try {
            if (token) {
                const res = await fetchMeWithToken(token);
                if (res.ok) {
                    const payload = await res.json();
                    const role = hydrateUserFromPayload(payload);
                    if (!requiredRoles.includes(role)) {
                        window.location.href = routeForRole(role);
                    }
                    return;
                }
            }

            // Fallback: sesion cookie activa aunque el token de tab no exista.
            const resCookie = await fetchMeWithCookie();
            if (!resCookie.ok) {
                clearAuthSession();
                window.location.href = "/login";
                return;
            }

            const payloadCookie = await resCookie.json();
            const roleCookie = hydrateUserFromPayload(payloadCookie);
            if (!requiredRoles.includes(roleCookie)) {
                window.location.href = routeForRole(roleCookie);
            }
        } catch (_error) {
            clearAuthSession();
            window.location.href = "/login";
        }
    }

    async function logoutCurrentTab() {
        try {
            await fetch("/api/auth/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            });
        } catch (_error) {
            // Ignorar errores de red, se limpia localmente.
        } finally {
            clearAuthSession();
            window.location.href = "/login";
        }
    }

    async function logoutAllTabs() {
        try {
            await fetch("/api/auth/logout-all", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
            });
        } catch (_error) {
            // Ignorar errores de red, se limpia localmente.
        } finally {
            clearAuthSession();
            try {
                const channel = new BroadcastChannel(SESSION_CHANNEL);
                channel.postMessage({ type: "logout-all" });
                channel.close();
            } catch (_error) {
                // Navegadores sin BroadcastChannel.
            }
            window.location.href = "/login";
        }
    }

    function bindLogoutTriggers() {
        document.querySelectorAll("[data-auth-logout]").forEach(function(el) {
            el.addEventListener("click", function(event) {
                event.preventDefault();
                const mode = (el.getAttribute("data-auth-logout") || "tab").toLowerCase();
                if (mode === "all") {
                    logoutAllTabs();
                    return;
                }
                logoutCurrentTab();
            });
        });
    }

    function bindSessionChannel() {
        try {
            const channel = new BroadcastChannel(SESSION_CHANNEL);
            channel.onmessage = function(event) {
                if (event && event.data && event.data.type === "logout-all") {
                    clearAuthSession();
                    window.location.href = "/login";
                }
            };
        } catch (_error) {
            // Navegadores sin BroadcastChannel.
        }
    }

    window.AuthSessionClient = {
        getToken: getToken,
        setToken: setToken,
        setUser: setUser,
        getUser: getUser,
        clear: clearAuthSession,
        ensureRoleAccess: ensureRoleAccess,
        logoutCurrentTab: logoutCurrentTab,
        logoutAllTabs: logoutAllTabs,
    };

    patchFetchWithAuthHeader();
    bindLogoutTriggers();
    bindSessionChannel();
    ensureRoleAccess();
})();

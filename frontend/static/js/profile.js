/* ==========================================================================
   Altarun : profil sportif (objectifs et paramètres physiologiques)
   --------------------------------------------------------------------------
   Source unique des valeurs saisies par l'utilisateur et utilisées partout :
   objectifs hebdomadaires du dashboard, objectif de course du coach, FC max
   et FC de repos (zones et charge TRIMP), parcours de golf de référence.
   Stockage : navigateur pour l'instant, puis `PUT /users/<username>/profile`.
   ========================================================================== */
(function (global) {
    "use strict";

    const KEY = "altarun-profile-v1";
    const DISTANCES = [
        { km: 5, label: "5 km", short: "5 km" },
        { km: 10, label: "10 km", short: "10 km" },
        { km: 21.0975, label: "Semi-marathon", short: "semi" },
        { km: 42.195, label: "Marathon", short: "marathon" },
    ];
    const DEFAULT = {
        updatedAt: "2026-09-02",
        hrMax: 192,
        hrRest: 50,
        targets: { Run: 65, Tennis: 7, Swim: 1, Golf: 2, RockClimbing: 1 },
        race: { name: "Semi-marathon", date: "2026-10-18", distanceKm: 21.0975, targetSec: 86 * 60 },
        golf: { rating: 71.2, slope: 128 },
    };
    const listeners = [];

    const clone = (o) => JSON.parse(JSON.stringify(o));
    function get() {
        try {
            const raw = localStorage.getItem(KEY);
            if (raw) return { ...clone(DEFAULT), ...JSON.parse(raw) };
        } catch (e) { /* stockage indisponible */ }
        return clone(DEFAULT);
    }
    function save(p) {
        p.updatedAt = new Date().toISOString().slice(0, 10);
        try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* stockage indisponible */ }
        listeners.forEach((fn) => fn(p));
    }
    const onChange = (fn) => listeners.push(fn);
    const distanceOf = (km) => DISTANCES.find((d) => Math.abs(d.km - km) < 0.2) || { km, label: `${km} km`, short: `${km} km` };
    const raceDate = (p) => { const [y, m, d] = p.race.date.split("-").map(Number); return new Date(y, m - 1, d); };

    // ------------------------------------------------------------ formats
    const hms = (sec) => {
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
        return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
    };
    const parseHms = (txt) => {
        const parts = String(txt).trim().split(/[:h'"\s]+/).filter(Boolean).map(Number);
        if (!parts.length || parts.some((n) => !isFinite(n))) return null;
        return parts.reduce((acc, n) => acc * 60 + n, 0);
    };
    const pace = (s) => `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, "0")}"`;
    const frDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); };

    // ------------------------------------------------------------ éditeur
    function h(tag, attrs, ...children) {
        const n = document.createElement(tag);
        for (const k in attrs || {}) {
            if (k === "class") n.className = attrs[k];
            else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
        }
        children.flat().forEach((c) => c != null && n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c));
        return n;
    }

    /** Ouvre la fenêtre « Profil sportif ». `focus` : "race" | "targets". */
    function openEditor(opts = {}) {
        const p = get();
        const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); if (opts.returnFocus) opts.returnFocus.focus(); };
        const onKey = (e) => { if (e.key === "Escape") close(); };
        const field = (id, label, input, hint) => h("label", { class: "prof-field", for: id }, h("span", {}, label), input, hint ? h("small", {}, hint) : null);
        const num = (id, value, step = "1", min = "0") => h("input", { id, type: "number", value, step, min, class: "prof-input" });

        const raceName = h("input", { id: "prof-race-name", type: "text", value: p.race.name, class: "prof-input" });
        const raceDateIn = h("input", { id: "prof-race-date", type: "date", value: p.race.date, class: "prof-input" });
        const raceDist = h("select", { id: "prof-race-dist", class: "prof-input" }, DISTANCES.map((d) => { const o = h("option", { value: String(d.km) }, d.label); if (Math.abs(d.km - p.race.distanceKm) < 0.2) o.selected = true; return o; }));
        const raceTime = h("input", { id: "prof-race-time", type: "text", value: hms(p.race.targetSec), class: "prof-input", inputmode: "numeric", placeholder: "h:mm:ss" });
        const paceOut = h("strong", {});
        const refreshPace = () => {
            const sec = parseHms(raceTime.value), km = Number(raceDist.value);
            paceOut.textContent = sec ? `${pace(sec / km)}/km` : "format attendu : h:mm:ss";
        };
        raceTime.addEventListener("input", refreshPace); raceDist.addEventListener("change", refreshPace); refreshPace();

        const t = p.targets;
        const tRun = num("prof-t-run", t.Run), tTen = num("prof-t-tennis", t.Tennis, "0.5"), tSwim = num("prof-t-swim", t.Swim, "0.5"), tGolf = num("prof-t-golf", t.Golf, "0.5"), tClimb = num("prof-t-climb", t.RockClimbing, "0.5");
        const hrMax = num("prof-hrmax", p.hrMax), hrRest = num("prof-hrrest", p.hrRest);
        const gR = num("prof-golf-r", p.golf.rating, "0.1"), gS = num("prof-golf-s", p.golf.slope);
        const error = h("p", { class: "prof-error", role: "alert", hidden: true });

        const form = h("form", { class: "prof-form" },
            h("section", { class: "prof-section" },
                h("h3", {}, "Objectif de course"),
                h("div", { class: "prof-grid" },
                    field("prof-race-name", "Course", raceName),
                    field("prof-race-date", "Date", raceDateIn),
                    field("prof-race-dist", "Distance", raceDist),
                    field("prof-race-time", "Chrono visé", raceTime)),
                h("p", { class: "prof-derived" }, "Allure cible : ", paceOut)),
            h("section", { class: "prof-section" },
                h("h3", {}, "Objectifs hebdomadaires"),
                h("div", { class: "prof-grid five" },
                    field("prof-t-run", "Course (km)", tRun),
                    field("prof-t-tennis", "Tennis (h)", tTen),
                    field("prof-t-swim", "Natation (h)", tSwim),
                    field("prof-t-golf", "Golf (h)", tGolf),
                    field("prof-t-climb", "Escalade (h)", tClimb))),
            h("section", { class: "prof-section" },
                h("h3", {}, "Physiologie et golf"),
                h("div", { class: "prof-grid" },
                    field("prof-hrmax", "FC max (bpm)", hrMax, "Charge TRIMP"),
                    field("prof-hrrest", "FC de repos (bpm)", hrRest, "Charge TRIMP"),
                    field("prof-golf-r", "Parcours : SR", gR, "Index golf"),
                    field("prof-golf-s", "Parcours : slope", gS))),
            error,
            h("footer", { class: "prof-foot" },
                h("span", { class: "prof-updated" }, `Dernière mise à jour : ${frDate(p.updatedAt)}`),
                h("button", { type: "button", class: "prof-btn ghost", onclick: close }, "Annuler"),
                h("button", { type: "submit", class: "prof-btn primary" }, "Enregistrer")));

        form.addEventListener("submit", (e) => {
            e.preventDefault();
            const sec = parseHms(raceTime.value);
            const vals = [hrMax, hrRest].map((i) => Number(i.value));
            if (!raceName.value.trim() || !raceDateIn.value || !sec) { error.textContent = "Renseigne le nom, la date et le chrono visé (format h:mm:ss)."; error.hidden = false; return; }
            if (!(vals[0] > vals[1] && vals[1] > 30)) { error.textContent = "La FC max doit être supérieure à la FC de repos."; error.hidden = false; return; }
            save({
                ...p,
                hrMax: vals[0], hrRest: vals[1],
                targets: { Run: Number(tRun.value), Tennis: Number(tTen.value), Swim: Number(tSwim.value), Golf: Number(tGolf.value), RockClimbing: Number(tClimb.value) },
                race: { name: raceName.value.trim(), date: raceDateIn.value, distanceKm: Number(raceDist.value), targetSec: sec },
                golf: { rating: Number(gR.value), slope: Number(gS.value) },
            });
            close();
        });

        const dialog = h("div", { class: "prof-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "prof-title" },
            h("header", { class: "prof-head" },
                h("div", {}, h("h2", { id: "prof-title" }, "Profil sportif"), h("p", {}, "Utilisé par le dashboard (objectifs, charge d'entraînement, index golf) et par le coach.")),
                h("button", { type: "button", class: "prof-x", "aria-label": "Fermer", onclick: close }, "×")),
            form);
        const overlay = h("div", { class: "prof-overlay", onclick: (e) => { if (e.target === overlay) close(); } }, dialog);
        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKey);
        const first = opts.focus === "targets" ? tRun : raceName;
        first.focus();
    }

    global.AltarunProfile = { get, save, onChange, openEditor, distanceOf, raceDate, DEFAULT, frDate };
})(window);

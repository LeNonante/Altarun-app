/* ==========================================================================
   Altarun — Dashboard multi-sport
   --------------------------------------------------------------------------
   Lit le contrat `fct_activities` (GET /dashboard/data), applique les filtres
   (sport × période), calcule les KPI via AltarunMetrics et dessine via
   AltarunCharts. Tout le rendu part d'un seul état => les chiffres de tous les
   blocs sont toujours cohérents entre eux.
   ========================================================================== */
(function () {
    "use strict";

    const M = window.AltarunMetrics;
    const V = window.AltarunCharts;
    const F = M.fmt;

    const PERIODS = [
        { weeks: 4, label: "4 sem." },
        { weeks: 12, label: "12 sem." },
        { weeks: 26, label: "6 mois" },
        { weeks: 52, label: "12 mois" },
    ];
    const ZONES = [
        { name: "Z1 Récup", color: "#184f95" },
        { name: "Z2 Endurance", color: "#256abf" },
        { name: "Z3 Tempo", color: "#3987e5" },
        { name: "Z4 Seuil", color: "#6da7ec", ink: "#0b0b0b" },
        { name: "Z5 VO2max", color: "#b7d3f6", ink: "#0b0b0b" },
    ];
    const SEQ = ["#1b2333", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"];
    const NEUTRAL_LINE = "#e8e8ec";
    const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
    const RUN_TYPES = { easy: "Footing", long: "Sortie longue", intervals: "Fractionné", tempo: "Tempo", race: "Compétition" };

    const state = { sport: "all", weeks: 12, view: "overview", pins: loadPins() };

    // KPI épinglés depuis le Studio (préférence locale du navigateur ; à terme : table API)
    function loadPins() {
        try { return JSON.parse(localStorage.getItem("altarun-pins") || "[]"); } catch (e) { return []; }
    }
    function savePins() {
        try { localStorage.setItem("altarun-pins", JSON.stringify(state.pins)); } catch (e) { /* stockage indisponible */ }
    }
    let DATA = null;

    // ------------------------------------------------------------- DOM utils
    function h(tag, attrs, ...children) {
        const n = document.createElement(tag);
        for (const k in attrs || {}) {
            if (k === "class") n.className = attrs[k];
            else if (k === "style") n.style.cssText = attrs[k];
            else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
        }
        children.flat().forEach((c) => c != null && n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c));
        return n;
    }

    const seqColor = (v, max) => {
        if (!v) return SEQ[0];
        const i = Math.min(SEQ.length - 1, 1 + Math.floor((v / (max || 1)) * (SEQ.length - 1.01)));
        return SEQ[i];
    };
    const divColor = (r) => {
        // Divergent bleu <-> rouge, gris au centre (|r| < 0,1)
        const a = Math.abs(r);
        if (a < 0.1) return "#383835";
        const pos = ["#1c3a63", "#256abf", "#3987e5", "#6da7ec"];
        const neg = ["#5a2626", "#a83c3c", "#d65555", "#e88a8a"];
        const i = Math.min(3, Math.floor(a / 0.2));
        return r > 0 ? pos[i] : neg[i];
    };
    const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    const monthTick = (t) => { const d = new Date(t); return `${MONTHS[d.getMonth()]}${d.getMonth() === 0 ? " " + String(d.getFullYear()).slice(2) : ""}`; };

    function monthTicks(from, to) {
        const out = [];
        let d = new Date(from.getFullYear(), from.getMonth() + 1, 1);
        while (d <= to) { out.push(d.getTime()); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
        const step = Math.ceil(out.length / 6);
        const t = out.filter((_, i) => i % step === 0);
        return [from.getTime(), ...t, to.getTime()].filter((v, i, a) => i === 0 || i === a.length - 1 || (v - a[0] > 12 * M.DAY && a[a.length - 1] - v > 12 * M.DAY));
    }

    // ------------------------------------------------------------- composants
    function card(title, subtitle, opts = {}) {
        const body = h("div", { class: "dash-card-body" });
        const tableHost = h("div", { class: "dash-card-table", hidden: true });
        const btn = h("button", { class: "dash-link-btn", type: "button", hidden: true }, "Tableau");
        const legend = h("div", { class: "dash-legend" });
        const root = h("section", { class: `dash-card ${opts.span ? "span-" + opts.span : ""}` },
            h("header", { class: "dash-card-head" },
                h("div", {}, h("h3", {}, title), subtitle ? h("p", { class: "dash-card-sub" }, subtitle) : null),
                btn),
            legend, body, tableHost);
        let table = null;
        btn.addEventListener("click", () => {
            const showTable = tableHost.hidden;
            tableHost.hidden = !showTable;
            body.hidden = showTable;
            btn.textContent = showTable ? "Graphique" : "Tableau";
            if (showTable && table) renderTable(tableHost, table);
        });
        return {
            root, body,
            setTable(t) { table = t; btn.hidden = !t; },
            setLegend(items) {
                legend.replaceChildren(...items.map((it) => h("span", { class: "dash-legend-item" },
                    h("span", { class: `dash-legend-key ${it.line ? "line" : ""} ${it.dashed ? "dashed" : ""}`, style: `--c:${it.color}` }), it.name)));
            },
        };
    }

    function renderTable(host, t) {
        host.replaceChildren(h("div", { class: "dash-table-wrap" }, h("table", { class: "dash-table" },
            h("thead", {}, h("tr", {}, t.head.map((c) => h("th", {}, c)))),
            h("tbody", {}, t.rows.map((r) => h("tr", {}, r.map((c) => h("td", {}, String(c)))))))));
    }

    function statusBadge(st) {
        if (!st || st.key === "na") return null;
        const icon = { good: "✓", warning: "!", serious: "▲", critical: "✕" }[st.key];
        return h("span", { class: `dash-status ${st.key}` }, h("span", { class: "dash-status-icon", "aria-hidden": "true" }, icon), st.label);
    }

    /** delta: { value, unit, digits, goodWhenUp (true|false|null) } */
    function deltaChip(d) {
        if (!d || d.value == null || !isFinite(d.value)) return h("span", { class: "dash-delta neutral" }, "— vs préc.");
        if (Number(d.value.toFixed(d.digits || 0)) === 0) return h("span", { class: "dash-delta neutral" }, "± 0", h("span", { class: "dash-delta-ctx" }, " vs préc."));
        const up = d.value > 0;
        const good = d.goodWhenUp == null || Math.abs(d.value) < 1e-9 ? null : up === d.goodWhenUp;
        return h("span", { class: `dash-delta ${good == null ? "neutral" : good ? "good" : "bad"}`, title: `Comparé aux ${state.weeks} semaines précédentes` },
            h("span", { "aria-hidden": "true" }, up ? "▲ " : d.value < 0 ? "▼ " : ""),
            F.signed(d.value, d.digits || 0, d.unit || ""), h("span", { class: "dash-delta-ctx" }, " vs préc."));
    }

    function tile(t) {
        const sp = h("div", { class: "dash-spark" });
        const node = h("article", { class: "dash-tile" },
            h("div", { class: "dash-tile-label" }, t.label, t.hint ? h("span", { class: "dash-hint", title: t.hint, tabindex: 0 }, "?") : null),
            h("div", { class: "dash-tile-value" }, t.value, t.unit ? h("span", { class: "dash-tile-unit" }, t.unit) : null),
            t.status ? statusBadge(t.status) : deltaChip(t.delta),
            t.sub ? h("div", { class: "dash-tile-sub" }, t.sub) : null,
            t.spark ? sp : null);
        if (t.spark) requestAnimationFrame(() => V.sparkline(sp, t.spark.values, t.spark.color));
        return node;
    }

    function insight(i) {
        const body = [];
        if (i.rows) {
            body.push(h("div", { class: "dash-cmp" }, i.rows.map((r) => h("div", { class: "dash-cmp-row" },
                h("span", { class: "dash-cmp-label" }, r.label),
                r.bar != null
                    ? h("span", { class: "dash-cmp-track" }, h("span", { class: "dash-cmp-bar", style: `width:${(r.bar * 100).toFixed(1)}%;background:${r.color}` }))
                    : h("span", { class: "dash-cmp-meta" }, r.meta || ""),
                h("strong", { class: "dash-cmp-value" }, r.value)))));
        }
        if (i.stack) {
            body.push(h("div", { class: "dash-stack" }, i.stack.map((p) => h("span", { class: "dash-stack-seg", style: `flex:${p.v.toFixed(2)};background:${p.color}`, title: `${p.label} : ${F.fr(p.v)} %` }))),
                h("div", { class: "dash-stack-legend" }, i.stack.map((p) => h("span", {}, h("span", { class: "dash-legend-key", style: `--c:${p.color}` }), `${p.label} ${F.fr(p.v)} %`))));
        }
        return h("article", { class: "dash-insight" },
            h("div", { class: "dash-insight-tag" }, i.tag),
            h("div", { class: "dash-insight-value" }, i.value),
            h("div", { class: "dash-insight-label" }, i.label),
            ...body,
            h("div", { class: "dash-insight-method" }, i.foot));
    }

    // ------------------------------------------------------------- dimensions dérivées
    /**
     * Colonnes calculées utilisées par le Studio (équivalent d'un modèle dbt intermédiaire) :
     * activité / charge de la veille, forme du jour (TSB), semaine avec golf, moment de la journée.
     */
    function enrich(data) {
        const byDay = new Map();
        data.acts.forEach((a) => {
            const d = byDay.get(a.day) || { load: 0, tennis: false, run: false };
            d.load += a.load; d.tennis = d.tennis || a.sport_type === "Tennis"; d.run = d.run || a.sport_type === "Run";
            byDay.set(a.day, d);
        });
        const tsb = new Map(M.pmc(M.dailyLoad(data.acts, data.first, data.last)).map((p) => [M.dayKey(p.date), p.tsb]));
        const golfWeeks = new Set(data.acts.filter((a) => a.sport_type === "Golf").map((a) => M.dayKey(M.mondayOf(a.date))));
        data.acts.forEach((a) => {
            const pv = byDay.get(M.dayKey(M.addDays(a.date, -1)));
            a.d_veille = !pv ? "Repos" : pv.tennis ? "Tennis" : pv.run ? "Course" : "Autre sport";
            a.d_chargeVeille = !pv ? "Repos" : pv.load < 80 ? "Légère (< 80)" : pv.load <= 150 ? "Modérée (80–150)" : "Forte (> 150)";
            const t = tsb.get(a.day) ?? 0;
            a.d_forme = t > 5 ? "Frais" : t >= -10 ? "Équilibré" : t >= -30 ? "Productif" : "Surcharge";
            a.d_golfWeek = golfWeeks.has(M.dayKey(M.mondayOf(a.date))) ? "Oui" : "Non";
            const hr = a.date.getHours();
            a.d_moment = hr < 11 ? "Matin" : hr < 15 ? "Midi" : hr < 18 ? "Après-midi" : "Soir";
        });
        return data;
    }

    // ------------------------------------------------------------- contexte
    function context() {
        // Période = N dernières semaines ISO complètes (lun → dim) : moyennes hebdo exactes.
        const end = M.addDays(M.mondayOf(DATA.last), DATA.last.getDay() === 0 ? 0 : -1);
        const from = M.addDays(end, -state.weeks * 7 + 1);
        const prevFrom = M.addDays(from, -state.weeks * 7);
        const prevTo = M.addDays(from, -1);
        const all = DATA.acts;
        const bySport = (arr) => (state.sport === "all" ? arr : arr.filter((a) => a.sport_type === state.sport));
        const cur = bySport(M.inRange(all, from, end));
        const prev = prevFrom >= M.mondayOf(DATA.first) ? bySport(M.inRange(all, prevFrom, prevTo)) : null;
        const grain = state.weeks <= 4 ? "day" : "week";
        const bks = M.buckets(from, end, grain);
        const wbks = M.buckets(from, end, "week");
        return { end, from, prevFrom, prevTo, all, cur, prev, grain, bks, wbks, weeks: state.weeks };
    }

    function bucketSeries(acts, bks, grain, f) {
        const idx = new Map(bks.map((b, i) => [b.key, i]));
        const out = new Array(bks.length).fill(0);
        acts.forEach((a) => { const i = idx.get(M.bucketOf(a.date, grain)); if (i != null) out[i] += f(a); });
        return out;
    }
    const bucketLabels = (bks, grain) => bks.map((b) => (grain === "day" ? `${b.start.getDate()}/${b.start.getMonth() + 1}` : shortDate(b.start)));
    const bucketTips = (bks, grain) => bks.map((b) => (grain === "day"
        ? b.start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
        : `Semaine ${M.isoWeek(b.start)} · du ${shortDate(b.start)} au ${shortDate(M.addDays(b.start, 6))}`));
    const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);

    // =====================================================================
    // Vue « Tout »
    // =====================================================================
    function renderAll(root, ctx) {
        const { cur, prev, weeks, wbks } = ctx;
        const hours = M.sum(cur, (a) => a.hours);
        const loadW = M.sum(cur, (a) => a.load) / weeks;
        const daily = M.dailyLoad(ctx.all, DATA.first, ctx.end);
        const pm = M.pmc(daily);
        const today = pm[pm.length - 1];
        const weeklyHours = bucketSeries(cur, wbks, "week", (a) => a.hours);
        const weeklyCount = bucketSeries(cur, wbks, "week", () => 1);
        // Régularité = semaines où au moins 4 sports différents ont été pratiqués
        const sportsPerWeek = (acts, bks) => {
            const idx = new Map(bks.map((b, i) => [b.key, i]));
            const sets = bks.map(() => new Set());
            acts.forEach((a) => { const i = idx.get(M.bucketOf(a.date, "week")); if (i != null) sets[i].add(a.sport_type); });
            return sets.map((x) => x.size);
        };
        const regular = sportsPerWeek(cur, wbks).filter((c) => c >= 4).length / wbks.length;
        const allW = M.buckets(DATA.first, ctx.end, "week");
        const allSports = sportsPerWeek(ctx.all, allW);
        let streak = 0;
        for (let i = allSports.length - 1; i >= 0 && allSports[i] >= 4; i--) streak++;

        root.append(h("div", { class: "dash-tiles" },
            tile({
                label: "Volume d'entraînement", value: F.fr(hours / weeks, 1), unit: "h / sem.",
                delta: prev && { value: pct(hours, M.sum(prev, (a) => a.hours)), unit: " %", goodWhenUp: true },
                sub: `${F.fr(hours, 0)} h sur la période · 5 sports`, spark: { values: weeklyHours, color: NEUTRAL_LINE },
            }),
            tile({
                label: "Séances", value: F.fr(cur.length), unit: "",
                delta: prev && { value: pct(cur.length, prev.length), unit: " %", goodWhenUp: true },
                sub: `${F.fr(cur.length / weeks, 1)} séances / semaine`, spark: { values: weeklyCount, color: NEUTRAL_LINE },
            }),
            tile({
                label: "Charge hebdo (TRIMP)", value: F.fr(loadW), unit: "",
                hint: "TRIMP de Banister : durée × intensité cardiaque pondérée. Unité commune à tous les sports.",
                delta: prev && { value: pct(loadW, M.sum(prev, (a) => a.load) / weeks), unit: " %", goodWhenUp: null },
                sub: `Course ${F.fr((100 * M.sum(cur.filter((a) => a.sport_type === "Run"), (a) => a.load)) / (M.sum(cur, (a) => a.load) || 1))} % de la charge`,
                spark: { values: bucketSeries(cur, wbks, "week", (a) => a.load), color: NEUTRAL_LINE },
            }),
            tile({
                label: "Forme du jour (TSB)", value: F.signed(today.tsb, 0), unit: "",
                hint: "Fraîcheur = forme de fond (CTL, 42 j) − fatigue (ATL, 7 j).",
                status: M.tsbStatus(today.tsb),
                sub: `Forme de fond ${F.fr(today.ctl)} · Fatigue ${F.fr(today.atl)}`,
            }),
            tile({
                label: "Ratio aigu / chronique", value: F.fr(today.acwr, 2), unit: "",
                hint: "ACWR (Gabbett) : charge moyenne 7 j / 28 j. Zone sûre 0,8 – 1,3 ; > 1,5 = risque de blessure accru.",
                status: M.acwrStatus(today.acwr),
                sub: "Charge 7 j vs 28 j · zone sûre 0,8 – 1,3",
            }),
            tile({
                label: "Régularité", value: F.fr(regular * 100), unit: "%",
                hint: "Part des semaines où au moins 4 des 5 sports ont été pratiqués.",
                status: { key: regular >= 0.7 ? "good" : "warning", label: `Série en cours : ${streak} sem.` },
                sub: "des semaines avec ≥ 4 sports pratiqués",
            }),
        ));

        const grid = h("div", { class: "dash-grid" });
        root.append(grid);

        // --- Volume hebdo par sport (empilé)
        {
            const c = card("Volume hebdomadaire par sport", "Heures d'activité par semaine ISO · moyenne mobile 4 semaines", { span: 12 });
            grid.append(c.root);
            const bars = M.SPORTS.map((s) => ({ name: s.label, color: s.color, values: bucketSeries(cur.filter((a) => a.sport_type === s.key), wbks, "week", (a) => a.hours) }));
            const total = weeklyHours;
            const roll = M.rolling(bucketSeries(ctx.all, allW, "week", (a) => a.hours), 4).slice(-wbks.length);
            c.setLegend([...M.SPORTS.map((s) => ({ name: s.label, color: s.color })), { name: "Moyenne mobile 4 sem.", color: NEUTRAL_LINE, line: true }]);
            c.setTable(V.bandChart(c.body, {
                labels: bucketLabels(wbks, "week"), tipLabels: bucketTips(wbks, "week"),
                bars, lines: [{ name: "Moyenne mobile 4 sem.", color: NEUTRAL_LINE, values: roll }],
                yFormat: (v) => F.fr(v, v % 1 ? 1 : 0) + " h", height: 260,
            }));
            void total;
        }

        // --- PMC
        {
            const c = card("Forme, fatigue & fraîcheur", "Modèle impulsion-réponse (Banister) sur la charge TRIMP tous sports confondus", { span: 8 });
            grid.append(c.root);
            const win = pm.filter((p) => p.date >= ctx.from);
            const labels = win.map((p) => shortDate(p.date));
            const tips = win.map((p) => p.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "long" }));
            c.setLegend([
                { name: "Forme de fond (CTL 42 j)", color: NEUTRAL_LINE, line: true },
                { name: "Fatigue (ATL 7 j)", color: "#d55181", line: true },
                { name: "Fraîcheur (TSB) +", color: "#3987e5" },
                { name: "Fraîcheur (TSB) −", color: "#e66767" },
            ]);
            const top = h("div", {}), bottom = h("div", { class: "dash-subchart" });
            c.body.append(top, h("div", { class: "dash-subchart-label" }, "Fraîcheur (TSB)"), bottom);
            const t1 = V.bandChart(top, {
                labels, tipLabels: tips,
                lines: [
                    { name: "Forme de fond (CTL)", color: NEUTRAL_LINE, values: win.map((p) => p.ctl), area: true },
                    { name: "Fatigue (ATL)", color: "#d55181", values: win.map((p) => p.atl) },
                ],
                yMin: 0, yFormat: (v) => F.fr(v), height: 200,
            });
            V.bandChart(bottom, {
                labels, tipLabels: tips, stacked: false,
                bars: [
                    { name: "Fraîcheur +", color: "#3987e5", values: win.map((p) => (p.tsb >= 0 ? p.tsb : 0)) },
                    { name: "Fraîcheur −", color: "#e66767", values: win.map((p) => (p.tsb < 0 ? p.tsb : 0)) },
                ],
                yFormat: (v) => F.signed(v), height: 110, tickCount: 2,
            });
            t1.table.head.push("Fraîcheur (TSB)");
            t1.table.rows.forEach((r, i) => r.push(F.signed(win[i].tsb)));
            c.setTable(t1.table);
        }

        // --- Répartition
        {
            const c = card("Répartition du temps", "Part de chaque sport dans le volume horaire", { span: 4 });
            grid.append(c.root);
            const rows = M.SPORTS.map((s) => {
                const a = cur.filter((x) => x.sport_type === s.key);
                const hh = M.sum(a, (x) => x.hours);
                return { label: s.label, value: hh, color: s.color, note: `${F.fr((100 * hh) / (hours || 1))} % · ${a.length} séance${a.length > 1 ? "s" : ""}` };
            });
            c.setTable(V.hbars(c.body, { rows, format: (v) => F.fr(v, 0) + " h", labelWidth: 74, valueWidth: 175 }));
            const loadRows = M.SPORTS.map((s) => ({ s, l: M.sum(cur.filter((x) => x.sport_type === s.key), (x) => x.load) }));
            const totalLoad = M.sum(loadRows, (r) => r.l) || 1;
            const ratio = loadRows.map((r) => ({ ...r, share: r.l / totalLoad, hshare: M.sum(cur.filter((x) => x.sport_type === r.s.key), (x) => x.hours) / (hours || 1) }));
            const intense = ratio.slice().sort((a, b) => b.share / (b.hshare || 1) - a.share / (a.hshare || 1))[0];
            c.body.append(h("p", { class: "dash-footnote" },
                `${intense.s.label} : ${F.fr(intense.hshare * 100)} % du temps mais ${F.fr(intense.share * 100)} % de la charge — le sport le plus « coûteux » par heure.`));
        }

        // --- Insights croisés
        renderInsights(grid, ctx, true);

        // --- Calendrier
        {
            const c = card("Calendrier de charge", "Charge TRIMP quotidienne, tous sports", { span: 7 });
            grid.append(c.root);
            const byDay = new Map();
            cur.forEach((a) => { const k = a.day; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(a); });
            const days = daily.filter((d) => d.date >= ctx.from).map((d) => {
                const list = byDay.get(M.dayKey(d.date)) || [];
                return {
                    date: d.date, value: d.value,
                    label: d.date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
                    rows: list.length
                        ? [{ value: F.fr(d.value), label: "TRIMP" }, ...list.map((a) => ({ value: F.duration(a.moving_time_min), label: a.name, color: M.SPORT[a.sport_type].color }))]
                        : [{ value: "Repos", label: "" }],
                };
            });
            const max = Math.max(...days.map((d) => d.value));
            c.setTable(V.calendar(c.body, { days, color: (v) => seqColor(v, max * 0.8), format: (v) => F.fr(v), valueLabel: "TRIMP", monthLabel: (d) => MONTHS[d.getMonth()] }));
            const restDays = days.filter((d) => d.value === 0).length;
            c.body.append(h("div", { class: "dash-scale" },
                h("span", {}, "Repos"), ...SEQ.map((col) => h("span", { class: "dash-scale-swatch", style: `background:${col}` })), h("span", {}, "Charge élevée"),
                h("span", { class: "dash-scale-note" }, `${restDays} jours de repos sur ${days.length}`)));
        }

        // --- Matrice jour × sport
        {
            const c = card("Routine hebdomadaire", "Heures moyennes par jour de la semaine", { span: 5 });
            grid.append(c.root);
            const vals = M.SPORTS.map((s) => DOW.map((_, j) => M.sum(cur.filter((a) => a.sport_type === s.key && (a.date.getDay() + 6) % 7 === j), (a) => a.hours) / weeks));
            const max = Math.max(...vals.flat());
            c.setTable(V.matrix(c.body, {
                rows: M.SPORTS.map((s) => s.label), cols: DOW, values: vals.map((r) => r.map((v) => (v > 0 ? v : null))),
                color: (v) => seqColor(v, max), format: (v) => F.duration(v * 60), showValues: false, valueLabel: "en moyenne / semaine",
            }));
        }

        // --- Corrélations
        {
            // Minimum 26 semaines : en dessous, un r de Pearson n'a pas de sens statistique.
            const nW = Math.max(weeks, 26);
            const cFrom = M.addDays(ctx.end, -nW * 7 + 1);
            const cW = M.buckets(cFrom, ctx.end, "week");
            const cActs = M.inRange(ctx.all, cFrom, ctx.end);
            const c = card("Corrélations entre sports", `Pearson sur les volumes hebdomadaires · ${nW} sem. · bleu = vont ensemble, rouge = se substituent`, { span: 5 });
            grid.append(c.root);
            const series = M.SPORTS.map((s) => bucketSeries(cActs.filter((a) => a.sport_type === s.key), cW, "week", (a) => a.hours));
            const labs = M.SPORTS.map((s) => s.label);
            const vals = series.map((x, i) => series.map((y, j) => (i === j ? null : M.pearson(x, y))));
            c.setTable(V.matrix(c.body, {
                rows: labs, cols: labs.map((l) => l.slice(0, 4) + "."), values: vals, labelWidth: 74,
                color: divColor, format: (v) => F.fr(v, 2), showValues: true, labelInk: (v) => (Math.abs(v) >= 0.6 ? "#0b0b0b" : "#fff"),
                cellTitle: (i, j) => `${labs[i]} × ${labs[j]}`, valueLabel: "r de Pearson",
            }));
            c.body.append(h("p", { class: "dash-footnote" }, `n = ${cW.length} semaines. Corrélation ≠ causalité : les semaines de vacances (plus de natation, pas de tennis) pèsent fortement. Les effets causaux sont isolés dans les analyses croisées.`));
        }

        // --- Zones FC
        {
            const c = card("Intensité par sport", "Répartition du temps par zone cardiaque (% FC max)", { span: 7 });
            grid.append(c.root);
            c.setLegend(ZONES.map((z) => ({ name: z.name, color: z.color })));
            const rows = M.SPORTS.map((s) => ({
                label: s.label,
                values: [0, 1, 2, 3, 4].map((z) => M.sum(cur.filter((a) => a.sport_type === s.key), (a) => a.hr_zones_min[z])),
            })).filter((r) => M.sum(r.values) > 0);
            c.setTable(V.hstack(c.body, { rows, keys: ZONES, format: (v) => F.duration(v), valueLabel: "cumulés" }));
        }

        renderActivities(grid, ctx, "Dernières activités");
    }

    // =====================================================================
    // Analyses croisées (le cœur « data » du dashboard)
    // =====================================================================
    function renderInsights(grid, ctx, isAll) {
        const { all, end } = ctx;
        // Au moins 26 semaines d'historique pour que les écarts soient robustes.
        const nW = Math.max(ctx.weeks, 26);
        const winFrom = M.addDays(end, -nW * 7 + 1);
        const pool = M.inRange(all, winFrom, end);
        const runs = pool.filter((a) => a.sport_type === "Run" && a.workout_type !== "race");
        const tennisDays = new Set(pool.filter((a) => a.sport_type === "Tennis").map((a) => a.day));
        const paceOf = (rs) => (M.sum(rs, (r) => r.moving_time_min) * 60) / (M.sum(rs, (r) => r.distance_km) || 1);
        const items = [];

        // 1. Tennis la veille -> allure des footings (même type de séance)
        {
            const easy = runs.filter((r) => r.workout_type === "easy");
            const after = easy.filter((r) => tennisDays.has(M.dayKey(M.addDays(r.date, -1))));
            const fresh = easy.filter((r) => !tennisDays.has(M.dayKey(M.addDays(r.date, -1))));
            if (after.length > 2 && fresh.length > 2) {
                const pA = paceOf(after), pF = paceOf(fresh);
                items.push({
                    tag: "Tennis → Course",
                    value: `${F.signed(pA - pF, 1)} s/km`,
                    label: "Allure des footings le lendemain d'un tennis",
                    rows: [
                        { label: "Après tennis", value: `${F.pace(pA)}/km`, meta: `${F.fr(M.mean(after, (r) => r.avg_hr))} bpm` },
                        { label: "Sans tennis", value: `${F.pace(pF)}/km`, meta: `${F.fr(M.mean(fresh, (r) => r.avg_hr))} bpm` },
                    ],
                    foot: `n = ${after.length} vs ${fresh.length} footings · ${nW} sem.`,
                });
            }
        }

        // 2. Semaine de golf -> sortie longue
        {
            const golfWeeks = new Set(pool.filter((a) => a.sport_type === "Golf").map((a) => M.dayKey(M.mondayOf(a.date))));
            const longs = runs.filter((r) => r.workout_type === "long");
            const g = longs.filter((r) => golfWeeks.has(M.dayKey(M.mondayOf(r.date))));
            const ng = longs.filter((r) => !golfWeeks.has(M.dayKey(M.mondayOf(r.date))));
            if (g.length > 2 && ng.length > 2) {
                const dG = M.mean(g, (r) => r.distance_km), dN = M.mean(ng, (r) => r.distance_km);
                items.push({
                    tag: "Golf → Sortie longue",
                    value: `${F.signed(dG - dN, 1)} km`,
                    label: "Distance de la sortie longue en semaine de golf",
                    rows: [
                        { label: "Semaine golf", value: `${F.fr(dG, 1)} km`, bar: dG / Math.max(dG, dN), color: M.SPORT.Golf.color },
                        { label: "Sans golf", value: `${F.fr(dN, 1)} km`, bar: dN / Math.max(dG, dN), color: "#5a5a66" },
                    ],
                    foot: `n = ${g.length} vs ${ng.length} sorties longues · ${nW} sem.`,
                });
            }
        }

        // 3. Efficacité aérobie (tendance)
        {
            const easy = runs.filter((r) => r.workout_type === "easy" || r.workout_type === "long");
            if (easy.length > 6) {
                const x = easy.map((r) => (r.date - winFrom) / M.DAY), y = easy.map(M.efficiency);
                const lr = M.linreg(x, y);
                const v0 = lr.intercept, v1 = lr.intercept + lr.slope * ((end - winFrom) / M.DAY);
                items.push({
                    tag: "Efficacité aérobie",
                    value: `${F.signed(((v1 - v0) / v0) * 100, 1)} %`,
                    label: "Vitesse par battement cardiaque, footings et sorties longues",
                    rows: [
                        { label: "Début de période", value: `${F.fr(v0, 3)}`, meta: "m/min/bpm" },
                        { label: "Aujourd'hui", value: `${F.fr(v1, 3)}`, meta: "m/min/bpm" },
                    ],
                    foot: `Tendance linéaire · n = ${easy.length} sorties · ${nW} sem.`,
                });
            }
        }

        // 4. Polarisation (course)
        {
            const z = [0, 1, 2, 3, 4].map((i) => M.sum(runs, (r) => r.hr_zones_min[i]));
            const tot = M.sum(z) || 1;
            const parts = [
                { label: "Z1–Z2", v: ((z[0] + z[1]) / tot) * 100, color: ZONES[1].color },
                { label: "Z3", v: (z[2] / tot) * 100, color: ZONES[2].color },
                { label: "Z4–Z5", v: ((z[3] + z[4]) / tot) * 100, color: ZONES[3].color },
            ];
            items.push({
                tag: "Polarisation course",
                value: `${F.fr(parts[0].v)} %`,
                label: "Temps de course en basse intensité (cible 80 %)",
                stack: parts,
                foot: `Zones à 60/70/80/90 % de FC max · ${nW} sem.`,
            });
        }

        if (!items.length) return;
        const c = card("Analyses croisées", isAll ? "Effets mesurés entre sports" : "Facteurs qui influencent la course", { span: 12 });
        c.body.append(h("div", { class: "dash-insights" }, items.map(insight)));
        grid.append(c.root);
    }

    // =====================================================================
    // Vues par sport
    // =====================================================================
    function weeklyVolumeCard(grid, ctx, sport, opts = {}) {
        const s = M.SPORT[sport];
        const isKm = opts.km;
        const f = isKm ? (a) => a.distance_km || 0 : (a) => a.hours;
        const allW = M.buckets(DATA.first, ctx.end, ctx.grain);
        const sportAll = ctx.all.filter((a) => a.sport_type === sport);
        const vals = bucketSeries(ctx.cur, ctx.bks, ctx.grain, f);
        const roll = ctx.grain === "week" ? M.rolling(bucketSeries(sportAll, allW, "week", f), 4).slice(-ctx.bks.length) : null;
        const unit = isKm ? " km" : " h";
        const c = card(ctx.grain === "week" ? `Volume hebdomadaire — ${s.label}` : `Volume quotidien — ${s.label}`,
            `${isKm ? "Kilomètres" : "Heures"} par ${ctx.grain === "week" ? "semaine" : "jour"}${roll ? " · moyenne mobile 4 sem." : ""}`, { span: opts.span || 8 });
        grid.append(c.root);
        const legend = [{ name: s.label, color: s.color }];
        if (roll) legend.push({ name: "Moyenne mobile 4 sem.", color: NEUTRAL_LINE, line: true });
        if (ctx.grain === "week") legend.push({ name: s.targetLabel, color: NEUTRAL_LINE, line: true, dashed: true });
        c.setLegend(legend);
        c.setTable(V.bandChart(c.body, {
            labels: bucketLabels(ctx.bks, ctx.grain), tipLabels: bucketTips(ctx.bks, ctx.grain),
            bars: [{ name: s.label, color: s.color, values: vals }],
            lines: roll ? [{ name: "Moyenne mobile 4 sem.", color: NEUTRAL_LINE, values: roll }] : [],
            refs: ctx.grain === "week" ? [{ value: isKm ? s.target : s.target, label: s.targetLabel }] : [],
            yFormat: (v) => F.fr(v, isKm || v % 1 === 0 ? 0 : 1) + unit, height: 250,
        }));
    }

    function zonesCard(grid, ctx, sport, span) {
        const c = card("Intensité cardiaque", "Temps passé par zone (% FC max)", { span: span || 4 });
        grid.append(c.root);
        const z = [0, 1, 2, 3, 4].map((i) => M.sum(ctx.cur, (a) => a.hr_zones_min[i]));
        c.setTable(V.hbars(c.body, {
            rows: ZONES.map((zz, i) => ({ label: zz.name, value: z[i], color: zz.color, note: `${F.fr((100 * z[i]) / (M.sum(z) || 1))} %` })),
            format: (v) => F.duration(v), labelWidth: 96, valueWidth: 120,
        }));
    }

    function trendPoints(points) {
        if (points.length < 4) return null;
        const lr = M.linreg(points.map((p) => p.x), points.map((p) => p.y));
        const xs = [Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x))];
        return { color: NEUTRAL_LINE, points: xs.map((x) => ({ x, y: lr.intercept + lr.slope * x })) };
    }

    // ---------------------------------------------------------------- Course
    function renderRun(root, ctx) {
        const { cur, prev, weeks } = ctx;
        const km = M.sum(cur, (a) => a.distance_km);
        const min = M.sum(cur, (a) => a.moving_time_min);
        const paceS = (min * 60) / (km || 1);
        const prevKm = prev && M.sum(prev, (a) => a.distance_km);
        const prevPace = prev && (M.sum(prev, (a) => a.moving_time_min) * 60) / (prevKm || 1);
        const easy = cur.filter((a) => a.workout_type === "easy" || a.workout_type === "long");
        const prevEasy = prev && prev.filter((a) => a.workout_type === "easy" || a.workout_type === "long");
        const ef = M.mean(easy, M.efficiency), prevEf = prevEasy && M.mean(prevEasy, M.efficiency);
        const allLoad = M.sum(M.inRange(ctx.all, ctx.from, ctx.end), (a) => a.load);
        const wk = bucketSeries(cur, ctx.wbks, "week", (a) => a.distance_km);

        root.append(h("div", { class: "dash-tiles" },
            tile({ label: "Distance hebdo", value: F.fr(km / weeks, 1), unit: "km / sem.", delta: prev && { value: km / weeks - prevKm / weeks, digits: 1, unit: " km", goodWhenUp: true }, sub: `${F.fr(km)} km sur la période · objectif ${M.SPORT.Run.target}`, spark: { values: wk, color: M.SPORT.Run.color } }),
            tile({ label: "Allure moyenne", value: F.pace(paceS), unit: "/ km", delta: prev && { value: paceS - prevPace, digits: 1, unit: " s/km", goodWhenUp: false }, sub: `${F.fr(min / 60 / weeks, 1)} h de course / semaine` }),
            tile({ label: "Sorties", value: F.fr(cur.length), unit: "", delta: prev && { value: cur.length - prev.length, goodWhenUp: true }, sub: `${F.fr(cur.length / weeks, 1)} / semaine · ${cur.filter((a) => ["intervals", "tempo"].includes(a.workout_type)).length} séances qualité` }),
            tile({ label: "Dénivelé positif", value: F.fr(M.sum(cur, (a) => a.elevation_gain_m)), unit: "m D+", delta: prev && { value: pct(M.sum(cur, (a) => a.elevation_gain_m), M.sum(prev, (a) => a.elevation_gain_m)), unit: " %", goodWhenUp: null }, sub: `${F.fr(M.sum(cur, (a) => a.elevation_gain_m) / (km || 1), 1)} m / km` }),
            tile({ label: "Efficacité aérobie", value: F.fr(ef, 3), unit: "m/min/bpm", hint: "EF = vitesse / FC moyenne sur footings et sorties longues. Plus haut = mieux.", delta: prevEf && { value: pct(ef, prevEf), digits: 1, unit: " %", goodWhenUp: true }, sub: `FC moyenne ${F.fr(M.mean(cur, (a) => a.avg_hr))} bpm` }),
            tile({ label: "Part de la charge totale", value: F.fr((100 * M.sum(cur, (a) => a.load)) / (allLoad || 1)), unit: "%", sub: "de ton TRIMP tous sports", status: { key: "good", label: `${F.fr(M.sum(cur, (a) => a.load) / weeks)} TRIMP / sem.` } }),
        ));

        const grid = h("div", { class: "dash-grid" });
        root.append(grid);
        weeklyVolumeCard(grid, ctx, "Run", { km: true, span: 8 });

        // Prédictions
        {
            const c = card("Prédictions de course", "Formule de Riegel à partir de ta meilleure performance récente", { span: 4 });
            grid.append(c.root);
            const pool = M.inRange(ctx.all, M.addDays(ctx.end, -365), ctx.end).filter((a) => a.sport_type === "Run" && a.distance_km >= 5);
            // référence : meilleure « performance équivalente semi » (compétitions + séances qualité)
            const refs = pool.map((a) => ({ a, eq: M.riegel(a.moving_time_min * 60, a.distance_km, 21.0975) }));
            const ref = refs.filter((r) => r.a.workout_type === "race").sort((x, y) => x.eq - y.eq)[0] || refs.sort((x, y) => x.eq - y.eq)[0];
            if (ref) {
                const t = ref.a.moving_time_min * 60, d = ref.a.distance_km;
                const rows = [["5 km", 5], ["10 km", 10], ["Semi-marathon", 21.0975], ["Marathon", 42.195]].map(([lab, dist]) => {
                    const sec = M.riegel(t, d, dist);
                    return h("div", { class: "dash-pred-row" }, h("span", { class: "dash-pred-label" }, lab), h("strong", {}, F.hms(sec)), h("span", { class: "dash-pred-pace" }, F.pace(sec / dist) + "/km"));
                });
                c.body.append(h("div", { class: "dash-pred" }, rows),
                    h("p", { class: "dash-footnote" }, `Référence : ${ref.a.name} du ${ref.a.date.toLocaleDateString("fr-FR")} — ${F.fr(d, 1)} km en ${F.hms(t)}. Marathon : extrapolation, à confirmer par des sorties longues de 30 km et plus.`));
                c.setTable({ head: ["Distance", "Temps prédit", "Allure"], rows: [["5 km", 5], ["10 km", 10], ["Semi", 21.0975], ["Marathon", 42.195]].map(([l, dist]) => { const s = M.riegel(t, d, dist); return [l, F.hms(s), F.pace(s / dist)]; }) });
            }
        }

        // Allure × FC
        {
            const c = card("Allure vs fréquence cardiaque", "Chaque point = une sortie · en bas à droite = rapide et économique", { span: 6 });
            grid.append(c.root);
            const groups = [
                { name: "Endurance", color: "#3987e5", types: ["easy", "long"] },
                { name: "Qualité (fractionné, tempo)", color: "#d95926", types: ["intervals", "tempo"] },
                { name: "Compétition", color: "#199e70", types: ["race"] },
            ];
            const series = groups.map((g) => ({
                name: g.name, color: g.color,
                points: cur.filter((a) => g.types.includes(a.workout_type)).map((a) => ({ x: a.avg_hr, y: a.avg_pace_s_per_km, title: `${a.name} · ${shortDate(a.date)}` })),
            })).filter((s) => s.points.length);
            c.setLegend(series.map((s) => ({ name: s.name, color: s.color })));
            c.setTable(V.scatter(c.body, { series, invertY: true, xFormat: (v) => F.fr(v) + " bpm", yFormat: F.pace, xLabel: "FC moyenne", yLabel: "Allure", height: 270 }));
        }

        // Tendance EF
        {
            const c = card("Progression de l'efficacité aérobie", "EF des footings et sorties longues · droite = tendance", { span: 6 });
            grid.append(c.root);
            const pts = easy.map((a) => ({ x: a.date.getTime(), y: M.efficiency(a), title: `${a.name} · ${shortDate(a.date)}` }));
            if (pts.length) {
                c.setLegend([{ name: "Sortie", color: M.SPORT.Run.color }, { name: "Tendance (régression linéaire)", color: NEUTRAL_LINE, line: true }]);
                c.setTable(V.scatter(c.body, {
                    series: [{ name: "Sortie", color: M.SPORT.Run.color, points: pts }], trend: trendPoints(pts),
                    xTicks: monthTicks(ctx.from, ctx.end), xFormat: monthTick, yFormat: (v) => F.fr(v, 3), xLabel: "Date", yLabel: "EF", height: 270,
                }));
            }
        }

        // Types de séance
        {
            const c = card("Structure de l'entraînement", "Kilomètres par type de séance", { span: 4 });
            grid.append(c.root);
            const rows = Object.entries(RUN_TYPES).map(([k, lab]) => {
                const a = cur.filter((x) => x.workout_type === k);
                return { label: lab, value: M.sum(a, (x) => x.distance_km), color: M.SPORT.Run.color, note: a.length ? `${F.pace(M.sum(a, (x) => x.moving_time_min) * 60 / M.sum(a, (x) => x.distance_km))}/km` : "" };
            }).filter((r) => r.value > 0);
            c.setTable(V.hbars(c.body, { rows, format: (v) => F.fr(v) + " km", labelWidth: 100 }));
        }
        zonesCard(grid, ctx, "Run", 4);
        {
            const c = card("Records & compétitions", "Courses officielles · 24 derniers mois", { span: 4 });
            grid.append(c.root);
            const races = M.inRange(ctx.all, M.addDays(ctx.end, -730), ctx.end).filter((a) => a.sport_type === "Run" && a.workout_type === "race").reverse();
            c.body.append(h("div", { class: "dash-list" }, races.map((r) => h("div", { class: "dash-list-row" },
                h("div", {}, h("strong", {}, r.name), h("span", { class: "dash-muted" }, r.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }))),
                h("div", { class: "dash-list-right" }, h("strong", {}, F.hms(r.moving_time_min * 60)), h("span", { class: "dash-muted" }, F.pace(r.avg_pace_s_per_km) + "/km"))))));
        }
        renderInsights(grid, ctx, false);
        renderActivities(grid, ctx, "Dernières sorties");
    }

    // ---------------------------------------------------------------- Tennis
    function renderTennis(root, ctx) {
        const { cur, prev, weeks } = ctx;
        const hours = M.sum(cur, (a) => a.hours);
        const matches = cur.filter((a) => a.workout_type === "match");
        const wins = matches.filter((a) => a.result === "W").length;
        const prevM = prev && prev.filter((a) => a.workout_type === "match");
        const prevRate = prevM && prevM.length ? prevM.filter((a) => a.result === "W").length / prevM.length : null;
        const rate = matches.length ? wins / matches.length : null;
        const hrMatch = M.mean(matches, (a) => a.avg_hr), hrTrain = M.mean(cur.filter((a) => a.workout_type === "training"), (a) => a.avg_hr);

        root.append(h("div", { class: "dash-tiles" },
            tile({ label: "Temps de jeu", value: F.fr(hours / weeks, 1), unit: "h / sem.", delta: prev && { value: hours / weeks - M.sum(prev, (a) => a.hours) / weeks, digits: 1, unit: " h", goodWhenUp: true }, sub: `${F.fr(hours, 0)} h sur la période · objectif ${M.SPORT.Tennis.target} h`, spark: { values: bucketSeries(cur, ctx.wbks, "week", (a) => a.hours), color: M.SPORT.Tennis.color } }),
            tile({ label: "Séances", value: F.fr(cur.length), unit: "", delta: prev && { value: cur.length - prev.length, goodWhenUp: true }, sub: `${F.duration(M.mean(cur, (a) => a.moving_time_min))} en moyenne` }),
            tile({ label: "Bilan en match", value: `${wins} – ${matches.length - wins}`, unit: "", sub: `${matches.length} matchs joués`, delta: prevM && { value: matches.length - prevM.length, goodWhenUp: true } }),
            tile({ label: "Taux de victoire", value: F.fr(rate * 100), unit: "%", delta: prevRate != null && rate != null && { value: (rate - prevRate) * 100, unit: " pts", goodWhenUp: true }, sub: "sur les matchs de la période" }),
            tile({ label: "Intensité match vs entraînement", value: F.signed(hrMatch - hrTrain, 0), unit: "bpm", sub: `Match ${F.fr(hrMatch)} bpm · entraînement ${F.fr(hrTrain)} bpm`, delta: null }),
            tile({ label: "Dépense", value: F.fr(M.sum(cur, (a) => a.calories) / (hours || 1)), unit: "kcal / h", sub: `${F.fr(M.sum(cur, (a) => a.calories))} kcal sur la période`, delta: null }),
        ));
        const grid = h("div", { class: "dash-grid" });
        root.append(grid);
        weeklyVolumeCard(grid, ctx, "Tennis", { span: 8 });
        zonesCard(grid, ctx, "Tennis", 4);

        // Résultats par mois
        {
            const c = card("Résultats par mois", "Victoires et défaites en match", { span: 6 });
            grid.append(c.root);
            const months = [];
            for (let d = new Date(ctx.from.getFullYear(), ctx.from.getMonth(), 1); d <= ctx.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
            const byM = (res) => months.map((m) => matches.filter((a) => a.result === res && a.date.getMonth() === m.getMonth() && a.date.getFullYear() === m.getFullYear()).length);
            c.setLegend([{ name: "Victoires", color: "#3987e5" }, { name: "Défaites", color: "#e66767" }]);
            c.setTable(V.bandChart(c.body, {
                labels: months.map((m) => MONTHS[m.getMonth()]), tipLabels: months.map((m) => `${MONTHS[m.getMonth()]} ${m.getFullYear()}`), stacked: false,
                bars: [{ name: "Victoires", color: "#3987e5", values: byM("W") }, { name: "Défaites", color: "#e66767", values: byM("L") }],
                yFormat: (v) => F.fr(v), height: 230,
            }));
        }
        // Forme : taux de victoire glissant
        {
            const c = card("Dynamique de victoire", "Taux de victoire glissant sur les 10 derniers matchs", { span: 6 });
            grid.append(c.root);
            const allM = ctx.all.filter((a) => a.sport_type === "Tennis" && a.workout_type === "match");
            const pts = allM.map((a, i) => (i < 9 ? null : { x: a.date.getTime(), y: (allM.slice(i - 9, i + 1).filter((m) => m.result === "W").length / 10) * 100, title: `${a.date.toLocaleDateString("fr-FR")} · ${a.result === "W" ? "Victoire" : "Défaite"} ${a.score}` }))
                .filter((p) => p && p.x >= ctx.from.getTime());
            if (pts.length) c.setTable(V.scatter(c.body, {
                series: [{ name: "Taux de victoire (10 matchs)", color: M.SPORT.Tennis.color, points: pts }], trend: trendPoints(pts),
                xTicks: monthTicks(ctx.from, ctx.end), xFormat: monthTick, yFormat: (v) => F.fr(v) + " %", yLabel: "Victoires", xLabel: "Date", height: 230,
            }));
        }
        {
            const c = card("Derniers matchs", null, { span: 12 });
            grid.append(c.root);
            c.body.append(h("div", { class: "dash-list cols" }, matches.slice(-8).reverse().map((m) => h("div", { class: "dash-list-row" },
                h("div", {}, h("strong", {}, m.score), h("span", { class: "dash-muted" }, m.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " · " + F.duration(m.moving_time_min))),
                statusBadge(m.result === "W" ? { key: "good", label: "Victoire" } : { key: "critical", label: "Défaite" })))));
        }
        renderActivities(grid, ctx, "Dernières séances");
    }

    // ---------------------------------------------------------------- Golf
    function renderGolf(root, ctx) {
        const { cur, prev, weeks } = ctx;
        const hours = M.sum(cur, (a) => a.hours);
        const r18 = cur.filter((a) => a.holes === 18);
        const prev18 = prev && prev.filter((a) => a.holes === 18);
        const weekPlayed = new Set(cur.map((a) => M.dayKey(M.mondayOf(a.date)))).size;
        const allRounds = M.inRange(ctx.all, DATA.first, ctx.end).filter((a) => a.sport_type === "Golf");
        const idx = M.golfIndex(allRounds);
        const idxPrev = M.golfIndex(allRounds.filter((a) => a.date < ctx.from));
        const avg = M.mean(r18, (a) => a.strokes), prevAvg = prev18 && prev18.length ? M.mean(prev18, (a) => a.strokes) : null;

        root.append(h("div", { class: "dash-tiles" },
            tile({ label: "Temps de jeu", value: F.fr(hours / weeks, 1), unit: "h / sem.", delta: prev && { value: hours / weeks - M.sum(prev, (a) => a.hours) / weeks, digits: 1, unit: " h", goodWhenUp: true }, sub: "lissé · joué environ 1 semaine sur 2", spark: { values: bucketSeries(cur, ctx.wbks, "week", (a) => a.hours), color: M.SPORT.Golf.color } }),
            tile({ label: "Parcours joués", value: F.fr(cur.length), unit: "", sub: `${r18.length} × 18 trous · ${cur.length - r18.length} × 9 trous`, delta: prev && { value: cur.length - prev.length, goodWhenUp: true } }),
            tile({ label: "Semaines jouées", value: F.fr((100 * weekPlayed) / ctx.wbks.length), unit: "%", sub: `${weekPlayed} semaines sur ${ctx.wbks.length}`, delta: null }),
            tile({ label: "Score moyen 18 trous", value: F.fr(avg, 1), unit: "coups", delta: prevAvg != null && { value: avg - prevAvg, digits: 1, unit: " coups", goodWhenUp: false }, sub: `Par 72 · +${F.fr(avg - 72, 1)} en moyenne` }),
            tile({ label: "Meilleure carte", value: r18.length ? String(Math.min(...r18.map((a) => a.strokes))) : "—", unit: "coups", sub: r18.length ? `le ${r18.slice().sort((a, b) => a.strokes - b.strokes)[0].date.toLocaleDateString("fr-FR")}` : "", delta: null }),
            tile({ label: "Index estimé", value: F.fr(idx, 1), unit: "", hint: "Méthode WHS simplifiée : moyenne des 8 meilleurs différentiels sur les 20 dernières cartes (SR 71,2 / slope 128).", delta: idxPrev != null && { value: idx - idxPrev, digits: 1, goodWhenUp: false }, sub: "8 meilleurs des 20 derniers 18 trous" }),
        ));
        const grid = h("div", { class: "dash-grid" });
        root.append(grid);
        weeklyVolumeCard(grid, ctx, "Golf", { span: 8 });
        zonesCard(grid, ctx, "Golf", 4);
        {
            const c = card("Évolution du score", "Cartes 18 trous · droite = tendance", { span: 7 });
            grid.append(c.root);
            const pts = r18.map((a) => ({ x: a.date.getTime(), y: a.strokes, title: `${a.name} · ${a.date.toLocaleDateString("fr-FR")}` }));
            if (pts.length) {
                c.setLegend([{ name: "Carte 18 trous", color: M.SPORT.Golf.color }, { name: "Tendance", color: NEUTRAL_LINE, line: true }]);
                c.setTable(V.scatter(c.body, { series: [{ name: "Carte", color: M.SPORT.Golf.color, points: pts }], trend: trendPoints(pts), xTicks: monthTicks(ctx.from, ctx.end), xFormat: monthTick, yFormat: (v) => F.fr(v), yLabel: "Coups", xLabel: "Date", height: 250 }));
            }
        }
        {
            const c = card("Golf & récupération", "Le golf compte peu en charge, mais occupe le week-end", { span: 5 });
            grid.append(c.root);
            const perH = M.sum(cur, (a) => a.load) / (hours || 1);
            const runAll = M.inRange(ctx.all, ctx.from, ctx.end).filter((a) => a.sport_type === "Run");
            const runPerH = M.sum(runAll, (a) => a.load) / (M.sum(runAll, (a) => a.hours) || 1);
            c.body.append(h("div", { class: "dash-kv" },
                kv("Charge par heure (TRIMP)", `${F.fr(perH)} vs ${F.fr(runPerH)} en course`),
                kv("Pas par parcours 18 trous", F.fr(M.mean(r18, (a) => a.steps))),
                kv("Distance marchée", `${F.fr(M.sum(cur, (a) => a.distance_km), 0)} km`),
                kv("FC moyenne", `${F.fr(M.mean(cur, (a) => a.avg_hr))} bpm`),
                kv("Dépense", `${F.fr(M.sum(cur, (a) => a.calories))} kcal`)));
        }
        renderActivities(grid, ctx, "Derniers parcours");
    }
    const kv = (k, v) => h("div", { class: "dash-kv-row" }, h("span", { class: "dash-muted" }, k), h("strong", {}, v));

    // ---------------------------------------------------------------- Natation
    function renderSwim(root, ctx) {
        const { cur, prev, weeks } = ctx;
        const km = M.sum(cur, (a) => a.distance_km);
        const hours = M.sum(cur, (a) => a.hours);
        const p100 = M.mean(cur, (a) => a.pace_s_per_100m), prevP = prev && prev.length ? M.mean(prev, (a) => a.pace_s_per_100m) : null;
        const sw = M.mean(cur, (a) => a.swolf), prevSw = prev && prev.length ? M.mean(prev, (a) => a.swolf) : null;
        root.append(h("div", { class: "dash-tiles" },
            tile({ label: "Temps dans l'eau", value: F.fr(hours / weeks, 1), unit: "h / sem.", delta: prev && { value: hours / weeks - M.sum(prev, (a) => a.hours) / weeks, digits: 1, unit: " h", goodWhenUp: true }, sub: "objectif 1 h", spark: { values: bucketSeries(cur, ctx.wbks, "week", (a) => a.hours), color: M.SPORT.Swim.color } }),
            tile({ label: "Distance", value: F.fr(km / weeks, 2), unit: "km / sem.", delta: prev && { value: pct(km, M.sum(prev, (a) => a.distance_km)), unit: " %", goodWhenUp: true }, sub: `${F.fr(km, 1)} km sur la période` }),
            tile({ label: "Allure de nage", value: F.pace(p100), unit: "/ 100 m", delta: prevP && { value: p100 - prevP, digits: 1, unit: " s", goodWhenUp: false }, sub: "temps de nage effectif" }),
            tile({ label: "SWOLF moyen", value: F.fr(sw, 1), unit: "", hint: "Coups de bras + secondes par longueur de 25 m. Plus bas = plus efficace.", delta: prevSw && { value: sw - prevSw, digits: 1, goodWhenUp: false }, sub: "bassin 25 m" }),
            tile({ label: "Séances", value: F.fr(cur.length), unit: "", delta: prev && { value: cur.length - prev.length, goodWhenUp: true }, sub: `${F.fr(M.mean(cur, (a) => a.distance_km * 1000), 0)} m par séance` }),
            tile({ label: "FC moyenne", value: F.fr(M.mean(cur, (a) => a.avg_hr)), unit: "bpm", sub: "sport porté : récupération active", delta: null }),
        ));
        const grid = h("div", { class: "dash-grid" });
        root.append(grid);
        weeklyVolumeCard(grid, ctx, "Swim", { span: 8 });
        zonesCard(grid, ctx, "Swim", 4);
        const pts = (f) => cur.map((a) => ({ x: a.date.getTime(), y: f(a), title: `${a.name} · ${a.date.toLocaleDateString("fr-FR")}` }));
        {
            const c = card("Allure / 100 m", "Par séance · droite = tendance", { span: 6 });
            grid.append(c.root);
            const p = pts((a) => a.pace_s_per_100m);
            if (p.length) c.setTable(V.scatter(c.body, { series: [{ name: "Séance", color: M.SPORT.Swim.color, points: p }], trend: trendPoints(p), invertY: true, xTicks: monthTicks(ctx.from, ctx.end), xFormat: monthTick, yFormat: F.pace, yLabel: "/100 m", xLabel: "Date", height: 240 }));
        }
        {
            const c = card("Efficacité de nage (SWOLF)", "Plus bas = moins de coups de bras pour le même temps", { span: 6 });
            grid.append(c.root);
            const p = pts((a) => a.swolf);
            if (p.length) c.setTable(V.scatter(c.body, { series: [{ name: "Séance", color: M.SPORT.Swim.color, points: p }], trend: trendPoints(p), invertY: true, xTicks: monthTicks(ctx.from, ctx.end), xFormat: monthTick, yFormat: (v) => F.fr(v, 0), yLabel: "SWOLF", xLabel: "Date", height: 240 }));
        }
        renderActivities(grid, ctx, "Dernières séances");
    }

    // ---------------------------------------------------------------- Escalade
    const GRADES = ["5c", "6a", "6a+", "6b", "6b+", "6c", "6c+", "7a"];
    function renderClimb(root, ctx) {
        const { cur, prev, weeks } = ctx;
        const hours = M.sum(cur, (a) => a.hours);
        const maxI = cur.length ? Math.max(...cur.map((a) => a.max_grade_index)) : null;
        const prevMax = prev && prev.length ? Math.max(...prev.map((a) => a.max_grade_index)) : null;
        const sends = M.sum(cur, (a) => a.problems_sent), att = M.sum(cur, (a) => a.attempts);
        const rate = att ? sends / att : null;
        const prevRate = prev && prev.length ? M.sum(prev, (a) => a.problems_sent) / M.sum(prev, (a) => a.attempts) : null;
        root.append(h("div", { class: "dash-tiles" },
            tile({ label: "Temps de grimpe", value: F.fr(hours / weeks, 1), unit: "h / sem.", delta: prev && { value: hours / weeks - M.sum(prev, (a) => a.hours) / weeks, digits: 1, unit: " h", goodWhenUp: true }, sub: "objectif 1 h · 1 séance", spark: { values: bucketSeries(cur, ctx.wbks, "week", (a) => a.hours), color: M.SPORT.RockClimbing.color } }),
            tile({ label: "Séances", value: F.fr(cur.length), unit: "", delta: prev && { value: cur.length - prev.length, goodWhenUp: true }, sub: `${F.duration(M.mean(cur, (a) => a.moving_time_min))} en moyenne` }),
            tile({ label: "Niveau max", value: maxI != null ? GRADES[maxI] : "—", unit: "Font.", delta: prevMax != null && maxI != null && { value: maxI - prevMax, unit: " cran(s)", goodWhenUp: true }, sub: "bloc le plus dur enchaîné" }),
            tile({ label: "Blocs réussis", value: F.fr(sends), unit: "", delta: prev && { value: pct(sends, M.sum(prev, (a) => a.problems_sent)), unit: " %", goodWhenUp: true }, sub: `${F.fr(sends / (cur.length || 1), 1)} par séance` }),
            tile({ label: "Taux de réussite", value: F.fr(rate * 100), unit: "%", delta: prevRate && { value: (rate - prevRate) * 100, unit: " pts", goodWhenUp: true }, sub: `${F.fr(att)} essais` }),
            tile({ label: "FC moyenne", value: F.fr(M.mean(cur, (a) => a.avg_hr)), unit: "bpm", sub: "effort intermittent (pics en Z4)", delta: null }),
        ));
        const grid = h("div", { class: "dash-grid" });
        root.append(grid);
        weeklyVolumeCard(grid, ctx, "RockClimbing", { span: 8 });
        zonesCard(grid, ctx, "RockClimbing", 4);
        {
            const c = card("Progression de niveau", "Bloc le plus dur enchaîné par séance (cotation Fontainebleau)", { span: 7 });
            grid.append(c.root);
            const p = cur.map((a) => ({ x: a.date.getTime(), y: a.max_grade_index, title: `${a.max_grade} · ${a.date.toLocaleDateString("fr-FR")}` }));
            if (p.length) c.setTable(V.scatter(c.body, { series: [{ name: "Séance", color: M.SPORT.RockClimbing.color, points: p }], trend: trendPoints(p), xTicks: monthTicks(ctx.from, ctx.end), xFormat: monthTick, yFormat: (v) => GRADES[Math.round(v)] || "", yLabel: "Niveau", xLabel: "Date", height: 250 }));
        }
        {
            const c = card("Volume de blocs", "Réussites et essais par mois", { span: 5 });
            grid.append(c.root);
            const months = [];
            for (let d = new Date(ctx.from.getFullYear(), ctx.from.getMonth(), 1); d <= ctx.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
            const by = (f) => months.map((m) => M.sum(cur.filter((a) => a.date.getMonth() === m.getMonth() && a.date.getFullYear() === m.getFullYear()), f));
            c.setLegend([{ name: "Blocs réussis", color: M.SPORT.RockClimbing.color }, { name: "Essais ratés", color: "#4a4a55" }]);
            c.setTable(V.bandChart(c.body, {
                labels: months.map((m) => MONTHS[m.getMonth()]),
                bars: [{ name: "Blocs réussis", color: M.SPORT.RockClimbing.color, values: by((a) => a.problems_sent) }, { name: "Essais ratés", color: "#4a4a55", values: by((a) => a.attempts - a.problems_sent) }],
                yFormat: (v) => F.fr(v), height: 250,
            }));
        }
        renderActivities(grid, ctx, "Dernières séances");
    }

    // ---------------------------------------------------------------- tableau d'activités
    function renderActivities(grid, ctx, title) {
        const acts = state.sport === "all" ? ctx.all : ctx.all.filter((a) => a.sport_type === state.sport);
        const c = card(title, "12 plus récentes, semaine en cours incluse", { span: 12 });
        grid.append(c.root);
        const rows = acts.slice(-12).reverse();
        const detail = (a) => {
            if (a.sport_type === "Run") return `${F.fr(a.distance_km, 1)} km · ${F.pace(a.avg_pace_s_per_km)}/km`;
            if (a.sport_type === "Swim") return `${F.fr(a.distance_km * 1000)} m · SWOLF ${F.fr(a.swolf, 0)}`;
            if (a.sport_type === "Golf") return `${a.strokes} coups (par ${a.par})`;
            if (a.sport_type === "Tennis") return a.score ? `${a.result === "W" ? "Victoire" : "Défaite"} ${a.score}` : "Entraînement";
            if (a.sport_type === "RockClimbing") return `${a.problems_sent}/${a.attempts} blocs · max ${a.max_grade}`;
            return "";
        };
        c.body.append(h("div", { class: "dash-table-wrap" }, h("table", { class: "dash-table" },
            h("thead", {}, h("tr", {}, ["Sport", "Activité", "Date", "Durée", "Détail", "FC moy.", "Charge"].map((x) => h("th", {}, x)))),
            h("tbody", {}, rows.map((a) => h("tr", {},
                h("td", {}, h("span", { class: "dash-sport-dot", style: `--c:${M.SPORT[a.sport_type].color}` }), M.SPORT[a.sport_type].label),
                h("td", {}, a.name),
                h("td", {}, a.date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })),
                h("td", { class: "num" }, F.duration(a.moving_time_min)),
                h("td", {}, detail(a)),
                h("td", { class: "num" }, `${a.avg_hr} bpm`),
                h("td", { class: "num" }, F.fr(a.load))))))));
    }

    // =====================================================================
    // Barre de filtres, export, provenance
    // =====================================================================
    function renderToolbar(host) {
        const sports = [{ key: "all", label: "Tous les sports" }, ...M.SPORTS];
        const sportGroup = h("div", { class: "dash-seg", role: "tablist", "aria-label": "Sport" }, sports.map((s) => h("button", {
            type: "button", role: "tab", class: "dash-seg-btn", "aria-selected": String(state.sport === s.key),
            onclick: () => { state.sport = s.key; update(); },
        }, s.color ? h("span", { class: "dash-sport-dot", style: `--c:${s.color}` }) : null, s.label)));
        const periodGroup = h("div", { class: "dash-seg", role: "tablist", "aria-label": "Période" }, PERIODS.map((p) => h("button", {
            type: "button", role: "tab", class: "dash-seg-btn", "aria-selected": String(state.weeks === p.weeks),
            onclick: () => { state.weeks = p.weeks; update(); },
        }, p.label)));
        const exportBtn = h("button", { type: "button", class: "dash-btn", onclick: exportCsv }, "Exporter CSV");
        host.replaceChildren(sportGroup, h("div", { class: "dash-toolbar-right" }, periodGroup, exportBtn));
    }

    function renderMeta(host, ctx) {
        const m = DATA.meta;
        const src = m.source === "bigquery" ? `BigQuery · ${m.table || "fct_activities"}` : `fct_activities · jeu de démo (seed ${m.seed})`;
        host.replaceChildren(
            h("span", {}, `Du ${ctx.from.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} au ${ctx.end.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`),
            h("span", { class: "dash-sep" }, "·"),
            h("span", {}, `${ctx.cur.length} activités`),
            h("span", { class: "dash-sep" }, "·"),
            h("span", { class: "dash-muted" }, `Source : ${src} · schéma v${m.schema_version} · ${m.row_count} lignes`));
    }

    function exportCsv() {
        const ctx = context();
        const cols = ["activity_id", "start_date_local", "sport_type", "name", "workout_type", "distance_km", "moving_time_min", "avg_hr", "max_hr", "calories", "elevation_gain_m"];
        const esc = (v) => (v == null ? "" : /[",;\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
        const lines = [cols.concat("trimp").join(",")].concat(ctx.cur.map((a) => cols.map((c) => esc(a[c])).concat(a.load.toFixed(1)).join(",")));
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = h("a", { href: url, download: `altarun_${state.sport}_${state.weeks}sem.csv` });
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ------------------------------------------------------------- cycle de rendu
    function syncUrl() {
        // Filtres reflétés dans l'URL => vue partageable. Ignoré si l'environnement l'interdit.
        try {
            const p = new URLSearchParams(location.search);
            p.set("sport", state.sport); p.set("periode", String(state.weeks)); p.set("vue", state.view);
            history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
        } catch (e) { /* iframe sandboxée, file:// … */ }
    }

    function renderViews(host) {
        const views = [{ key: "overview", label: "Vue d'ensemble" }, { key: "studio", label: "Studio KPI" }];
        host.replaceChildren(...views.map((v) => h("button", {
            type: "button", role: "tab", class: "dash-view-tab", "aria-selected": String(state.view === v.key),
            onclick: () => { state.view = v.key; update(); },
        }, v.label, v.key === "studio" && state.pins.length ? h("span", { class: "dash-view-count" }, String(state.pins.length)) : null)));
    }

    /** Cartes des KPI épinglés, recalculées avec les filtres courants. */
    function renderPins(body, ctx) {
        if (!state.pins.length || !window.AltarunStudio) return;
        const grid = h("div", { class: "dash-grid dash-pins" });
        state.pins.forEach((pin, i) => {
            const odd = state.pins.length % 2 === 1 && i === state.pins.length - 1;
            const c = card(pin.title, "KPI personnalisé · Studio", { span: odd ? 12 : 6 });
            const remove = h("button", { type: "button", class: "dash-link-btn", onclick: () => { state.pins.splice(i, 1); savePins(); update(); } }, "Retirer");
            c.root.querySelector(".dash-card-head").append(remove);
            grid.append(c.root);
            requestAnimationFrame(() => {
                const out = window.AltarunStudio.renderVisual(c.body, pin, ctx.cur, ctx, h);
                if (out.table) c.setTable(out.table);
            });
        });
        const tiles = body.querySelector(".dash-tiles");
        if (tiles) tiles.after(grid); else body.prepend(grid);
    }

    function update() {
        syncUrl();
        V.hideTip();
        const ctx = context();
        renderViews(document.getElementById("dash-views"));
        renderToolbar(document.getElementById("dash-toolbar"));
        renderMeta(document.getElementById("dash-meta"), ctx);
        const body = document.getElementById("dash-body");
        body.replaceChildren();
        if (state.view === "studio" && window.AltarunStudio) {
            window.AltarunStudio.mount(body, {
                h, acts: ctx.cur, ctx, sport: state.sport, pinsCount: state.pins.length,
                onPin: (pin) => { state.pins.push(pin); savePins(); state.view = "overview"; update(); window.scrollTo({ top: 0, behavior: "smooth" }); },
            });
            return;
        }
        const renderers = { all: renderAll, Run: renderRun, Tennis: renderTennis, Golf: renderGolf, Swim: renderSwim, RockClimbing: renderClimb };
        renderers[state.sport](body, ctx);
        renderPins(body, ctx);
    }

    async function init() {
        const root = document.getElementById("dashboard");
        if (!root) return;
        const p = new URLSearchParams(location.search);
        if (p.get("sport") && (p.get("sport") === "all" || M.SPORT[p.get("sport")])) state.sport = p.get("sport");
        if (PERIODS.some((x) => String(x.weeks) === p.get("periode"))) state.weeks = Number(p.get("periode"));
        if (p.get("vue") === "studio") state.view = "studio";
        try {
            const payload = window.ALTARUN_DATA || (await (await fetch(root.dataset.source, { credentials: "same-origin" })).json());
            DATA = enrich(M.prepare(payload));
            root.classList.remove("is-loading");
            update();
        } catch (e) {
            console.error("[Altarun] Chargement du dashboard impossible", e);
            document.getElementById("dash-body").replaceChildren(h("div", { class: "error-message" }, "Impossible de charger les données d'activité."));
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();

/* ==========================================================================
   Altarun — mini librairie de graphiques SVG (vanilla JS, zéro dépendance)
   --------------------------------------------------------------------------
   Volontairement légère (cf. CLAUDE.md : pas de dépendance JS lourde).
   Chaque fonction :
     - dessine dans un conteneur DOM (responsive : se redessine au resize),
     - gère son calque de survol (tooltip),
     - renvoie un objet { table } utilisé par la vue « Tableau » (accessibilité).
   ========================================================================== */
(function (global) {
    "use strict";

    const NS = "http://www.w3.org/2000/svg";
    const C = {
        grid: "rgba(255,255,255,0.07)",
        axis: "rgba(255,255,255,0.18)",
        muted: "#8a8a93",
        text: "#c9c9cf",
        surface: "#141419",
    };

    // ---------------------------------------------------------------- helpers
    function el(tag, attrs, parent) {
        const n = document.createElementNS(NS, tag);
        for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(n);
        return n;
    }

    function niceTicks(min, max, count) {
        if (min === max) { max = min + 1; }
        const span = max - min;
        const step0 = span / Math.max(1, count);
        const mag = Math.pow(10, Math.floor(Math.log10(step0)));
        const err = step0 / mag;
        const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
        const lo = Math.floor(min / step) * step;
        const hi = Math.ceil(max / step) * step;
        const ticks = [];
        for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
        return ticks;
    }

    // Arrondi « barre » : 4px en haut (côté donnée), carré à la ligne de base.
    function barPath(x, y, w, h, r, roundTop) {
        if (h <= 0) return "";
        r = Math.min(r, w / 2, h);
        if (!roundTop || r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
        return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    }

    function hbarPath(x, y, w, h, r, roundEnd) {
        if (w <= 0) return "";
        r = Math.min(r, h / 2, w);
        if (!roundEnd || r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
        return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    }

    // ---------------------------------------------------------------- tooltip
    let tip;
    function tooltip() {
        if (tip) return tip;
        tip = document.createElement("div");
        tip.className = "viz-tooltip";
        tip.setAttribute("role", "status");
        document.body.appendChild(tip);
        return tip;
    }

    /** rows: [{ value, label, color, line? }] — valeurs en premier, libellés ensuite. */
    function showTip(evt, title, rows) {
        const t = tooltip();
        t.replaceChildren();
        if (title) {
            const h = document.createElement("div");
            h.className = "viz-tooltip-title";
            h.textContent = title;
            t.appendChild(h);
        }
        rows.forEach((r) => {
            const row = document.createElement("div");
            row.className = "viz-tooltip-row";
            if (r.color) {
                const k = document.createElement("span");
                k.className = "viz-tooltip-key";
                k.style.background = r.color;
                row.appendChild(k);
            }
            const v = document.createElement("strong");
            v.textContent = r.value;
            row.appendChild(v);
            if (r.label) {
                const l = document.createElement("span");
                l.textContent = r.label;
                row.appendChild(l);
            }
            t.appendChild(row);
        });
        t.style.display = "block";
        const pad = 14;
        const w = t.offsetWidth, h = t.offsetHeight;
        let x = evt.clientX + pad, y = evt.clientY + pad;
        if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
        if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
        t.style.left = x + "px";
        t.style.top = y + "px";
    }
    function hideTip() { if (tip) tip.style.display = "none"; }

    // ---------------------------------------------------------- responsive
    const registry = new Map();
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => registry.forEach((draw, node) => {
            if (document.body.contains(node)) draw(); else registry.delete(node);
        }), 120);
    });
    function mount(container, draw) {
        registry.set(container, draw);
        draw();
    }

    function svgRoot(container, height, minWidth = 260) {
        container.replaceChildren();
        const width = Math.max(minWidth, container.clientWidth);
        const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "viz-svg" }, container);
        svg.addEventListener("pointerleave", hideTip);
        return { svg, width, height };
    }

    // =====================================================================
    // 1. Cartésien à bande : colonnes (empilées ou non) + lignes + repères
    // =====================================================================
    /**
     * opts = {
     *   labels: [..], tipLabels?: [..],
     *   bars: [{ name, color, values }], stacked: true,
     *   lines: [{ name, color, values, dashed? }],
     *   refs: [{ value, label }],
     *   height, yFormat(v), yMin?, invertY?, xEvery?, unit?
     * }
     */
    function bandChart(container, opts) {
        const bars = opts.bars || [];
        const lines = opts.lines || [];
        const refs = opts.refs || [];
        const fmt = opts.yFormat || ((v) => v.toLocaleString("fr-FR"));
        const n = opts.labels.length;

        const draw = () => {
            const { svg, width, height } = svgRoot(container, opts.height || 240);
            const m = { t: 14, r: 12, b: 26, l: 46 };
            const iw = width - m.l - m.r, ih = height - m.t - m.b;

            // domaine Y
            let vals = [];
            if (opts.stacked !== false && bars.length) {
                for (let i = 0; i < n; i++) vals.push(bars.reduce((s, b) => s + (b.values[i] || 0), 0));
            } else bars.forEach((b) => (vals = vals.concat(b.values)));
            lines.forEach((l) => (vals = vals.concat(l.values)));
            refs.forEach((r) => vals.push(r.value));
            vals = vals.filter((v) => v != null && isFinite(v));
            let yMin = opts.yMin != null ? opts.yMin : bars.length ? Math.min(0, ...vals) : Math.min(...vals);
            let yMax = Math.max(...vals, yMin + 1e-9);
            if (!bars.length && opts.yMin == null) {
                const pad = (yMax - yMin) * 0.12 || 1;
                yMin -= pad; yMax += pad;
            }
            const ticks = niceTicks(yMin, yMax, opts.tickCount || 4);
            yMin = ticks[0];
            yMax = ticks[ticks.length - 1];
            const y = (v) => {
                const f = (v - yMin) / (yMax - yMin);
                return m.t + (opts.invertY ? f : 1 - f) * ih;
            };
            const band = iw / n;
            const x = (i) => m.l + band * i + band / 2;

            // grille + axe Y
            const g = el("g", {}, svg);
            ticks.forEach((t) => {
                el("line", { x1: m.l, x2: width - m.r, y1: y(t), y2: y(t), stroke: C.grid }, g);
                const tx = el("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end", class: "viz-tick" }, g);
                tx.textContent = fmt(t);
            });
            // axe X
            const every = opts.xEvery || Math.ceil(n / Math.max(2, Math.floor(iw / 64)));
            opts.labels.forEach((lab, i) => {
                if (i % every !== 0 && i !== n - 1) return;
                if (i === n - 1 && i % every !== 0 && (n - 1) % every < every * 0.6) return;
                const tx = el("text", { x: x(i), y: height - 8, "text-anchor": "middle", class: "viz-tick" }, g);
                tx.textContent = lab;
            });
            if (bars.length) el("line", { x1: m.l, x2: width - m.r, y1: y(0), y2: y(0), stroke: C.axis }, g);

            // barres
            const bw = Math.min(24, Math.max(2, band * 0.66));
            if (opts.stacked !== false) {
                for (let i = 0; i < n; i++) {
                    let acc = 0;
                    const present = bars.filter((b) => (b.values[i] || 0) > 0);
                    present.forEach((b, k) => {
                        const v = b.values[i];
                        const y0 = y(acc), y1 = y(acc + v);
                        const gap = k > 0 ? 1 : 0; // 2px d'écart au total (1px de chaque côté)
                        const h = Math.max(0, y0 - y1 - gap - (k < present.length - 1 ? 1 : 0));
                        el("path", { d: barPath(x(i) - bw / 2, y1 + (k < present.length - 1 ? 1 : 0), bw, h, 4, k === present.length - 1), fill: b.color, class: "viz-bar" }, svg);
                        acc += v;
                    });
                }
            } else {
                const nb = bars.length;
                const sub = Math.min(bw, (band * 0.8) / nb);
                bars.forEach((b, k) => b.values.forEach((v, i) => {
                    if (!v) return;
                    const bx = x(i) - (sub * nb) / 2 + k * sub + (nb > 1 ? 1 : 0);
                    const bwk = Math.max(1, sub - (nb > 1 ? 2 : 0));
                    if (v > 0) el("path", { d: barPath(bx, y(v), bwk, y(0) - y(v), sub > 6 ? 4 : 0, true), fill: b.color, class: "viz-bar" }, svg);
                    else el("path", { d: barPath(bx, y(0), bwk, y(v) - y(0), 0, false), fill: b.color, class: "viz-bar" }, svg);
                }));
            }

            // repères (objectifs)
            refs.forEach((r) => {
                el("line", { x1: m.l, x2: width - m.r, y1: y(r.value), y2: y(r.value), stroke: "#e8e8ec", "stroke-width": 1, "stroke-dasharray": "4 4", opacity: 0.55 }, svg);
                // L'étiquette du repère est portée par la légende (évite les collisions avec les barres).
                if (r.inlineLabel) {
                    const tx = el("text", { x: width - m.r, y: y(r.value) - 6, "text-anchor": "end", class: "viz-ref" }, svg);
                    tx.textContent = r.label;
                }
            });

            // lignes
            lines.forEach((l) => {
                let d = "", pen = false;
                l.values.forEach((v, i) => {
                    if (v == null || !isFinite(v)) { pen = false; return; }
                    d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
                    pen = true;
                });
                el("path", { d, fill: "none", stroke: l.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": l.dashed ? "5 4" : "none" }, svg);
                if (l.area) {
                    const first = l.values.findIndex((v) => v != null);
                    el("path", { d: d + `L${x(n - 1)},${y(yMin)}L${x(first)},${y(yMin)}Z`, fill: l.color, opacity: 0.1 }, svg);
                }
                // point final + étiquette directe
                let last = n - 1;
                while (last >= 0 && (l.values[last] == null)) last--;
                if (last >= 0 && l.endDot !== false) {
                    el("circle", { cx: x(last), cy: y(l.values[last]), r: 4, fill: l.color, stroke: C.surface, "stroke-width": 2 }, svg);
                }
            });

            // calque de survol (crosshair)
            const cross = el("line", { y1: m.t, y2: m.t + ih, stroke: "rgba(255,255,255,0.35)", "stroke-width": 1, visibility: "hidden" }, svg);
            const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
            hit.addEventListener("pointermove", (evt) => {
                const rect = svg.getBoundingClientRect();
                const i = Math.max(0, Math.min(n - 1, Math.floor((evt.clientX - rect.left - m.l) / band)));
                cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
                cross.setAttribute("visibility", "visible");
                const rows = [];
                bars.forEach((b) => rows.push({ value: fmt(b.values[i] || 0), label: b.name, color: b.color }));
                lines.forEach((l) => l.values[i] != null && rows.push({ value: fmt(l.values[i]), label: l.name, color: l.color }));
                if (opts.stacked !== false && bars.length > 1) {
                    rows.unshift({ value: fmt(bars.reduce((s, b) => s + (b.values[i] || 0), 0)), label: "Total" });
                }
                showTip(evt, (opts.tipLabels || opts.labels)[i], rows);
            });
            hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
        };
        mount(container, draw);

        const series = [...bars, ...lines];
        return {
            table: {
                head: ["", ...series.map((s) => s.name)],
                rows: opts.labels.map((lab, i) => [(opts.tipLabels || opts.labels)[i], ...series.map((s) => (s.values[i] == null ? "—" : fmt(s.values[i])))]),
            },
        };
    }

    // =====================================================================
    // 2. Nuage de points (x numérique ou date)
    // =====================================================================
    /**
     * opts = { series: [{ name, color, points: [{x, y, title}] }], height,
     *          xFormat, yFormat, invertY, xTicks?, trend?: {color, points} }
     */
    function scatter(container, opts) {
        const xf = opts.xFormat || ((v) => v.toLocaleString("fr-FR"));
        const yf = opts.yFormat || ((v) => v.toLocaleString("fr-FR"));
        const all = opts.series.flatMap((s) => s.points.map((p) => ({ ...p, s })));

        const draw = () => {
            const { svg, width, height } = svgRoot(container, opts.height || 260);
            const m = { t: 14, r: 14, b: 30, l: 50 };
            const iw = width - m.l - m.r, ih = height - m.t - m.b;
            const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
            const xT = opts.xTicks || niceTicks(Math.min(...xs), Math.max(...xs), Math.max(3, Math.floor(iw / 90)));
            const yPad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
            const yT = niceTicks(Math.min(...ys) - yPad, Math.max(...ys) + yPad, 4);
            const x0 = xT[0], x1 = xT[xT.length - 1], y0 = yT[0], y1 = yT[yT.length - 1];
            const X = (v) => m.l + ((v - x0) / (x1 - x0)) * iw;
            const Y = (v) => { const f = (v - y0) / (y1 - y0); return m.t + (opts.invertY ? f : 1 - f) * ih; };

            yT.forEach((t) => {
                el("line", { x1: m.l, x2: width - m.r, y1: Y(t), y2: Y(t), stroke: C.grid }, svg);
                el("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end", class: "viz-tick" }, svg).textContent = yf(t);
            });
            xT.forEach((t) => {
                el("text", { x: X(t), y: height - 10, "text-anchor": "middle", class: "viz-tick" }, svg).textContent = xf(t);
            });
            el("line", { x1: m.l, x2: width - m.r, y1: m.t + ih, y2: m.t + ih, stroke: C.axis }, svg);

            opts.series.forEach((s) => s.points.forEach((p) => {
                p._cx = X(p.x); p._cy = Y(p.y);
                el("circle", { cx: p._cx, cy: p._cy, r: 4, fill: s.color, stroke: C.surface, "stroke-width": 2, opacity: 0.9 }, svg);
            }));
            if (opts.trend) {
                const d = opts.trend.points.map((p, i) => (i ? "L" : "M") + X(p.x) + "," + Y(p.y)).join("");
                el("path", { d, fill: "none", stroke: opts.trend.color || "#ffffff", "stroke-width": 2, "stroke-linecap": "round" }, svg);
            }

            const ring = el("circle", { r: 7, fill: "none", stroke: "#fff", "stroke-width": 2, visibility: "hidden" }, svg);
            const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);
            hit.addEventListener("pointermove", (evt) => {
                const r = svg.getBoundingClientRect();
                const px = evt.clientX - r.left, py = evt.clientY - r.top;
                let best = null, bd = 24 * 24;
                all.forEach((p) => { const d = (p._cx - px) ** 2 + (p._cy - py) ** 2; if (d < bd) { bd = d; best = p; } });
                if (!best) { ring.setAttribute("visibility", "hidden"); hideTip(); return; }
                ring.setAttribute("cx", best._cx); ring.setAttribute("cy", best._cy); ring.setAttribute("visibility", "visible");
                showTip(evt, best.title || best.s.name, [
                    { value: yf(best.y), label: opts.yLabel || "", color: best.s.color },
                    { value: xf(best.x), label: opts.xLabel || "" },
                ]);
            });
            hit.addEventListener("pointerleave", () => { ring.setAttribute("visibility", "hidden"); hideTip(); });
        };
        mount(container, draw);
        return {
            table: {
                head: ["Série", opts.xLabel || "x", opts.yLabel || "y"],
                rows: all.map((p) => [p.title || p.s.name, xf(p.x), yf(p.y)]),
            },
        };
    }

    // =====================================================================
    // 3. Heatmap matricielle (lignes × colonnes)
    // =====================================================================
    /** opts = { rows:[], cols:[], values:[[...]], color(v) -> hex, format(v), height?, cellTitle? } */
    function matrix(container, opts) {
        const draw = () => {
            const rowsN = opts.rows.length, colsN = opts.cols.length;
            const labelW = opts.labelWidth || 78;
            const width = Math.max(260, container.clientWidth);
            const cell = Math.min(46, (width - labelW - 4) / colsN);
            const height = 22 + rowsN * cell;
            const { svg } = svgRoot(container, height);
            opts.cols.forEach((c, j) => {
                el("text", { x: labelW + j * cell + cell / 2, y: 13, "text-anchor": "middle", class: "viz-tick" }, svg).textContent = c;
            });
            opts.rows.forEach((r, i) => {
                el("text", { x: labelW - 8, y: 22 + i * cell + cell / 2 + 4, "text-anchor": "end", class: "viz-tick viz-tick-strong" }, svg).textContent = r;
                opts.cols.forEach((c, j) => {
                    const v = opts.values[i][j];
                    const rect = el("rect", {
                        x: labelW + j * cell + 1, y: 22 + i * cell + 1, width: cell - 2, height: cell - 2, rx: 4,
                        fill: v == null ? "rgba(255,255,255,0.03)" : opts.color(v), class: "viz-cell", tabindex: 0,
                    }, svg);
                    if (opts.showValues && v != null && cell >= 34) {
                        const t = el("text", { x: labelW + j * cell + cell / 2, y: 22 + i * cell + cell / 2 + 4, "text-anchor": "middle", class: "viz-cell-label" }, svg);
                        t.textContent = opts.format(v);
                        t.setAttribute("fill", opts.labelInk ? opts.labelInk(v) : "#fff");
                    }
                    const tipFn = (evt) => showTip(evt, opts.cellTitle ? opts.cellTitle(i, j) : `${r} · ${c}`, [{ value: v == null ? "—" : opts.format(v), label: opts.valueLabel || "" }]);
                    rect.addEventListener("pointermove", tipFn);
                    rect.addEventListener("pointerleave", hideTip);
                });
            });
        };
        mount(container, draw);
        return {
            table: {
                head: ["", ...opts.cols],
                rows: opts.rows.map((r, i) => [r, ...opts.values[i].map((v) => (v == null ? "—" : opts.format(v)))]),
            },
        };
    }

    // =====================================================================
    // 4. Calendrier (type GitHub) — une colonne par semaine, lun → dim
    // =====================================================================
    /** opts = { days: [{ date: Date, value }], color(v), format(v), monthLabel(d) } */
    function calendar(container, opts) {
        const draw = () => {
            const weeks = [];
            opts.days.forEach((d) => {
                const dow = (d.date.getDay() + 6) % 7;
                if (!weeks.length || dow === 0) weeks.push(new Array(7).fill(null));
                weeks[weeks.length - 1][dow] = d;
            });
            const width = Math.max(260, container.clientWidth);
            const labelW = 26;
            const cell = Math.max(6, Math.min(weeks.length <= 8 ? 34 : 18, (width - labelW) / weeks.length));
            const height = 18 + cell * 7;
            const { svg } = svgRoot(container, height);
            ["L", "", "M", "", "V", "", "D"].forEach((t, i) => {
                if (t) el("text", { x: 0, y: 18 + i * cell + cell / 2 + 4, class: "viz-tick" }, svg).textContent = t;
            });
            let lastMonth = -1;
            weeks.forEach((w, wi) => {
                const first = w.find(Boolean);
                if (first && first.date.getMonth() !== lastMonth && first.date.getDate() <= 7) {
                    lastMonth = first.date.getMonth();
                    el("text", { x: labelW + wi * cell, y: 11, class: "viz-tick" }, svg).textContent = opts.monthLabel(first.date);
                }
                w.forEach((d, di) => {
                    if (!d) return;
                    const r = el("rect", {
                        x: labelW + wi * cell + 1, y: 18 + di * cell + 1, width: cell - 2, height: cell - 2, rx: 2,
                        fill: d.value > 0 ? opts.color(d.value) : "rgba(255,255,255,0.04)", class: "viz-cell",
                    }, svg);
                    r.addEventListener("pointermove", (evt) => showTip(evt, d.label || d.date.toLocaleDateString("fr-FR"), d.rows || [{ value: opts.format(d.value), label: opts.valueLabel || "" }]));
                    r.addEventListener("pointerleave", hideTip);
                });
            });
        };
        mount(container, draw);
        return {
            table: {
                head: ["Date", opts.valueLabel || "Valeur"],
                rows: opts.days.filter((d) => d.value > 0).map((d) => [d.date.toLocaleDateString("fr-FR"), opts.format(d.value)]),
            },
        };
    }

    // =====================================================================
    // 5. Barres horizontales empilées (100 % ou valeurs) — ex. zones FC
    // =====================================================================
    /** opts = { rows: [{ label, values: [] }], keys: [{ name, color }], percent, format } */
    function hstack(container, opts) {
        const fmt = opts.format || ((v) => v.toFixed(0));
        const draw = () => {
            const rowH = 28, gap = 14, labelW = opts.labelWidth || 84;
            const height = opts.rows.length * (rowH + gap);
            const { svg, width } = svgRoot(container, height);
            const iw = width - labelW - 52;
            opts.rows.forEach((r, i) => {
                const total = r.values.reduce((a, b) => a + b, 0) || 1;
                const yy = i * (rowH + gap) + gap / 2;
                el("text", { x: labelW - 10, y: yy + rowH / 2 + 4, "text-anchor": "end", class: "viz-tick viz-tick-strong" }, svg).textContent = r.label;
                let acc = 0;
                const nz = r.values.map((v, k) => [v, k]).filter(([v]) => v > 0);
                nz.forEach(([v, k], idx) => {
                    const w = (v / total) * iw;
                    const x0 = labelW + (acc / total) * iw;
                    const p = el("path", { d: hbarPath(x0 + (idx ? 1 : 0), yy, Math.max(0, w - (idx ? 1 : 0) - (idx < nz.length - 1 ? 1 : 0)), rowH, 4, idx === nz.length - 1), fill: opts.keys[k].color, class: "viz-bar" }, svg);
                    const pct = (v / total) * 100;
                    if (w > 40) {
                        const t = el("text", { x: x0 + w / 2, y: yy + rowH / 2 + 4, "text-anchor": "middle", class: "viz-cell-label" }, svg);
                        t.textContent = Math.round(pct) + " %";
                        t.setAttribute("fill", opts.keys[k].ink || "#fff");
                    }
                    p.addEventListener("pointermove", (evt) => showTip(evt, `${r.label} · ${opts.keys[k].name}`, [
                        { value: pct.toFixed(1).replace(".", ",") + " %", label: "du temps", color: opts.keys[k].color },
                        { value: fmt(v), label: opts.valueLabel || "" },
                    ]));
                    p.addEventListener("pointerleave", hideTip);
                    acc += v;
                });
            });
        };
        mount(container, draw);
        return {
            table: {
                head: ["", ...opts.keys.map((k) => k.name)],
                rows: opts.rows.map((r) => [r.label, ...r.values.map(fmt)]),
            },
        };
    }

    // =====================================================================
    // 6. Barres horizontales simples (classement / répartition)
    // =====================================================================
    /** opts = { rows: [{ label, value, color, note }], format } */
    function hbars(container, opts) {
        const fmt = opts.format || ((v) => v.toFixed(0));
        const draw = () => {
            const rowH = 18, gap = 22, labelW = opts.labelWidth || 84, valueW = opts.valueWidth || 110;
            const height = opts.rows.length * (rowH + gap);
            const { svg, width } = svgRoot(container, height);
            const iw = width - labelW - valueW;
            const max = Math.max(...opts.rows.map((r) => r.value), 1e-9);
            opts.rows.forEach((r, i) => {
                const yy = i * (rowH + gap) + gap / 2;
                el("text", { x: labelW - 10, y: yy + rowH / 2 + 4, "text-anchor": "end", class: "viz-tick viz-tick-strong" }, svg).textContent = r.label;
                const w = (r.value / max) * iw;
                const p = el("path", { d: hbarPath(labelW, yy, w, rowH, 4, true), fill: r.color, class: "viz-bar" }, svg);
                const t = el("text", { x: labelW + w + 8, y: yy + rowH / 2 + 4, class: "viz-value" }, svg);
                t.textContent = fmt(r.value) + (r.note ? "  ·  " + r.note : "");
                p.addEventListener("pointermove", (evt) => showTip(evt, r.label, [{ value: fmt(r.value), label: r.note || "", color: r.color }]));
                p.addEventListener("pointerleave", hideTip);
            });
        };
        mount(container, draw);
        return { table: { head: ["", "Valeur", ""], rows: opts.rows.map((r) => [r.label, fmt(r.value), r.note || ""]) } };
    }

    // ------------------------------------------------- petite courbe (tuile KPI)
    function sparkline(container, values, color) {
        const draw = () => {
            const { svg, width, height } = svgRoot(container, 34, 60);
            const v = values.filter((x) => x != null);
            if (v.length < 2) return;
            const min = Math.min(...v), max = Math.max(...v);
            const X = (i) => 2 + (i / (values.length - 1)) * (width - 8);
            const Y = (val) => 4 + (1 - (val - min) / (max - min || 1)) * (height - 8);
            let d = "";
            values.forEach((val, i) => { if (val != null) d += (d ? "L" : "M") + X(i) + "," + Y(val); });
            el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
            el("circle", { cx: X(values.length - 1), cy: Y(values[values.length - 1]), r: 3, fill: color }, svg);
        };
        mount(container, draw);
    }

    global.AltarunCharts = { bandChart, scatter, matrix, calendar, hstack, hbars, sparkline, showTip, hideTip };
})(window);

/* ==========================================================================
   Altarun — Studio KPI
   --------------------------------------------------------------------------
   Constructeur de KPI en glisser-déposer : on choisit une mesure, un axe,
   une légende et des filtres ; le studio agrège les activités, choisit un
   visuel adapté et génère la requête BigQuery équivalente sur le mart
   `fct_activities`. Un KPI construit peut être épinglé au tableau de bord.
   ========================================================================== */
(function (global) {
    "use strict";

    const M = global.AltarunMetrics;
    const V = global.AltarunCharts;
    const F = M.fmt;

    const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    const DOW = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    const TYPES = {
        easy: "Footing", long: "Sortie longue", intervals: "Fractionné", tempo: "Tempo", race: "Compétition",
        match: "Match", training: "Entraînement", endurance: "Endurance", technique: "Technique",
        bouldering: "Bloc", "18_holes": "18 trous", "9_holes": "9 trous",
    };
    // Palette catégorielle (ordre fixe, validée daltonisme) pour les légendes hors « sport »
    const CAT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
    const SINGLE = "#3987e5";
    const TABLE = "`altarun.marts.fct_activities`";

    // ------------------------------------------------------------ dimensions
    const DIMS = [
        // sql = expression BigQuery ; sqlValue = libellé affiché -> valeur stockée (pour les filtres)
        { key: "sport", label: "Sport", group: "Activité", get: (a) => M.SPORT[a.sport_type].label, order: M.SPORTS.map((s) => s.label), sql: "a.sport_type", sqlValue: (v) => M.SPORTS.find((s) => s.label === v).key },
        { key: "type", label: "Type de séance", group: "Activité", get: (a) => TYPES[a.workout_type] || a.workout_type, sql: "a.workout_type", sqlValue: (v) => Object.keys(TYPES).find((k) => TYPES[k] === v) || v },
        { key: "resultat", label: "Résultat (tennis)", group: "Activité", get: (a) => (a.result ? (a.result === "W" ? "Victoire" : "Défaite") : null), order: ["Victoire", "Défaite"], sql: "a.result", sqlValue: (v) => (v === "Victoire" ? "W" : "L"), where: "a.result IS NOT NULL" },
        { key: "jour", label: "Jour de la semaine", group: "Temps", get: (a) => DOW[(a.date.getDay() + 6) % 7], order: DOW, sql: "FORMAT_DATE('%u', DATE(a.start_date_local))", sqlValue: (v) => String(DOW.indexOf(v) + 1) },
        { key: "moment", label: "Moment de la journée", group: "Temps", get: (a) => a.d_moment, order: ["Matin", "Midi", "Après-midi", "Soir"], sql: "CASE WHEN EXTRACT(HOUR FROM a.start_date_local) < 11 THEN 'Matin' WHEN EXTRACT(HOUR FROM a.start_date_local) < 15 THEN 'Midi' WHEN EXTRACT(HOUR FROM a.start_date_local) < 18 THEN 'Après-midi' ELSE 'Soir' END" },
        { key: "semaine", label: "Semaine", group: "Temps", time: "week", get: (a) => M.dayKey(M.mondayOf(a.date)), sql: "DATE_TRUNC(DATE(a.start_date_local), ISOWEEK)" },
        { key: "mois", label: "Mois", group: "Temps", time: "month", get: (a) => `${a.date.getFullYear()}-${String(a.date.getMonth() + 1).padStart(2, "0")}`, sql: "DATE_TRUNC(DATE(a.start_date_local), MONTH)" },
        { key: "veille", label: "Activité de la veille", group: "Croisement", get: (a) => a.d_veille, order: ["Repos", "Tennis", "Course", "Autre sport"], sql: "COALESCE(v.activite_veille, 'Repos')", needs: "veille" },
        { key: "chargeVeille", label: "Charge de la veille", group: "Croisement", get: (a) => a.d_chargeVeille, order: ["Repos", "Légère (< 80)", "Modérée (80–150)", "Forte (> 150)"], sql: "CASE WHEN v.charge IS NULL THEN 'Repos' WHEN v.charge < 80 THEN 'Légère (< 80)' WHEN v.charge <= 150 THEN 'Modérée (80–150)' ELSE 'Forte (> 150)' END", needs: "veille" },
        { key: "forme", label: "Forme du jour (TSB)", group: "Croisement", get: (a) => a.d_forme, order: ["Frais", "Équilibré", "Productif", "Surcharge"], sql: "l.forme", needs: "load" },
        { key: "golfWeek", label: "Semaine avec golf", group: "Croisement", get: (a) => a.d_golfWeek, order: ["Oui", "Non"], sql: "IF(gw.semaine IS NULL, 'Non', 'Oui')", needs: "golf" },
    ];

    // ------------------------------------------------------------ mesures
    const isRun = (a) => a.sport_type === "Run";
    const MEASURES = [
        { key: "count", label: "Nombre de séances", unit: "", aggs: ["count"], get: () => 1, fmt: (v) => F.fr(v), sqlCol: "*" },
        { key: "duree", label: "Durée", unit: "h", aggs: ["sum", "avg", "median", "max"], get: (a) => a.hours, fmt: (v) => F.fr(v, v < 10 ? 1 : 0) + " h", sqlCol: "a.moving_time_min / 60" },
        { key: "distance", label: "Distance", unit: "km", aggs: ["sum", "avg", "median", "max"], get: (a) => a.distance_km, keep: (a) => a.distance_km != null, fmt: (v) => F.fr(v, v < 10 ? 1 : 0) + " km", sqlCol: "a.distance_km", sqlWhere: "a.distance_km IS NOT NULL" },
        { key: "trimp", label: "Charge (TRIMP)", unit: "", aggs: ["sum", "avg", "median", "max"], get: (a) => a.load, fmt: (v) => F.fr(v), sqlCol: "a.trimp" },
        { key: "fc", label: "FC moyenne", unit: "bpm", aggs: ["avg", "median", "max", "min"], get: (a) => a.avg_hr, fmt: (v) => F.fr(v) + " bpm", zeroless: true, sqlCol: "a.avg_hr" },
        { key: "allure", label: "Allure course", unit: "/km", aggs: ["weighted"], keep: isRun, weighted: (rs) => (M.sum(rs, (r) => r.moving_time_min) * 60) / M.sum(rs, (r) => r.distance_km), fmt: (v) => F.pace(v), zeroless: true, lowerIsBetter: true, sqlExpr: "SUM(a.moving_time_min) * 60 / SUM(a.distance_km)", sqlWhere: "a.sport_type = 'Run'" },
        { key: "ef", label: "Efficacité aérobie", unit: "", aggs: ["avg", "median"], keep: (a) => isRun(a) && (a.workout_type === "easy" || a.workout_type === "long"), get: (a) => M.efficiency(a), fmt: (v) => F.fr(v, 3), zeroless: true, sqlCol: "a.distance_km * 1000 / a.moving_time_min / a.avg_hr", sqlWhere: "a.workout_type IN ('easy', 'long')" },
        { key: "calories", label: "Calories", unit: "kcal", aggs: ["sum", "avg"], get: (a) => a.calories, fmt: (v) => F.fr(v) + " kcal", sqlCol: "a.calories" },
        { key: "denivele", label: "Dénivelé positif", unit: "m", aggs: ["sum", "avg", "max"], keep: (a) => a.elevation_gain_m != null, get: (a) => a.elevation_gain_m, fmt: (v) => F.fr(v) + " m", sqlCol: "a.elevation_gain_m", sqlWhere: "a.elevation_gain_m IS NOT NULL" },
        { key: "victoires", label: "Taux de victoire tennis", unit: "%", aggs: ["ratio"], keep: (a) => a.workout_type === "match", weighted: (rs) => (100 * rs.filter((r) => r.result === "W").length) / rs.length, fmt: (v) => F.fr(v) + " %", sqlExpr: "100 * COUNTIF(a.result = 'W') / COUNT(*)", sqlWhere: "a.workout_type = 'match'" },
        { key: "score", label: "Score golf (18 trous)", unit: "coups", aggs: ["avg", "median", "min"], keep: (a) => a.holes === 18, get: (a) => a.strokes, fmt: (v) => F.fr(v, 1), tick: (v) => F.fr(v), zeroless: true, lowerIsBetter: true, sqlCol: "a.strokes", sqlWhere: "a.holes = 18" },
        { key: "blocs", label: "Blocs réussis", unit: "", aggs: ["sum", "avg", "max"], keep: (a) => a.problems_sent != null, get: (a) => a.problems_sent, fmt: (v) => F.fr(v), sqlCol: "a.problems_sent", sqlWhere: "a.sport_type = 'RockClimbing'" },
    ];
    const AGG_LABEL = { sum: "Somme", avg: "Moyenne", median: "Médiane", max: "Max", min: "Min", count: "Nombre", weighted: "Pondérée", ratio: "Ratio" };
    const AGG_SQL = { sum: "SUM", avg: "AVG", max: "MAX", min: "MIN" };
    const DIM = Object.fromEntries(DIMS.map((d) => [d.key, d]));
    const MEA = Object.fromEntries(MEASURES.map((m) => [m.key, m]));

    const VISUALS = [
        { key: "bar", label: "Barres", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
        { key: "stacked", label: "Empilé", icon: "M5 20v-6h4v6M5 14V9h4v5M13 20V7h4v13M13 7V4h4v3" },
        { key: "line", label: "Courbe", icon: "M3 17l5-6 4 3 8-9" },
        { key: "dots", label: "Points", icon: "M6 14a1.6 1.6 0 1 0 0 .1M12 8a1.6 1.6 0 1 0 0 .1M18 11a1.6 1.6 0 1 0 0 .1" },
        { key: "kpi", label: "Carte", icon: "M4 6h16v12H4zM8 13h8" },
        { key: "table", label: "Tableau", icon: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14" },
    ];

    // Modèles : points de départ pour montrer l'étendue du studio
    const TEMPLATES = [
        { name: "Allure selon la veille", cfg: { x: "veille", value: { key: "allure", agg: "weighted" }, legend: null, filters: { type: ["Footing"] }, visual: "dots" } },
        { name: "Charge par jour et par sport", cfg: { x: "jour", value: { key: "trimp", agg: "sum" }, legend: "sport", filters: {}, visual: "stacked" } },
        { name: "Allure selon la forme", cfg: { x: "forme", value: { key: "allure", agg: "weighted" }, legend: null, filters: {}, visual: "dots" } },
        { name: "Volume mensuel par sport", cfg: { x: "mois", value: { key: "duree", agg: "sum" }, legend: "sport", filters: {}, visual: "stacked" } },
        { name: "Victoires selon la charge de la veille", cfg: { x: "chargeVeille", value: { key: "victoires", agg: "ratio" }, legend: null, filters: {}, visual: "bar" } },
        { name: "FC moyenne par moment de la journée", cfg: { x: "moment", value: { key: "fc", agg: "avg" }, legend: "sport", filters: {}, visual: "dots" } },
        { name: "Score golf par mois", cfg: { x: "mois", value: { key: "score", agg: "avg" }, legend: null, filters: {}, visual: "line" } },
    ];

    // ------------------------------------------------------------ calcul
    function median(arr) {
        const s = arr.slice().sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    function aggregate(rows, mea, agg) {
        if (!rows.length) return null;
        if (mea.weighted) return mea.weighted(rows);
        const vals = rows.map(mea.get).filter((v) => v != null && isFinite(v));
        if (!vals.length) return null;
        switch (agg) {
            case "count": return rows.length;
            case "sum": return M.sum(vals);
            case "avg": return M.mean(vals);
            case "median": return median(vals);
            case "max": return Math.max(...vals);
            case "min": return Math.min(...vals);
            default: return M.sum(vals);
        }
    }

    function timeLabel(dim, key) {
        if (dim.time === "week") { const d = new Date(key); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
        const [y, m] = key.split("-").map(Number);
        return `${MONTHS[m - 1]}${m === 1 ? " " + String(y).slice(2) : ""}`;
    }

    function timeKeys(dim, from, to) {
        const out = [];
        if (dim.time === "week") for (let d = M.mondayOf(from); d <= to; d = M.addDays(d, 7)) out.push(M.dayKey(d));
        else for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
        return out;
    }

    /** Applique filtres + mesure, regroupe par axe × légende. */
    function compute(cfg, acts, ctx) {
        const mea = MEA[cfg.value.key];
        let rows = acts.filter((a) => (mea.keep ? mea.keep(a) : true));
        Object.entries(cfg.filters || {}).forEach(([k, vals]) => {
            if (!vals || !vals.length) return;
            const d = DIM[k];
            rows = rows.filter((a) => vals.includes(d.get(a)));
        });
        const xd = cfg.x ? DIM[cfg.x] : null, ld = cfg.legend ? DIM[cfg.legend] : null;
        if (xd) rows = rows.filter((a) => xd.get(a) != null);
        if (ld) rows = rows.filter((a) => ld.get(a) != null);

        const keysOf = (d) => {
            if (!d) return ["__all"];
            if (d.time) return timeKeys(d, ctx.from, ctx.end);
            const present = new Set(rows.map(d.get));
            if (d.order) return d.order.filter((k) => present.has(k));
            return [...present];
        };
        let xs = keysOf(xd);
        let ls = keysOf(ld);
        // Légende : 6 valeurs max, le reste est regroupé dans « Autres »
        if (ld && !ld.order && ls.length > 6) ls = ls.slice(0, 5).concat("Autres");
        const lOf = (a) => { const v = ld.get(a); return ls.includes(v) ? v : "Autres"; };

        const groups = new Map();
        rows.forEach((a) => {
            const k = (xd ? xd.get(a) : "__all") + "\u0001" + (ld ? lOf(a) : "__all");
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(a);
        });
        const series = ls.map((l) => ({
            key: l,
            values: xs.map((x) => { const g = groups.get(x + "\u0001" + l); return g ? aggregate(g, mea, cfg.value.agg) : null; }),
            counts: xs.map((x) => (groups.get(x + "\u0001" + l) || []).length),
        }));
        // Axe catégoriel sans ordre métier : tri par valeur décroissante
        if (xd && !xd.time && !xd.order) {
            const tot = xs.map((_, i) => M.sum(series, (s) => s.values[i] || 0));
            const idx = xs.map((_, i) => i).sort((a, b) => tot[b] - tot[a]);
            xs = idx.map((i) => xs[i]);
            series.forEach((s) => { s.values = idx.map((i) => s.values[i]); s.counts = idx.map((i) => s.counts[i]); });
        }
        return {
            xs, labels: xs.map((x) => (x === "__all" ? "Total" : xd && xd.time ? timeLabel(xd, x) : x)),
            series, total: aggregate(rows, mea, cfg.value.agg), n: rows.length, mea, xd, ld,
        };
    }

    function colorFor(ld, key, i) {
        if (ld && ld.key === "sport") { const s = M.SPORTS.find((x) => x.label === key); if (s) return s.color; }
        if (!ld) return SINGLE;
        return key === "Autres" ? "#6b6b76" : CAT[i % CAT.length];
    }

    // ------------------------------------------------------------ SQL
    function buildSql(cfg, ctx, sportKey) {
        const mea = MEA[cfg.value.key];
        const dims = [cfg.x, cfg.legend, ...Object.keys(cfg.filters || {}).filter((k) => (cfg.filters[k] || []).length)].filter(Boolean).map((k) => DIM[k]);
        const needs = new Set(dims.map((d) => d.needs).filter(Boolean));
        const ctes = [];
        if (needs.has("veille")) ctes.push(
`jours AS (
  SELECT DATE(start_date_local) AS jour,
         SUM(trimp) AS charge,
         LOGICAL_OR(sport_type = 'Tennis') AS tennis,
         LOGICAL_OR(sport_type = 'Run') AS course
  FROM ${TABLE}
  GROUP BY jour
),
veille AS (
  SELECT DATE_ADD(jour, INTERVAL 1 DAY) AS jour, charge,
         CASE WHEN tennis THEN 'Tennis' WHEN course THEN 'Course' ELSE 'Autre sport' END AS activite_veille
  FROM jours
)`);
        if (needs.has("golf")) ctes.push(
`semaines_golf AS (
  SELECT DISTINCT DATE_TRUNC(DATE(start_date_local), ISOWEEK) AS semaine
  FROM ${TABLE}
  WHERE sport_type = 'Golf'
)`);
        const sel = [];
        if (cfg.x) sel.push(`  ${DIM[cfg.x].sql} AS axe`);
        if (cfg.legend) sel.push(`  ${DIM[cfg.legend].sql} AS legende`);
        const agg = cfg.value.agg;
        const valueExpr = mea.sqlExpr || (agg === "count" ? "COUNT(*)" : agg === "median" ? `APPROX_QUANTILES(${mea.sqlCol}, 2)[OFFSET(1)]` : `${AGG_SQL[agg] || "SUM"}(${mea.sqlCol})`);
        sel.push(`  ${valueExpr} AS valeur`);
        const joins = [];
        if (needs.has("veille")) joins.push("LEFT JOIN veille v ON v.jour = DATE(a.start_date_local)");
        if (needs.has("load")) joins.push("LEFT JOIN `altarun.marts.fct_daily_load` l ON l.jour = DATE(a.start_date_local)");
        if (needs.has("golf")) joins.push("LEFT JOIN semaines_golf gw ON gw.semaine = DATE_TRUNC(DATE(a.start_date_local), ISOWEEK)");
        const where = [`DATE(a.start_date_local) BETWEEN '${M.dayKey(ctx.from)}' AND '${M.dayKey(ctx.end)}'`];
        if (sportKey !== "all") where.push(`a.sport_type = '${sportKey}'`);
        if (mea.sqlWhere) where.push(mea.sqlWhere);
        dims.forEach((d) => { if (d.where) where.push(d.where); });
        Object.entries(cfg.filters || {}).forEach(([k, vals]) => {
            const d = DIM[k];
            if (vals && vals.length) where.push(`${d.sql} IN (${vals.map((v) => `'${String(d.sqlValue ? d.sqlValue(v) : v).replace(/'/g, "\\'")}'`).join(", ")})`);
        });
        const group = [cfg.x && "axe", cfg.legend && "legende"].filter(Boolean);
        return (ctes.length ? `WITH ${ctes.join(",\n")}\n` : "")
            + `SELECT\n${sel.join(",\n")}\nFROM ${TABLE} a\n`
            + (joins.length ? joins.join("\n") + "\n" : "")
            + `WHERE ${where.join("\n  AND ")}\n`
            + (group.length ? `GROUP BY ${group.join(", ")}\nORDER BY ${group.join(", ")}` : "");
    }

    const SQL_KW = /\b(WITH|AS|SELECT|FROM|LEFT JOIN|ON|WHERE|AND|IN|GROUP BY|ORDER BY|CASE|WHEN|THEN|ELSE|END|IS NULL|IS NOT NULL|NOT|DISTINCT|INTERVAL|DAY|ISOWEEK|MONTH|HOUR|OFFSET)\b/g;
    function sqlNode(h, sql) {
        const pre = h("pre", { class: "studio-sql-code" });
        let last = 0;
        sql.replace(SQL_KW, (m, _k, off) => {
            if (off > last) pre.appendChild(document.createTextNode(sql.slice(last, off)));
            pre.appendChild(h("span", { class: "kw" }, m));
            last = off + m.length;
            return m;
        });
        pre.appendChild(document.createTextNode(sql.slice(last)));
        return pre;
    }

    // ------------------------------------------------------------ titre auto
    function autoTitle(cfg) {
        if (!cfg.value) return "Nouveau KPI";
        const mea = MEA[cfg.value.key];
        const agg = ["sum", "avg", "median", "max", "min"].includes(cfg.value.agg) && cfg.value.key !== "count" ? `${AGG_LABEL[cfg.value.agg]} · ` : "";
        let t = agg + mea.label;
        if (cfg.x) t += ` par ${DIM[cfg.x].label.toLowerCase()}`;
        if (cfg.legend) t += ` et ${DIM[cfg.legend].label.toLowerCase()}`;
        return t;
    }

    // ------------------------------------------------------------ rendu d'un visuel
    /** Dessine le visuel d'une config dans `host`. Retourne { table, result }. */
    function renderVisual(host, cfg, acts, ctx, h) {
        host.replaceChildren();
        if (!cfg.value) return { table: null };
        const r = compute(cfg, acts, ctx);
        const fmt = r.mea.fmt;
        if (!r.n) {
            host.append(h("div", { class: "studio-empty" }, "Aucune activité ne correspond à ces filtres sur la période."));
            return { table: null, result: r };
        }
        const visual = cfg.visual || "bar";
        const legendItems = r.ld ? r.series.map((s, i) => ({ name: s.key, color: colorFor(r.ld, s.key, i) })) : [];

        if (visual === "kpi") {
            const tile = h("div", { class: "studio-kpi" },
                h("div", { class: "studio-kpi-value" }, fmt(r.total)),
                h("div", { class: "studio-kpi-sub" }, `${AGG_LABEL[cfg.value.agg]} sur ${r.n} activités`));
            host.append(tile);
            if (r.xd && r.labels.length > 1) {
                const list = h("div", { class: "studio-kpi-break" }, r.labels.map((lab, i) => {
                    const v = r.ld ? null : r.series[0].values[i];
                    return v == null ? null : h("div", { class: "studio-kpi-row" }, h("span", {}, lab), h("strong", {}, fmt(v)));
                }));
                host.append(list);
            }
        } else if (visual === "table") {
            // rendu par la vue tableau ci-dessous
        } else {
            const chartHost = h("div", {});
            if (legendItems.length) host.append(h("div", { class: "dash-legend" }, legendItems.map((it) => h("span", { class: "dash-legend-item" }, h("span", { class: "dash-legend-key", style: `--c:${it.color}` }), it.name))));
            host.append(chartHost);
            const named = r.series.map((s, i) => ({ name: r.ld ? s.key : r.mea.label, color: colorFor(r.ld, s.key, i), values: s.values }));
            const base = { labels: r.labels, yFormat: r.mea.tick || fmt, height: 280 };
            if (visual === "line") V.bandChart(chartHost, { ...base, lines: named.map((s) => ({ ...s, dots: r.labels.length <= 24 })), valueLabels: r.labels.length <= 8 ? fmt : null });
            else if (visual === "dots") {
                const k = named.length;
                V.bandChart(chartHost, { ...base, lines: named.map((s, i) => ({ ...s, noPath: true, dots: true, endDot: false, dotOffset: (i - (k - 1) / 2) * 12 })), valueLabels: k === 1 ? fmt : null, invertY: r.mea.lowerIsBetter && r.mea.key === "allure" });
            } else V.bandChart(chartHost, { ...base, bars: named, stacked: visual === "stacked", valueLabels: visual === "bar" ? fmt : null });
        }
        const table = {
            head: [r.xd ? r.xd.label : "", ...(r.ld ? r.series.map((s) => s.key) : [r.mea.label]), "n"],
            rows: r.labels.map((lab, i) => [lab, ...r.series.map((s) => (s.values[i] == null ? "—" : fmt(s.values[i]))), M.sum(r.series, (s) => s.counts[i])]),
        };
        if (visual === "table") {
            host.append(h("div", { class: "dash-table-wrap" }, h("table", { class: "dash-table" },
                h("thead", {}, h("tr", {}, table.head.map((c) => h("th", {}, c)))),
                h("tbody", {}, table.rows.map((row) => h("tr", {}, row.map((c, j) => h("td", { class: j ? "num" : "" }, String(c)))))))));
        }
        return { table, result: r };
    }

    /** Ligne de synthèse façon dashboard : max, min, écart. */
    function summary(r, h) {
        if (!r || !r.xd || r.ld || r.labels.length < 2) return null;
        const vals = r.series[0].values.map((v, i) => ({ v, lab: r.labels[i], n: r.series[0].counts[i] })).filter((x) => x.v != null);
        if (vals.length < 2) return null;
        const hi = vals.reduce((a, b) => (b.v > a.v ? b : a)), lo = vals.reduce((a, b) => (b.v < a.v ? b : a));
        const diff = hi.v - lo.v;
        const diffTxt = r.mea.key === "allure" ? `${F.fr(diff, 1)} s/km` : r.mea.fmt(diff);
        return h("div", { class: "studio-summary" },
            h("span", {}, h("em", {}, "Max "), `${hi.lab} · ${r.mea.fmt(hi.v)}`),
            h("span", {}, h("em", {}, "Min "), `${lo.lab} · ${r.mea.fmt(lo.v)}`),
            h("span", {}, h("em", {}, "Écart "), diffTxt),
            h("span", {}, h("em", {}, "n "), String(r.n)));
    }

    // =====================================================================
    // Interface du studio
    // =====================================================================
    let cfg = { x: null, value: null, legend: null, filters: {}, visual: "bar", title: null };
    let fieldQuery = "";

    function clone(c) { return JSON.parse(JSON.stringify(c)); }

    function mount(host, api) {
        const { h, acts, ctx, sport, onPin, pinsCount } = api;
        host.replaceChildren();

        const rerender = () => mount(host, api);
        const set = (patch) => { cfg = { ...cfg, ...patch }; rerender(); };

        // ---------------- panneau Champs
        const dragStart = (kind, key) => (e) => {
            e.dataTransfer.setData("text/plain", `${kind}:${key}`);
            e.dataTransfer.effectAllowed = "copy";
            host.classList.add("is-dragging", `drag-${kind}`);
        };
        const dragEnd = () => host.classList.remove("is-dragging", "drag-dim", "drag-mea");
        const autoPlace = (kind, key) => {
            if (kind === "mea") {
                const m = MEA[key];
                set({ value: { key, agg: m.aggs.includes("avg") && m.zeroless ? "avg" : m.aggs[0] }, visual: m.zeroless && !cfg.legend ? "dots" : cfg.visual === "dots" && !m.zeroless ? "bar" : cfg.visual });
            } else if (!cfg.x) set({ x: key, visual: DIM[key].time && cfg.visual === "bar" ? "line" : cfg.visual });
            else if (!cfg.legend && key !== cfg.x) set({ legend: key });
            else set({ filters: { ...cfg.filters, [key]: cfg.filters[key] || [] } });
        };
        const field = (kind, f) => h("button", {
            type: "button", class: `studio-field ${kind}`, draggable: "true",
            ondragstart: dragStart(kind, f.key), ondragend: dragEnd, onclick: () => autoPlace(kind, f.key),
            title: "Glisser vers une zone, ou cliquer pour l'ajouter",
        }, h("span", { class: "studio-field-icon", "aria-hidden": "true" }, kind === "mea" ? "Σ" : "≡"), f.label);
        const q = fieldQuery.toLowerCase();
        const match = (f) => !q || f.label.toLowerCase().includes(q);
        const groups = ["Activité", "Temps", "Croisement"];
        const search = h("input", { type: "search", id: "studio-search", class: "studio-search", placeholder: "Rechercher un champ", value: fieldQuery });
        search.addEventListener("input", (e) => { fieldQuery = e.target.value; const pos = e.target.selectionStart; rerender(); const n = document.getElementById("studio-search"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } });
        const fields = h("aside", { class: "studio-panel studio-fields" },
            h("div", { class: "studio-panel-title" }, "Champs", h("span", { class: "studio-panel-hint" }, "fct_activities")),
            search,
            h("div", { class: "studio-group-label" }, "Mesures"),
            h("div", { class: "studio-field-list" }, MEASURES.filter(match).map((m) => field("mea", m))),
            ...groups.map((g) => [
                h("div", { class: "studio-group-label" }, g === "Croisement" ? "Dimensions croisées" : `Dimensions · ${g.toLowerCase()}`),
                h("div", { class: "studio-field-list" }, DIMS.filter((d) => d.group === g && match(d)).map((d) => field("dim", d))),
            ]).flat());

        // ---------------- panneau Construction (zones de dépôt)
        const well = (slot, label, accepts, content) => {
            const node = h("div", { class: `studio-well ${content ? "filled" : ""}`, "data-accepts": accepts },
                h("div", { class: "studio-well-label" }, label), content || h("div", { class: "studio-well-empty" }, accepts === "mea" ? "Déposer une mesure" : "Déposer une dimension"));
            node.addEventListener("dragover", (e) => {
                const ok = host.classList.contains(`drag-${accepts}`);
                if (ok) { e.preventDefault(); node.classList.add("is-over"); }
            });
            node.addEventListener("dragleave", () => node.classList.remove("is-over"));
            node.addEventListener("drop", (e) => {
                e.preventDefault(); node.classList.remove("is-over"); dragEnd();
                const [kind, key] = e.dataTransfer.getData("text/plain").split(":");
                if (kind !== accepts) return;
                if (slot === "value") { const m = MEA[key]; set({ value: { key, agg: m.aggs.includes("avg") && m.zeroless ? "avg" : m.aggs[0] }, visual: m.zeroless && !cfg.legend ? "dots" : cfg.visual === "dots" && !m.zeroless ? "bar" : cfg.visual }); }
                else if (slot === "x") set({ x: key, visual: DIM[key].time && (cfg.visual === "bar" || cfg.visual === "dots") ? "line" : cfg.visual });
                else if (slot === "legend") set({ legend: key, visual: cfg.visual === "bar" && !MEA[cfg.value?.key]?.zeroless ? "stacked" : cfg.visual });
                else if (slot === "filters") set({ filters: { ...cfg.filters, [key]: cfg.filters[key] || [] } });
            });
            return node;
        };
        const pill = (label, onRemove, extra) => h("div", { class: "studio-pill" }, h("span", { class: "studio-pill-label" }, label), extra || null,
            h("button", { type: "button", class: "studio-pill-x", "aria-label": `Retirer ${label}`, onclick: onRemove }, "×"));

        let aggSelect = null;
        if (cfg.value) {
            const m = MEA[cfg.value.key];
            aggSelect = h("select", { class: "studio-agg", id: "studio-agg", "aria-label": "Agrégation", disabled: m.aggs.length < 2 ? "disabled" : null, onchange: (e) => set({ value: { ...cfg.value, agg: e.target.value } }) },
                m.aggs.map((a) => { const o = h("option", { value: a }, AGG_LABEL[a]); if (a === cfg.value.agg) o.selected = true; return o; }));
        }
        // filtres : valeurs cliquables
        const filterContent = Object.keys(cfg.filters).length ? h("div", { class: "studio-filters" }, Object.entries(cfg.filters).map(([k, vals]) => {
            const d = DIM[k];
            // Valeurs proposées : celles présentes dans les activités concernées par la mesure
            const mea = cfg.value ? MEA[cfg.value.key] : null;
            const scope = mea && mea.keep ? acts.filter(mea.keep) : acts;
            const present = [...new Set(scope.map(d.get).filter((v) => v != null))];
            const values = d.order ? d.order.filter((v) => present.includes(v)) : d.time ? present.sort() : present.sort();
            return h("div", { class: "studio-filter" },
                pill(d.label, () => { const f = { ...cfg.filters }; delete f[k]; set({ filters: f }); }),
                h("div", { class: "studio-chips" }, values.slice(0, 14).map((v) => h("button", {
                    type: "button", class: `studio-chip ${vals.includes(v) ? "on" : ""}`, "aria-pressed": String(vals.includes(v)),
                    onclick: () => { const nv = vals.includes(v) ? vals.filter((x) => x !== v) : vals.concat(v); set({ filters: { ...cfg.filters, [k]: nv } }); },
                }, d.time ? timeLabel(d, v) : v)), vals.length ? null : h("span", { class: "studio-chip-hint" }, "Toutes les valeurs")));
        })) : null;

        const visuals = h("div", { class: "studio-visuals", role: "radiogroup", "aria-label": "Type de visuel" }, VISUALS.map((v) => h("button", {
            type: "button", role: "radio", "aria-checked": String(cfg.visual === v.key), class: "studio-visual", title: v.label,
            onclick: () => set({ visual: v.key }),
        }, svgIcon(h, v.icon), h("span", {}, v.label))));

        const build = h("aside", { class: "studio-panel studio-build" },
            h("div", { class: "studio-panel-title" }, "Visuel"),
            visuals,
            h("div", { class: "studio-panel-title" }, "Construction"),
            well("value", "Valeur", "mea", cfg.value ? pill(MEA[cfg.value.key].label, () => set({ value: null }), aggSelect) : null),
            well("x", "Axe", "dim", cfg.x ? pill(DIM[cfg.x].label, () => set({ x: null })) : null),
            well("legend", "Légende", "dim", cfg.legend ? pill(DIM[cfg.legend].label, () => set({ legend: null })) : null),
            well("filters", "Filtres", "dim", filterContent));

        // ---------------- canevas
        const title = h("input", { class: "studio-title", id: "studio-title", value: cfg.title || autoTitle(cfg), "aria-label": "Nom du KPI" });
        title.addEventListener("change", (e) => { cfg.title = e.target.value.trim() || null; });
        const visualHost = h("div", { class: "studio-visual-host" });
        const canvas = h("section", { class: "studio-canvas" },
            h("div", { class: "studio-canvas-head" }, title,
                h("div", { class: "studio-actions" },
                    h("button", { type: "button", class: "dash-btn ghost", onclick: () => { cfg = { x: null, value: null, legend: null, filters: {}, visual: "bar", title: null }; rerender(); } }, "Réinitialiser"),
                    h("button", { type: "button", class: "dash-btn primary", disabled: cfg.value ? null : "disabled", onclick: () => { onPin({ ...clone(cfg), title: title.value.trim() || autoTitle(cfg) }); } }, "Épingler au dashboard"))),
            visualHost);

        const templates = h("div", { class: "studio-templates" }, h("span", { class: "studio-templates-label" }, "Partir d'un modèle"),
            TEMPLATES.map((t) => h("button", { type: "button", class: "studio-template", onclick: () => { cfg = { ...clone(t.cfg), title: t.name }; rerender(); } }, t.name)));

        host.append(templates, h("div", { class: "studio" }, fields, canvas, build));

        // rendu du visuel (après insertion pour connaître la largeur)
        if (!cfg.value) {
            visualHost.append(h("div", { class: "studio-placeholder" },
                h("strong", {}, "Glisse une mesure dans « Valeur »"),
                h("span", {}, "puis une dimension dans « Axe » pour la découper. Tu peux aussi cliquer sur un champ ou partir d'un modèle."),
                h("span", { class: "studio-placeholder-meta" }, `${acts.length} activités disponibles · ${MEASURES.length} mesures · ${DIMS.length} dimensions`)));
        } else {
            const { result } = renderVisual(visualHost, cfg, acts, ctx, h);
            const sum = summary(result, h);
            if (sum) canvas.append(sum);
            const sql = buildSql(cfg, ctx, sport);
            const copy = h("button", { type: "button", class: "dash-link-btn" }, "Copier");
            copy.addEventListener("click", () => {
                const done = () => { copy.textContent = "Copié"; setTimeout(() => (copy.textContent = "Copier"), 1500); };
                if (navigator.clipboard) navigator.clipboard.writeText(sql).then(done, () => {});
            });
            canvas.append(h("details", { class: "studio-sql" },
                h("summary", {}, "Requête BigQuery générée", copy),
                sqlNode(h, sql)));
        }
        if (pinsCount) canvas.append(h("p", { class: "dash-footnote" }, `${pinsCount} KPI épinglé${pinsCount > 1 ? "s" : ""} sur la vue d'ensemble.`));
    }

    function svgIcon(h, d) {
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "18"); svg.setAttribute("height", "18");
        svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
        const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); svg.appendChild(p);
        return svg;
    }

    global.AltarunStudio = { mount, renderVisual, autoTitle, DIMS, MEASURES, TEMPLATES };
})(window);

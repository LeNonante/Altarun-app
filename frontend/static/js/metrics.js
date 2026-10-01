/* ==========================================================================
   Altarun — couche sémantique (métriques métier)
   --------------------------------------------------------------------------
   Toutes les définitions de KPI vivent ici, en un seul endroit, testables et
   indépendantes de l'affichage. Le jour où ces calculs migrent dans dbt
   (marts `fct_daily_load`, `fct_weekly_sport`), le front n'a plus qu'à lire
   les colonnes : les noms et les formules sont déjà alignés.
   ========================================================================== */
(function (global) {
    "use strict";

    const DAY = 86400000;

    // Référentiel des sports (ordre fixe => couleur fixe, jamais réattribuée).
    // Palette validée (contraste >= 3:1, séparation daltonisme ΔE >= 8 entre voisins).
    const SPORTS = [
        { key: "Run", label: "Course", color: "#d95926", unit: "km", target: 40, targetLabel: "Objectif 40 km" },
        { key: "Swim", label: "Natation", color: "#3987e5", unit: "h", target: 1, targetLabel: "Objectif 1 h" },
        { key: "Tennis", label: "Tennis", color: "#c98500", unit: "h", target: 3, targetLabel: "Objectif 3 h" },
        { key: "RockClimbing", label: "Escalade", color: "#9085e9", unit: "h", target: 1, targetLabel: "Objectif 1 h" },
        { key: "Golf", label: "Golf", color: "#199e70", unit: "h", target: 2, targetLabel: "Moyenne visée 2 h" },
    ];
    const SPORT = Object.fromEntries(SPORTS.map((s) => [s.key, s]));

    // ------------------------------------------------------------- dates
    const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
    const isoWeek = (d) => {
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dn = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - dn);
        const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        return Math.ceil(((t - y0) / DAY + 1) / 7);
    };

    // ------------------------------------------------------------- charge
    /**
     * TRIMP de Banister (1991) : durée × FCr × 0,64 × e^(1,92 × FCr)
     * avec FCr = (FCmoy − FCrepos) / (FCmax − FCrepos). Unité commune à tous les sports :
     * c'est elle qui permet de croiser course, tennis, golf… sur une même échelle de charge.
     */
    function trimp(a, athlete) {
        const hrr = Math.max(0, Math.min(1, (a.avg_hr - athlete.hr_rest) / (athlete.hr_max - athlete.hr_rest)));
        return a.moving_time_min * hrr * 0.64 * Math.exp(1.92 * hrr);
    }

    function prepare(payload) {
        const athlete = payload.meta.athlete;
        const acts = payload.activities.map((a) => {
            const date = new Date(a.start_date_local);
            return { ...a, date, day: dayKey(date), load: trimp(a, athlete), hours: a.moving_time_min / 60 };
        });
        acts.sort((a, b) => a.date - b.date);
        const first = startOfDay(acts[0].date);
        const last = startOfDay(acts[acts.length - 1].date);
        return { meta: payload.meta, athlete, acts, first, last };
    }

    /** Série journalière continue de charge (0 les jours sans activité). */
    function dailyLoad(acts, from, to) {
        const byDay = new Map();
        acts.forEach((a) => byDay.set(a.day, (byDay.get(a.day) || 0) + a.load));
        const out = [];
        for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) out.push({ date: d, value: byDay.get(dayKey(d)) || 0 });
        return out;
    }

    /**
     * Modèle impulsion-réponse (Performance Management Chart) :
     *   CTL (forme de fond) = moyenne exponentielle 42 j de la charge
     *   ATL (fatigue)       = moyenne exponentielle 7 j
     *   TSB (fraîcheur)     = CTL(veille) − ATL(veille)
     * ACWR (Gabbett) = charge moyenne 7 j / charge moyenne 28 j.
     */
    function pmc(daily) {
        let ctl = 0, atl = 0;
        const kC = 1 - Math.exp(-1 / 42), kA = 1 - Math.exp(-1 / 7);
        return daily.map((d, i) => {
            const tsb = ctl - atl;
            ctl += (d.value - ctl) * kC;
            atl += (d.value - atl) * kA;
            const s7 = daily.slice(Math.max(0, i - 6), i + 1).reduce((s, x) => s + x.value, 0) / 7;
            const s28 = daily.slice(Math.max(0, i - 27), i + 1).reduce((s, x) => s + x.value, 0) / 28;
            return { date: d.date, load: d.value, ctl, atl, tsb, acwr: s28 > 0 ? s7 / s28 : null };
        });
    }

    function acwrStatus(v) {
        if (v == null) return { key: "na", label: "—" };
        if (v < 0.8) return { key: "warning", label: "Sous-charge" };
        if (v <= 1.3) return { key: "good", label: "Zone optimale" };
        if (v <= 1.5) return { key: "serious", label: "Vigilance" };
        return { key: "critical", label: "Risque de blessure" };
    }

    function tsbStatus(v) {
        if (v > 5) return { key: "good", label: "Frais" };
        if (v >= -10) return { key: "good", label: "Équilibré" };
        if (v >= -30) return { key: "warning", label: "Zone productive" };
        return { key: "critical", label: "Surcharge" };
    }

    // ------------------------------------------------------------- agrégats
    function inRange(acts, from, to) {
        return acts.filter((a) => a.date >= from && a.date < addDays(to, 1));
    }

    /** Buckets (jour ou semaine ISO) continus entre from et to. */
    function buckets(from, to, grain) {
        const out = [];
        if (grain === "day") {
            for (let d = startOfDay(from); d <= to; d = addDays(d, 1)) out.push({ start: d, key: dayKey(d) });
        } else {
            for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) out.push({ start: d, key: dayKey(d) });
        }
        return out;
    }
    function bucketOf(date, grain) {
        return dayKey(grain === "day" ? startOfDay(date) : mondayOf(date));
    }

    function sum(arr, f) { return arr.reduce((s, x) => s + (f ? f(x) : x), 0); }
    function mean(arr, f) { return arr.length ? sum(arr, f) / arr.length : null; }
    function rolling(values, w) {
        return values.map((_, i) => (i < w - 1 ? null : mean(values.slice(i - w + 1, i + 1))));
    }
    function pearson(x, y) {
        const mx = mean(x), my = mean(y);
        let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
        return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
    }
    function linreg(x, y) {
        const mx = mean(x), my = mean(y);
        let sxy = 0, sxx = 0;
        for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
        const slope = sxx ? sxy / sxx : 0;
        return { slope, intercept: my - slope * mx };
    }

    // ------------------------------------------------------------- course
    /** Riegel (1981) : T2 = T1 × (D2 / D1)^1,06 */
    const riegel = (t1, d1, d2) => t1 * Math.pow(d2 / d1, 1.06);

    /** Efficacité aérobie (EF) = vitesse (m/min) / FC moyenne. Plus haut = mieux. */
    const efficiency = (a) => (a.distance_km * 1000) / a.moving_time_min / a.avg_hr;

    // ------------------------------------------------------------- golf
    /** Index estimé façon WHS : moyenne des 8 meilleurs différentiels sur les 20 derniers 18 trous. */
    function golfIndex(rounds, rating = 71.2, slope = 128) {
        const r18 = rounds.filter((r) => r.holes === 18).slice(-20);
        if (r18.length < 3) return null;
        const diffs = r18.map((r) => ((r.strokes - rating) * 113) / slope).sort((a, b) => a - b);
        const best = diffs.slice(0, Math.max(1, Math.round((8 / 20) * diffs.length)));
        return mean(best) * 0.96;
    }

    // ------------------------------------------------------------- formats
    const fr = (v, d = 0) => (v == null || !isFinite(v) ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }));
    const pace = (s) => {
        if (s == null || !isFinite(s)) return "—";
        const m = Math.floor(s / 60), r = Math.round(s - m * 60);
        return r === 60 ? `${m + 1}'00"` : `${m}'${String(r).padStart(2, "0")}"`;
    };
    const duration = (min) => {
        if (min == null) return "—";
        const h = Math.floor(min / 60), m = Math.round(min - h * 60);
        return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
    };
    const hms = (sec) => {
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
        return h ? `${h} h ${String(m).padStart(2, "0")}'${String(s).padStart(2, "0")}"` : `${m}'${String(s).padStart(2, "0")}"`;
    };
    const signed = (v, d = 0, unit = "") => (v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "±") + fr(Math.abs(v), d) + unit);

    global.AltarunMetrics = {
        SPORTS, SPORT, DAY,
        dayKey, startOfDay, addDays, mondayOf, isoWeek,
        trimp, prepare, dailyLoad, pmc, acwrStatus, tsbStatus,
        inRange, buckets, bucketOf, sum, mean, rolling, pearson, linreg,
        riegel, efficiency, golfIndex,
        fmt: { fr, pace, duration, hms, signed },
    };
})(window);

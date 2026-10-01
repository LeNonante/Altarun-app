/* ==========================================================================
   Altarun : Coach IA (page « Mon coach IA »)
   --------------------------------------------------------------------------
   Interface de chat avec le coach. Le contexte envoyé au coach est calculé à
   partir du contrat `fct_activities` (forme du jour, charge, records, effets
   croisés) : c'est ce même contexte qui alimentera le modèle de langage via
   la route API prévue `POST /coach/message`.

   Mode démo (actuel) : les réponses sont produites localement par `respond()`
   à partir de ce contexte, ce qui garantit une démonstration reproductible.
   ========================================================================== */
(function () {
    "use strict";

    const M = window.AltarunMetrics;
    const F = M.fmt;

    // Objectif et paramètres : saisis par l'utilisateur dans son profil sportif
    const P = window.AltarunProfile;
    const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    const longDate = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    let CTX = null;

    // ------------------------------------------------------------- DOM
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
    /** Texte avec **gras** minimal, inséré sans innerHTML. */
    function rich(text) {
        const p = h("p", {});
        text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
            if (part.startsWith("**")) p.appendChild(h("strong", {}, part.slice(2, -2)));
            else if (part) p.appendChild(document.createTextNode(part));
        });
        return p;
    }

    // ------------------------------------------------------------- contexte
    function buildContext(payload) {
        const prof = P.get();
        payload.meta.athlete = { ...payload.meta.athlete, hr_max: prof.hrMax, hr_rest: prof.hrRest };
        const goal = {
            name: prof.race.name, date: P.raceDate(prof), distance: prof.race.distanceKm, targetSec: prof.race.targetSec,
            short: P.distanceOf(prof.race.distanceKm).short, updatedAt: prof.updatedAt,
        };
        const D = M.prepare(payload);
        const today = M.addDays(D.last, 1); // données synchronisées jusqu'à la veille
        const tomorrow = M.addDays(today, 1);
        const pm = M.pmc(M.dailyLoad(D.acts, D.first, D.last));
        const now = pm[pm.length - 1];
        const runs = D.acts.filter((a) => a.sport_type === "Run");
        const races = runs.filter((a) => a.workout_type === "race");
        const best5k = races.filter((r) => Math.abs(r.distance_km - 5) < 0.1).sort((a, b) => a.moving_time_min - b.moving_time_min)[0];
        const bestSame = races.filter((r) => Math.abs(r.distance_km - goal.distance) < 0.2).sort((a, b) => a.moving_time_min - b.moving_time_min)[0];
        const predRace = M.riegel(best5k.moving_time_min * 60, 5, goal.distance);
        const lastQuality = runs.filter((a) => a.workout_type === "intervals" || a.workout_type === "tempo").slice(-1)[0];
        const lastTennis = D.acts.filter((a) => a.sport_type === "Tennis").slice(-1)[0];

        // Effet « tennis la veille » sur les footings (26 dernières semaines)
        const from26 = M.addDays(D.last, -26 * 7 + 1);
        const pool = M.inRange(D.acts, from26, D.last);
        const tDays = new Set(pool.filter((a) => a.sport_type === "Tennis").map((a) => a.day));
        const easy = pool.filter((a) => a.sport_type === "Run" && a.workout_type === "easy");
        const paceOf = (rs) => (M.sum(rs, (r) => r.moving_time_min) * 60) / M.sum(rs, (r) => r.distance_km);
        const after = easy.filter((r) => tDays.has(M.dayKey(M.addDays(r.date, -1))));
        const fresh = easy.filter((r) => !tDays.has(M.dayKey(M.addDays(r.date, -1))));
        const tennisEffect = paceOf(after) - paceOf(fresh);
        const easyPace = paceOf(M.inRange(D.acts, M.addDays(D.last, -41), D.last).filter((a) => a.sport_type === "Run" && a.workout_type === "easy"));

        // Efficacité aérobie : premier vs dernier trimestre des 12 derniers mois
        const from52 = M.addDays(D.last, -52 * 7 + 1);
        const er = M.inRange(D.acts, from52, D.last).filter((a) => a.sport_type === "Run" && (a.workout_type === "easy" || a.workout_type === "long"));
        const quarter = (52 * 7) / 4;
        const efStart = M.mean(er.filter((r) => (r.date - from52) / M.DAY < quarter), M.efficiency);
        const efEnd = M.mean(er.filter((r) => (r.date - from52) / M.DAY >= 3 * quarter), M.efficiency);

        // Volume course de la semaine en cours et moyenne des 4 dernières semaines complètes
        const monday = M.mondayOf(D.last);
        const weekKm = M.sum(runs.filter((a) => a.date >= monday), (a) => a.distance_km);
        const avg4 = M.sum(M.inRange(runs, M.addDays(monday, -28), M.addDays(monday, -1)), (a) => a.distance_km) / 4;

        return {
            D, goal, today, tomorrow, now, best5k, bestSame, predRace, lastQuality, lastTennis, tennisEffect, easyPace,
            efGain: ((efEnd - efStart) / efStart) * 100, weekKm, avg4,
            daysToGoal: Math.round((goal.date - today) / M.DAY),
            goalPace: goal.targetSec / goal.distance,
        };
    }

    // ------------------------------------------------------------- blocs riches
    function statBlock(rows) {
        return h("div", { class: "coach-stats" }, rows.map(([k, v]) => h("div", { class: "coach-stat" }, h("span", {}, k), h("strong", {}, v))));
    }

    function repsTable(reps) {
        return h("div", { class: "coach-reps" },
            h("div", { class: "coach-reps-cap" }, "Tours de la séance enregistrés par ta montre"),
            h("div", { class: "coach-reps-head" }, h("span", {}, "1 000 m"), h("span", {}, "Temps"), h("span", {}, "Écart"), h("span", {}, "FC fin")),
            reps.map((r, i) => {
                const avg = M.mean(reps, (x) => x.sec);
                return h("div", { class: "coach-reps-row" }, h("span", {}, `n° ${i + 1}`), h("span", {}, F.hms(r.sec)), h("span", {}, F.signed(r.sec - avg, 1, " s")), h("span", {}, `${r.hr} bpm`));
            }));
    }

    function sessionCard(c) {
        const p = c.goalPace;
        const warmKm = (20 * 60) / c.easyPace, coolKm = (10 * 60) / c.easyPace, recKm = 3 * (90 / 400);
        const totalKm = warmKm + 4 + recKm + coolKm;
        const totalMin = 20 + (4 * p) / 60 + 4.5 + 10 + 5;
        const steps = [
            ["Échauffement", `20 min footing à ${F.pace(c.easyPace)}/km, puis 4 lignes droites de 80 m`],
            ["Corps de séance", `4 × 1 000 m à **${F.pace(p - 2)} à ${F.pace(p + 2)}/km** (allure ${c.goal.short})`],
            ["Récupération", "1'30\" de trot entre chaque 1 000 m"],
            ["Retour au calme", "10 min footing très souple"],
        ];
        const card = h("div", { class: "coach-session" },
            h("div", { class: "coach-session-head" },
                h("div", {}, h("div", { class: "coach-session-kicker" }, cap(longDate(c.tomorrow))), h("div", { class: "coach-session-title" }, `4 × 1 000 m allure ${c.goal.short}`)),
                h("span", { class: "coach-badge" }, `J-${c.daysToGoal - 1}`)),
            h("ol", { class: "coach-steps" }, steps.map(([k, v]) => h("li", {}, h("span", { class: "coach-step-k" }, k), rich(v)))),
            statBlock([
                ["Distance", `${F.fr(totalKm, 1)} km`],
                ["Durée", `${F.fr(totalMin)} min`],
                ["FC cible", "165 à 170 bpm"],
                ["Charge estimée", `~${F.fr(totalMin * 1.55)} TRIMP`],
            ]));
        const add = h("button", { type: "button", class: "coach-action" }, "Ajouter à mon plan");
        add.addEventListener("click", () => { add.textContent = `Ajoutée au plan du ${longDate(c.tomorrow)}`; add.disabled = true; add.classList.add("done"); });
        card.append(add);
        return card;
    }

    /** Semaines restantes jusqu'à la course, volume dégressif par rapport à la moyenne des 4 dernières semaines. */
    function taperTable(c) {
        const base = c.avg4, sh = c.goal.short;
        const raceMonday = M.mondayOf(c.goal.date);
        const curMonday = M.mondayOf(c.today);
        const n = Math.round((raceMonday - curMonday) / (7 * M.DAY));
        const plan = {
            0: [0.45, `Rappel 3 × 1 000 m mardi, footings courts, repos la veille`],
            1: [0.72, `3 × 2 000 m allure ${sh} mardi, sortie longue réduite à 14 km`],
            2: [0.9, `Dernière sortie longue dimanche : 16 km dont 6 km à allure ${sh}`],
            3: [1, "Dernière semaine de charge complète"],
        };
        const short = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
        const rows = [];
        for (let k = n; k >= 0; k--) {
            const mon = M.addDays(raceMonday, -7 * k);
            const [f, note] = plan[Math.min(k, 3)];
            rows.push([k === n ? "Cette semaine" : k === 0 ? "Semaine de course" : `S-${k}`, `${short(mon)} → ${short(M.addDays(mon, 6))}`, base * f, note]);
        }
        return h("div", { class: "coach-taper" },
            h("div", { class: "coach-taper-title" }, "Plan d'affûtage"),
            rows.map(([w, d, km, note]) => h("div", { class: "coach-taper-row" },
                h("div", {}, h("strong", {}, w), h("span", {}, d)),
                h("div", { class: "coach-taper-bar" }, h("span", { style: `width:${Math.round((km / base) * 100)}%` })),
                h("div", { class: "coach-taper-km" }, `${F.fr(km)} km`, h("span", {}, `${F.signed(((km - base) / base) * 100, 0, " %")}`)),
                h("p", { class: "coach-taper-note" }, note))));
    }

    // ------------------------------------------------------------- réponses
    function replyTomorrow(c) {
        const tennisDays = Math.round((c.today - M.startOfDay(c.lastTennis.date)) / M.DAY);
        return [
            rich(`Demain, ${longDate(c.tomorrow)} : **4 × 1 000 m à allure ${c.goal.short}**, soit ${F.pace(c.goalPace)}/km.`),
            c.daysToGoal < 0
                ? rich("Ta course objectif est passée. Mets à jour ton profil sportif pour que je construise la suite.")
                : c.daysToGoal <= 24
                    ? rich(`Ton ${c.goal.short} est dans ${c.daysToGoal} jours, on entre dans l'affûtage. Le principe : on garde l'intensité spécifique, mais on réduit le volume chaque semaine pour arriver frais le ${c.goal.date.getDate()} sans perdre ta forme de fond.`)
                    : rich(`Ton ${c.goal.short} est dans ${c.daysToGoal} jours : on reste dans un bloc de développement, et cette séance sert à installer l'allure.`),
            sessionCard(c),
            rich(`Pourquoi ${F.pace(c.goalPace)}/km : c'est l'allure d'un ${c.goal.short} en **${F.hms(c.goal.targetSec)}**, ton objectif. Ton RP 5 km (${F.hms(c.best5k.moving_time_min * 60)}) prédit ${F.hms(c.predRace)} : l'objectif est ambitieux mais cohérent avec ton bloc. Le but de demain n'est pas d'aller plus vite, c'est d'ancrer la sensation de l'allure. Si ta FC dépasse 172 bpm dès la 2e répétition, termine à ${F.pace(c.goalPace + 4)}/km.`),
            c.daysToGoal >= 7 && c.daysToGoal <= 24 ? taperTable(c) : null,
            rich(c.now.tsb > 5
                ? `Ta fraîcheur est déjà à ${F.signed(c.now.tsb)} après une semaine plus légère. L'enjeu de l'affûtage est donc de garder ta forme de fond (CTL ${F.fr(c.now.ctl)}) : c'est pour ça qu'on maintient des séances à allure ${c.goal.short} jusqu'au bout.`
                : `Ta forme de fond (CTL ${F.fr(c.now.ctl)}) reste stable pendant que la fatigue redescend : on vise une fraîcheur (TSB) autour de +10 le jour de la course, contre ${F.signed(c.now.tsb)} aujourd'hui.`),
            rich(`Point d'attention : ${tennisDays <= 1 ? "tu as joué au tennis hier soir" : "pense au tennis"}. Sur tes 26 dernières semaines, tes footings sont **${F.signed(c.tennisEffect, 0)} s/km** plus lents le lendemain d'un tennis. Pas de tennis ce soir, pour arriver frais demain.`),
        ];
    }

    function replyLastSession(c) {
        const q = c.lastQuality;
        return [
            rich(`Ta dernière séance qualité date de ${longDate(q.date)} : ${q.name.toLowerCase()}, ${F.fr(q.distance_km, 1)} km au total. Elle est solide, fractions régulières et FC maîtrisée.`),
            statBlock([["Distance", `${F.fr(q.distance_km, 1)} km`], ["FC moyenne", `${q.avg_hr} bpm`], ["FC max", `${q.max_hr} bpm`], ["Charge", `${F.fr(q.load)} TRIMP`]]),
        ];
    }

    function replyForm(c) {
        const st = M.tsbStatus(c.now.tsb), ac = M.acwrStatus(c.now.acwr);
        return [
            rich(`Ta fraîcheur (TSB) est à **${F.signed(c.now.tsb)}** : ${st.label.toLowerCase()}. Ta forme de fond est à ${F.fr(c.now.ctl)} et ta fatigue à ${F.fr(c.now.atl)}.`),
            rich(`Ton ratio charge aiguë / chronique est à ${F.fr(c.now.acwr, 2)} (${ac.label.toLowerCase()}). Pas de signal de surcharge : tu peux faire la séance prévue demain.`),
        ];
    }

    function replyTennis(c) {
        return [rich(`Sur tes 26 dernières semaines, tes footings sont **${F.signed(c.tennisEffect, 0)} s/km** plus lents le lendemain d'un tennis. D'ici ton ${c.goal.short}, garde le tennis au moins 48 h avant les séances à allure semi, et coupe-le complètement les 3 jours avant la course.`)];
    }

    function replyGoal(c) {
        const g = c.goal;
        return [
            rich(`Ton objectif : **${F.hms(g.targetSec)}** au ${g.short} du ${longDate(g.date)} (${g.name}), soit ${F.pace(c.goalPace)}/km. ${c.bestSame ? `Ton RP sur la distance est ${F.hms(c.bestSame.moving_time_min * 60)} et ton` : "Ton"} 5 km (${F.hms(c.best5k.moving_time_min * 60)}) prédit ${F.hms(c.predRace)}.`),
            rich(`Ton efficacité aérobie progresse de ${F.signed(c.efGain, 1)} % en un an : c'est ce qui rend l'objectif atteignable. Pars sur ${F.pace(c.goalPace + 3)}/km les 5 premiers km, puis cale-toi à l'allure cible.`),
        ];
    }

    function respond(text, c) {
        const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (/(demain|seance|entrainement|programme|que dois|quoi faire|courir)/.test(t) && !/(derniere|hier|c.etait)/.test(t)) return replyTomorrow(c);
        if (/(derniere|hier|c.etait|bien passe)/.test(t)) return replyLastSession(c);
        if (/(forme|fatigue|fraicheur|tsb|recup)/.test(t)) return replyForm(c);
        if (/tennis/.test(t)) return replyTennis(c);
        if (/(semi|marathon|objectif|chrono|record|predict|temps|course)/.test(t)) return replyGoal(c);
        return [rich(`Je peux t'aider sur ta prochaine séance, ta forme du jour, ta préparation du ${c.goal.short} ou l'impact de tes autres sports sur la course. Pose-moi ta question.`)];
    }

    // ------------------------------------------------------------- historique
    /** Échange du mardi 29 septembre (après le 6 × 1 000 m). */
    function history(c) {
        const q = c.lastQuality;
        const reps = [221, 223, 220, 222, 224, 221].map((sec, i) => ({ sec, hr: 168 + i + (i > 3 ? 1 : 0) }));
        const avg = M.mean(reps, (r) => r.sec);
        return [
            { day: cap(longDate(q.date)) },
            { from: "me", time: "21:12", nodes: [rich("Salut coach, ma séance de ce soir c'était bien ?")] },
            {
                from: "coach", time: "21:12", nodes: [
                    rich(`Oui, c'est très prometteur. Tes 6 × 1 000 m sont réguliers : **${F.pace(avg)}/km de moyenne**, avec seulement 4 s d'écart entre la plus rapide et la plus lente.`),
                    repsTable(reps),
                    rich(`Ta FC ne monte que de 168 à 174 bpm sur la séance : l'allure 10 km est maîtrisée, tu n'as pas fini dans le rouge. C'est cohérent avec ton RP 5 km en ${F.hms(c.best5k.moving_time_min * 60)}.`),
                    rich(`Ton efficacité aérobie progresse aussi : ${F.signed(c.efGain, 1)} % de vitesse par battement cardiaque sur tes footings et sorties longues en un an. C'est ce qui fera la différence sur ton ${c.goal.short}.`),
                    rich("Demain : footing tranquille en zone 2, sans regarder l'allure."),
                ],
            },
            { from: "me", time: "21:14", nodes: [rich("Top merci !")] },
            { day: "Aujourd'hui" },
        ];
    }

    // ------------------------------------------------------------- rendu du chat
    function bubble(msg) {
        if (msg.day) return h("div", { class: "coach-day" }, h("span", {}, msg.day));
        const isMe = msg.from === "me";
        return h("div", { class: `coach-msg ${isMe ? "me" : "bot"}` },
            isMe ? null : h("div", { class: "coach-avatar", "aria-hidden": "true" }, "A"),
            h("div", { class: "coach-bubble" }, ...msg.nodes, h("div", { class: "coach-time" }, msg.time)));
    }

    function nowTime() {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    function scrollDown(log) { log.scrollTo({ top: log.scrollHeight, behavior: "smooth" }); }

    /** Affiche la réponse bloc par bloc, le texte mot à mot. */
    async function stream(log, nodes) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const msgNode = bubble({ from: "coach", time: nowTime(), nodes: [] });
        const body = msgNode.querySelector(".coach-bubble");
        const time = body.querySelector(".coach-time");
        log.appendChild(msgNode);
        for (const n of nodes) {
            if (n.tagName === "P" && !reduce) {
                const full = [...n.childNodes].map((c) => ({ strong: c.nodeName === "STRONG", text: c.textContent }));
                const p = h("p", {});
                body.insertBefore(p, time);
                for (const part of full) {
                    const holder = part.strong ? p.appendChild(h("strong", {})) : p;
                    const words = part.text.split(/(\s+)/);
                    let tn = document.createTextNode("");
                    holder.appendChild(tn);
                    for (const w of words) {
                        tn.textContent += w;
                        if (w.trim()) await new Promise((r) => setTimeout(r, 14));
                    }
                }
            } else {
                n.classList.add("coach-appear");
                body.insertBefore(n, time);
                await new Promise((r) => setTimeout(r, reduce ? 0 : 160));
            }
            scrollDown(log);
        }
    }

    function render(root) {
        const c = CTX;
        const log = h("div", { class: "coach-log", role: "log", "aria-live": "polite" });
        history(c).forEach((m) => log.appendChild(bubble(m)));

        const input = h("textarea", { id: "coach-input", class: "coach-input", rows: "1", placeholder: "Pose une question à ton coach…", "aria-label": "Message au coach" });
        const send = h("button", { type: "submit", class: "coach-send", "aria-label": "Envoyer" }, "Envoyer");
        let busy = false;
        const ask = async (text) => {
            if (busy || !text.trim()) return;
            busy = true; send.disabled = true;
            log.appendChild(bubble({ from: "me", time: nowTime(), nodes: [rich(text.trim())] }));
            input.value = ""; input.style.height = "";
            const typing = h("div", { class: "coach-msg bot" }, h("div", { class: "coach-avatar", "aria-hidden": "true" }, "A"), h("div", { class: "coach-bubble coach-typing" }, h("span", {}), h("span", {}), h("span", {})));
            log.appendChild(typing); scrollDown(log);
            await new Promise((r) => setTimeout(r, 1100));
            typing.remove();
            await stream(log, respond(text, c));
            busy = false; send.disabled = false; input.focus();
        };
        const form = h("form", { class: "coach-form" }, input, send);
        form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
        input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); } });
        input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(140, input.scrollHeight) + "px"; });

        const chips = h("div", { class: "coach-chips" }, [
            "Quelle est ma séance de course à pied demain ?",
            "Comment est ma forme ?",
            "Je peux jouer au tennis cette semaine ?",
            "Où j'en suis pour mon objectif ?",
        ].map((q) => h("button", { type: "button", class: "coach-chip", onclick: () => ask(q) }, q)));

        // Bouton discret : revient à l'historique de départ (utile pour rejouer une démo)
        const reset = h("button", { type: "button", class: "coach-reset", title: "Réinitialiser la conversation", "aria-label": "Réinitialiser la conversation", onclick: () => render(root) }, "↺");
        const chat = h("section", { class: "coach-chat" },
            h("header", { class: "coach-head" },
                h("div", { class: "coach-avatar big", "aria-hidden": "true" }, "A"),
                h("div", {}, h("strong", {}, "Coach Altarun"), h("span", { class: "coach-status" }, `Basé sur tes ${F.fr(c.D.acts.length)} activités · mis à jour ce matin`)),
                reset),
            log, chips, form);

        // Panneau de contexte : ce que le coach « voit »
        const st = M.tsbStatus(c.now.tsb);
        const side = h("aside", { class: "coach-side" },
            h("div", { class: "coach-side-card goal" },
                h("span", { class: "coach-side-kicker" }, "Objectif"),
                h("strong", { class: "coach-side-big" }, c.goal.name),
                h("span", {}, `${cap(longDate(c.goal.date))} · J-${c.daysToGoal}`),
                h("div", { class: "coach-side-goal" }, h("span", {}, "Cible"), h("strong", {}, F.hms(c.goal.targetSec)), h("span", {}, `${F.pace(c.goalPace)}/km`)),
                h("div", { class: "coach-side-goal" }, h("span", {}, "Prédiction"), h("strong", {}, F.hms(c.predRace)), h("span", {}, `${F.pace(c.predRace / c.goal.distance)}/km`)),
                h("div", { class: "coach-side-source" },
                    h("span", {}, `Défini dans ton profil sportif le ${P.frDate(c.goal.updatedAt)}`),
                    h("button", { type: "button", class: "coach-link", onclick: (e) => P.openEditor({ focus: "race", returnFocus: e.currentTarget }) }, "Modifier"))),
            h("div", { class: "coach-side-card" },
                h("span", { class: "coach-side-kicker" }, "Contexte utilisé par le coach"),
                ...[
                    ["Forme du jour (TSB)", `${F.signed(c.now.tsb)} · ${st.label}`],
                    ["Forme de fond (CTL)", F.fr(c.now.ctl)],
                    ["Ratio aigu / chronique", F.fr(c.now.acwr, 2)],
                    ["Course cette semaine", `${F.fr(c.weekKm, 1)} km`],
                    ["Moyenne 4 semaines", `${F.fr(c.avg4, 1)} km`],
                    ["RP 5 km", F.hms(c.best5k.moving_time_min * 60)],
                    c.bestSame && c.goal.short !== "5 km" ? [`RP ${c.goal.short}`, F.hms(c.bestSame.moving_time_min * 60)] : null,
                    ["FC max / repos (profil)", `${P.get().hrMax} / ${P.get().hrRest} bpm`],
                    ["Effet tennis la veille", `${F.signed(c.tennisEffect, 0)} s/km`],
                    ["Efficacité aérobie (12 mois)", `${F.signed(c.efGain, 1)} %`],
                ].filter(Boolean).map(([k, v]) => h("div", { class: "coach-side-row" }, h("span", {}, k), h("strong", {}, v))),
                h("p", { class: "coach-side-note" }, "Calculé à partir de tes activités synchronisées et de ton profil sportif.")));

        root.replaceChildren(h("div", { class: "coach" }, chat, side));
        requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    }

    async function init() {
        const root = document.getElementById("coach");
        if (!root) return;
        try {
            const payload = window.ALTARUN_DATA || (await (await fetch(root.dataset.source, { credentials: "same-origin" })).json());
            CTX = buildContext(payload);
            render(root);
            P.onChange(() => { CTX = buildContext(payload); render(root); });
        } catch (e) {
            console.error("[Altarun] Coach indisponible", e);
            root.replaceChildren(h("div", { class: "error-message" }, "Le coach n'a pas pu charger tes activités. Réessaie dans un instant."));
        }
    }

    document.addEventListener("DOMContentLoaded", init);
})();

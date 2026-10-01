"""Génère un jeu d'activités sportives simulées au format du mart ``fct_activities``.

Pourquoi ce script ?
--------------------
Le dashboard de la page d'accueil consomme le même contrat de données que la vue dbt
``all_activities`` exposée dans BigQuery. Pour développer et démontrer le front sans
dépendre de l'ETL (ni exposer de vraies données), on génère un jeu **déterministe**
(seed fixe) et **calibré** sur un profil d'athlète réaliste :

* Course à pied : ~50 km / semaine à ~5'20"/km de moyenne, 4 sorties typées
  (fractionné, tempo ou footing, footing, sortie longue), progression d'allure,
  courses officielles (5 km, 10 km, semi).
* Tennis : ~7 h / semaine, 3 à 5 séances (entraînements + matchs avec score).
* Natation : ~1 h / semaine, bassin 25 m, SWOLF.
* Golf : ~2 h / semaine en moyenne, mais joué environ une semaine sur deux (18 ou 9 trous),
  niveau débutant (index ~40).
* Escalade : 1 séance d'~1 h / semaine (bloc), progression de cotation.

Effets croisés volontairement injectés (pour que les KPI croisés aient du sens) :

* allure de course selon l'activité de la veille : repos (plus rapide) < autre sport
  < course < tennis (plus lent, FC plus haute) ;
* l'efficacité aérobie (vitesse / FC) s'améliore au fil des mois ;
* les semaines de golf (week-end), la sortie longue est raccourcie ;
* semaine de vacances en août (moins de course, plus de natation).

Usage ::

    python scripts/generate_mock_activities.py            # écrit frontend/data/mock/fct_activities.json
    python scripts/generate_mock_activities.py --seed 7   # autre tirage, mêmes moyennes

Volume total visé : ~15 h / semaine tous sports confondus, 2 séances maximum par jour.

Les moyennes cibles sont recalées sur les 52 dernières semaines complètes, puis vérifiées
(le script échoue si l'écart dépasse la tolérance).
"""

from __future__ import annotations

import argparse
import json
import math
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "frontend" / "data" / "mock" / "fct_activities.json"

SCHEMA_VERSION = "1.0"
END_DATE = date(2026, 9, 30)  # dernière journée de données (veille du jour J)
N_WEEKS = 104  # deux saisons : permet de comparer chaque période à la précédente

# --- Profil athlète -------------------------------------------------------------------
HR_MAX = 192
HR_REST = 50
WEIGHT_KG = 72

# --- Cibles (moyennes sur les 52 dernières semaines complètes) --------------------------
TARGET_RUN_KM_PER_WEEK = 50.0
TARGET_RUN_PACE_S_PER_KM = 320.0  # 5'20"/km
TARGET_HOURS_PER_WEEK = {
    "Tennis": 7.0,
    "Swim": 1.0,
    "Golf": 2.0,
    "RockClimbing": 1.0,
}

# Zones FC (bornes hautes en bpm, % de FC max : 60 / 70 / 80 / 90)
ZONE_BOUNDS = [0.60 * HR_MAX, 0.70 * HR_MAX, 0.80 * HR_MAX, 0.90 * HR_MAX]

FONT_GRADES = ["5c", "6a", "6a+", "6b", "6b+", "6c", "6c+", "7a"]


@dataclass
class Activity:
    sport_type: str
    start: datetime
    name: str
    workout_type: str
    moving_time_min: float
    avg_hr: float
    hr_sd: float
    max_hr: float
    distance_km: float | None = None
    elevation_gain_m: float | None = None
    extra: dict | None = None


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def hr_zone_minutes(avg_hr: float, sd: float, minutes: float) -> list[float]:
    """Répartit le temps en 5 zones FC en supposant une FC ~ normale(avg, sd)."""
    cdfs = [norm_cdf((b - avg_hr) / sd) for b in ZONE_BOUNDS]
    fracs = [cdfs[0]] + [cdfs[i] - cdfs[i - 1] for i in range(1, 4)] + [1 - cdfs[3]]
    return [round(f * minutes, 1) for f in fracs]


def calories(sport: str, minutes: float, avg_hr: float) -> int:
    # Formule de Keytel (homme) bornée, pondérée par sport pour rester crédible.
    kcal_min = (-55.0969 + 0.6309 * avg_hr + 0.1988 * WEIGHT_KG + 0.2017 * 26) / 4.184
    factor = {"Golf": 0.75, "RockClimbing": 0.85, "Swim": 1.0, "Tennis": 0.95, "Run": 0.85}[sport]
    return round(max(kcal_min, 3.5) * minutes * factor)


def at(day: date, hour: int, minute: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute)


def season_factor(day: date) -> float:
    """Légère saisonnalité : un peu moins de volume au cœur de l'hiver."""
    doy = day.timetuple().tm_yday
    return 1 + 0.06 * math.cos(2 * math.pi * (doy - 200) / 365)


# --------------------------------------------------------------------------------------
# Générateurs par sport
# --------------------------------------------------------------------------------------
class Generator:
    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)
        self.start_monday = END_DATE - timedelta(days=END_DATE.weekday()) - timedelta(weeks=N_WEEKS)
        self.activities: list[Activity] = []
        self.golf_last_played = False
        self.half_marathon_day = date(2026, 3, 22)
        self.prev_half_day = date(2025, 4, 6)
        # Courses officielles : (nom, distance km, temps en secondes, FC moyenne)
        # RP 5 km = 18'53" ; les autres chronos sont cohérents (équivalences de Riegel).
        self.races = {
            date(2025, 4, 6): ("Semi-marathon", 21.0975, 5500, 170),  # 1 h 31'40"
            date(2025, 6, 15): ("5 km sur route", 5.0, 1181, 179),  # 19'41"
            date(2025, 10, 12): ("10 km sur route", 10.0, 2465, 175),  # 41'05"
            date(2026, 3, 22): ("Semi-marathon", 21.0975, 5232, 172),  # 1 h 27'12"
            date(2026, 5, 10): ("5 km sur route", 5.0, 1133, 181),  # 18'53" (RP)
            date(2026, 6, 7): ("10 km sur route", 10.0, 2366, 177),  # 39'26"
        }
        self.vacation_weeks = {date(2025, 8, 11), date(2026, 8, 10)}

    # Progression : 0 au début de la fenêtre, 1 à la fin
    def progress(self, day: date) -> float:
        return (day - self.start_monday).days / (END_DATE - self.start_monday).days

    def gauss(self, mu: float, sigma: float, lo: float | None = None, hi: float | None = None):
        v = self.rng.gauss(mu, sigma)
        if lo is not None:
            v = max(lo, v)
        if hi is not None:
            v = min(hi, v)
        return v

    # ------------------------------------------------------------------ planning
    def plan_week(self, monday: date) -> dict:
        """Répartit les séances de la semaine sur les jours.

        Règles : 2 séances maximum par jour, 1 course maximum par jour, sortie longue le
        week-end. Les jours sont tirés au hasard pour que le type de séance de course ne
        dépende pas de l'activité de la veille (sinon les KPI « veille » seraient biaisés).
        """
        rng = self.rng
        vac = monday in self.vacation_weeks
        load = dict.fromkeys(range(7), 0)
        race = next((i for i in range(7) if monday + timedelta(days=i) in self.races), None)

        # Semaine en cours : planning fixe, cohérent avec l'historique du coach
        if monday == END_DATE - timedelta(days=END_DATE.weekday()):
            return {
                "runs": {1: "intervals", 2: "easy"},
                "tennis": {2: "match"},
                "swim": [],
                "climb": [0],
                "golf": None,
            }

        types = (
            ["easy", "easy", "long"]
            if vac
            else ["intervals", "tempo" if rng.random() < 0.35 else "easy", "easy", "long"]
        )
        long_day = race if race is not None else rng.choice([5, 6])
        others = rng.sample([d for d in range(7) if d != long_day], len(types) - 1)
        rest_types = types[:-1]
        rng.shuffle(rest_types)
        runs = {long_day: "long", **dict(zip(others, rest_types, strict=True))}
        for d in runs:
            load[d] += 1

        def pick(n: int, allowed=range(7), exclude=()) -> list[int]:
            free = [d for d in allowed if load[d] < 2 and d not in exclude]
            chosen = rng.sample(free, min(n, len(free)))
            for d in chosen:
                load[d] += 1
            return sorted(chosen)

        golf = None
        if not vac and self.golf_plays(monday):
            g = pick(1, allowed=[5, 6], exclude=[race] if race is not None else [])
            golf = g[0] if g else None
        n_tennis = 0 if vac else rng.choices([3, 4, 5], weights=[0.25, 0.55, 0.2])[0]
        # Pas de tennis la veille d'une séance de qualité (fractionné, tempo) ni d'une course
        no_tennis = [d - 1 for d, t in runs.items() if t in ("intervals", "tempo")]
        if race:
            no_tennis.append(race - 1)
        tennis_days = pick(n_tennis, exclude=no_tennis)
        tennis = {d: ("match" if rng.random() < 0.4 else "training") for d in tennis_days}
        swim = pick(2 if vac else (1 if rng.random() > 0.08 else 0))
        climb = pick(0 if vac or rng.random() < 0.08 else 1)
        return {"runs": runs, "tennis": tennis, "swim": swim, "climb": climb, "golf": golf}

    def golf_plays(self, monday: date) -> bool:
        rng = self.rng
        # ~une semaine sur deux, avec un peu d'irrégularité
        play = rng.random() < (0.18 if self.golf_last_played else 0.85)
        if monday.month in (12, 1, 2) and rng.random() < 0.3:
            play = False
        self.golf_last_played = play
        return play

    def record(self, act: Activity) -> None:
        self.activities.append(act)
        self.by_day.setdefault(act.start.date(), set()).add(act.sport_type)

    # ------------------------------------------------------------------ course à pied
    def veille(self, day: date) -> str:
        prev = self.by_day.get(day - timedelta(days=1), set())
        if "Tennis" in prev:
            return "tennis"
        if "Run" in prev:
            return "course"
        return "autre" if prev else "repos"

    def run_week(self, monday: date, plan: dict) -> None:
        rng = self.rng
        p = self.progress(monday)
        # Volume : saison 1 ~45 km, saison 2 ~51 km ; bruit modéré (sigma ~5 %)
        base_km = (45.0 + 6.0 * p) * self.gauss(1, 0.05, 0.88, 1.12)
        # Base d'allure : 5'34" -> 5'08" sur deux ans (amélioration de forme)
        base_pace = 334 - 26 * p
        week_days = [monday + timedelta(days=i) for i in range(7)]
        race_day = next((d for d in week_days if d in self.races), None)
        taper = any(
            d - timedelta(days=7) in (self.half_marathon_day, self.prev_half_day) for d in week_days
        )
        vac = monday in self.vacation_weeks
        if vac:
            base_km *= 0.6
        if race_day or taper:
            base_km *= 0.85
        golf_week = plan["golf"] is not None
        # (part du volume, décalage d'allure s/km, FC moy, sd FC)
        # Allures de séance (échauffement compris) : fractionné ~4'15", tempo ~4'35",
        # sortie longue ~5'30", footing ~5'40"
        spec = {
            "intervals": (0.19, -58, 161, 11),
            "tempo": (0.20, -45, 164, 5),
            "easy": (0.30 if vac else 0.20, +22, 136, 6),
            "long": (0.35 if golf_week else 0.41, +10, 141, 6),
        }
        # Effet de la veille sur l'allure (s/km) : repos < autre sport < course < tennis
        veille_effect = {"repos": -5, "autre": +2, "course": +12, "tennis": +12}
        last_week = monday == END_DATE - timedelta(days=END_DATE.weekday())

        for dow in sorted(plan["runs"]):
            wtype = plan["runs"][dow]
            day = week_days[dow]
            if day > END_DATE:
                continue
            busy = len(self.by_day.get(day, set())) > 0 or (plan["golf"] == dow)
            if race_day and wtype == "long":
                rname, dist, secs, rhr = self.races[race_day]
                self.add_run(
                    race_day, at(race_day, 9, 30), rname, "race", dist, secs / dist, rhr, 5, p, None
                )
                continue
            if rng.random() < 0.03 and not last_week:  # séance sautée de temps en temps
                continue
            share, pace_off, hr, hr_sd = spec[wtype]
            dist = max(5.0, base_km * share * self.gauss(1, 0.05))
            v = self.veille(day)
            pace = base_pace + pace_off + veille_effect[v] + self.gauss(0, 5)
            if v == "tennis":
                hr += 3
            names = {
                "intervals": rng.choice(["Fractionné 10x400", "Fractionné 6x1000", "VMA 30/30"]),
                "tempo": "Tempo au seuil",
                "easy": rng.choice(["Footing", "Footing récup", "Sortie endurance"]),
                "long": "Sortie longue",
            }
            name = "Fractionné 6x1000" if last_week and wtype == "intervals" else names[wtype]
            if plan["golf"] == dow:
                hh, mm = 17, 30
            elif busy or plan["tennis"].get(dow) or dow in plan["climb"] or dow in plan["swim"]:
                hh, mm = (7, 0) if wtype != "intervals" else (18, 15)
            else:
                hh, mm = {
                    "intervals": (19, 5),
                    "tempo": (12, 30),
                    "easy": rng.choice([(7, 0), (12, 30), (18, 40)]),
                    "long": (9, 0),
                }[wtype]
            if last_week:
                hh, mm = (19, 10) if wtype == "intervals" else (7, 11)
            self.add_run(
                day,
                at(day, hh, mm + (0 if last_week else rng.randint(0, 15))),
                name,
                wtype,
                dist,
                pace,
                hr,
                hr_sd,
                p,
                v,
            )

    def add_run(self, day, start, name, wtype, dist, pace, hr, hr_sd, p, veille):
        # Gain d'efficacité aérobie : même effort, FC plus basse au fil du temps
        if wtype != "race":
            hr = hr - 5 * p + self.gauss(0, 2)
        minutes = dist * pace / 60
        self.record(
            Activity(
                sport_type="Run",
                start=start,
                name=name,
                workout_type=wtype,
                moving_time_min=minutes,
                avg_hr=hr,
                hr_sd=hr_sd,
                max_hr=min(
                    HR_MAX, hr + self.gauss(16 if wtype in ("intervals", "race") else 12, 3)
                ),
                distance_km=dist,
                elevation_gain_m=dist * self.gauss(7, 2.5, 1),
                extra={
                    "cadence_spm": round(self.gauss(170 + 4 * p, 2)),
                    "is_race": wtype == "race",
                },
            )
        )

    # ------------------------------------------------------------------ autres sports
    def tennis_session(self, day: date, kind: str, n: int, monday: date) -> None:
        p = self.progress(monday)
        is_match = kind == "match"
        extra: dict = {"session": "match" if is_match else "entrainement"}
        if is_match:
            extra.update(self.tennis_score(self.rng.random() < (0.48 + 0.18 * p)))
        self.record(
            Activity(
                sport_type="Tennis",
                start=at(day, 19 if day.weekday() < 5 else 16, 30),
                name="Match de tennis" if is_match else "Entraînement tennis",
                workout_type="match" if is_match else "training",
                moving_time_min=self.gauss(420 / max(n, 3) * season_factor(monday), 15, 45, 160),
                avg_hr=self.gauss(138 if is_match else 131, 5),
                hr_sd=13,
                max_hr=self.gauss(172, 5, 160, HR_MAX),
                extra=extra,
            )
        )

    def tennis_score(self, win: bool) -> dict:
        rng = self.rng

        def set_score(won: bool) -> str:
            loser = rng.choice([1, 2, 3, 4, 4, 5, 6])
            hi = 7 if loser in (5, 6) else 6
            return f"{hi}-{loser}" if won else f"{loser}-{hi}"

        sets = (
            [set_score(win), set_score(win)]
            if rng.random() < 0.6
            else [set_score(win), set_score(not win), set_score(win)]
        )
        return {"result": "W" if win else "L", "score": " ".join(sets)}

    def swim_session(self, day: date, monday: date) -> None:
        rng = self.rng
        p = self.progress(monday)
        minutes = self.gauss(60, 6, 40, 80)
        pace_100 = self.gauss(146 - 10 * p, 3)  # s/100 m, temps de nage effectif
        dist = minutes * 0.86 * 60 / pace_100 / 10  # le reste = récup au mur
        self.record(
            Activity(
                sport_type="Swim",
                start=at(day, 12, 15),
                name=rng.choice(["Natation endurance", "Natation technique", "Pyramide 100-400"]),
                workout_type=rng.choice(["endurance", "technique", "endurance"]),
                moving_time_min=minutes,
                avg_hr=self.gauss(129, 4),
                hr_sd=8,
                max_hr=self.gauss(158, 4),
                distance_km=round(dist * 40) / 40,  # multiple de 25 m
                extra={
                    "pool_length_m": 25,
                    "swolf": round(self.gauss(40 - 4 * p, 0.8), 1),
                    "pace_s_per_100m": round(pace_100, 1),
                },
            )
        )

    def golf_session(self, day: date, monday: date) -> None:
        p = self.progress(monday)
        holes = 18 if self.rng.random() < 0.8 else 9
        # Niveau débutant : ~133 coups -> ~121 sur deux ans (index ~45 -> ~40)
        score18 = self.gauss(133 - 12 * p, 5)
        score = round(score18 if holes == 18 else score18 / 2 + self.gauss(0, 1))
        self.record(
            Activity(
                sport_type="Golf",
                start=at(day, 8, 20),
                name=f"Parcours {holes} trous",
                workout_type=f"{holes}_holes",
                moving_time_min=self.gauss(250 if holes == 18 else 125, 15),
                avg_hr=self.gauss(99, 4),
                hr_sd=9,
                max_hr=self.gauss(128, 5),
                distance_km=round(self.gauss(8.6 if holes == 18 else 4.4, 0.4), 2),
                extra={
                    "holes": holes,
                    "strokes": score,
                    "par": 72 if holes == 18 else 36,
                    "steps": round(self.gauss(12400 if holes == 18 else 6300, 600)),
                },
            )
        )

    def climb_session(self, day: date, monday: date) -> None:
        p = self.progress(monday)
        minutes = self.gauss(62, 7, 45, 85)
        level = 0.6 + 4.6 * p + self.gauss(0, 0.5)  # index dans FONT_GRADES
        max_idx = max(0, min(len(FONT_GRADES) - 1, round(level)))
        attempts = round(self.gauss(minutes / 2.6, 3, 10))
        sends = round(attempts * self.gauss(0.50 + 0.12 * p, 0.06, 0.25, 0.85))
        self.record(
            Activity(
                sport_type="RockClimbing",
                start=at(day, 20, 30),
                name="Séance de bloc",
                workout_type="bouldering",
                moving_time_min=minutes,
                avg_hr=self.gauss(121, 5),
                hr_sd=14,
                max_hr=self.gauss(165, 5),
                extra={
                    "max_grade": FONT_GRADES[max_idx],
                    "max_grade_index": max_idx,
                    "problems_sent": sends,
                    "attempts": attempts,
                },
            )
        )

    def build(self) -> list[Activity]:
        self.by_day: dict[date, set[str]] = {}
        for w in range(N_WEEKS + 1):
            monday = self.start_monday + timedelta(weeks=w)
            plan = self.plan_week(monday)
            n_tennis = len(plan["tennis"])
            # Jour par jour, dans l'ordre : la course connaît l'activité de la veille
            for dow in range(7):
                day = monday + timedelta(days=dow)
                if day > END_DATE:
                    break
                if plan["golf"] == dow:
                    self.golf_session(day, monday)
                if dow in plan["swim"]:
                    self.swim_session(day, monday)
                if dow in plan["runs"]:
                    self.run_week(monday, {**plan, "runs": {dow: plan["runs"][dow]}})
                if dow in plan["tennis"]:
                    self.tennis_session(day, plan["tennis"][dow], n_tennis, monday)
                if dow in plan["climb"]:
                    self.climb_session(day, monday)
        self.activities.sort(key=lambda a: a.start)
        return self.activities


# --------------------------------------------------------------------------------------
# Calibration : on recale exactement les moyennes cibles sur les 52 dernières semaines
# --------------------------------------------------------------------------------------
def calibration_window() -> tuple[date, date]:
    last_sunday = END_DATE - timedelta(days=(END_DATE.weekday() + 1) % 7)
    if END_DATE.weekday() == 6:
        last_sunday = END_DATE
    first_monday = last_sunday - timedelta(days=52 * 7 - 1)
    return first_monday, last_sunday


def calibrate(acts: list[Activity]) -> None:
    lo, hi = calibration_window()
    in_win = [a for a in acts if lo <= a.start.date() <= hi]

    runs = [a for a in in_win if a.sport_type == "Run" and a.workout_type != "race"]
    race_km = sum(
        a.distance_km for a in in_win if a.sport_type == "Run" and a.workout_type == "race"
    )
    km = sum(a.distance_km for a in runs)
    k = (TARGET_RUN_KM_PER_WEEK * 52 - race_km) / km
    all_runs = [a for a in acts if a.sport_type == "Run" and a.workout_type != "race"]
    for a in all_runs:
        a.distance_km *= k
        a.moving_time_min *= k

    # Recalage de l'allure moyenne : seules les séances d'entraînement sont ajustées,
    # les chronos de compétition restent exacts (RP).
    win_runs = [a for a in in_win if a.sport_type == "Run"]
    race_min = sum(a.moving_time_min for a in win_runs if a.workout_type == "race")
    train_min = sum(a.moving_time_min for a in win_runs if a.workout_type != "race")
    total_km = sum(a.distance_km for a in win_runs)
    kp = (TARGET_RUN_PACE_S_PER_KM * total_km / 60 - race_min) / train_min
    for a in acts:
        if a.sport_type == "Run" and a.workout_type != "race":
            a.moving_time_min *= kp

    for sport, target_h in TARGET_HOURS_PER_WEEK.items():
        hours = sum(a.moving_time_min for a in in_win if a.sport_type == sport) / 60
        ks = target_h * 52 / hours
        for a in acts:
            if a.sport_type == sport:
                a.moving_time_min *= ks
                if sport == "Swim" and a.distance_km:
                    a.distance_km = round(a.distance_km * ks * 40) / 40


def to_record(i: int, a: Activity) -> dict:
    rec = {
        "activity_id": 15_800_000_000 + i * 7919,
        "athlete_id": 98_431_207,
        "start_date_local": a.start.isoformat(timespec="minutes"),
        "sport_type": a.sport_type,
        "name": a.name,
        "workout_type": a.workout_type,
        "distance_km": round(a.distance_km, 2) if a.distance_km is not None else None,
        "moving_time_min": round(a.moving_time_min, 2),
        "elevation_gain_m": round(a.elevation_gain_m) if a.elevation_gain_m is not None else None,
        "avg_hr": round(a.avg_hr),
        "max_hr": round(max(a.max_hr, a.avg_hr + 5)),
        "calories": calories(a.sport_type, a.moving_time_min, a.avg_hr),
        "hr_zones_min": hr_zone_minutes(a.avg_hr, a.hr_sd, a.moving_time_min),
    }
    if a.sport_type == "Run" and a.distance_km:
        rec["avg_pace_s_per_km"] = round(a.moving_time_min * 60 / a.distance_km, 1)
    rec.update(a.extra or {})
    return rec


def check(records: list[dict]) -> dict:
    lo, hi = calibration_window()
    win = [r for r in records if lo.isoformat() <= r["start_date_local"][:10] <= hi.isoformat()]

    def hours(sport):
        return sum(r["moving_time_min"] for r in win if r["sport_type"] == sport) / 60 / 52

    runs = [r for r in win if r["sport_type"] == "Run"]
    km = sum(r["distance_km"] for r in runs)
    pace = sum(r["moving_time_min"] for r in runs) * 60 / km
    summary = {
        "window": f"{lo} -> {hi}",
        "run_km_per_week": round(km / 52, 2),
        "run_pace_s_per_km": round(pace, 1),
        "run_hours_per_week": round(hours("Run"), 2),
        **{f"{s.lower()}_hours_per_week": round(hours(s), 2) for s in TARGET_HOURS_PER_WEEK},
        "golf_weeks_played_pct": round(
            100
            * len(
                {
                    (date.fromisoformat(r["start_date_local"][:10]) - lo).days // 7
                    for r in win
                    if r["sport_type"] == "Golf"
                }
            )
            / 52
        ),
    }
    assert abs(summary["run_km_per_week"] - TARGET_RUN_KM_PER_WEEK) < 0.3, summary
    assert abs(summary["run_pace_s_per_km"] - TARGET_RUN_PACE_S_PER_KM) < 1.5, summary
    for s, t in TARGET_HOURS_PER_WEEK.items():
        assert abs(summary[f"{s.lower()}_hours_per_week"] - t) < 0.05, summary
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--seed", type=int, default=57)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()

    acts = Generator(args.seed).build()
    calibrate(acts)
    records = [to_record(i, a) for i, a in enumerate(acts)]
    summary = check(records)

    payload = {
        "meta": {
            "dataset": "fct_activities",
            "schema_version": SCHEMA_VERSION,
            "source": "mock",
            "seed": args.seed,
            "generated_at": datetime(2026, 10, 1, 6, 0).isoformat(timespec="minutes"),
            "row_count": len(records),
            "athlete": {"hr_max": HR_MAX, "hr_rest": HR_REST, "weight_kg": WEIGHT_KG},
            "calibration": summary,
        },
        "activities": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(records)} activités écrites dans {args.output}")
    for k, v in summary.items():
        print(f"  {k:<28} {v}")


if __name__ == "__main__":
    main()

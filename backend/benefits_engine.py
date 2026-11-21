import math
import re


class PhysiologicalBenefitsEngine:
    """
    Physiological Benefits Engine for PULSE Hybrid Athlete OS.
    Generates 5-pillar physiological and biomechanical breakdowns for Garmin workouts.
    """

    def __init__(self, athlete_weight_kg=None):
        self.weight_kg = athlete_weight_kg

    @staticmethod
    def _valid_weight(val):
        if val is None or isinstance(val, bool):
            return None
        try:
            w = float(val)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(w) or w <= 0:
            return None
        return w

    def generate_benefits(self, activity_name, sub_title, duration_min, calories, avg_hr, max_hr, aerobic_te=0.0, anaerobic_te=0.0, weight_kg=None):
        w = self._valid_weight(weight_kg)
        if w is None:
            w = self._valid_weight(self.weight_kg)
        text = f"{activity_name or ''} {sub_title or ''}".lower()

        # Determine movement archetype using word-boundary regexes
        is_jump = bool(re.search(r'\b(?:jump|jumps|plyo|plyometrics|hop|hops|skip|skipping|tuck|box\s*jump)\b', text))
        is_ruck = bool(re.search(r'\b(?:ruck|rucking|weighted\s*pack)\b', text))
        is_walk = (not is_ruck) and bool(re.search(r'\b(?:walk|walking|hike|hiking|stroll)\b', text))
        is_run = bool(re.search(r'\b(?:run|running|sprint|sprints|jog|jogging|tempo)\b', text))
        is_squat = bool(re.search(r'\b(?:squat|squats|leg\s*press|lunge|lunges|quad|quads)\b', text))
        is_deadlift = bool(re.search(r'\b(?:deadlift|deadlifts|rdl|rdls|hinge|hamstring|hamstrings)\b', text))
        is_press = bool(re.search(r'\b(?:bench|press|pushup|pushups|push-up|push-ups|dip|dips|overhead)\b', text))
        is_combat = bool(re.search(r'\b(?:body\s*combat|bodycombat|les\s*mills|muay\s*thai|kickbox|kickboxing|shadow\s*box|combat|boxing|martial|mma|karate|taekwondo)\b', text))
        is_kettlebell = bool(re.search(r'\b(?:kettlebell|kettlebells|kb|swing|swings|snatch)\b', text))

        # 1. Muscles Worked (deduplicated preserving order)
        muscles = []
        if is_jump or is_squat:
            muscles.extend(["Quadriceps (Vastus Medialis/Lateralis)", "Gluteus Maximus", "Calves & Achilles Tendon Complex (Gastrocnemius/Soleus)", "Hip Flexors (Iliopsoas)", "Tibialis Anterior"])
        if is_combat:
            muscles.extend(["Anterior Deltoids & Serratus Anterior (Boxer Guard)", "Internal/External Obliques (Rotational Core)", "Hip Flexors & Calves", "Core Stabilizers"])
        if is_walk or is_ruck:
            muscles.extend(["Soleus & Gastrocnemius", "Gluteus Medius", "Postural Spinal Erectors", "Foot Arch Intrinsic Muscles"])
        if is_deadlift or is_kettlebell:
            muscles.extend(["Biceps Femoris & Semitendinosus", "Gluteal Complex", "Thoracolumbar Fascia & Erector Spinae", "Latissimus Dorsi & Trapezius"])
        if is_press:
            muscles.extend(["Pectoralis Major/Minor", "Anterior Deltoids", "Triceps Brachii", "Serratus Anterior"])
        if not muscles:
            muscles = ["Cardiovascular Myocardium", "Slow-Twitch Oxidative Fibers", "Core Stabilizers", "Lower Extremity Postural Chain"]
        unique_muscles = list(dict.fromkeys(muscles))

        # 2. Biomechanics
        if is_combat:
            biomechanics = ("High-velocity martial arts striking with rapid kinetic-chain force transfer from rear-foot pivot "
                            "through pelvic rotation to anterior deltoid/serratus punch extension and hip-flexor kick chambers. "
                            "Drives VO2 stroke volume and lactate clearance with zero axial spinal compression.")
        elif is_jump:
            if w is not None:
                min_force = round(w * 3.5, 1)
                max_force = round(w * 4.5, 1)
                load_phrase = f" (~{min_force}–{max_force}kg per landing at {w:g}kg bodyweight)"
            else:
                load_phrase = ""
            biomechanics = (f"High-frequency plyometric impacts generating peak eccentric ground reaction forces of "
                            f"3.5–4.5× bodyweight{load_phrase}. "
                            f"Drives Achilles tendon stiffness, elastic energy storage, and stretch-shortening cycle (SSC) reactive strength.")
        elif is_ruck:
            biomechanics = ("Loaded axial locomotion challenging posterior chain tensile capacity and lumbar stability. "
                            "Strengthens spinal erector endurance, pelvic stabilizer recruitment, and knee joint integrity under load.")
        elif is_walk:
            impact_phrase = f", ~{round(w * 1.2, 1)}kg per stride" if w is not None else " per stride"
            biomechanics = (f"Low-impact cyclical ground force absorption (~1.2× bodyweight{impact_phrase}). "
                            f"Promotes synovial fluid circulation in knee/hip joints, venous blood pooling return, and axial lumbar decompression.")
        elif is_run:
            impact_phrase = f" (~{round(w * 2.5, 1)}kg/stride)" if w is not None else " per stride"
            biomechanics = (f"Dynamic unilateral flight-and-impact cycles absorbing 2.5–3.0× bodyweight{impact_phrase}. "
                            f"Demands sagittal plane pelvic control, gluteus medius stabilization, and reactive Achilles elastic recoil.")
        else:
            biomechanics = ("Controlled functional biomechanics maintaining joint alignment, intra-abdominal pressure, "
                            "and smooth kinetic chain force transfer without pathological joint shear.")

        # 3. Cardio & Energy Systems
        avg_hr_val = int(round(float(avg_hr))) if avg_hr is not None else 0
        max_hr_val = int(round(float(max_hr))) if max_hr is not None else 0
        if max_hr_val > 0:
            peak_pct = round((max_hr_val / 190.0) * 100)
            hr_line = f"Average HR {avg_hr_val} bpm with peak spike at {max_hr_val} bpm ({peak_pct}% estimated HRmax)."
        else:
            hr_line = f"Average HR {avg_hr_val} bpm."
        cardio = (f"{hr_line} "
                  f"Aerobic TE {float(aerobic_te or 0.0):.1f} + Anaerobic TE {float(anaerobic_te or 0.0):.1f} stimulates mitochondrial capillary density, "
                  f"lactate clearance shuttling, and myocardial stroke volume expansion.")

        # 4. Metabolic Runway Expansion
        metabolic = (f"{int(round(float(calories or 0)))} kcal active expenditure dynamically expands today's caloric runway "
                     f"while protecting your 350 kcal deficit towards 15.0% body fat. "
                     f"Elevates excess post-exercise oxygen consumption (EPOC) for 4–8 hours post-session.")

        # 5. Autoregulation & Next Session Prescriptions
        if is_jump:
            autoregulation = ("High eccentric loading on patellar tendons and gastrocnemius complex. "
                              "Recommendation: Pair next session with horizontal push/pull (bench/dips/rows) "
                              "and allow knee extensors 24–48 hours before heavy axial barbell squats.")
        elif is_walk:
            autoregulation = ("Zero systemic CNS recovery debt. Stimulates parasympathetic tone and metabolic waste flush, "
                              "priming neuromuscular pathways for high-output barbell lifting.")
        elif is_squat or is_deadlift:
            autoregulation = ("Substantial central nervous system and spinal axial loading. "
                              "Hydrate with 750ml electrolyte solution and schedule Zone 1/2 recovery locomotion before next heavy loading.")
        else:
            autoregulation = ("Optimal cardiovascular and neuromuscular stimulus. Systemic fatigue remains manageable; "
                              "cleared for scheduled training.")

        return {
            "muscles_worked": ", ".join(unique_muscles[:6]),
            "biomechanics": biomechanics,
            "cardio": cardio,
            "metabolic": metabolic,
            "autoregulation": autoregulation,
        }

    def analyze_workout(self, text, telemetry=None, athlete=None):
        telemetry = telemetry or {}
        weight_kg = self._valid_weight(athlete.get("weight_kg") if isinstance(athlete, dict) else None)
        return self.generate_benefits(
            activity_name="",
            sub_title=text or "",
            duration_min=float(telemetry["duration_min"] if telemetry.get("duration_min") is not None else 25),
            calories=float(telemetry["calories"] if telemetry.get("calories") is not None else 300),
            avg_hr=float(telemetry["avg_hr"] if telemetry.get("avg_hr") is not None else 130),
            max_hr=float(telemetry["max_hr"] if telemetry.get("max_hr") is not None else 160),
            aerobic_te=float(telemetry["aerobic_te"] if telemetry.get("aerobic_te") is not None else 2.5),
            anaerobic_te=float(telemetry["anaerobic_te"] if telemetry.get("anaerobic_te") is not None else 1.3),
            weight_kg=weight_kg,
        )

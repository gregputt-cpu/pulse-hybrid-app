import re

class PhysiologicalBenefitsEngine:
    """
    Physiological Benefits Engine for Greg Putt (99.85 kg, 17.5% -> 15.0% BF Recomposition).
    Generates 5-pillar physiological and biomechanical breakdowns for Garmin workouts.
    """

    def __init__(self, athlete_weight_kg=99.85):
        self.weight_kg = athlete_weight_kg

    def generate_benefits(self, activity_name, sub_title, duration_min, calories, avg_hr, max_hr, aerobic_te=0.0, anaerobic_te=0.0):
        text = f"{activity_name} {sub_title}".lower()
        
        # Determine movement archetype
        is_jump = any(k in text for k in ['jump', 'plyo', 'hop', 'skip', 'tuck'])
        is_walk = any(k in text for k in ['walk', 'hike', 'stroll'])
        is_ruck = any(k in text for k in ['ruck', 'weighted pack', 'pack'])
        is_run = any(k in text for k in ['run', 'sprint', 'jog', 'tempo'])
        is_squat = any(k in text for k in ['squat', 'leg press', 'lunge', 'quad'])
        is_deadlift = any(k in text for k in ['deadlift', 'rdl', 'hinge', 'hamstring'])
        is_press = any(k in text for k in ['bench', 'press', 'pushup', 'dip', 'overhead'])
        is_combat = any(k in text for k in ['combat', 'boxing', 'martial', 'mma'])
        is_kettlebell = any(k in text for k in ['kettlebell', 'kb', 'swing', 'snatch'])

        # 1. Muscles Worked
        muscles = []
        if is_jump or is_squat:
            muscles.extend(["Quadriceps (Vastus Medialis/Lateralis)", "Gluteus Maximus", "Calves & Achilles Tendon Complex (Gastrocnemius/Soleus)", "Hip Flexors (Iliopsoas)", "Tibialis Anterior"])
        if is_combat:
            muscles.extend(["Deltoids & Rotator Cuff", "Serratus Anterior", "Obliques & Transverse Abdominis", "Core Stabilizers"])
        if is_walk or is_ruck:
            muscles.extend(["Soleus & Gastrocnemius", "Gluteus Medius", "Postural Spinal Erectors", "Foot Arch Intrinsic Muscles"])
        if is_deadlift or is_kettlebell:
            muscles.extend(["Biceps Femoris & Semitendinosus", "Gluteal Complex", "Thoracolumbar Fascia & Erector Spinae", "Latissimus Dorsi & Trapezius"])
        if is_press:
            muscles.extend(["Pectoralis Major/Minor", "Anterior Deltoids", "Triceps Brachii", "Serratus Anterior"])
        if not muscles:
            muscles = ["Cardiovascular Myocardium", "Slow-Twitch Oxidative Fibers", "Core Stabilizers", "Lower Extremity Postural Chain"]

        # 2. Biomechanics
        if is_jump:
            min_force = round(self.weight_kg * 3.5, 1)
            max_force = round(self.weight_kg * 4.5, 1)
            biomechanics = (f"High-frequency plyometric impacts generating peak eccentric ground reaction forces of "
                            f"3.5–4.5× bodyweight (~{min_force}–{max_force}kg per landing at {self.weight_kg}kg bodyweight). "
                            f"Drives Achilles tendon stiffness, elastic energy storage, and stretch-shortening cycle (SSC) reactive strength.")
        elif is_ruck:
            biomechanics = (f"Loaded axial locomotion challenging posterior chain tensile capacity and lumbar stability. "
                            f"Strengthens spinal erector endurance, pelvic stabilizer recruitment, and knee joint integrity under load.")
        elif is_walk:
            impact = round(self.weight_kg * 1.2, 1)
            biomechanics = (f"Low-impact cyclical ground force absorption (~1.2× bodyweight, ~{impact}kg per stride). "
                            f"Promotes synovial fluid circulation in knee/hip joints, venous blood pooling return, and axial lumbar decompression.")
        elif is_run:
            impact = round(self.weight_kg * 2.5, 1)
            biomechanics = (f"Dynamic unilateral flight-and-impact cycles absorbing 2.5–3.0× bodyweight (~{impact}kg/stride). "
                            f"Demands sagittal plane pelvic control, gluteus medius stabilization, and reactive Achilles elastic recoil.")
        else:
            biomechanics = ("Controlled functional biomechanics maintaining joint alignment, intra-abdominal pressure, "
                            "and smooth kinetic chain force transfer without pathological joint shear.")

        # 3. Cardio & Energy Systems
        peak_pct = round((max_hr / 190.0) * 100) if max_hr else 75
        cardio = (f"Average HR {int(avg_hr)} bpm with peak spike at {int(max_hr)} bpm ({peak_pct}% estimated HRmax). "
                  f"Aerobic TE {aerobic_te:.1f} + Anaerobic TE {anaerobic_te:.1f} stimulates mitochondrial capillary density, "
                  f"lactate clearance shuttling, and myocardial stroke volume expansion.")

        # 4. Metabolic Runway Expansion
        metabolic = (f"{int(calories)} kcal active expenditure dynamically expands today's caloric runway "
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
            "muscles_worked": ", ".join(muscles[:6]),
            "biomechanics": biomechanics,
            "cardio": cardio,
            "metabolic": metabolic,
            "autoregulation": autoregulation
        }

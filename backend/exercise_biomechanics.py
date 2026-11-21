import re
from typing import Dict, Any, Iterable, List, Optional, Set, Tuple

ALL_ADAPTOR_JOINTS: Tuple[str, ...] = (
    "lumbar",
    "shoulders",
    "knees",
    "elbows",
    "wrists",
    "ankles",
)

MOVEMENT_RESTRICTIONS: Tuple[str, ...] = (
    "axial_spinal_loading",
    "deep_hip_hinge",
    "overhead_pressing",
    "deep_horizontal_push",
    "deep_knee_flexion",
    "ballistic_impact",
    "terminal_elbow_lockout",
    "wrist_extension_load",
    "heavy_grip_pull",
    "explosive_calf_achilles",
)

ANATOMICAL_REGIONS: Tuple[str, ...] = (
    "cervical_neck",
    "thoracic_upper_back",
    "lumbar_lower_back",
    "shoulder",
    "elbow",
    "wrist_hand",
    "hip_glute",
    "groin_adductor",
    "hamstring",
    "quadriceps",
    "knee",
    "calf_shin",
    "ankle_achilles",
    "foot_plantar",
    "chest_rib",
    "other_unspecified",
)

REGION_TO_ADAPTOR_MAP: Dict[str, Dict[str, Any]] = {
    "lumbar_lower_back": {
        "affected_joints": ["lumbar"],
        "movement_restrictions": ["axial_spinal_loading", "deep_hip_hinge"],
    },
    "thoracic_upper_back": {
        "affected_joints": ["lumbar", "shoulders"],
        "movement_restrictions": ["axial_spinal_loading", "overhead_pressing"],
    },
    "cervical_neck": {
        "affected_joints": ["shoulders"],
        "movement_restrictions": ["overhead_pressing", "axial_spinal_loading"],
    },
    "shoulder": {
        "affected_joints": ["shoulders"],
        "movement_restrictions": ["overhead_pressing", "deep_horizontal_push"],
    },
    "chest_rib": {
        "affected_joints": ["shoulders"],
        "movement_restrictions": ["deep_horizontal_push"],
    },
    "elbow": {
        "affected_joints": ["elbows"],
        "movement_restrictions": ["terminal_elbow_lockout"],
    },
    "wrist_hand": {
        "affected_joints": ["wrists"],
        "movement_restrictions": ["wrist_extension_load"],
    },
    "knee": {
        "affected_joints": ["knees"],
        "movement_restrictions": ["deep_knee_flexion", "ballistic_impact"],
    },
    "quadriceps": {
        "affected_joints": ["knees"],
        "movement_restrictions": ["deep_knee_flexion"],
    },
    "hip_glute": {
        "affected_joints": ["lumbar"],
        "movement_restrictions": ["deep_hip_hinge"],
    },
    "hamstring": {
        "affected_joints": ["lumbar"],
        "movement_restrictions": ["deep_hip_hinge"],
    },
    "groin_adductor": {
        "affected_joints": ["lumbar"],
        "movement_restrictions": ["deep_hip_hinge"],
    },
    "ankle_achilles": {
        "affected_joints": ["ankles"],
        "movement_restrictions": ["ballistic_impact", "explosive_calf_achilles"],
    },
    "calf_shin": {
        "affected_joints": ["ankles"],
        "movement_restrictions": ["ballistic_impact", "explosive_calf_achilles"],
    },
    "foot_plantar": {
        "affected_joints": ["ankles"],
        "movement_restrictions": ["ballistic_impact", "explosive_calf_achilles"],
    },
    "other_unspecified": {
        "affected_joints": [],
        "movement_restrictions": [],
    },
}

# Documented legacy alias present in js/workout-verdict.js JOINT_CONTRAINDICATIONS.knees
LEGACY_EXERCISE_ALIASES: Set[str] = {"kb_goblet_lunge"}

JOINT_CONTRAINDICATIONS: Dict[str, Set[str]] = {
    "lumbar": {
        "barbell_squat", "barbell_rdl", "barbell_zercher_squat", "barbell_z_press", "barbell_pendlay_row",
        "kb_heavy_rdl", "kb_swings", "kb_front_rack_squat", "slam_ball_slams",
        "for_time_kb_chipper", "emom_hybrid_10", "amrap_hybrid_10",
    },
    "shoulders": {
        "weighted_dips", "bench_dips", "barbell_z_press", "barbell_bench_press",
        "kb_clean_and_strict_press", "half_kneeling_kb_press", "pike_pushups",
    },
    "knees": {
        "barbell_squat", "barbell_zercher_squat", "kb_front_rack_squat", "goblet_squat", "split_squat",
        "box_step_ups", "speed_rope_intervals", "emom_hybrid_10", "amrap_hybrid_10", "for_time_kb_chipper",
        "kb_goblet_lunge",
    },
    "elbows": {
        "weighted_dips", "bench_dips", "kb_clean_and_strict_press", "barbell_floor_press",
        "narrow_pushups", "pushups_renegade", "slam_ball_slams",
    },
    "wrists": {
        "pushups_renegade", "narrow_pushups", "incline_pushups", "pike_pushups", "plank_shoulder_taps",
        "weighted_dips", "bench_dips", "kb_clean_and_strict_press", "kb_front_rack_squat",
        "barbell_zercher_squat", "emom_hybrid_10", "amrap_hybrid_10", "for_time_kb_chipper",
    },
    "ankles": {
        "speed_rope_intervals", "box_step_ups", "farmers_walk", "kb_suitcase_carry", "split_squat",
        "barbell_squat", "single_leg_rdl", "emom_hybrid_10", "amrap_hybrid_10", "for_time_kb_chipper",
    },
}

JOINT_SAFE_SWAPS: Dict[str, List[str]] = {
    "lumbar": ["glute_bridge_hold", "hip_thrust_weighted", "inverted_row", "db_press", "zone2_flush", "deadbug_hold", "thoracic_openers"],
    "shoulders": ["barbell_floor_press", "db_close_grip_press", "band_pull_aparts", "glute_bridge_hold", "deadbug_hold", "zone2_flush"],
    "knees": ["knee_tke", "glute_bridge_hold", "hip_thrust_weighted", "zone2_flush", "deadbug_hold"],
    "elbows": ["glute_bridge_hold", "hip_thrust_weighted", "zone2_flush", "deadbug_hold", "thoracic_openers"],
    "wrists": ["barbell_floor_press", "glute_bridge_hold", "hip_thrust_weighted", "deadbug_hold", "zone2_flush"],
    "ankles": ["zone2_flush", "glute_bridge_hold", "hip_thrust_weighted", "deadbug_hold", "thoracic_openers"],
}

JOINT_MOBILITY_FALLBACKS: Tuple[str, ...] = (
    "deadbug_hold",
    "glute_bridge_hold",
    "zone2_flush",
    "thoracic_openers",
)

MOVEMENT_RESTRICTION_EXERCISES: Dict[str, Set[str]] = {
    "axial_spinal_loading": {
        "barbell_squat", "barbell_zercher_squat", "barbell_z_press",
        "barbell_pendlay_row", "kb_front_rack_squat", "farmers_walk", "kb_suitcase_carry",
    },
    "deep_hip_hinge": {
        "barbell_rdl", "kb_heavy_rdl", "db_rdl", "single_leg_rdl",
        "kb_swings", "slam_ball_slams", "barbell_pendlay_row", "kb_gorilla_row",
        "for_time_kb_chipper", "emom_hybrid_10", "amrap_hybrid_10",
    },
    "overhead_pressing": {
        "barbell_z_press", "kb_clean_and_strict_press", "half_kneeling_kb_press", "pike_pushups",
    },
    "deep_horizontal_push": {
        "weighted_dips", "bench_dips", "barbell_bench_press",
        "pushups_renegade", "narrow_pushups", "incline_pushups",
    },
    "deep_knee_flexion": {
        "barbell_squat", "barbell_zercher_squat", "kb_front_rack_squat",
        "goblet_squat", "split_squat", "box_step_ups", "kb_goblet_lunge",
    },
    "ballistic_impact": {
        "speed_rope_intervals", "tabata_rope_core", "kb_swings", "slam_ball_slams",
        "emom_hybrid_10", "amrap_hybrid_10", "for_time_kb_chipper",
    },
    "terminal_elbow_lockout": {
        "weighted_dips", "bench_dips", "barbell_bench_press", "barbell_floor_press",
        "kb_clean_and_strict_press", "half_kneeling_kb_press",
        "narrow_pushups", "pushups_renegade", "pike_pushups",
    },
    "wrist_extension_load": {
        "pushups_renegade", "narrow_pushups", "incline_pushups", "pike_pushups",
        "plank_shoulder_taps", "weighted_dips", "bench_dips",
        "kb_clean_and_strict_press", "kb_front_rack_squat", "barbell_zercher_squat",
    },
    "heavy_grip_pull": {
        "barbell_rdl", "kb_heavy_rdl", "db_rdl", "barbell_pendlay_row",
        "kb_gorilla_row", "db_single_arm_row", "inverted_row", "farmers_walk", "kb_suitcase_carry",
    },
    "explosive_calf_achilles": {
        "speed_rope_intervals", "tabata_rope_core", "box_step_ups", "split_squat",
        "emom_hybrid_10", "amrap_hybrid_10", "for_time_kb_chipper",
    },
}


def _ex(
    ex_id: str,
    name: str,
    family: str,
    primary_muscles: List[str],
    secondary_muscles: List[str],
    stressed_joints: List[str],
    kinetic_chain: str,
    movement_tags: List[str],
    impact_level: str = "low",
    axial_load: str = "low",
) -> Dict[str, Any]:
    return {
        "id": ex_id,
        "name": name,
        "family": family,
        "primary_muscles": primary_muscles,
        "secondary_muscles": secondary_muscles,
        "stressed_joints": stressed_joints,
        "kinetic_chain": kinetic_chain,
        "movement_tags": movement_tags,
        "impact_level": impact_level,
        "axial_load": axial_load,
    }


# Complete 54-exercise parity registry matching js/workout-catalog.js:getAllExercises()
EXERCISE_BIOMECHANICS: Dict[str, Dict[str, Any]] = {item["id"]: item for item in [
    _ex("barbell_rdl", "Barbell Romanian Deadlift (RDL)", "hip_hinge",
        ["hamstrings", "glutes"], ["spinal_erectors", "forearms"], ["lumbar"],
        "posterior_chain", ["deep_hip_hinge", "heavy_grip_pull"], "low", "moderate"),
    _ex("barbell_floor_press", "Barbell Floor Press", "horizontal_push",
        ["pectorals", "triceps"], ["anterior_deltoids"], ["elbows", "wrists"],
        "anterior_upper", ["terminal_elbow_lockout"], "low", "none"),
    _ex("barbell_bench_press", "Barbell Flat Bench Press", "horizontal_push",
        ["pectorals", "anterior_deltoids"], ["triceps"], ["shoulders", "elbows", "wrists"],
        "anterior_upper", ["deep_horizontal_push", "terminal_elbow_lockout"], "low", "none"),
    _ex("weighted_dips", "Dip Bar Chest & Tricep Dips", "horizontal_push",
        ["pectorals", "triceps"], ["anterior_deltoids"], ["shoulders", "elbows", "wrists"],
        "anterior_upper", ["deep_horizontal_push", "terminal_elbow_lockout", "wrist_extension_load"], "low", "none"),
    _ex("barbell_zercher_squat", "Barbell Zercher Squat", "squat",
        ["quadriceps", "glutes"], ["core", "spinal_erectors", "biceps"], ["lumbar", "knees", "elbows", "wrists"],
        "anterior_lower", ["axial_spinal_loading", "deep_knee_flexion", "wrist_extension_load"], "low", "high"),
    _ex("barbell_pendlay_row", "Barbell Bent-Over Pendlay Row", "pull",
        ["lats", "rhomboids"], ["rear_deltoids", "spinal_erectors", "biceps"], ["lumbar"],
        "posterior_upper", ["axial_spinal_loading", "deep_hip_hinge", "heavy_grip_pull"], "low", "moderate"),
    _ex("barbell_z_press", "Floor Seated Barbell Z-Press", "vertical_push",
        ["anterior_deltoids", "lateral_deltoids", "triceps"], ["core", "spinal_erectors"], ["shoulders", "lumbar"],
        "overhead_core", ["overhead_pressing", "axial_spinal_loading"], "low", "moderate"),
    _ex("db_press", "Dumbbell Chest Floor Press", "horizontal_push",
        ["pectorals", "triceps"], ["anterior_deltoids"], ["elbows"],
        "anterior_upper", [], "low", "none"),
    _ex("kb_swings", "Kettlebell Two-Hand Swings", "hip_hinge",
        ["glutes", "hamstrings"], ["spinal_erectors", "core", "forearms"], ["lumbar"],
        "posterior_chain", ["deep_hip_hinge", "ballistic_impact"], "moderate", "moderate"),
    _ex("slam_ball_slams", "Rotational Slam Ball Slams", "hip_hinge",
        ["core", "lats", "glutes"], ["shoulders", "triceps"], ["lumbar", "elbows", "shoulders"],
        "full_body_power", ["deep_hip_hinge", "ballistic_impact"], "moderate", "low"),
    _ex("speed_rope_intervals", "Speed Rope Intervals", "cardio",
        ["calves", "tibialis"], ["quadriceps", "shoulders", "forearms"], ["ankles", "knees"],
        "lower_plyometric", ["ballistic_impact", "explosive_calf_achilles"], "high", "low"),
    _ex("emom_hybrid_10", "10-Min Hybrid EMOM (Swings + Rope)", "cardio",
        ["glutes", "hamstrings", "calves"], ["shoulders", "core", "forearms"], ["lumbar", "knees", "ankles", "wrists"],
        "full_body_metabolic", ["deep_hip_hinge", "ballistic_impact", "explosive_calf_achilles"], "high", "moderate"),
    _ex("amrap_hybrid_10", "10-Min Engine AMRAP", "cardio",
        ["glutes", "pectorals", "calves"], ["shoulders", "quadriceps", "core"], ["lumbar", "knees", "ankles", "wrists"],
        "full_body_metabolic", ["deep_hip_hinge", "ballistic_impact", "explosive_calf_achilles"], "high", "moderate"),
    _ex("tabata_rope_core", "Tabata Conditioning (20s / 10s × 8)", "cardio",
        ["calves", "core"], ["shoulders", "hip_flexors"], ["ankles", "knees"],
        "lower_plyometric", ["ballistic_impact", "explosive_calf_achilles"], "high", "low"),
    _ex("for_time_kb_chipper", "For-Time Conditioning Chipper", "cardio",
        ["glutes", "hamstrings", "quadriceps", "calves"], ["shoulders", "core", "forearms"], ["lumbar", "knees", "ankles", "wrists"],
        "full_body_metabolic", ["deep_hip_hinge", "ballistic_impact", "explosive_calf_achilles"], "high", "moderate"),
    _ex("kb_flow_2h_out_about", "2H Out & About 9-Move Flow (30m AMRAP)", "cardio",
        ["glutes", "hamstrings", "shoulders"], ["core", "forearms", "quadriceps"], ["lumbar", "shoulders", "knees", "wrists", "ankles"],
        "full_body_metabolic", ["deep_hip_hinge", "ballistic_impact"], "moderate", "moderate"),
    _ex("kb_flow_2h_tactical_upper", "2H Tactical Upper & Push-Up Engine Flow", "cardio",
        ["pectorals", "shoulders", "glutes"], ["triceps", "core", "lats"], ["lumbar", "shoulders", "elbows", "wrists", "knees", "ankles"],
        "full_body_metabolic", ["deep_hip_hinge", "deep_horizontal_push"], "moderate", "moderate"),
    _ex("kb_flow_2h_gladiator_post", "2H Gladiator Posterior & Trunk Flow", "cardio",
        ["hamstrings", "glutes", "lats"], ["spinal_erectors", "core", "forearms"], ["lumbar", "shoulders", "knees", "wrists", "ankles"],
        "posterior_chain", ["deep_hip_hinge", "ballistic_impact"], "moderate", "moderate"),
    _ex("kb_flow_2h_pyramid_1_5", "2H 1-to-5 Pyramid Ladder Flow", "cardio",
        ["glutes", "hamstrings", "quadriceps"], ["shoulders", "core"], ["lumbar", "shoulders", "knees", "wrists", "ankles"],
        "full_body_metabolic", ["deep_hip_hinge", "ballistic_impact"], "moderate", "moderate"),
    _ex("kb_flow_1h_armor_chain", "1H Armor & Athletic Chain (5L → 5R)", "cardio",
        ["glutes", "shoulders", "core"], ["hamstrings", "forearms", "quadriceps"], ["lumbar", "shoulders", "knees", "elbows", "wrists", "ankles"],
        "full_body_unilateral", ["deep_hip_hinge", "overhead_pressing"], "moderate", "moderate"),
    _ex("kb_flow_1h_viking_warrior", "1H Viking Warrior Conditioning (5L → 5R)", "cardio",
        ["glutes", "shoulders", "hamstrings"], ["forearms", "core"], ["lumbar", "shoulders", "elbows", "wrists", "knees", "ankles"],
        "full_body_unilateral", ["deep_hip_hinge", "ballistic_impact", "overhead_pressing"], "moderate", "moderate"),
    _ex("kb_flow_1h_dan_john_grind", "1H Dan John Armor + Grind (L → R)", "cardio",
        ["quadriceps", "shoulders", "glutes"], ["core", "forearms"], ["lumbar", "shoulders", "knees", "wrists", "ankles"],
        "full_body_unilateral", ["overhead_pressing", "deep_knee_flexion"], "low", "moderate"),
    _ex("kb_flow_1h_combat_core", "1H Rotational Combat & Core (5L → 5R)", "cardio",
        ["core", "glutes", "shoulders"], ["obliques", "forearms", "hamstrings"], ["lumbar", "shoulders", "knees", "wrists", "ankles"],
        "rotational_core", ["deep_hip_hinge"], "moderate", "moderate"),
    _ex("pushups_renegade", "Floor Push-ups (Tempo 3-0-1)", "horizontal_push",
        ["pectorals", "triceps"], ["anterior_deltoids", "core"], ["wrists", "elbows"],
        "anterior_upper", ["deep_horizontal_push", "terminal_elbow_lockout", "wrist_extension_load"], "low", "none"),
    _ex("kb_clean_and_strict_press", "Heavy Kettlebell Single-Arm Clean & Strict Press", "vertical_push",
        ["anterior_deltoids", "triceps"], ["glutes", "core", "forearms"], ["shoulders", "elbows", "wrists"],
        "overhead_unilateral", ["overhead_pressing", "terminal_elbow_lockout", "wrist_extension_load"], "low", "moderate"),
    _ex("kb_heavy_rdl", "Heavy Kettlebell Romanian Deadlift (RDL)", "hip_hinge",
        ["hamstrings", "glutes"], ["spinal_erectors", "forearms"], ["lumbar"],
        "posterior_chain", ["deep_hip_hinge", "heavy_grip_pull"], "low", "moderate"),
    _ex("kb_goblet_floor_press", "Heavy Kettlebell Floor Press (Single-Arm / Goblet)", "horizontal_push",
        ["pectorals", "triceps"], ["anterior_deltoids", "core"], ["elbows"],
        "anterior_upper", [], "low", "none"),
    _ex("kb_gorilla_row", "Heavy Kettlebell Gorilla Row (Alternating Dead-Stop)", "pull",
        ["lats", "rhomboids"], ["rear_deltoids", "core", "forearms"], ["lumbar"],
        "posterior_upper", ["deep_hip_hinge", "heavy_grip_pull"], "low", "low"),
    _ex("kb_front_rack_squat", "Heavy Kettlebell Front Rack Squat", "squat",
        ["quadriceps", "glutes"], ["core", "upper_back"], ["knees", "lumbar", "wrists"],
        "anterior_lower", ["axial_spinal_loading", "deep_knee_flexion", "wrist_extension_load"], "low", "high"),
    _ex("kb_suitcase_carry", "Heavy Kettlebell Suitcase Carry / March", "core_carry",
        ["obliques", "core", "forearms"], ["glutes", "calves", "traps"], ["ankles", "lumbar"],
        "loaded_carry", ["axial_spinal_loading", "heavy_grip_pull"], "low", "moderate"),
    _ex("barbell_squat", "Barbell Back Squat", "squat",
        ["quadriceps", "glutes"], ["spinal_erectors", "hamstrings", "core"], ["lumbar", "knees", "ankles"],
        "anterior_lower", ["axial_spinal_loading", "deep_knee_flexion"], "low", "high"),
    _ex("zone2_flush", "Incline Cadence Walk / Ruck (Zone 2)", "cardio",
        ["glutes", "hamstrings", "calves"], ["quadriceps", "core"], [],
        "low_impact_aerobic", [], "low", "none"),
    _ex("knee_tke", "Banded Terminal Knee Extensions (TKE)", "squat",
        ["quadriceps"], ["vmo"], [],
        "knee_rehab", [], "low", "none"),
    _ex("glute_bridge_hold", "Glute Bridge Isometric & Walkouts", "hip_hinge",
        ["glutes", "hamstrings"], ["core"], [],
        "posterior_rehab", [], "low", "none"),
    _ex("deadbug_hold", "Deadbug Anti-Extension Core Brace", "pull",
        ["core", "transverse_abdominis"], ["hip_flexors"], [],
        "core_rehab", [], "low", "none"),
    _ex("thoracic_openers", "Side-Lying Thoracic Open Book Rotations", "mobility",
        ["thoracic_spine", "pectorals"], ["obliques", "posterior_shoulder"], [],
        "mobility_reset", [], "low", "none"),
    _ex("couch_stretch_flow", "Couch Stretch & Hip Flexor Decompression", "mobility",
        ["hip_flexors", "rectus_femoris"], ["quadriceps"], ["knees"],
        "mobility_reset", [], "low", "none"),
    _ex("narrow_pushups", "Narrow / Close-Grip Push-Ups", "horizontal_push",
        ["triceps", "pectorals"], ["anterior_deltoids", "core"], ["elbows", "wrists"],
        "anterior_upper", ["deep_horizontal_push", "terminal_elbow_lockout", "wrist_extension_load"], "low", "none"),
    _ex("incline_pushups", "Incline Push-Ups (Hands Elevated)", "horizontal_push",
        ["pectorals", "triceps"], ["anterior_deltoids", "core"], ["wrists"],
        "anterior_upper", ["deep_horizontal_push", "wrist_extension_load"], "low", "none"),
    _ex("bench_dips", "Bench / Box Tricep Dips", "horizontal_push",
        ["triceps", "anterior_deltoids"], ["pectorals"], ["shoulders", "elbows", "wrists"],
        "anterior_upper", ["deep_horizontal_push", "terminal_elbow_lockout", "wrist_extension_load"], "low", "none"),
    _ex("db_close_grip_press", "Dumbbell Close-Grip Floor Press", "horizontal_push",
        ["triceps", "pectorals"], ["anterior_deltoids"], [],
        "anterior_upper", [], "low", "none"),
    _ex("db_rdl", "Dumbbell Romanian Deadlift (RDL)", "hip_hinge",
        ["hamstrings", "glutes"], ["spinal_erectors", "forearms"], ["lumbar"],
        "posterior_chain", ["deep_hip_hinge", "heavy_grip_pull"], "low", "low"),
    _ex("single_leg_rdl", "Single-Leg KB / DB Romanian Deadlift", "hip_hinge",
        ["hamstrings", "glutes"], ["core", "calves", "peroneals"], ["ankles", "lumbar"],
        "unilateral_posterior", ["deep_hip_hinge"], "low", "low"),
    _ex("hip_thrust_weighted", "Barbell / KB Glute Bridge / Hip Thrust", "hip_hinge",
        ["glutes"], ["hamstrings", "core"], [],
        "posterior_chain", [], "low", "none"),
    _ex("goblet_squat", "Kettlebell / DB Goblet Squat", "squat",
        ["quadriceps", "glutes"], ["core", "upper_back"], ["knees"],
        "anterior_lower", ["deep_knee_flexion"], "low", "low"),
    _ex("split_squat", "Bodyweight / DB Bulgarian Split Squat", "squat",
        ["quadriceps", "glutes"], ["hip_flexors", "calves"], ["knees", "ankles"],
        "unilateral_lower", ["deep_knee_flexion", "explosive_calf_achilles"], "low", "low"),
    _ex("box_step_ups", "Controlled Step-Ups", "squat",
        ["quadriceps", "glutes"], ["calves"], ["knees", "ankles"],
        "unilateral_lower", ["deep_knee_flexion", "explosive_calf_achilles"], "low", "none"),
    _ex("db_single_arm_row", "Single-Arm Dumbbell Row", "pull",
        ["lats", "rhomboids"], ["biceps", "rear_deltoids", "forearms"], [],
        "posterior_upper", ["heavy_grip_pull"], "low", "none"),
    _ex("inverted_row", "Bodyweight / Bar Inverted Row", "pull",
        ["lats", "rhomboids", "rear_deltoids"], ["biceps", "core"], [],
        "posterior_upper", ["heavy_grip_pull"], "low", "none"),
    _ex("band_pull_aparts", "Banded Face Pulls / Pull-Aparts", "pull",
        ["rear_deltoids", "rhomboids", "rotator_cuff"], ["lower_traps"], [],
        "scapular_prehab", [], "low", "none"),
    _ex("half_kneeling_kb_press", "Half-Kneeling Single-Arm KB/DB Press", "vertical_push",
        ["anterior_deltoids", "triceps"], ["glutes", "core"], ["shoulders"],
        "overhead_unilateral", ["overhead_pressing", "terminal_elbow_lockout"], "low", "low"),
    _ex("pike_pushups", "Pike Push-Ups (Shoulder Focus)", "vertical_push",
        ["anterior_deltoids", "triceps"], ["upper_pectorals", "core"], ["shoulders", "wrists"],
        "overhead_bodyweight", ["overhead_pressing", "terminal_elbow_lockout", "wrist_extension_load"], "low", "none"),
    _ex("plank_shoulder_taps", "Hollow Plank Shoulder Taps", "core_carry",
        ["core", "serratus_anterior"], ["anterior_deltoids", "glutes"], ["wrists"],
        "anti_rotation_core", ["wrist_extension_load"], "low", "none"),
    _ex("farmers_walk", "Heavy Dual Farmer's Walk", "core_carry",
        ["forearms", "traps", "core"], ["glutes", "calves"], ["ankles", "lumbar"],
        "loaded_carry", ["axial_spinal_loading", "heavy_grip_pull"], "low", "moderate"),
]}

_SET_SUFFIX_RE = re.compile(r"^(.+)_(\d+)$")


def normalize_exercise_id(raw_id: Any) -> str:
    """Normalize set-suffixed exercise log keys (e.g. 'barbell_rdl_1' -> 'barbell_rdl') while keeping numeric catalog IDs intact."""
    s = str(raw_id or "").strip()
    if not s:
        return ""
    if s in EXERCISE_BIOMECHANICS or s in LEGACY_EXERCISE_ALIASES:
        return s
    m = _SET_SUFFIX_RE.match(s)
    if m:
        stem = m.group(1)
        if stem in EXERCISE_BIOMECHANICS or stem in LEGACY_EXERCISE_ALIASES or stem.startswith(("kb_flow_2h_", "kb_flow_1h_")):
            return stem
    return s


def is_exercise_contraindicated_py(
    ex_id: str,
    active_joints: Iterable[str],
    movement_restrictions: Iterable[str] = (),
    restricted_exercise_ids: Iterable[str] = (),
) -> bool:
    """Mirror frontend isExerciseContraindicated() across 6 joints, kb_flow_*, movement restrictions, and explicit IDs."""
    norm = normalize_exercise_id(ex_id)
    if not norm:
        return False
    if norm in set(restricted_exercise_ids or ()):
        return True
    is_kb_flow = norm.startswith("kb_flow_2h_") or norm.startswith("kb_flow_1h_")
    for joint in active_joints or ():
        if joint not in ALL_ADAPTOR_JOINTS:
            continue
        if is_kb_flow or norm in JOINT_CONTRAINDICATIONS.get(joint, ()):
            return True
    for restr in movement_restrictions or ():
        if norm in MOVEMENT_RESTRICTION_EXERCISES.get(restr, ()):
            return True
    return False


def compute_safe_swaps_for_injuries(
    active_joints: Iterable[str],
    movement_restrictions: Iterable[str] = (),
    restricted_exercise_ids: Iterable[str] = (),
    limit: int = 5,
) -> List[str]:
    """Return catalog swap IDs that are safe across ALL merged active joints, restrictions, and explicit IDs."""
    joints_list = [j for j in dict.fromkeys(active_joints or ()) if j in ALL_ADAPTOR_JOINTS]
    restr_list = [r for r in dict.fromkeys(movement_restrictions or ()) if r in MOVEMENT_RESTRICTIONS]
    explicit_ids = list(dict.fromkeys(restricted_exercise_ids or ()))

    candidates: List[str] = []
    for j in joints_list:
        for sid in JOINT_SAFE_SWAPS.get(j, ()):
            if sid not in candidates:
                candidates.append(sid)
    for fid in JOINT_MOBILITY_FALLBACKS:
        if fid not in candidates:
            candidates.append(fid)

    safe: List[str] = []
    for cid in candidates:
        if not is_exercise_contraindicated_py(cid, joints_list, restr_list, explicit_ids):
            safe.append(cid)
            if len(safe) >= limit:
                break
    return safe


_ACTIVITY_CLASSIFIERS: Tuple[Tuple[re.Pattern[str], Dict[str, Any]], ...] = (
    (re.compile(r"\b(run|running|jog|sprint|treadmill run|track)\b", re.I), {
        "category": "running_impact",
        "kinetic_chain": "lower_impact_locomotion",
        "stressed_joints": ["knees", "ankles"],
        "impact_level": "high",
        "movement_tags": ["ballistic_impact", "explosive_calf_achilles"],
    }),
    (re.compile(r"\b(jump\s*rope|skipping|double[- ]?under|plyo|plyometric|box\s*jump)\b", re.I), {
        "category": "plyometric_skipping",
        "kinetic_chain": "lower_plyometric",
        "stressed_joints": ["knees", "ankles"],
        "impact_level": "high",
        "movement_tags": ["ballistic_impact", "explosive_calf_achilles"],
    }),
    (re.compile(r"\b(kettlebell|kb|snatch|clean\s*&?\s*press|swing|turkish)\b", re.I), {
        "category": "kettlebell_ballistic_strength",
        "kinetic_chain": "full_body_posterior_overhead",
        "stressed_joints": ["lumbar", "shoulders", "wrists", "knees"],
        "impact_level": "moderate",
        "movement_tags": ["deep_hip_hinge", "overhead_pressing", "ballistic_impact"],
    }),
    (re.compile(r"\b(cycle|cycling|bike|spin|peloton|erg)\b", re.I), {
        "category": "cycling_concentric",
        "kinetic_chain": "anterior_lower_cardio",
        "stressed_joints": ["knees"],
        "impact_level": "low",
        "movement_tags": ["deep_knee_flexion"],
    }),
    (re.compile(r"\b(walk|incline|ruck|hike|hiking|steps)\b", re.I), {
        "category": "walking_liss",
        "kinetic_chain": "low_impact_aerobic",
        "stressed_joints": ["ankles"],
        "impact_level": "low",
        "movement_tags": [],
    }),
    (re.compile(r"\b(combat|hiit|crossfit|circuit|bootcamp|metcon|amrap|emom)\b", re.I), {
        "category": "hiit_mixed_modal",
        "kinetic_chain": "full_body_metabolic",
        "stressed_joints": ["knees", "shoulders", "ankles", "lumbar"],
        "impact_level": "high",
        "movement_tags": ["ballistic_impact", "deep_knee_flexion", "overhead_pressing"],
    }),
    (re.compile(r"\b(strength|barbell|weight|lift|lifting|squat|deadlift|bench|press|dip|pullup)\b", re.I), {
        "category": "resistance_strength",
        "kinetic_chain": "compound_strength",
        "stressed_joints": ["lumbar", "shoulders", "knees", "elbows", "wrists"],
        "impact_level": "low",
        "movement_tags": ["axial_spinal_loading", "deep_hip_hinge"],
    }),
    (re.compile(r"\b(row|rowing|concept2|ski\s*erg)\b", re.I), {
        "category": "rowing_ergometer",
        "kinetic_chain": "posterior_chain_cardio",
        "stressed_joints": ["lumbar", "elbows"],
        "impact_level": "low",
        "movement_tags": ["deep_hip_hinge", "heavy_grip_pull"],
    }),
    (re.compile(r"\b(swim|swimming|pool)\b", re.I), {
        "category": "swimming_non_impact",
        "kinetic_chain": "upper_overhead_aerobic",
        "stressed_joints": ["shoulders"],
        "impact_level": "low",
        "movement_tags": ["overhead_pressing"],
    }),
    (re.compile(r"\b(yoga|mobility|stretch|prehab|pilates|foam roll|recovery)\b", re.I), {
        "category": "mobility_recovery",
        "kinetic_chain": "mobility_reset",
        "stressed_joints": [],
        "impact_level": "low",
        "movement_tags": [],
    }),
)


def classify_activity_biomechanics(
    name: str,
    sub_title: str = "",
    activity_type_key: str = "",
    exercise_ids: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """Infer stressed joints, kinetic chain, and impact level for Garmin/manual/in-app workouts."""
    norm_ids = [normalize_exercise_id(eid) for eid in (exercise_ids or ()) if eid]
    catalog_matches = [EXERCISE_BIOMECHANICS[eid] for eid in norm_ids if eid in EXERCISE_BIOMECHANICS]
    if catalog_matches:
        joints: List[str] = []
        tags: List[str] = []
        impact_rank = {"low": 0, "moderate": 1, "high": 2}
        max_impact = "low"
        chains: List[str] = []
        for meta in catalog_matches:
            for j in meta["stressed_joints"]:
                if j not in joints:
                    joints.append(j)
            for t in meta["movement_tags"]:
                if t not in tags:
                    tags.append(t)
            if meta["kinetic_chain"] not in chains:
                chains.append(meta["kinetic_chain"])
            if impact_rank.get(meta["impact_level"], 0) > impact_rank.get(max_impact, 0):
                max_impact = meta["impact_level"]
        return {
            "category": "catalog_session",
            "kinetic_chain": ", ".join(chains[:3]),
            "stressed_joints": joints,
            "impact_level": max_impact,
            "movement_tags": tags,
        }

    haystack = f"{name or ''} {sub_title or ''} {activity_type_key or ''}".strip()
    for pattern, meta in _ACTIVITY_CLASSIFIERS:
        if pattern.search(haystack):
            return dict(meta)

    return {
        "category": "general_conditioning",
        "kinetic_chain": "mixed",
        "stressed_joints": [],
        "impact_level": "low",
        "movement_tags": [],
    }

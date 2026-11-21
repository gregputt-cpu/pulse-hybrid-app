import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

from exercise_biomechanics import (
    ALL_ADAPTOR_JOINTS,
    ANATOMICAL_REGIONS,
    EXERCISE_BIOMECHANICS,
    LEGACY_EXERCISE_ALIASES,
    MOVEMENT_RESTRICTIONS,
    REGION_TO_ADAPTOR_MAP,
    compute_safe_swaps_for_injuries,
)

CLINICAL_DISCLAIMER = (
    "Educational biomechanical triage only — not a medical diagnosis or prescription. "
    "Do not train through sharp joint pain, instability, numbness, or systemic symptoms; "
    "consult a qualified physician or physiotherapist if symptoms persist or worsen."
)

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_BOLD_MD_RE = re.compile(r"\*\*([^*]+)\*\*")

_NEURO_FLAG_RE = re.compile(
    r"\b(numb|numbness|tingl\w*|pins\s+and\s+needles|paraesthesia|paresthesia|"
    r"radiat(?:ing|es)|shooting\s+pain|electric\s+shock|foot\s*drop|"
    r"sudden\s+weakness|giving\s+out\s+weakness|loss\s+of\s+sensation|"
    r"saddle\s+anesthesia|bowel|bladder\s+(?:loss|incontinence|dysfunction))\b",
    re.I,
)
_STRUCTURAL_FLAG_RE = re.compile(
    r"\b(audible\s+pop|loud\s+pop|felt\s+a\s+pop|popped|snapped|snap\s+and\s+swell|"
    r"immediate\s+swelling|swelled\s+up\s+immediately|"
    r"(?:can'?t|cannot|unable\s+to)\s+bear\s+weight|can'?t\s+walk|cannot\s+walk|"
    r"joint\s+(?:lock|locking|locked)|knee\s+lock\w*|giving\s+way|buckl(?:ing|ed)|"
    r"deformity|deformed|dislocat\w*|fracture|broken\s+bone)\b",
    re.I,
)
_SYSTEMIC_CARDIO_FLAG_RE = re.compile(
    r"\b(chest\s+(?:pain|pressure|tightness|heaviness)|shortness\s+of\s+breath|"
    r"can'?t\s+breathe|dizz(?:y|iness)|faint(?:ing|ed)?|syncope|"
    r"fever|chills|hot\s+(?:and\s+)?swollen\s+joint|red\s+hot\s+joint|"
    r"unrelenting\s+night\s+pain|night\s+pain\s+waking)\b",
    re.I,
)
_ACUTE_ONSET_TEXT_RE = re.compile(
    r"\b(sudden|suddenly|acute|sharp|stabbing|can'?t\s+move|unable\s+to\s+move|"
    r"severe|excruciating|unbearable)\b",
    re.I,
)

# Ambiguous broad terms checked ONLY when no specific joint/region was detected
_AMBIGUOUS_LIMB_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("leg", re.compile(r"\b(leg|legs|lower\s+limb)\b", re.I)),
    ("arm", re.compile(r"\b(arm|arms|upper\s+limb)\b", re.I)),
    ("back", re.compile(r"\b(my\s+back|the\s+back|back\s+hurts?|back\s+pain|back\s+is\s+sore)\b", re.I)),
)

# Specific region patterns ordered by anatomical specificity
_REGION_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("knee", re.compile(r"\b(knee|knees|patella\w*|kneecap|meniscus|pcl|acl|mcl|lcl|behind\s+(?:my\s+)?knee|popliteal|it\s*band)\b", re.I)),
    ("lumbar_lower_back", re.compile(r"\b(lower\s+back|low\s+back|lumbar|erector\w*|l4|l5|s1|si\s+joint|sacroiliac|sciatic\w*|tailbone)\b", re.I)),
    ("shoulder", re.compile(r"\b(shoulder\w*|rotator\s+cuff|supraspinatus|subacromial|ac\s+joint|deltoid|front\s+delt|rear\s+delt|labrum)\b", re.I)),
    ("ankle_achilles", re.compile(r"\b(ankle\w*|achilles|tarsal|talus|ankle\s+sprain)\b", re.I)),
    ("foot_plantar", re.compile(r"\b(plantar\w*|heel|arch\s+of\s+foot|metatarsal|toe\w*|foot\s+pain|bottom\s+of\s+foot)\b", re.I)),
    ("calf_shin", re.compile(r"\b(calf|calves|soleus|gastroc\w*|shin\w*|tibialis)\b", re.I)),
    ("elbow", re.compile(r"\b(elbow\w*|olecranon|epicondyl\w*|tennis\s+elbow|golfer'?s\s+elbow|distal\s+tricep\w*|bicep\s+tendon)\b", re.I)),
    ("wrist_hand", re.compile(r"\b(wrist\w*|carpal|thumb\w*|hand\w*|finger\w*|knuckle\w*|forearm\s+extensor\w*)\b", re.I)),
    ("hamstring", re.compile(r"\b(hamstring\w*|back\s+of\s+thigh|biceps\s+femoris)\b", re.I)),
    ("quadriceps", re.compile(r"\b(quad\w*|rectus\s+femoris|front\s+of\s+thigh|vmo|thigh)\b", re.I)),
    ("groin_adductor", re.compile(r"\b(groin|adductor\w*|inner\s+thigh)\b", re.I)),
    ("hip_glute", re.compile(r"\b(hip|hips|hip\s+flexor|psoas|glute\w*|piriformis|gluteal|buttock)\b", re.I)),
    ("thoracic_upper_back", re.compile(r"\b(upper\s+back|mid\s*back|thoracic|rhomboid\w*|scapula\w*|shoulder\s+blade|lat\s+strain)\b", re.I)),
    ("cervical_neck", re.compile(r"\b(neck|cervical|upper\s+trap\w*|stiff\s+neck)\b", re.I)),
    ("chest_rib", re.compile(r"\b(chest|pec|pectoral\w*|sternum|rib|ribs|intercostal)\b", re.I)),
)


def strip_markup(text: Any) -> str:
    """Remove HTML tags and markdown bold markers from clinical/UI text fields."""
    if text is None:
        return ""
    s = str(text)
    s = _HTML_TAG_RE.sub("", s)
    s = _BOLD_MD_RE.sub(r"\1", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def sanitize_report_strings(obj: Any) -> Any:
    """Recursively sanitize all strings in a nested dict/list payload."""
    if isinstance(obj, str):
        return strip_markup(obj)
    if isinstance(obj, list):
        return [sanitize_report_strings(v) for v in obj]
    if isinstance(obj, dict):
        return {k: sanitize_report_strings(v) for k, v in obj.items()}
    return obj


def evaluate_red_flags(
    raw_text: str,
    pain_severity: Optional[int] = None,
    onset_type: Optional[str] = None,
) -> Dict[str, Any]:
    """Deterministic clinical red-flag classifier evaluated BEFORE vague-input or AI logic."""
    text = str(raw_text or "").strip()
    flags: List[str] = []

    neuro = _NEURO_FLAG_RE.search(text)
    if neuro:
        flags.append(f"Neurological symptom reported ('{neuro.group(0).strip()}')")

    structural = _STRUCTURAL_FLAG_RE.search(text)
    if structural:
        flags.append(f"Acute structural instability/trauma cue ('{structural.group(0).strip()}')")

    systemic = _SYSTEMIC_CARDIO_FLAG_RE.search(text)
    if systemic:
        flags.append(f"Cardiopulmonary or systemic red-flag cue ('{systemic.group(0).strip()}')")

    sev_num = int(pain_severity) if isinstance(pain_severity, int) and not isinstance(pain_severity, bool) else None
    is_acute_context = (onset_type == "sudden_acute") or bool(_ACUTE_ONSET_TEXT_RE.search(text))
    if sev_num is not None and (sev_num >= 9 or (sev_num >= 8 and is_acute_context)):
        flags.append(f"Severe acute pain intensity rated {sev_num}/10")

    if flags:
        return {
            "triggered": True,
            "deterministic_override": True,
            "flags": flags,
            "clinical_action": (
                "Stop loaded and ballistic training immediately. Rest the affected area and "
                "seek prompt evaluation from a licensed physician, sports doctor, or urgent care clinic."
            ),
            "training_clearance": "stop_and_evaluate",
        }

    return {
        "triggered": False,
        "deterministic_override": False,
        "flags": [],
        "clinical_action": "No acute neurological, systemic, or structural red flags detected in your description.",
        "training_clearance": "modified_allowed",
    }


def _detect_laterality(text: str, laterality_hint: Optional[str] = None) -> str:
    t = str(text or "").lower()
    has_left = bool(re.search(r"\b(left|l\s+side)\b", t))
    has_right = bool(re.search(r"\b(right|r\s+side)\b", t))
    has_bilat = bool(re.search(r"\b(both|bilateral|each\s+side)\b", t))
    if has_bilat or (has_left and has_right):
        return "bilateral"
    if has_left:
        return "left"
    if has_right:
        return "right"
    if re.search(r"\b(center|central|midline|spine)\b", t):
        return "midline"
    if laterality_hint in ("left", "right", "bilateral", "midline"):
        return str(laterality_hint)
    return "unspecified"


def detect_anatomical_region(
    raw_text: str,
    laterality_hint: Optional[str] = None,
    has_clarification_context: bool = False,
) -> Dict[str, Any]:
    """Classify primary anatomical region, laterality, secondary joints, and ambiguity."""
    text = str(raw_text or "").strip()
    t_lower = text.lower()
    alpha_count = len(re.findall(r"[a-zA-Z]", text))

    matched_regions: List[str] = []
    for region_key, pat in _REGION_PATTERNS:
        if pat.search(t_lower):
            matched_regions.append(region_key)

    ambiguous_limb: Optional[str] = None
    if not matched_regions:
        for limb_name, pat in _AMBIGUOUS_LIMB_PATTERNS:
            if pat.search(t_lower):
                ambiguous_limb = limb_name
                break

    primary_region = matched_regions[0] if matched_regions else "other_unspecified"
    if primary_region == "other_unspecified" and ambiguous_limb == "back" and has_clarification_context:
        primary_region = "lumbar_lower_back"

    laterality = _detect_laterality(text, laterality_hint)
    is_vague = (
        not has_clarification_context
        and (alpha_count < 8 or primary_region == "other_unspecified" or ambiguous_limb is not None)
    )

    return {
        "primary_region": primary_region,
        "matched_regions": matched_regions,
        "ambiguous_limb": ambiguous_limb,
        "laterality": laterality,
        "alpha_count": alpha_count,
        "is_vague": is_vague,
    }


def build_clarification_questions(detection: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build up to 3 targeted clarification prompts when symptom input lacks specificity."""
    ambiguous = detection.get("ambiguous_limb")
    questions: List[Dict[str, Any]] = []

    if ambiguous == "leg":
        questions.append({
            "id": "q_leg_region",
            "prompt": "Which part of your leg is hurting most?",
            "quick_options": ["Knee / Kneecap", "Hamstring / Back of thigh", "Calf / Achilles / Ankle"],
        })
    elif ambiguous == "arm":
        questions.append({
            "id": "q_arm_region",
            "prompt": "Which joint or area of your arm is affected?",
            "quick_options": ["Shoulder", "Elbow / Forearm", "Wrist / Hand"],
        })
    elif ambiguous == "back":
        questions.append({
            "id": "q_back_region",
            "prompt": "Where along your back do you feel the symptoms?",
            "quick_options": ["Lower back (Lumbar)", "Upper / Mid back (Thoracic)", "Neck / Upper Traps"],
        })
    else:
        questions.append({
            "id": "q_body_region",
            "prompt": "Which specific joint or area feels uncomfortable?",
            "quick_options": ["Knee", "Lower back", "Shoulder"],
        })

    questions.append({
        "id": "q_trigger",
        "prompt": "When did the discomfort start or feel worst?",
        "quick_options": ["During heavy lifting", "After cardio / jumping", "Stiff waking up"],
    })
    return questions[:3]


def infer_affected_joints_and_restrictions(
    primary_region: str,
    matched_regions: Iterable[str],
    raw_text: str,
) -> Tuple[List[str], List[str]]:
    """Map anatomical region(s) + specific pain triggers onto Adaptor joints & movement restrictions."""
    joints: List[str] = []
    restrictions: List[str] = []

    regions = list(dict.fromkeys([primary_region] + list(matched_regions or ())))
    for reg in regions:
        spec = REGION_TO_ADAPTOR_MAP.get(reg)
        if not spec:
            continue
        for j in spec["affected_joints"]:
            if j not in joints:
                joints.append(j)
        for r in spec["movement_restrictions"]:
            if r not in restrictions:
                restrictions.append(r)

    t = str(raw_text or "").lower()
    # Refinement rules from Section 4.1
    if primary_region in ("hip_glute", "hamstring", "groin_adductor") and re.search(r"\b(squat|lunge|knee)\b", t):
        if "knees" not in joints:
            joints.append("knees")
        if "deep_knee_flexion" not in restrictions:
            restrictions.append("deep_knee_flexion")
    if primary_region == "cervical_neck" and re.search(r"\b(squat|deadlift|rdl|axial|back)\b", t):
        if "lumbar" not in joints:
            joints.append("lumbar")
    if re.search(r"\b(pull|row|deadlift|grip|carry)\b", t) and ("elbows" in joints or "wrists" in joints):
        if "heavy_grip_pull" not in restrictions:
            restrictions.append("heavy_grip_pull")

    return joints, restrictions


def enforce_safety_invariants(
    report: Dict[str, Any],
    red_flags: Dict[str, Any],
    existing_active_and_chronic_joints: Iterable[str],
    has_clarification_context: bool = False,
) -> Dict[str, Any]:
    """Post-process AI or deterministic report to guarantee clinical guardrails and schema safety."""
    cleaned = sanitize_report_strings(dict(report or {}))

    if has_clarification_context:
        cleaned["needs_clarification"] = False
        cleaned["clarification_questions"] = []

    region = cleaned.get("anatomical_region")
    if region not in ANATOMICAL_REGIONS:
        region = "other_unspecified"
    cleaned["anatomical_region"] = region

    laterality = cleaned.get("laterality")
    if laterality not in ("left", "right", "bilateral", "midline", "unspecified"):
        laterality = "unspecified"
    cleaned["laterality"] = laterality

    severity = cleaned.get("severity")
    if severity not in ("mild", "moderate", "severe"):
        severity = "moderate"
    cleaned["severity"] = severity

    triage_level = cleaned.get("triage_level")
    if triage_level not in ("green_modify", "amber_deload", "red_seek_care"):
        triage_level = "amber_deload" if severity in ("moderate", "severe") else "green_modify"

    # Merge AI red flags with deterministic red flags without ever allowing downgrade
    rf_out = dict(cleaned.get("red_flags") or {})
    if red_flags.get("triggered"):
        merged_flags = list(dict.fromkeys([*red_flags.get("flags", []), *(rf_out.get("flags") or [])]))
        rf_out = {
            "triggered": True,
            "deterministic_override": True,
            "flags": merged_flags[:5],
            "clinical_action": red_flags["clinical_action"],
            "training_clearance": "stop_and_evaluate",
        }
        triage_level = "red_seek_care"
        severity = "severe"
        cleaned["severity"] = severity
        cleaned["needs_clarification"] = False
        cleaned["clarification_questions"] = []
    else:
        ai_triggered = bool(rf_out.get("triggered"))
        rf_out["triggered"] = ai_triggered
        rf_out["deterministic_override"] = False
        rf_out["flags"] = [strip_markup(f) for f in (rf_out.get("flags") or []) if f][:5]
        rf_out["clinical_action"] = strip_markup(rf_out.get("clinical_action")) or red_flags["clinical_action"]
        tc = rf_out.get("training_clearance")
        if tc not in ("modified_allowed", "deload_only", "stop_and_evaluate"):
            tc = "stop_and_evaluate" if ai_triggered else ("deload_only" if triage_level == "amber_deload" else "modified_allowed")
        if ai_triggered:
            triage_level = "red_seek_care"
            tc = "stop_and_evaluate"
        rf_out["training_clearance"] = tc

    cleaned["triage_level"] = triage_level
    cleaned["severity"] = severity
    cleaned["red_flags"] = rf_out

    if not cleaned.get("clinical_disclaimer"):
        cleaned["clinical_disclaimer"] = CLINICAL_DISCLAIMER

    # Normalize & safety-filter adaptor_handoff against merged existing+new constraints
    if cleaned.get("needs_clarification"):
        cleaned["adaptor_handoff"] = None
    else:
        handoff = dict(cleaned.get("adaptor_handoff") or {})
        raw_joints = [j for j in dict.fromkeys(handoff.get("affected_joints") or []) if j in ALL_ADAPTOR_JOINTS]
        if not raw_joints and region in REGION_TO_ADAPTOR_MAP:
            raw_joints = list(REGION_TO_ADAPTOR_MAP[region]["affected_joints"])
        raw_restr = [r for r in dict.fromkeys(handoff.get("movement_restrictions") or []) if r in MOVEMENT_RESTRICTIONS]
        if not raw_restr and region in REGION_TO_ADAPTOR_MAP:
            raw_restr = list(REGION_TO_ADAPTOR_MAP[region]["movement_restrictions"])
        raw_ex_ids = [
            eid for eid in dict.fromkeys(handoff.get("restricted_exercise_ids") or [])
            if eid in EXERCISE_BIOMECHANICS or eid in LEGACY_EXERCISE_ALIASES
        ]

        merged_joints = list(dict.fromkeys([*existing_active_and_chronic_joints, *raw_joints]))
        safe_swaps = compute_safe_swaps_for_injuries(
            merged_joints,
            movement_restrictions=raw_restr,
            restricted_exercise_ids=raw_ex_ids,
            limit=5,
        )

        rest_rec = bool(handoff.get("rest_recommended")) or (triage_level == "red_seek_care") or (rf_out["training_clearance"] == "stop_and_evaluate")
        expires_hours = 168 if triage_level == "red_seek_care" else (72 if triage_level == "amber_deload" else 48)
        cleaned["adaptor_handoff"] = {
            "assessment_id": str(cleaned.get("assessment_id") or handoff.get("assessment_id") or ""),
            "affected_joints": raw_joints,
            "anatomical_region": region,
            "laterality": laterality,
            "severity": severity,
            "triage_level": triage_level,
            "movement_restrictions": raw_restr,
            "restricted_exercise_ids": raw_ex_ids,
            "recommended_swaps": safe_swaps,
            "rest_recommended": rest_rec,
            "merge_mode": "additive",
            "summary_note": strip_markup(handoff.get("summary_note") or cleaned.get("summary_headline") or "")[:300],
            "expires_hint_hours": int(handoff.get("expires_hint_hours") or expires_hours),
        }

    return cleaned

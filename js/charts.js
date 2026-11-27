// ==================== GARMIN CHARTS & TELEMETRY ENGINE ====================

function getGarminHrZoneBreakdown(act) {
  // 1. Check for real Garmin HR zones in seconds
  if (act && act.hr_zones && typeof act.hr_zones === 'object') {
    const hz = act.hr_zones;
    const z1 = Number(hz.z1 ?? hz['1'] ?? hz.zone1 ?? 0);
    const z2 = Number(hz.z2 ?? hz['2'] ?? hz.zone2 ?? 0);
    const z3 = Number(hz.z3 ?? hz['3'] ?? hz.zone3 ?? 0);
    const z4 = Number(hz.z4 ?? hz['4'] ?? hz.zone4 ?? 0);
    const z5 = Number(hz.z5 ?? hz['5'] ?? hz.zone5 ?? 0);
    const totalSec = z1 + z2 + z3 + z4 + z5;

    if (totalSec > 0) {
      const p1 = Math.round((z1 / totalSec) * 100);
      const p2 = Math.round((z2 / totalSec) * 100);
      const p3 = Math.round((z3 / totalSec) * 100);
      const p4 = Math.round((z4 / totalSec) * 100);
      const p5 = Math.round((z5 / totalSec) * 100);

      const formatSec = (s) => `${Math.floor(s / 60)}m ${s % 60 < 10 ? '0' : ''}${s % 60}s`;

      const zones = [
        { num: 5, name: "Maximum / Anaerobic", range: "> 171 bpm", pct: p5, durStr: formatSec(z5), color: "#ef4444" },
        { num: 4, name: "Threshold / Hard", range: "152–171 bpm", pct: p4, durStr: formatSec(z4), color: "#f59e0b" },
        { num: 3, name: "Aerobic / Moderate", range: "133–152 bpm", pct: p3, durStr: formatSec(z3), color: "#10b981" },
        { num: 2, name: "Easy / Fat Oxidation Base", range: "114–133 bpm", pct: p2, durStr: formatSec(z2), color: "#00F0FF" },
        { num: 1, name: "Warm Up / Active Recovery", range: "< 114 bpm", pct: p1, durStr: formatSec(z1), color: "#8b9db5" }
      ];

      let dominant = zones[0];
      zones.forEach(z => { if (z.pct > dominant.pct) dominant = z; });

      return {
        zones,
        dominantZoneText: 'Dominant: Z' + dominant.num + ' (' + dominant.durStr + ' • ' + dominant.pct + '%)'
      };
    }
  }

  // Fallback: Existing synthetic distribution
  const dur = act.durationMin || act.duration_min || 30;
  const avg = act.avgHr || act.avg_hr || 115;
  const max = act.maxHr || act.max_hr || 150;
  const text = `${act.name || ''} ${act.subTitle || act.sub_title || ''}`.toLowerCase();
  const isWalk = text.includes('walk') || text.includes('stroll');
  const isStrength = text.includes('strength') || text.includes('barbell') || text.includes('lift') || text.includes('gym');
  const isPlyo = text.includes('jump') || text.includes('plyo') || text.includes('tuck');

  let p1, p2, p3, p4, p5;
  if (isWalk || avg < 95) {
    p1 = 88; p2 = 12; p3 = 0; p4 = 0; p5 = 0;
  } else if (isStrength) {
    p1 = 22; p2 = 48; p3 = 22; p4 = 8; p5 = 0;
  } else if (isPlyo || max >= 162) {
    p1 = 10; p2 = 25; p3 = 35; p4 = 22; p5 = 8;
  } else if (avg <= 122) {
    p1 = 12; p2 = 58; p3 = 24; p4 = 6; p5 = 0;
  } else if (avg <= 135) {
    p1 = 8; p2 = 28; p3 = 46; p4 = 15; p5 = 3;
  } else {
    p1 = 5; p2 = 20; p3 = 35; p4 = 28; p5 = 12;
  }

  const formatMinSec = (fractionMinutes) => {
    const totalSec = Math.round(fractionMinutes * 60);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  };

  const zones = [
    { num: 5, name: "Maximum / Anaerobic", range: "> 171 bpm", pct: p5, durStr: formatMinSec(dur * p5 / 100), color: "#ef4444" },
    { num: 4, name: "Threshold / Hard", range: "152–171 bpm", pct: p4, durStr: formatMinSec(dur * p4 / 100), color: "#f59e0b" },
    { num: 3, name: "Aerobic / Moderate", range: "133–152 bpm", pct: p3, durStr: formatMinSec(dur * p3 / 100), color: "#10b981" },
    { num: 2, name: "Easy / Fat Oxidation Base", range: "114–133 bpm", pct: p2, durStr: formatMinSec(dur * p2 / 100), color: "#00F0FF" },
    { num: 1, name: "Warm Up / Active Recovery", range: "< 114 bpm", pct: p1, durStr: formatMinSec(dur * p1 / 100), color: "#8b9db5" }
  ];

  let dominant = zones[0];
  zones.forEach(z => { if (z.pct > dominant.pct) dominant = z; });

  return {
    zones,
    dominantZoneText: `Dominant: Z${dominant.num} (${dominant.durStr} • ${dominant.pct}%)`
  };
}

function generateHrSvgChart(act) {
  const dur = act.durationMin || act.duration_min || 30;
  let avg = act.avgHr || act.avg_hr || 119;
  let max = act.maxHr || act.max_hr || 151;

  let hrs = [];
  const hasRealStream = Array.isArray(act.hr_samples) && act.hr_samples.length >= 5;

  if (hasRealStream) {
    const raw = [];
    for (const item of act.hr_samples) {
      let val = null;
      if (typeof item === 'number') {
        val = item;
      } else if (item && typeof item === 'object') {
        val = item.hr ?? item.bpm ?? item.value;
      }
      val = Number(val);
      if (!isNaN(val) && val > 30 && val < 250) {
        raw.push(val);
      }
    }

    if (raw.length >= 5) {
      // If stream length > 80, sample up to 80 points evenly to keep SVG crisp
      if (raw.length > 80) {
        const step = (raw.length - 1) / 79;
        for (let i = 0; i < 80; i++) {
          const idx = Math.min(raw.length - 1, Math.round(i * step));
          hrs.push(raw[idx]);
        }
      } else {
        hrs = raw.slice();
      }

      // Find actual peak and average from real stream
      const sum = raw.reduce((acc, v) => acc + v, 0);
      avg = Math.round(sum / raw.length);
      max = Math.max(...raw);
    }
  }

  const isSynthetic = (hrs.length === 0);
  if (isSynthetic) {
    const pointsCount = 24;
    const minHr = Math.max(50, avg - 40);
    for (let i = 0; i < pointsCount; i++) {
      const progress = i / (pointsCount - 1);
      let hr;
      if (progress < 0.15) {
        hr = minHr + 15 + (avg - minHr - 15) * (progress / 0.15);
      } else if (progress < 0.85) {
        const phase = (progress - 0.15) / 0.70;
        const wave = Math.sin(phase * Math.PI * 6);
        const spike = Math.exp(-Math.pow((phase - 0.72) * 8, 2));
        hr = avg + wave * 9 + spike * (max - avg);
      } else {
        const coolPhase = (progress - 0.85) / 0.15;
        hr = avg - 5 - (avg - minHr - 10) * coolPhase;
      }
      hrs.push(Math.min(max, Math.max(minHr, hr)));
    }
    hrs[17] = max;
  }

  const minHr = Math.max(40, Math.min(...hrs, avg - 30));
  const ceilHr = Math.max(max + 12, 168);
  const range = Math.max(20, ceilHr - minHr);

  const pointsCount = hrs.length;
  const width = 360;
  const height = 130;
  const padL = 42;
  const padR = 14;
  const padT = 26;
  const padB = 28;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const pts = hrs.map((val, idx) => {
    const x = padL + (idx / (pointsCount - 1)) * chartW;
    const y = padT + (1 - (val - minHr) / range) * chartH;
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, hr: Math.round(val) };
  });

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];
    const midX = (curr.x + next.x) / 2;
    d += ` Q ${curr.x} ${curr.y}, ${midX} ${(curr.y + next.y) / 2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;

  const areaD = `${d} L ${last.x} ${height - padB} L ${pts[0].x} ${height - padB} Z`;
  const avgY = Math.round((padT + (1 - (avg - minHr) / range) * chartH) * 10) / 10;

  // Peak point marker
  let peakIdx = 0;
  let peakVal = hrs[0];
  hrs.forEach((v, i) => {
    if (v >= peakVal) {
      peakVal = v;
      peakIdx = i;
    }
  });
  const peakPt = pts[peakIdx] || pts[0];

  const streamLabel = !isSynthetic ? 'OPTICAL SENSOR STREAM (GARMIN)' : 'OPTICAL SENSOR MODEL';
  const gradId = `hrGrad_${String(act.id).replace(/[^a-zA-Z0-9]/g, '_')}`;
  const midMin = Math.round(dur / 2);

  return `
<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.38"/>
<stop offset="70%" stop-color="#3B82F6" stop-opacity="0.12"/>
<stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.0"/>
</linearGradient>
</defs>

      
<line x1="${padL}" y1="${padT}" x2="${width - padR}" y2="${padT}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${padL}" y1="${avgY}" x2="${width - padR}" y2="${avgY}" stroke="rgba(56,189,248,0.4)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

      
<text x="${padL - 4}" y="${avgY + 4}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">${avg}</text>
<text x="${padL - 4}" y="${padT + 10}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${ceilHr}</text>
<text x="${padL - 4}" y="${height - padB}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${minHr}</text>

      
<path d="${areaD}" fill="url(#${gradId})"/>

      
<path d="${d}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.5));"/>

      
<text x="${padL + 2}" y="${padT - 8}" fill="${!isSynthetic ? '#00F0FF' : 'var(--text-muted)'}" font-size="12.5" font-weight="800" letter-spacing="0.04em">${streamLabel}</text>

      
<text x="${width - padR}" y="${avgY - 5}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">Avg ${avg} bpm</text>

      
<circle cx="${peakPt.x}" cy="${peakPt.y}" r="4" fill="#ef4444" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(239,68,68,0.8));"/>
<circle cx="${peakPt.x}" cy="${peakPt.y}" r="7" fill="none" stroke="#ef4444" stroke-width="1" opacity="0.6"/>
<text x="${peakPt.x}" y="${Math.max(14, peakPt.y - 8)}" fill="#ef4444" font-size="12.5" font-weight="800" text-anchor="middle">Peak ${max}</text>

      
<text x="${padL}" y="${height - 6}" fill="var(--text-muted)" font-size="12.5">0:00</text>
<text x="${padL + chartW / 2}" y="${height - 6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${midMin}:00</text>
<text x="${width - padR}" y="${height - 6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${dur.toFixed(1)}m</text>
</svg>
  `;
}

function generateZoneBarsHtml(act) {
  const { zones } = getGarminHrZoneBreakdown(act);
  return zones.map(z => `
<div style="display:flex; flex-direction:column; gap:2px; margin-bottom:6px;">
<div style="display:flex; justify-content:space-between; font-size:10.5px; line-height:1.2;">
<span style="color:#d4d4d8; font-weight:600;">
<span style="color:${z.color}; font-weight:800;">Z${z.num}</span> ${z.name} <small style="color:var(--text-muted); font-size:9.5px;">(${z.range})</small>
</span>
<span style="color:#fff; font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums;">
          ${z.durStr} <small style="color:var(--text-muted);">(${z.pct}%)</small>
</span>
</div>
<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
<div style="height:100%; width:${z.pct}%; background:${z.color}; border-radius:3px; box-shadow:0 0 6px ${z.color}66;"></div>
</div>
</div>
  `).join('');
}

function generateTeDualGaugesHtml(act) {
  const rawAero = act.aerobicTe ?? act.aerobic_te;
  const rawAnaero = act.anaerobicTe ?? act.anaerobic_te;
  const aero = (rawAero !== undefined && rawAero !== null && !Number.isNaN(Number(rawAero))) ? Number(rawAero) : 0;
  const anaero = (rawAnaero !== undefined && rawAnaero !== null && !Number.isNaN(Number(rawAnaero))) ? Number(rawAnaero) : 0;

  const getTeFeedback = (score, isAnaero) => {
    if (score >= 4.5) return { label: "Overreaching", desc: isAnaero ? "High neuromuscular & PCr fatigue" : "Heavy aerobic strain requiring 48h rest", color: "#ef4444" };
    if (score >= 3.5) return { label: "Highly Improving", desc: isAnaero ? "Drastically expands glycolytic buffering" : "Major stimulus for VO2max expansion", color: "#f59e0b" };
    if (score >= 2.5) return { label: "Impacting / Building", desc: isAnaero ? "Improves anaerobic work tolerance" : "Stimulates aerobic base & stroke volume", color: "#10b981" };
    if (score >= 1.5) return { label: "Maintaining Base", desc: isAnaero ? "Minor anaerobic speed maintenance" : "Maintains aerobic fitness & mitochondrial density", color: "#00F0FF" };
    return { label: "Minor Recovery Stimulus", desc: "Active recovery flush with negligible debt", color: "#38bdf8" };
  };

  const aeroInfo = getTeFeedback(aero, false);
  const anaeroInfo = getTeFeedback(anaero, true);

  return `
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Aerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${aeroInfo.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${aero.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100, (aero / 5.0) * 100)}%; background:${aeroInfo.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${aeroInfo.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${aeroInfo.desc}</div>
</div>

      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Anaerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${anaeroInfo.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${anaero.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100, (anaero / 5.0) * 100)}%; background:${anaeroInfo.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${anaeroInfo.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${anaeroInfo.desc}</div>
</div>
</div>
  `;
}

function _parseActivityTimestampMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (!raw || typeof raw !== 'string') return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const norm = (trimmed.includes(' ') && !trimmed.includes('T')) ? trimmed.replace(' ', 'T') : trimmed;
  const ms = new Date(norm).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function _formatClockHHMM(ms) {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function _coerceSetWeightKg(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s || /^(body(?:weight)?|bw)$/.test(s)) return 0;
  const cleaned = s.replace(/^2\s*[×x]\s*/i, '').replace(/kg$/i, '').trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function _parsePulseLogWindowMs(timeStr, baseDateStr, prevMinMs) {
  if (!timeStr || typeof timeStr !== 'string') return { startMs: 0, endMs: 0 };
  const trimmed = timeStr.trim();
  const hm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hm && baseDateStr && /^\d{4}-\d{2}-\d{2}$/.test(baseDateStr)) {
    const [y, m, d] = baseDateStr.split('-').map(Number);
    let ms = new Date(y, m - 1, d, Number(hm[1]), Number(hm[2]), 0, 0).getTime();
    if (prevMinMs > 0 && (prevMinMs - ms) > 6 * 3600 * 1000) {
      ms += 24 * 3600 * 1000;
    }
    return { startMs: ms, endMs: ms + 59999 };
  }
  const parsed = _parseActivityTimestampMs(trimmed);
  return parsed > 0 ? { startMs: parsed, endMs: parsed + 59999 } : { startMs: 0, endMs: 0 };
}

function _garminCategoryMatchesPulseEx(garminLabel, pulseExId) {
  const g = String(garminLabel || '').toLowerCase();
  const p = String(pulseExId || '').toLowerCase();
  if (!g || !p) return 0;
  const patterns = [
    { g: /squat|lunge|split_squat|thruster/, p: /squat|lunge/ },
    { g: /bench|chest_press|floor_press|push_up|pushup|dip/, p: /bench|floor_press|pushup|dip|chest/ },
    { g: /deadlift|rdl|good_morning|hip_hinge|swing/, p: /rdl|deadlift|swing|hinge/ },
    { g: /row|pull_up|pullup|chin_up|lat_pull|curl/, p: /row|pullup|chin|curl/ },
    { g: /shoulder_press|overhead_press|military_press|z_press/, p: /press|z_press|ohp/ }
  ];
  let gHit = -1;
  let pHit = -1;
  patterns.forEach((pat, idx) => {
    if (pat.g.test(g) && gHit === -1) gHit = idx;
    if (pat.p.test(p) && pHit === -1) pHit = idx;
  });
  if (gHit === -1 || pHit === -1) return 0;
  return gHit === pHit ? 1 : -1;
}

// DECODER FOR GARMIN FĒNIX 8 EXERCISE SETS (milligrams/grams -> kg, TUT, clock windows & rest intervals)
function decodeGarminStrengthSets(act) {
  const rawSets = act && Array.isArray(act.exercise_sets) ? act.exercise_sets : [];
  if (!rawSets.length) return null;

  const actStartMs = _parseActivityTimestampMs(act.rawDate || act.date);
  let cursorMs = actStartMs;

  const activeSets = [];
  const restDurations = [];

  for (let i = 0; i < rawSets.length; i++) {
    const s = rawSets[i];
    if (!s || typeof s !== 'object') continue;
    const sType = String(s.set_type || s.setType || '').toUpperCase();
    const durRaw = Number(s.duration || 0);
    const dur = Math.round(durRaw);

    if (sType === 'REST') {
      if (dur > 0) restDurations.push(dur);
      if (cursorMs > 0 && durRaw > 0) {
        cursorMs += durRaw * 1000;
      }
      continue;
    }
    if (sType !== 'ACTIVE') continue;

    const explicitStartMs = _parseActivityTimestampMs(s.start_time || s.startTime);
    const startMs = explicitStartMs > 0 ? explicitStartMs : cursorMs;
    const endMs = (startMs > 0 && durRaw > 0) ? (startMs + durRaw * 1000) : startMs;
    if (startMs > 0) {
      cursorMs = endMs;
    }

    const rawWt = Number(s.weight || 0);
    const weightKg = rawWt >= 1000
      ? Math.round((rawWt / 1000) * 10) / 10
      : (rawWt > 0 ? Math.round(rawWt * 10) / 10 : 0);

    const rawReps = (s.reps !== undefined && s.reps !== null) ? s.reps : s.repetitionCount;
    const parsedReps = (rawReps !== undefined && rawReps !== null && rawReps !== '' && !isNaN(Number(rawReps)) && Number(rawReps) >= 0)
      ? Math.round(Number(rawReps))
      : null;

    // Look ahead for immediate REST interval following this active set
    let restAfterSec = 0;
    if (i + 1 < rawSets.length && rawSets[i + 1] && String(rawSets[i + 1].set_type || rawSets[i + 1].setType || '').toUpperCase() === 'REST') {
      restAfterSec = Math.round(Number(rawSets[i + 1].duration || 0));
    }

    activeSets.push({
      setNum: activeSets.length + 1,
      weightKg,
      weightLabel: weightKg > 0 ? `${weightKg}kg` : 'Bodyweight',
      shortWeightLabel: weightKg > 0 ? `${weightKg}kg` : 'BW',
      durationSec: dur,
      reps: parsedReps,
      exerciseId: s.exercise_id ? String(s.exercise_id) : '',
      exerciseName: s.exercise_name ? String(s.exercise_name).replace(/_/g, ' ') : '',
      exerciseCategory: s.exercise_category || s.category ? String(s.exercise_category || s.category).replace(/_/g, ' ') : '',
      role: s.role ? String(s.role) : '',
      pulseSetNum: (s.pulse_set_num !== undefined && s.pulse_set_num !== null) ? Number(s.pulse_set_num) : null,
      pulseWeightKg: (s.pulse_weight_kg !== undefined && s.pulse_weight_kg !== null) ? Number(s.pulse_weight_kg) : null,
      pulseReps: (s.pulse_reps !== undefined && s.pulse_reps !== null) ? Number(s.pulse_reps) : null,
      pulseTime: s.pulse_time ? String(s.pulse_time) : '',
      weightMismatch: (s.weight_mismatch && typeof s.weight_mismatch === 'object') ? s.weight_mismatch : null,
      restAfterSec,
      startMs,
      endMs,
      startClock: startMs > 0 ? _formatClockHHMM(startMs) : '',
      endClock: endMs > 0 ? _formatClockHHMM(endMs) : ''
    });
  }

  if (!activeSets.length) return null;

  const weightedSets = activeSets.filter(s => s.weightKg > 0);
  const peakWeightKg = weightedSets.length ? Math.max(...weightedSets.map(s => s.weightKg)) : 0;
  const peakWeightCount = peakWeightKg > 0 ? activeSets.filter(s => s.weightKg === peakWeightKg).length : 0;
  const avgRestSec = restDurations.length
    ? Math.round(restDurations.reduce((sum, d) => sum + d, 0) / restDurations.length)
    : 0;
  const totalTutSec = activeSets.reduce((sum, s) => sum + s.durationSec, 0);

  // Build contiguous weight-block summary (avoids mislabeling lighter exercises as warm-ups)
  const blocks = [];
  activeSets.forEach(s => {
    const key = s.weightKg > 0 ? String(s.weightKg) : 'BW';
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) {
      last.count += 1;
      last.totalDur += s.durationSec;
    } else {
      blocks.push({ key, weightKg: s.weightKg, count: 1, totalDur: s.durationSec });
    }
  });

  const workingSummaryParts = blocks.map((b, idx) => {
    if (b.weightKg === 0) {
      return `${b.count}×BW (${b.totalDur >= 60 ? `${b.totalDur}s core hold` : `${b.totalDur}s`})`;
    }
    const nextB = blocks[idx + 1];
    const isLeadingLightWarmup = Boolean(nextB && nextB.weightKg > 0 && b.count <= 2 && b.weightKg <= 0.78 * nextB.weightKg);
    if (isLeadingLightWarmup) {
      return `${b.count}×${b.weightKg}kg warm-up`;
    }
    return `${b.count}×${b.weightKg}kg`;
  });

  return {
    activeSets,
    activeCount: activeSets.length,
    peakWeightKg,
    peakWeightCount,
    avgRestSec,
    totalTutSec,
    workingSummary: workingSummaryParts.join(' • ')
  };
}
window.decodeGarminStrengthSets = decodeGarminStrengthSets;

function alignGarminSetsWithPulse(act, matchedPulse) {
  const decoded = decodeGarminStrengthSets(act);
  if (!decoded || !decoded.activeSets.length) return null;
  if (!matchedPulse || !matchedPulse.details || typeof matchedPulse.details !== 'object') return null;

  const allEx = (typeof getAllExercises === 'function') ? getAllExercises() : [];
  const baseDateMatch = String(act.rawDate || act.date || matchedPulse.date || '').match(/\d{4}-\d{2}-\d{2}/);
  const baseDateStr = baseDateMatch ? baseDateMatch[0] : '';

  const exOrder = [];
  const setsByExMap = {};
  Object.entries(matchedPulse.details).forEach(([k, s]) => {
    if (!s || !s.logged) return;
    const exId = String(s.exercise_id || String(k || '').replace(/_(?:wu)?\d+$/, '') || 'exercise');
    if (!setsByExMap[exId]) {
      const exObj = allEx.find(e => e.id === exId);
      const exName = exObj ? exObj.name : exId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      setsByExMap[exId] = { exId, exName, items: [] };
      exOrder.push(exId);
    }
    const wuMatch = String(k).match(/_wu(\d+)$/);
    const isExplicitWarmup = Boolean(s.explicit_warmup) || Boolean(wuMatch);
    const numMatch = String(k).match(/_(\d+)$/);
    const wuNum = Number(s.warmup_num || (wuMatch ? wuMatch[1] : setsByExMap[exId].items.length + 1));
    const setNum = isExplicitWarmup
      ? 0
      : Number(s.set_num || (numMatch ? numMatch[1] : setsByExMap[exId].items.length + 1));
    const sortKey = isExplicitWarmup ? wuNum : (1000 + setNum);
    setsByExMap[exId].items.push({ key: k, raw: s, setNum, isExplicitWarmup, sortKey });
  });

  const pulseSets = [];
  let prevMinMs = 0;
  exOrder.forEach((exId) => {
    const grp = setsByExMap[exId];
    grp.items.sort((a, b) => a.sortKey - b.sortKey);
    grp.items.forEach((item) => {
      const s = item.raw;
      const win = _parsePulseLogWindowMs(s.time, baseDateStr, prevMinMs);
      if (win.startMs > 0) prevMinMs = win.startMs;
      const wKg = _coerceSetWeightKg(s.weight);
      const repsVal = (s.reps !== undefined && s.reps !== null && !isNaN(Number(s.reps))) ? Math.round(Number(s.reps)) : 0;
      pulseSets.push({
        idx: pulseSets.length,
        key: item.key,
        exerciseId: exId,
        exerciseName: grp.exName,
        setNum: item.setNum,
        isExplicitWarmup: item.isExplicitWarmup,
        weightKg: wKg,
        weightLabel: wKg > 0 ? `${wKg}kg` : 'BW',
        reps: repsVal,
        timeStr: s.time || '',
        logMinStartMs: win.startMs,
        logMinEndMs: win.endMs,
        isWarmupFlag: Boolean(s.is_warmup || s.status === 'warmup')
      });
    });
  });

  if (!pulseSets.length) return null;

  const gSets = decoded.activeSets;
  const N = gSets.length;
  const M = pulseSets.length;

  function _pairScore(g, p) {
    let score = 0;
    if (g.endMs > 0 && p.logMinStartMs > 0) {
      let distMs = 0;
      if (g.endMs < p.logMinStartMs) distMs = p.logMinStartMs - g.endMs;
      else if (g.endMs > p.logMinEndMs) distMs = g.endMs - p.logMinEndMs;
      const distSec = distMs / 1000;
      if (distSec > 900) return -Infinity;
      if (distSec <= 15) score += 55;
      else if (distSec <= 45) score += 48;
      else if (distSec <= 90) score += 38;
      else if (distSec <= 180) score += 24;
      else if (distSec <= 360) score += 10;
      else score += -5 - (distSec - 360) / 30;
      if (g.startMs > 0 && p.logMinEndMs < (g.startMs - 30000)) {
        score -= 6;
      }
    } else {
      score += 20;
    }

    if (g.weightKg === 0 && p.weightKg === 0) {
      score += 30;
    } else if (g.weightKg > 0 && p.weightKg > 0) {
      const diff = Math.abs(g.weightKg - p.weightKg);
      const ratio = Math.min(g.weightKg, p.weightKg) / Math.max(g.weightKg, p.weightKg);
      if (diff <= 0.5) score += 40;
      else if (diff <= 2.5) score += 26;
      else if (ratio >= 0.85) score += 14;
      else if (ratio >= 0.65) score += 2;
      else score -= 28;
    } else {
      score -= 15;
    }

    if (g.reps !== null && p.reps > 0) {
      const repDiff = Math.abs(g.reps - p.reps);
      if (repDiff === 0) score += 20;
      else if (repDiff === 1) score += 12;
      else if (repDiff === 2) score += 5;
      else if (repDiff >= 5) score -= 6;
    }

    const catHint = _garminCategoryMatchesPulseEx(`${g.exerciseCategory} ${g.exerciseName}`, p.exerciseId);
    if (catHint > 0) score += 12;
    else if (catHint < 0) score -= 8;

    return score;
  }

  // Monotonic DP: dp[i][j] = max score aligning gSets[0..i-1] with pulseSets[0..j-1]
  const SKIP_PULSE_PENALTY = -18;
  const dp = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
  const choice = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0)); // 1=skipG, 2=skipP, 3=match

  for (let i = 1; i <= N; i++) {
    dp[i][0] = 0;
    choice[i][0] = 1;
  }
  for (let j = 1; j <= M; j++) {
    dp[0][j] = dp[0][j - 1] + SKIP_PULSE_PENALTY;
    choice[0][j] = 2;
  }

  for (let i = 1; i <= N; i++) {
    for (let j = 1; j <= M; j++) {
      const sSkipG = dp[i - 1][j];
      const sSkipP = dp[i][j - 1] + SKIP_PULSE_PENALTY;
      const ps = _pairScore(gSets[i - 1], pulseSets[j - 1]);
      const sMatch = ps > 0 ? (dp[i - 1][j - 1] + ps) : -Infinity;

      if (sMatch >= sSkipG && sMatch >= sSkipP) {
        dp[i][j] = sMatch;
        choice[i][j] = 3;
      } else if (sSkipG >= sSkipP) {
        dp[i][j] = sSkipG;
        choice[i][j] = 1;
      } else {
        dp[i][j] = sSkipP;
        choice[i][j] = 2;
      }
    }
  }

  const matchedByGarminIdx = new Array(N).fill(null);
  const unmatchedPulse = [];
  let i = N;
  let j = M;
  while (i > 0 || j > 0) {
    const ch = choice[i][j];
    if (i > 0 && j > 0 && ch === 3) {
      matchedByGarminIdx[i - 1] = pulseSets[j - 1];
      i--;
      j--;
    } else if (i > 0 && (j === 0 || ch === 1)) {
      i--;
    } else {
      unmatchedPulse.unshift(pulseSets[j - 1]);
      j--;
    }
  }

  // Group matched sets by Pulse exercise
  const groupByExId = {};
  const orderedGroups = [];
  exOrder.forEach((exId) => {
    const grp = {
      exerciseId: exId,
      exerciseName: setsByExMap[exId].exName,
      warmupSets: [],
      workingSets: [],
      extraSets: [],
      firstMatchedIdx: Infinity,
      lastMatchedIdx: -1,
      workingWeightKg: 0,
      firstPulseIsWarmup: setsByExMap[exId].items[0] ? Boolean(setsByExMap[exId].items[0].raw.is_warmup || setsByExMap[exId].items[0].raw.status === 'warmup') : false
    };
    groupByExId[exId] = grp;
    orderedGroups.push(grp);
  });

  const annotatedSets = gSets.map((g, gi) => {
    const p = matchedByGarminIdx[gi];
    if (!p) {
      return { ...g, garminIdx: gi, role: 'unmatched', pulseSet: null, weightMismatch: null, repDelta: null };
    }
    const weightMismatch = (g.weightKg > 0 && p.weightKg > 0 && Math.abs(g.weightKg - p.weightKg) > 2.5)
      ? { garminKg: g.weightKg, pulseKg: p.weightKg }
      : null;
    const repDelta = (g.reps !== null && p.reps > 0) ? (g.reps - p.reps) : null;
    const role = p.isExplicitWarmup ? 'warmup' : 'working';
    const item = { ...g, garminIdx: gi, role, exerciseId: p.exerciseId, exerciseName: p.exerciseName, pulseSet: p, weightMismatch, repDelta };
    const grp = groupByExId[p.exerciseId];
    if (grp) {
      if (p.isExplicitWarmup) {
        grp.warmupSets.push(item);
      } else {
        grp.workingSets.push(item);
        if (gi < grp.firstMatchedIdx) grp.firstMatchedIdx = gi;
        if (gi > grp.lastMatchedIdx) grp.lastMatchedIdx = gi;
      }
    }
    return item;
  });

  orderedGroups.forEach((grp) => {
    const posWeights = grp.workingSets.map(x => x.weightKg).filter(w => w > 0);
    if (posWeights.length > 0) {
      const sorted = [...posWeights].sort((a, b) => a - b);
      grp.workingWeightKg = sorted[Math.floor(sorted.length / 2)];
    } else if (grp.workingSets.length > 0) {
      grp.workingWeightKg = grp.workingSets[0].pulseSet.weightKg;
    }
  });

  const unmatchedSets = [];
  annotatedSets.forEach((item, gi) => {
    if (item.pulseSet) return;
    // Check if strictly inside an exercise's working span at matching load -> extra_set
    const enclosingGrp = orderedGroups.find(grp =>
      grp.workingSets.length > 0 &&
      gi > grp.firstMatchedIdx &&
      gi < grp.lastMatchedIdx &&
      (grp.workingWeightKg === 0 || Math.abs(item.weightKg - grp.workingWeightKg) <= 2.5)
    );
    if (enclosingGrp) {
      item.role = 'extra_set';
      item.exerciseId = enclosingGrp.exerciseId;
      item.exerciseName = enclosingGrp.exerciseName;
      enclosingGrp.extraSets.push(item);
      return;
    }

    // Check if immediately preceding an exercise's first matched set (no other exercise matched between gi and firstMatchedIdx)
    const nextGrp = orderedGroups
      .filter(grp => grp.workingSets.length > 0 && grp.firstMatchedIdx > gi)
      .sort((a, b) => a.firstMatchedIdx - b.firstMatchedIdx)[0];
    if (nextGrp) {
      const hasInterveningMatch = annotatedSets.slice(gi + 1, nextGrp.firstMatchedIdx).some(s => Boolean(s.pulseSet));
      const isLighterLoad = (item.weightKg > 0 && nextGrp.workingWeightKg > 0 && item.weightKg <= 0.78 * nextGrp.workingWeightKg) ||
        (item.weightKg === 0 && nextGrp.workingWeightKg > 0);
      if (!hasInterveningMatch && isLighterLoad) {
        item.role = 'warmup';
        item.exerciseId = nextGrp.exerciseId;
        item.exerciseName = nextGrp.exerciseName;
        nextGrp.warmupSets.push(item);
        return;
      }
    }

    item.role = 'unmatched';
    unmatchedSets.push(item);
  });

  const activeGroups = orderedGroups.filter(grp => grp.warmupSets.length > 0 || grp.workingSets.length > 0 || grp.extraSets.length > 0);
  const summaryParts = activeGroups.map((grp) => {
    const wuCount = grp.warmupSets.length;
    const wkList = grp.workingSets.concat(grp.extraSets);
    const wkCount = wkList.length;
    const wkWeight = grp.workingWeightKg > 0 ? `${grp.workingWeightKg}kg` : 'BW';
    const repsList = grp.workingSets.map(x => (x.pulseSet && x.pulseSet.reps > 0) ? x.pulseSet.reps : null).filter(r => r !== null);
    const repsSuffix = repsList.length ? ` (${repsList.join(',')}r)` : '';
    const parts = [];
    if (wuCount > 0) parts.push(`${wuCount} WU`);
    if (wkCount > 0) parts.push(`${wkCount}×${wkWeight}${repsSuffix}`);
    return `${grp.exerciseName}: ${parts.join(' + ')}`;
  });

  // Ensure every working annotatedSet carries its resolved exerciseName
  annotatedSets.forEach((item) => {
    if (item.pulseSet) {
      item.exerciseId = item.pulseSet.exerciseId;
      item.exerciseName = item.pulseSet.exerciseName;
    }
  });

  const matchedCount = annotatedSets.filter(s => s.role === 'working').length;
  const warmupCount = annotatedSets.filter(s => s.role === 'warmup').length;
  const extraCount = annotatedSets.filter(s => s.role === 'extra_set').length;
  const hasPerSetGarminReps = annotatedSets.some(s => s.reps !== null);
  const perSetRepSum = annotatedSets.reduce((sum, s) => sum + (s.reps || 0), 0);
  const garminTotalReps = Number(act.total_reps || 0) > 0
    ? Number(act.total_reps)
    : (hasPerSetGarminReps ? perSetRepSum : null);
  const pulseTotalReps = pulseSets.reduce((sum, p) => sum + (p.reps || 0), 0);
  const inferredWarmupReps = (garminTotalReps !== null && garminTotalReps > pulseTotalReps && (warmupCount + extraCount + unmatchedSets.length) > 0)
    ? (garminTotalReps - pulseTotalReps)
    : 0;

  return {
    decoded,
    annotatedSets,
    exerciseGroups: activeGroups,
    unmatchedSets,
    unmatchedPulse,
    matchedCount,
    warmupCount,
    extraCount,
    hasPerSetGarminReps,
    garminTotalReps,
    pulseTotalReps,
    inferredWarmupReps,
    matchedSummary: summaryParts.join(' • ')
  };
}
window.alignGarminSetsWithPulse = alignGarminSetsWithPulse;

function _buildAlignedFromBackendEnrichedSets(act, decoded) {
  if (!decoded || !Array.isArray(decoded.activeSets) || !decoded.activeSets.length) return null;
  const hasEnriched = decoded.activeSets.some(s => s.exerciseId && s.role);
  if (!hasEnriched) return null;

  const groupMap = {};
  const orderedGroups = [];
  const unmatchedSets = [];
  const annotatedSets = [];

  decoded.activeSets.forEach((s, gi) => {
    const exId = s.exerciseId || '';
    const exName = s.exerciseName || (exId ? exId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '');
    const role = s.role || (exId ? 'working' : 'unmatched');

    let pulseSet = null;
    let repDelta = null;
    if (role === 'working' && exId) {
      const pReps = s.pulseReps !== null ? s.pulseReps : (s.reps !== null ? s.reps : 0);
      pulseSet = {
        exerciseId: exId,
        exerciseName: exName,
        setNum: s.pulseSetNum || 1,
        weightKg: s.pulseWeightKg !== null ? s.pulseWeightKg : s.weightKg,
        reps: pReps,
        timeStr: s.pulseTime || ''
      };
      if (s.reps !== null && pReps > 0) {
        repDelta = s.reps - pReps;
      }
    }

    const normMismatch = s.weightMismatch
      ? {
          garminKg: s.weightMismatch.garminKg ?? s.weightMismatch.garmin_kg,
          pulseKg: s.weightMismatch.pulseKg ?? s.weightMismatch.pulse_kg
        }
      : null;

    const item = {
      ...s,
      garminIdx: gi,
      role,
      exerciseId: exId,
      exerciseName: exName,
      pulseSet,
      repDelta,
      weightMismatch: normMismatch
    };
    annotatedSets.push(item);

    if (exId && (role === 'warmup' || role === 'working' || role === 'extra_set')) {
      if (!groupMap[exId]) {
        groupMap[exId] = {
          exerciseId: exId,
          exerciseName: exName,
          warmupSets: [],
          workingSets: [],
          extraSets: [],
          workingWeightKg: 0
        };
        orderedGroups.push(groupMap[exId]);
      }
      if (role === 'warmup') groupMap[exId].warmupSets.push(item);
      else if (role === 'extra_set') groupMap[exId].extraSets.push(item);
      else groupMap[exId].workingSets.push(item);
    } else {
      unmatchedSets.push(item);
    }
  });

  const summaryParts = orderedGroups.map((grp) => {
    const posW = grp.workingSets.map(x => x.weightKg).filter(w => w > 0).sort((a, b) => a - b);
    grp.workingWeightKg = posW.length ? posW[Math.floor(posW.length / 2)] : (grp.workingSets[0]?.pulseSet?.weightKg || 0);
    const wuCount = grp.warmupSets.length;
    const wkCount = grp.workingSets.length + grp.extraSets.length;
    const wkWeight = grp.workingWeightKg > 0 ? `${grp.workingWeightKg}kg` : 'BW';
    const repsList = grp.workingSets.map(x => (x.pulseSet && x.pulseSet.reps > 0) ? x.pulseSet.reps : null).filter(r => r !== null);
    const repsSuffix = repsList.length ? ` (${repsList.join(',')}r)` : '';
    const parts = [];
    if (wuCount > 0) parts.push(`${wuCount} WU`);
    if (wkCount > 0) parts.push(`${wkCount}×${wkWeight}${repsSuffix}`);
    return `${grp.exerciseName}: ${parts.join(' + ')}`;
  });

  const matchedCount = annotatedSets.filter(s => s.role === 'working').length;
  const warmupCount = annotatedSets.filter(s => s.role === 'warmup').length;
  const extraCount = annotatedSets.filter(s => s.role === 'extra_set').length;
  const hasPerSetGarminReps = annotatedSets.some(s => s.reps !== null);
  const perSetRepSum = annotatedSets.reduce((sum, s) => sum + (s.reps || 0), 0);
  const garminTotalReps = Number(act.total_reps || 0) > 0 ? Number(act.total_reps) : (hasPerSetGarminReps ? perSetRepSum : null);
  const pulseTotalReps = annotatedSets.reduce((sum, s) => sum + (s.pulseSet ? (s.pulseSet.reps || 0) : 0), 0);
  const inferredWarmupReps = (garminTotalReps !== null && garminTotalReps > pulseTotalReps && (warmupCount + extraCount + unmatchedSets.length) > 0)
    ? (garminTotalReps - pulseTotalReps)
    : 0;

  return {
    decoded,
    annotatedSets,
    exerciseGroups: orderedGroups,
    unmatchedSets,
    unmatchedPulse: [],
    matchedCount,
    warmupCount,
    extraCount,
    hasPerSetGarminReps,
    garminTotalReps,
    pulseTotalReps,
    inferredWarmupReps,
    matchedSummary: act.matched_exercises_summary || summaryParts.join(' • ')
  };
}

// RENDER COMPLETED WORKOUTS & PHYSIOLOGICAL BENEFITS LIST (EGM OVERHAUL WITH GARMIN CHARTS)
function renderHistoryList() {
  const box = document.getElementById('trainViewHistory');
  if (!box) return;

  const activities = (typeof recentActivitiesData !== 'undefined' && Array.isArray(recentActivitiesData))
    ? recentActivitiesData
    : ((window.BAKED_LIVE_STATE && window.BAKED_LIVE_STATE.garmin && Array.isArray(window.BAKED_LIVE_STATE.garmin.recent_activities))
        ? window.BAKED_LIVE_STATE.garmin.recent_activities
        : []);

  const histTabBtn = document.getElementById('btnTrainHistory');
  if (histTabBtn) {
    histTabBtn.innerText = `History (${activities.length})`;
  }

  const esc = (typeof escapeHtml === 'function' ? escapeHtml : (v => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]))));

  box.innerHTML = '';

  const pulseMatchMap = (typeof buildGarminPulseMatchMap === 'function') ? buildGarminPulseMatchMap(activities) : null;

  activities.forEach(act => {
    const formatted = typeof formatActivityDisplay === 'function' ? formatActivityDisplay(act) : { isToday: false, displayDate: act.date || '' };
    const isToday = formatted.isToday;
    const displayDate = formatted.displayDate;
    const egm = typeof getEgmWorkoutBreakdown === 'function' ? getEgmWorkoutBreakdown(act, isToday) : { recoveryPill: '', primaryTakeaway: '', achievements: [], stressors: [], recoveryProtocol: [] };
    const hrZonesData = getGarminHrZoneBreakdown(act);

    const hasRealSamples = Array.isArray(act.hr_samples) && act.hr_samples.length >= 5;
    const sensorHeaderLabel = hasRealSamples ? 'OPTICAL SENSOR STREAM (GARMIN)' : 'OPTICAL SENSOR MODEL';

    const matchedPulse = pulseMatchMap
      ? (pulseMatchMap.get(String(act.id)) || null)
      : ((typeof getMatchedPulseSessionForGarmin === 'function') ? getMatchedPulseSessionForGarmin(act, activities) : null);
    const decodedSets = decodeGarminStrengthSets(act);
    const alignedSets = (decodedSets && matchedPulse)
      ? alignGarminSetsWithPulse(act, matchedPulse)
      : (decodedSets ? _buildAlignedFromBackendEnrichedSets(act, decodedSets) : null);
    const pulseSessId = matchedPulse ? String(matchedPulse.id || matchedPulse.client_event_id || '') : '';
    const pulseSessDate = matchedPulse ? String(matchedPulse.dateStr || String(matchedPulse.date || '').slice(0, 10)) : '';

    let pulseDetailsHtml = '';
    let pulseLoggedSummaries = [];
    if (matchedPulse) {
      let sessionName = matchedPulse.title || '';
      if (!sessionName) {
        if (matchedPulse.preset === 'gym') sessionName = 'Option A: Heavy Barbell Strength & Hinge';
        else if (matchedPulse.preset === 'combat') sessionName = 'Option B: Hybrid Work Capacity Circuit';
        else sessionName = 'Pulse Strength Session';
      }

      const garminStats = [
        act.total_sets ? `${act.total_sets} Garmin Sets` : (matchedPulse.setsLogged ? `${matchedPulse.setsLogged} Sets Logged` : ''),
        act.avgHr ? `${act.avgHr} bpm HR` : '',
        act.calories ? `${act.calories} kcal` : ''
      ].filter(Boolean).join(' • ');

      let exerciseRows = '';
      if (matchedPulse.details && typeof matchedPulse.details === 'object') {
        const setsByEx = {};
        const exOrder = [];
        const allEx = (typeof getAllExercises === 'function') ? getAllExercises() : [];
        Object.entries(matchedPulse.details).forEach(([k, s]) => {
          if (!s || !s.logged) return;
          const exId = s.exercise_id || String(k || '').replace(/_(?:wu)?\d+$/, '') || 'exercise';
          if (!setsByEx[exId]) {
            const exObj = allEx.find(e => e.id === exId);
            setsByEx[exId] = {
              exId,
              name: exObj ? exObj.name : exId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              sets: [],
              plainSets: []
            };
            exOrder.push(exId);
          }
          const wuM = String(k).match(/_wu(\d+)$/);
          const isExplicitWu = Boolean(s.explicit_warmup) || Boolean(wuM);
          const numM = String(k).match(/_(\d+)$/);
          const wuNum = Number(s.warmup_num || (wuM ? wuM[1] : setsByEx[exId].sets.length + 1));
          const setNum = isExplicitWu ? 0 : Number(s.set_num || (numM ? numM[1] : setsByEx[exId].sets.length + 1));
          const sortKey = isExplicitWu ? wuNum : (1000 + setNum);
          const isBw = s.weight === 'Bodyweight' || s.weight === 'Body' || s.weight === 0 || s.weight === '0';
          const wNum = isBw ? 0 : Number(String(s.weight ?? '').replace(/^2\s*[×x]\s*/i, '').replace(/kg$/i, ''));
          const wStr = (!isBw && s.weight !== undefined && s.weight !== null && s.weight !== '') ? `${s.weight}kg` : (isBw ? 'BW' : '');
          const rNum = Number(s.reps || 0);
          const rStr = `${rNum}r`;
          const labelStr = wStr ? `${wStr} × ${rStr}` : rStr;
          setsByEx[exId].sets.push({
            detailKey: k,
            sortKey,
            isExplicitWu,
            wNum: Number.isFinite(wNum) ? wNum : 0,
            rNum: Number.isFinite(rNum) ? rNum : 0,
            labelStr
          });
          setsByEx[exId].plainSets.push(isExplicitWu ? `WU ${labelStr}` : labelStr);
        });

        const exEntries = exOrder.map(id => setsByEx[id]);
        pulseLoggedSummaries = exEntries.map(e => `${esc(e.name)} (${esc(e.plainSets.join(', '))})`);
        if (exEntries.length > 0) {
          exerciseRows = `
<div style="margin-top:6px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:4px; font-size:10.5px;">
              ${exEntries.map(e => {
                e.sets.sort((a, b) => a.sortKey - b.sortKey);
                const alignedGrp = (alignedSets && Array.isArray(alignedSets.exerciseGroups))
                  ? alignedSets.exerciseGroups.find(g => g.exerciseId === e.exId)
                  : null;
                const mismatchByKey = {};
                if (alignedGrp && Array.isArray(alignedGrp.workingSets)) {
                  alignedGrp.workingSets.forEach(ws => {
                    if (ws.weightMismatch && ws.pulseSet && ws.pulseSet.key) {
                      mismatchByKey[ws.pulseSet.key] = ws.weightMismatch.garminKg;
                    }
                  });
                }
                const unloggedWuChips = (alignedGrp && Array.isArray(alignedGrp.warmupSets))
                  ? alignedGrp.warmupSets.filter(w => !w.pulseSet).map(w => {
                      const wuWt = w.weightKg > 0 ? `${w.weightKg}kg` : 'BW';
                      const wuReps = w.reps !== null ? ` × ${w.reps}r` : '';
                      return `<span title="Warm-up recorded on Garmin watch" style="display:inline-flex; align-items:center; gap:2px; font-size:9.5px; font-family:var(--font-mono); font-weight:700; padding:1px 5px; border-radius:4px; background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.45); color:#fbbf24;">🔥 WU ${esc(wuWt)}${esc(wuReps)} ⌚</span>`;
                    }).join('')
                  : '';

                const setChipsHtml = e.sets.map(st => {
                  const watchKgOpt = mismatchByKey[st.detailKey] !== undefined ? String(mismatchByKey[st.detailKey]) : '';
                  const isMismatch = watchKgOpt !== '';
                  const chipStyle = st.isExplicitWu
                    ? 'background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.45); color:#fbbf24;'
                    : (isMismatch
                      ? 'background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.55); color:#fde68a;'
                      : 'background:rgba(0,229,255,0.08); border:1px solid rgba(0,229,255,0.22); color:var(--cyan);');
                  const prefix = st.isExplicitWu ? '🔥 WU ' : '';
                  return `<button type="button" data-sess-id="${esc(pulseSessId)}" data-sess-date="${esc(pulseSessDate)}" data-detail-key="${esc(st.detailKey)}" data-ex-name="${esc(e.name)}" data-weight="${esc(st.wNum)}" data-reps="${esc(st.rNum)}" data-watch-weight="${esc(watchKgOpt)}" onclick="openEditHistorySetModal(this.dataset.sessId, this.dataset.sessDate, this.dataset.detailKey, this.dataset.exName, Number(this.dataset.weight), Number(this.dataset.reps), this.dataset.watchWeight)" title="Tap to edit weight or reps" style="cursor:pointer; font-family:var(--font-mono); font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px; ${chipStyle}">${prefix}${esc(st.labelStr)} ✎</button>`;
                }).join('');

                return `
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 7px;">
<div style="font-weight:700; color:#fff; margin-bottom:4px;">${esc(e.name)}</div>
<div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${unloggedWuChips}${setChipsHtml}</div>
</div>
              `;
              }).join('')}
</div>
          `;
        }
      } else if (matchedPulse.conditioningDrill) {
        const cd = matchedPulse.conditioningDrill;
        const durMin = cd.totalSeconds ? `${Math.round(cd.totalSeconds / 60)}m` : '';
        exerciseRows = `
<div style="margin-top:6px; font-size:10.5px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 8px;">
<span style="font-weight:700; color:#fff;">${esc(cd.name || 'Conditioning')}:</span>
<span style="color:var(--cyan); font-family:var(--font-mono); font-size:10px; margin-left:4px;">${esc(String(cd.format || 'interval').toUpperCase())} • ${cd.roundsCompleted || cd.rounds || 1} rounds ${durMin ? `(${durMin})` : ''}</span>
</div>
        `;
      }

      pulseDetailsHtml = `
<div style="margin:6px 0 8px; padding:8px 10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:9.5px; font-weight:800; background:rgba(16,185,129,0.22); border:1px solid #10b981; color:#10b981; padding:2px 6px; border-radius:4px; letter-spacing:0.04em;">🔗 MATCHED WITH PULSE</span>
<span style="font-size:11.5px; font-weight:800; color:#fff;">${esc(sessionName)}</span>
</div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${garminStats ? `<span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono);">${esc(garminStats)}</span>` : ''}
              <button type="button" class="header-pill-btn" data-act-id="${esc(act.id)}" onclick="unlinkGarminPulseMatch(this.dataset.actId)" title="Unlink Pulse session from this Garmin recording" style="padding:1px 6px; font-size:9.5px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:var(--text-secondary); cursor:pointer;">✕ Unlink</button>
            </div>
</div>
          ${exerciseRows}
</div>
      `;
    }

    let garminStrengthSetsHtml = '';
    if (decodedSets) {
      const avgRestBadge = decodedSets.avgRestSec > 0 ? ` • Avg Rest ${decodedSets.avgRestSec}s` : '';
      let headerMeta = '';
      let summaryLine = decodedSets.workingSummary;
      let setsGridHtml = '';

      if (alignedSets) {
        const matchParts = [`${alignedSets.matchedCount} Matched`];
        if (alignedSets.warmupCount > 0) {
          matchParts.push(`${alignedSets.warmupCount} Warm-up${alignedSets.warmupCount === 1 ? '' : 's'}`);
        }
        if (alignedSets.extraCount > 0) {
          matchParts.push(`${alignedSets.extraCount} Extra`);
        }
        headerMeta = `${decodedSets.activeCount} Active Sets • ${matchParts.join(' + ')}${avgRestBadge}`;
        summaryLine = alignedSets.matchedSummary || decodedSets.workingSummary;

        const renderAlignedSetCard = (s, fallbackExName = '') => {
          const clockRange = (s.startClock && s.endClock) ? `${s.startClock}–${s.endClock}` : '';
          const restTxt = s.restAfterSec > 0 ? ` • ${s.restAfterSec}s Rest` : '';
          const setExName = s.exerciseName || fallbackExName || (s.pulseSet && s.pulseSet.exerciseName) || '';
          if (s.role === 'warmup') {
            return `
<div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.32); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
<strong style="color:#fbbf24;">🔥 ${setExName ? `${esc(setExName)} • ` : ''}WARM-UP (G${s.setNum}): ${s.weightKg === 0 ? 'BW' : esc(s.weightLabel)}</strong>
${s.reps !== null ? `<span style="color:#fbbf24; font-weight:700;">⌚ ${esc(s.reps)}r</span>` : `<span style="color:#fbbf24; font-weight:700;">Unlogged</span>`}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${clockRange ? `${esc(clockRange)} • ` : ''}${s.durationSec}s TUT${restTxt}
</div>
</div>`;
          }
          if (s.pulseSet) {
            const p = s.pulseSet;
            const repPill = s.reps !== null
              ? (s.repDelta === 0
                ? `<span style="color:#10b981; font-weight:700;">⌚ ${esc(s.reps)}r ✓</span>`
                : `<span style="color:#fbbf24; font-weight:700;">⌚ ${esc(s.reps)}r vs 📱 ${esc(p.reps)}r</span>`)
              : '';
            const mismatchPill = s.weightMismatch
              ? `<div style="margin-top:3px; display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; color:#fbbf24; font-weight:700;">
<span>⚠️ Watch ${esc(s.weightMismatch.garminKg)}kg vs App ${esc(s.weightMismatch.pulseKg)}kg</span>
${(matchedPulse && p.key) ? `<button type="button" data-sess-id="${esc(pulseSessId)}" data-sess-date="${esc(pulseSessDate)}" data-detail-key="${esc(p.key)}" data-watch-wt="${esc(s.weightMismatch.garminKg)}" data-reps="${esc(p.reps)}" onclick="quickApplyWatchWeightToPulseSet(this.dataset.sessId, this.dataset.sessDate, this.dataset.detailKey, Number(this.dataset.watchWt), Number(this.dataset.reps))" style="cursor:pointer; font-family:var(--font-mono); font-size:9.5px; font-weight:800; padding:2px 6px; border-radius:4px; background:rgba(245,158,11,0.22); border:1px solid rgba(245,158,11,0.55); color:#fde68a;">⚡ Use Watch ${esc(s.weightMismatch.garminKg)}kg</button>` : ''}
</div>`
              : '';
            return `
<div style="background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.24); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
<strong style="color:#fff;">${setExName ? `${esc(setExName)} • ` : ''}Set ${esc(p.setNum)} (G${s.setNum}): ${s.weightKg === 0 ? 'BW' : esc(s.weightLabel)} × ${esc(p.reps)}r</strong>
${repPill}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${clockRange ? `${esc(clockRange)} • ` : ''}${s.durationSec}s TUT${restTxt}${p.timeStr ? ` • 📱 ${esc(p.timeStr)}` : ''}
</div>
${mismatchPill}
</div>`;
          }
          return `
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
<strong style="color:#cbd5e1;">${setExName ? `${esc(setExName)} • ` : ''}${s.role === 'extra_set' ? 'Extra Set' : 'Unmatched'} (G${s.setNum}): ${s.weightKg === 0 ? 'BW Hold' : esc(s.weightLabel)}</strong>
${s.reps !== null ? `<span style="color:var(--primary); font-weight:700;">⌚ ${esc(s.reps)}r</span>` : ''}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${clockRange ? `${esc(clockRange)} • ` : ''}${s.durationSec}s TUT${restTxt}
</div>
</div>`;
        };

        const groupBlocksHtml = alignedSets.exerciseGroups.map(grp => {
          const allGrpSets = [...grp.warmupSets, ...grp.workingSets, ...grp.extraSets]
            .sort((a, b) => a.garminIdx - b.garminIdx);
          return `
<div style="margin-bottom:8px;">
<div style="font-size:10.5px; font-weight:800; color:#e2e8f0; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
<span>🏋️ ${esc(grp.exerciseName)}</span>
<span style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono);">${grp.warmupSets.length > 0 ? `${grp.warmupSets.length} WU + ` : ''}${grp.workingSets.length + grp.extraSets.length} working</span>
</div>
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:5px;">
${allGrpSets.map(s => renderAlignedSetCard(s, grp.exerciseName)).join('')}
</div>
</div>`;
        }).join('');

        const unmatchedHtml = alignedSets.unmatchedSets.length > 0 ? `
<div style="margin-bottom:6px;">
<div style="font-size:10px; font-weight:800; color:var(--text-muted); margin-bottom:4px;">Other Watch Sets</div>
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:5px;">
${alignedSets.unmatchedSets.map(renderAlignedSetCard).join('')}
</div>
</div>` : '';

        const repReconParts = [];
        if (alignedSets.garminTotalReps !== null) repReconParts.push(`⌚ ${alignedSets.garminTotalReps} Garmin reps`);
        repReconParts.push(`📱 ${alignedSets.pulseTotalReps} Pulse reps`);
        if (alignedSets.inferredWarmupReps > 0) {
          repReconParts.push(`🔥 ~${alignedSets.inferredWarmupReps} warm-up/unlogged reps`);
        }
        const repReconHtml = `
<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5; font-family:var(--font-mono);">
<strong style="color:#10b981;">🔗 Rep Reconciliation:</strong> ${esc(repReconParts.join(' • '))}
</div>`;

        setsGridHtml = `${groupBlocksHtml}${unmatchedHtml}${repReconHtml}`;
      } else {
        const peakBadge = decodedSets.peakWeightKg > 0
          ? `Peak Load ${decodedSets.peakWeightKg}kg (${decodedSets.peakWeightCount} working ${decodedSets.peakWeightCount === 1 ? 'set' : 'sets'})`
          : 'Bodyweight / Core';
        headerMeta = `${decodedSets.activeCount} Active Sets • ${peakBadge}${avgRestBadge}`;
        const pulseCrossRefHtml = pulseLoggedSummaries.length > 0
          ? `<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5;">
<strong style="color:#10b981;">🔗 Pulse Rep Cross-Reference:</strong> ${pulseLoggedSummaries.join(' • ')}
</div>`
          : '';
        setsGridHtml = `
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:5px;">
                ${decodedSets.activeSets.map(s => `
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center;">
<strong style="color:#fff;">Set ${s.setNum}: ${s.weightKg === 0 ? 'BW Hold' : esc(s.weightLabel)}</strong>
                      ${s.reps !== null ? `<span style="color:var(--primary); font-weight:700;">${esc(s.reps)} reps</span>` : ''}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
                      ${s.startClock ? `${esc(s.startClock)} • ` : ''}${s.durationSec}s TUT${s.restAfterSec > 0 ? ` • ${s.restAfterSec}s Rest` : ''}
</div>
</div>
                `).join('')}
</div>
              ${pulseCrossRefHtml}`;
      }

      garminStrengthSetsHtml = `
<div style="margin:6px 0 8px; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.24); border-radius:9px; padding:8px 10px;">
          
<div style="font-size:10.5px; font-weight:800; color:var(--cyan); letter-spacing:0.02em;">
            ⌚ GARMIN FĒNIX 8 SET TELEMETRY: <span style="color:#fff;">${esc(headerMeta)}</span>
</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:3px; font-family:var(--font-mono);">
            ${esc(summaryLine)}
</div>
          
<details style="margin-top:6px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.07); border-radius:7px; overflow:hidden;">
<summary style="font-size:10.5px; font-weight:700; color:var(--text-secondary); padding:6px 9px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>🔬 View All ${decodedSets.activeCount} Garmin Watch Sets &amp; Rest Intervals (${decodedSets.totalTutSec}s TUT)</span>
<span style="color:var(--text-muted);">▾</span>
</summary>
<div style="padding:8px 9px; border-top:1px solid rgba(255,255,255,0.06);">
              ${setsGridHtml}
</div>
</details>
</div>
      `;
    }

    const rawTitle = act.subTitle || act.sub_title || act.name || 'Workout';
    const isGenericGarminTitle = /^(cardio|indoor_cardio|cardio_training|hiit|hiit_training|strength|strength_training|fitness_equipment)$/i.test(String(rawTitle).trim());
    const displayTitle = (isGenericGarminTitle && matchedPulse && matchedPulse.title)
      ? `${matchedPulse.title} (Garmin ${rawTitle})`
      : rawTitle;
    const isManualEntry = act.source === 'manual_app_entry';
    const unclaimedPulse = (!matchedPulse && !isManualEntry && typeof getUnclaimedPulseSessionsForActivity === 'function')
      ? getUnclaimedPulseSessionsForActivity(act, activities, pulseMatchMap)
      : [];
    const linkPulseBtnHtml = unclaimedPulse.length > 0
      ? `<button type="button" class="header-pill-btn" data-act-id="${esc(act.id)}" data-session-key="${esc(unclaimedPulse[0]._matchKey)}" onclick="linkGarminPulseMatch(this.dataset.actId, this.dataset.sessionKey)" title="Link ${esc(unclaimedPulse[0].title || 'Pulse Workout')}" style="padding:3px 8px; font-size:11px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); color:#10b981; cursor:pointer;">🔗 Link Pulse</button>`
      : '';

    const normDurationMin = act.durationMin ?? act.duration_min ?? 0;
    const normAvgHr = act.avgHr ?? act.avg_hr ?? null;
    const normMaxHr = act.maxHr ?? act.max_hr ?? null;
    const normAeroTe = Number(act.aerobicTe ?? act.aerobic_te ?? 0);
    const normAnaeroTe = Number(act.anaerobicTe ?? act.anaerobic_te ?? 0);
    const isWalkOrRunAct = /walk|run|ruck|hike/i.test(`${act.name || ''} ${rawTitle} ${act.activity_type_key || ''}`);
    const estSteps = act.steps ? Number(act.steps) : (isWalkOrRunAct && normDurationMin ? Math.round(Number(normDurationMin) * 91.5) : 0);
    const estMiles = act.distance_miles ? Number(act.distance_miles) : (estSteps > 0 ? Number((estSteps / 1810).toFixed(2)) : 0);
    const actStepPillHtml = (isWalkOrRunAct && estSteps > 0)
      ? `<span>•</span><span style="color:var(--cyan); font-weight:700;">👣 ${estSteps.toLocaleString()} activity steps${estMiles > 0 ? ` (${estMiles} mi)` : ''}</span>`
      : '';

    const card = document.createElement('div');
    card.className = `history-card ${isToday ? 'today-highlight' : ''}`;
    card.style.background = isToday ? '#141a24' : '#11141c';
    card.style.border = isToday ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid rgba(255,255,255,0.08)';
    card.style.borderRadius = '14px';
    card.style.padding = '12px 14px';

    card.innerHTML = `
      
<div class="history-top-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
<div>
<div class="history-title" style="font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px;">
            ${esc(displayTitle)}
</div>
<div class="history-meta-row" style="font-size:11.5px; color:var(--text-muted); margin-top:2px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
<span>${esc(displayDate)}</span>
<span>•</span>
<span>⏱ ${normDurationMin} min</span>
<span>•</span>
<span style="color:var(--primary); font-weight:800;">🔥 ${act.calories || 0} kcal</span>
            ${actStepPillHtml}
</div>
</div>
<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${isToday ? '<span style="font-size:10px; font-weight:900; color:var(--primary); background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.3); padding:2px 7px; border-radius:4px; letter-spacing:0.04em;">TODAY</span>' : ''}
          ${egm.recoveryPill}
</div>
</div>

      ${pulseDetailsHtml}
      ${garminStrengthSetsHtml}

      
<div style="font-size:11.5px; color:#d4d4d8; line-height:1.4; margin:4px 0 8px; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;">
        ${egm.primaryTakeaway}
</div>

      
<div class="history-stats-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 4px; text-align:center;">
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:var(--primary);">${act.calories || 0}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Active Burn</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#fff;">${normAvgHr || '--'}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Avg HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#38bdf8;">${normMaxHr || '--'}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Peak HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#a78bfa;">${normAeroTe.toFixed(1)} / ${normAnaeroTe.toFixed(1)}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Aerobic/Anaer</div>
</div>
</div>

      
<div style="margin-top:6px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 10px;">
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; margin-bottom:5px;">
<span style="color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Garmin HR Intensity Zones</span>
<span style="color:var(--primary); font-weight:700; font-family:var(--font-mono); font-size:10.5px;">${hrZonesData.dominantZoneText}</span>
</div>
<div style="display:flex; height:6px; border-radius:3px; overflow:hidden; gap:2px; background:rgba(255,255,255,0.06);">
          ${hrZonesData.zones.filter(z => z.pct > 0).map(z => `<div style="height:100%; width:${z.pct}%; background:${z.color}; border-radius:2px; box-shadow:0 0 4px ${z.color}88;" title="Z${z.num}: ${z.durStr} (${z.pct}%)"></div>`).join('')}
</div>
</div>

      
<div class="benefits-toggle-btn" data-act-id="${esc(act.id)}" onclick="toggleBenefitAccordion(this.dataset.actId)" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); padding:8px 12px; border-radius:8px; cursor:pointer; font-size:11.5px; font-weight:700; color:var(--cyan);">
<span>🔬 View Garmin Telemetry, Charts & Recovery (6 sections)</span>
<span class="accordion-arrow" id="arrow_${esc(act.id)}" style="transition:transform 0.2s;">▾</span>
</div>

<div class="benefits-accordion-body" id="benefit_body_${esc(act.id)}" style="display:none; flex-direction:column; gap:10px; margin-top:8px; padding:12px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.08); border-radius:12px; font-size:11.5px; line-height:1.45;">
        
        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:var(--primary);">📈</span> Heart Rate Telemetry Curve
</span>
<span style="font-size:10px; font-weight:700; color:${hasRealSamples ? 'var(--primary)' : 'var(--text-muted)'};">${sensorHeaderLabel}</span>
</div>
          ${generateHrSvgChart(act)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#f59e0b;">📊</span> 5-Zone Physiological Intensity
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">Max HR: 190 bpm</span>
</div>
          ${generateZoneBarsHtml(act)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#a78bfa;">🎯</span> Firstbeat Training Effect (TE)
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">0.0 – 5.0 Scale</span>
</div>
          ${generateTeDualGaugesHtml(act)}
</div>

        
<div style="border-left:2px solid var(--primary); padding-left:8px;">
<div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            ✓ 4. What This Workout Achieved
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(egm.achievements || []).map(a => `<div>${a}</div>`).join('')}
</div>
</div>

        
<div style="border-left:2px solid #f59e0b; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#f59e0b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            ⚠️ 5. Potential Stressors & Biomechanical Impact
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(egm.stressors || []).map(s => `<div>${s}</div>`).join('')}
</div>
</div>

        
<div style="border-left:2px solid #38bdf8; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            🛡️ 6. Recommended Recovery Protocol & Window
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(egm.recoveryProtocol || []).map(r => `<div>${r}</div>`).join('')}
</div>
</div>

</div>

<div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10.5px; color:var(--text-muted);">${isManualEntry ? 'Pulse Logged Entry' : 'Garmin Telemetry'} • ID: ${esc(act.id)}</span>
<div style="display:flex; align-items:center; gap:6px;">
${linkPulseBtnHtml}
<button class="header-pill-btn" style="padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:var(--text-secondary);" data-act-id="${esc(act.id)}" onclick="openAnnotateModal(this.dataset.actId)">
          Annotate Notes ✎
</button>
</div>
</div>
    `;
    box.appendChild(card);
  });
}

// ==================== 30-DAY RENPHO TREND SVG CHART ====================

let _renphoHistoryCache = null;
let _renphoHistoryFetchedAtMs = 0;

async function renderRenphoTrendChart(opts = {}) {
  let records = Array.isArray(_renphoHistoryCache) ? _renphoHistoryCache : [];
  const force = Boolean(opts && opts.force === true);
  const isStale = (Date.now() - _renphoHistoryFetchedAtMs) > (5 * 60 * 1000);

  if (force || records.length === 0 || isStale) {
    try {
      const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch('/api/renpho/history?days=30', { promptAuthOn401: false }) : fetch('/api/renpho/history?days=30'));
      if (res && res.ok) {
        const data = await res.json();
        const hasValidList = Array.isArray(data) || (data && Array.isArray(data.history));
        const fetched = Array.isArray(data) ? data : ((data && Array.isArray(data.history)) ? data.history : []);
        if (hasValidList && (force || fetched.length > 0 || records.length === 0)) {
          records = fetched;
          _renphoHistoryCache = fetched;
          _renphoHistoryFetchedAtMs = Date.now();
          if (typeof window !== 'undefined') window.PULSE_RENPHO_HISTORY = fetched;
        }
      }
    } catch (err) {
      console.warn('[RenphoChart] Fetch failed, using fallback live state:', err);
    }
  }

  // Update Body-tab 7-Day EMA weight label from latest 7d_avg_weight
  try {
    const emaEl = document.getElementById('bodyAvg7dWeightVal');
    if (emaEl && Array.isArray(records) && records.length > 0) {
      const latestRec = records[records.length - 1];
      const emaWt = Number(latestRec && (latestRec['7d_avg_weight'] ?? latestRec.weight_kg));
      if (Number.isFinite(emaWt) && emaWt > 0) {
        emaEl.innerText = `7-Day EMA: ${emaWt.toFixed(2)} kg`;
      }
    }
  } catch (e) {}

  // Locate or create #renphoTrendChartContainer
  let container = document.getElementById('renphoTrendChartContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'renphoTrendChartContainer';
    const renphoSyncEl = document.getElementById('renphoSyncTime');
    const renphoCard = renphoSyncEl ? renphoSyncEl.closest('.card') : (document.querySelector('#tab-body .card') || document.querySelector('.card'));
    if (renphoCard) {
      renphoCard.appendChild(container);
    } else {
      const targetMain = document.getElementById('tab-today') || document.querySelector('main') || document.body;
      targetMain.appendChild(container);
    }
  }
  if (!container) return;

  container.style.marginTop = '14px';
  container.style.paddingTop = '12px';
  container.style.borderTop = '1px solid rgba(255,255,255,0.06)';

  const _renderRenphoFallbackCard = () => {
    const baked = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
    const rState = baked.renpho || baked.athlete || (typeof window !== 'undefined' ? window.athleteProfile : null) || {};
    const curWt = Number(rState.weight_kg);
    const curBf = Number(rState.body_fat_pct);
    const curLm = Number(rState.lean_mass_kg);
    const snapshotLine = Number.isFinite(curWt) && curWt > 0
      ? `Latest reading: ${curWt.toFixed(2)} kg${Number.isFinite(curBf) && curBf > 0 ? ` • ${curBf.toFixed(1)}% BF` : ''}${Number.isFinite(curLm) && curLm > 0 ? ` • ${curLm.toFixed(2)} kg LBM` : ''}`
      : 'Sync Renpho or log a manual weigh-in to begin tracking.';
    container.innerHTML = `
<div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.14); border-radius:12px; padding:16px; text-align:center;">
<div style="font-size:12px; font-weight:800; color:#e4e4e7; margin-bottom:4px;">Need ≥ 2 weigh-ins to plot 30-day trend</div>
<div style="font-size:11px; color:var(--text-muted);">${snapshotLine}</div>
</div>`;
  };

  if (!records || records.length < 2) {
    _renderRenphoFallbackCard();
    return;
  }

  const _normRenphoTsMs = (r) => {
    const rawTs = r && r.timestamp !== undefined && r.timestamp !== null ? Number(r.timestamp) : NaN;
    if (Number.isFinite(rawTs) && rawTs > 0) {
      return rawTs < 1e11 ? rawTs * 1000 : rawTs;
    }
    if (r && r.date_str) {
      const parsed = new Date(r.date_str).getTime();
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  };

  // Ensure chronologically sorted
  records = records.slice().sort((a, b) => _normRenphoTsMs(a) - _normRenphoTsMs(b));

  // Map to structured points
  const points = records.map(r => {
    const ts = _normRenphoTsMs(r) || Date.now();
    const d = new Date(ts);
    const dateLabel = isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
    return {
      ts,
      dateLabel,
      dateStr: r.date_str || dateLabel,
      bf: Number(r.body_fat_pct || 0),
      lm: Number(r.lean_mass_kg || 0),
      wt: Number(r.weight_kg || 0)
    };
  }).filter(p => p.bf > 5 && p.lm > 20);

  if (points.length < 2) {
    _renderRenphoFallbackCard();
    return;
  }

  // Calculate 7-day moving averages for both metrics
  const sevenDaysMs = 7 * 86400 * 1000;
  points.forEach((pt, i) => {
    const windowPts = points.slice(0, i + 1).filter(p => (pt.ts - p.ts) <= sevenDaysMs);
    const avgBf = windowPts.reduce((s, p) => s + p.bf, 0) / windowPts.length;
    const avgLm = windowPts.reduce((s, p) => s + p.lm, 0) / windowPts.length;
    pt.maBf = Math.round(avgBf * 100) / 100;
    pt.maLm = Math.round(avgLm * 100) / 100;
  });

  // Calculate Fat Loss Velocity (kg/week and %/week)
  const firstPt = points[0];
  const lastPt = points[points.length - 1];
  const spanMs = Math.max(86400 * 1000, lastPt.ts - firstPt.ts);
  const weeks = spanMs / (7 * 86400 * 1000);

  const bfDelta = lastPt.bf - firstPt.bf;
  const bfRatePerWk = bfDelta / weeks;

  const firstFatKg = (firstPt.wt && firstPt.lm) ? (firstPt.wt - firstPt.lm) : (firstPt.wt * (firstPt.bf / 100));
  const lastFatKg = (lastPt.wt && lastPt.lm) ? (lastPt.wt - lastPt.lm) : (lastPt.wt * (lastPt.bf / 100));
  const fatKgDelta = lastFatKg - firstFatKg;
  const fatKgRatePerWk = fatKgDelta / weeks;

  const velKgStr = `${fatKgRatePerWk <= 0 ? '' : '+'}${fatKgRatePerWk.toFixed(2)} kg/wk`;
  const velBfStr = `${bfRatePerWk <= 0 ? '' : '+'}${bfRatePerWk.toFixed(2)} %/wk`;

  // Min and max for metrics
  const allBf = points.map(p => p.bf);
  const allLm = points.map(p => p.lm);
  const minBfVal = Math.min(...allBf);
  const maxBfVal = Math.max(...allBf);
  const minLmVal = Math.min(...allLm);
  const maxLmVal = Math.max(...allLm);

  // Y-axis scaling
  const padBf = Math.max(0.15, (maxBfVal - minBfVal) * 0.12);
  const minBf = Math.floor((minBfVal - padBf) * 10) / 10;
  const maxBf = Math.ceil((maxBfVal + padBf) * 10) / 10;
  const rangeBf = Math.max(0.4, maxBf - minBf);

  const padLm = Math.max(0.2, (maxLmVal - minLmVal) * 0.12);
  const minLm = Math.floor((minLmVal - padLm) * 10) / 10;
  const maxLm = Math.ceil((maxLmVal + padLm) * 10) / 10;
  const rangeLm = Math.max(0.6, maxLm - minLm);

  // Dimensions
  const width = 380;
  const height = 180;
  const padL = 50;
  const padR = 54;
  const padT = 24;
  const padB = 28;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Compute SVG coordinates
  const pts = points.map((p, i) => {
    const x = Math.round((padL + (i / Math.max(1, points.length - 1)) * chartW) * 10) / 10;
    const yBf = Math.round((padT + (1 - (p.bf - minBf) / rangeBf) * chartH) * 10) / 10;
    const yBfMa = Math.round((padT + (1 - (p.maBf - minBf) / rangeBf) * chartH) * 10) / 10;
    const yLm = Math.round((padT + (1 - (p.lm - minLm) / rangeLm) * chartH) * 10) / 10;
    const yLmMa = Math.round((padT + (1 - (p.maLm - minLm) / rangeLm) * chartH) * 10) / 10;
    return { ...p, x, yBf, yBfMa, yLm, yLmMa };
  });

  const buildPath = (coordKey) => {
    if (pts.length === 1) return `M ${pts[0].x} ${pts[0][coordKey]}`;
    let d = `M ${pts[0].x} ${pts[0][coordKey]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const c = pts[i];
      const n = pts[i + 1];
      const midX = (c.x + n.x) / 2;
      d += ` Q ${c.x} ${c[coordKey]}, ${midX} ${(c[coordKey] + n[coordKey]) / 2}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last.x} ${last[coordKey]}`;
    return d;
  };

  const pathBf = buildPath('yBf');
  const pathBfMa = buildPath('yBfMa');
  const pathLm = buildPath('yLm');
  const pathLmMa = buildPath('yLmMa');

  const areaBf = `${pathBf} L ${pts[pts.length - 1].x} ${height - padB} L ${pts[0].x} ${height - padB} Z`;

  // Grid line Y coordinates
  const gridY1 = padT;
  const gridY2 = Math.round((padT + chartH * 0.5) * 10) / 10;
  const gridY3 = height - padB;

  // Date timeline markers
  const startDate = points[0].dateLabel || 'D-30';
  const midDate = points[Math.floor(points.length / 2)].dateLabel || 'D-15';
  const endDate = points[points.length - 1].dateLabel || 'Today';

  container.innerHTML = `
    
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:12px;">📈</span>
<span style="font-size:10.5px; font-weight:800; letter-spacing:0.08em; color:#fff; text-transform:uppercase;">
          30-DAY RENPHO TREND
</span>
</div>
<div style="display:flex; align-items:center; gap:5px;">
<span style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Fat Velocity:</span>
<span style="font-size:11px; font-weight:800; color:#00F0FF; font-family:var(--font-mono); background:rgba(0,240,255,0.12); border:1px solid rgba(0,240,255,0.3); padding:2px 7px; border-radius:4px; box-shadow:0 0 8px rgba(0,240,255,0.25);">
          ${velKgStr} <small style="color:var(--text-secondary); font-size:9.5px; font-weight:600;">(${velBfStr})</small>
</span>
</div>
</div>

    
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); margin-bottom:6px; padding:0 2px;">
<div style="display:flex; align-items:center; gap:5px;">
<span style="display:inline-block; width:12px; height:2.5px; background:#00F0FF; border-radius:1px; box-shadow:0 0 6px rgba(0,240,255,0.7);"></span>
<span style="color:#00F0FF; font-weight:700;">Body Fat %</span>
<span style="color:var(--text-muted); font-size:9px;">(dashed: 7d MA)</span>
</div>
<div style="display:flex; align-items:center; gap:5px;">
<span style="display:inline-block; width:12px; height:2.5px; background:#10b981; border-radius:1px; box-shadow:0 0 6px rgba(16,185,129,0.7);"></span>
<span style="color:#10b981; font-weight:700;">Lean Mass kg</span>
<span style="color:var(--text-muted); font-size:9px;">(dashed: 7d MA)</span>
</div>
</div>

    
<div style="background:linear-gradient(180deg, rgba(15,23,42,0.4) 0%, rgba(6,8,14,0.7) 100%); border:1px solid rgba(0,240,255,0.14); border-radius:10px; padding:8px 6px 4px; box-shadow:inset 0 0 16px rgba(0,0,0,0.4);">
<svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="renphoBfGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.32"/>
<stop offset="60%" stop-color="#00F0FF" stop-opacity="0.08"/>
<stop offset="100%" stop-color="#00F0FF" stop-opacity="0.0"/>
</linearGradient>
</defs>

        
<line x1="${padL}" y1="${gridY1}" x2="${width - padR}" y2="${gridY1}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${padL}" y1="${gridY2}" x2="${width - padR}" y2="${gridY2}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${padL}" y1="${gridY3}" x2="${width - padR}" y2="${gridY3}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

        
<text x="${padL - 4}" y="${gridY1 + 4}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${maxBf.toFixed(1)}%</text>
<text x="${padL - 4}" y="${gridY2 + 4}" fill="#38bdf8" font-size="12.5" font-weight="600" text-anchor="end">${((maxBf + minBf) / 2).toFixed(1)}%</text>
<text x="${padL - 4}" y="${gridY3}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${minBf.toFixed(1)}%</text>

        
<text x="${width - padR + 4}" y="${gridY1 + 4}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${maxLm.toFixed(1)}kg</text>
<text x="${width - padR + 4}" y="${gridY2 + 4}" fill="#34d399" font-size="12.5" font-weight="600" text-anchor="start">${((maxLm + minLm) / 2).toFixed(1)}kg</text>
<text x="${width - padR + 4}" y="${gridY3}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${minLm.toFixed(1)}kg</text>

        
<path d="${areaBf}" fill="url(#renphoBfGrad)"/>

        
<path d="${pathBfMa}" fill="none" stroke="#00F0FF" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>
<path d="${pathLmMa}" fill="none" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>

        
<path d="${pathBf}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.6));"/>
<path d="${pathLm}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.6));"/>

        
<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].yBf}" r="4" fill="#00F0FF" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.9));"/>
<circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].yLm}" r="4" fill="#10b981" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.9));"/>

        
<text x="${padL}" y="${height - 6}" fill="var(--text-muted)" font-size="12.5">${startDate}</text>
<text x="${padL + chartW / 2}" y="${height - 6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${midDate}</text>
<text x="${width - padR}" y="${height - 6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${endDate}</text>
</svg>
</div>

    
<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(0,240,255,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#00F0FF; font-weight:800; text-transform:uppercase;">BF% Range</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${lastPt.bf.toFixed(1)}%</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#00F0FF;">${minBfVal.toFixed(1)}%</strong></span>
<span>Max: <strong style="color:#94a3b8;">${maxBfVal.toFixed(1)}%</strong></span>
</div>
</div>

<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(16,185,129,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#10b981; font-weight:800; text-transform:uppercase;">Lean Mass</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${lastPt.lm.toFixed(1)}kg</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#94a3b8;">${minLmVal.toFixed(1)}kg</strong></span>
<span>Max: <strong style="color:#10b981;">${maxLmVal.toFixed(1)}kg</strong></span>
</div>
</div>
</div>
  `;
}

// ==================== 4-WEEK STRENGTH e1RM PROGRESSION ====================

let _strengthHistoryCache = null;
let _strengthHistoryFetchedAtMs = 0;

async function renderStrengthProgressionChart(opts = {}) {
  let strengthHistory = (_strengthHistoryCache && typeof _strengthHistoryCache === 'object') ? _strengthHistoryCache : {};
  let prescriptions = {};
  const force = Boolean(opts && opts.force === true);
  const hasCached = Object.keys(strengthHistory).length > 0;
  const isStale = (Date.now() - _strengthHistoryFetchedAtMs) > (5 * 60 * 1000);

  // Try fetching 30-day history from backend
  if (force || !hasCached || isStale) {
    try {
      const res = await (typeof pulseApiFetch === 'function' ? pulseApiFetch('/api/strength/history?days=30', { promptAuthOn401: false }) : fetch('/api/strength/history?days=30'));
      if (res && res.ok) {
        const data = await res.json();
        strengthHistory = (data && data.exercises) || data || {};
        _strengthHistoryCache = strengthHistory;
        _strengthHistoryFetchedAtMs = Date.now();
      }
    } catch (err) {
      console.warn('[StrengthChart] Fetch failed, falling back to baked prescriptions:', err);
    }
  }

  // Load baseline strength prescriptions from live state
  const baked = (typeof window !== 'undefined' && window.BAKED_LIVE_STATE) ? window.BAKED_LIVE_STATE : {};
  prescriptions = baked.strength_prescriptions || (typeof window !== 'undefined' ? window.strengthPrescriptions : null) || {};

  const _catExs = (typeof getAllExercises === 'function') ? getAllExercises() : [];
  const _catLiftDefaults = (exId, fbW, fbR) => {
    const found = _catExs.find(e => e && e.id === exId);
    const rawW = found ? (typeof found.getBaseWeight === 'function' ? found.getBaseWeight() : found.targetWeight) : NaN;
    const rawR = found ? (typeof found.getBaseReps === 'function' ? found.getBaseReps() : found.targetReps) : NaN;
    const w = (typeof rawW === 'number' && Number.isFinite(rawW) && rawW > 0) ? rawW : fbW;
    const r = (typeof rawR === 'number' && Number.isFinite(rawR) && rawR > 0) ? rawR : fbR;
    return {
      weight: w,
      reps: r,
      e1rm: Number((w * (1 + r / 30)).toFixed(1))
    };
  };
  const _sqDef = _catLiftDefaults('barbell_squat', 100.0, 8);
  const _rdlDef = _catLiftDefaults('barbell_rdl', 70.0, 8);
  const _fpDef = _catLiftDefaults('barbell_floor_press', 95.0, 6);
  const _rowDef = _catLiftDefaults('barbell_pendlay_row', 85.0, 8);

  const COMPOUND_LIFTS = [
    {
      key: 'barbell_squat',
      name: 'Barbell Back Squat',
      icon: '🏋️',
      family: 'Quad & Knee Extensor Power',
      defaultWeight: _sqDef.weight,
      defaultReps: _sqDef.reps,
      defaultE1rm: _sqDef.e1rm
    },
    {
      key: 'barbell_rdl',
      name: 'Barbell Romanian Deadlift (RDL)',
      icon: '⚡',
      family: 'Hamstring & Glute Hinge Anchor',
      defaultWeight: _rdlDef.weight,
      defaultReps: _rdlDef.reps,
      defaultE1rm: _rdlDef.e1rm
    },
    {
      key: 'barbell_floor_press',
      name: 'Barbell Floor Press',
      icon: '🛡️',
      family: 'Horizontal Push / Strict Triceps Power',
      defaultWeight: _fpDef.weight,
      defaultReps: _fpDef.reps,
      defaultE1rm: _fpDef.e1rm
    },
    {
      key: 'barbell_pendlay_row',
      name: 'Barbell Pendlay Row',
      icon: '🚀',
      family: 'Explosive Dead-Stop Lat Pull',
      defaultWeight: _rowDef.weight,
      defaultReps: _rowDef.reps,
      defaultE1rm: _rowDef.e1rm
    }
  ];

  // Locate or create #strengthProgressionContainer
  let container = document.getElementById('strengthProgressionContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'strengthProgressionContainer';
    const trainPrescribed = document.getElementById('trainViewPrescribed') || document.getElementById('tab-train') || document.getElementById('todayTrainingContainer');
    if (trainPrescribed) {
      trainPrescribed.appendChild(container);
    } else {
      (document.querySelector('main') || document.body).appendChild(container);
    }
  }

  container.style.marginTop = '14px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '10px';

  let cardsHtml = '';

  const _parseNum = (val, fallback) => {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    if (typeof val === 'string') {
      const m = val.match(/-?\d+(?:\.\d+)?/);
      if (m) return Number(m[0]);
    }
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  for (const lift of COMPOUND_LIFTS) {
    const sp = prescriptions[lift.key] || {};
    const historyLogs = strengthHistory[lift.key] || [];

    const prescribedWeight = _parseNum(sp.weight, lift.defaultWeight);
    const prescribedReps = _parseNum(sp.reps, lift.defaultReps);
    const baselineE1rm = _parseNum(sp.e1rm, lift.defaultE1rm);

    const lastLoggedWeight = _parseNum(sp.last_logged_weight ?? (historyLogs.length ? historyLogs[historyLogs.length - 1].weight : prescribedWeight), prescribedWeight);
    const lastLoggedReps = _parseNum(sp.last_logged_reps ?? (historyLogs.length ? historyLogs[historyLogs.length - 1].reps : prescribedReps), prescribedReps);
    const lastE1rm = _parseNum(sp.last_e1rm ?? (historyLogs.length ? historyLogs[historyLogs.length - 1].e1rm : baselineE1rm), baselineE1rm);

    const isProgReady = Boolean(
      sp.progression_ready === true ||
      sp.status === 'progression_ready' ||
      lastLoggedWeight > prescribedWeight ||
      lastE1rm > baselineE1rm
    );

    // Plot only real recorded sessions (no synthetic fabricated history bars)
    const realTail = historyLogs.slice(-4);
    let weekValues;
    let w4Val;
    if (realTail.length >= 2) {
      weekValues = realTail.map((entry, idx) => ({
        label: idx === realTail.length - 1 ? 'Now' : `S${idx + 1}`,
        val: Number(Number(entry.e1rm || baselineE1rm).toFixed(1)),
        isCurrent: idx === realTail.length - 1
      }));
      w4Val = weekValues[weekValues.length - 1].val.toFixed(1);
    } else {
      const currentVal = Number(Number(realTail.length === 1 ? (realTail[0].e1rm || baselineE1rm) : (isProgReady ? Math.max(lastE1rm, baselineE1rm) : baselineE1rm)).toFixed(1));
      weekValues = [{ label: 'Now', val: currentVal, isCurrent: true }];
      w4Val = currentVal.toFixed(1);
    }

    const minW = Math.min(...weekValues.map(w => w.val));
    const maxW = Math.max(...weekValues.map(w => w.val));
    const rangeW = Math.max(6, maxW - minW + 3);

    const barsHtml = weekValues.map(w => {
      const h = Math.max(12, Math.round(((w.val - (minW - 1.5)) / rangeW) * 36));
      const isTarget = w.isCurrent && isProgReady;
      const barStyle = isTarget
        ? 'background:linear-gradient(180deg, #00F0FF 0%, #10b981 100%); box-shadow:0 0 10px rgba(0,240,255,0.6);'
        : (w.isCurrent ? 'background:#38bdf8;' : 'background:rgba(255,255,255,0.18);');
      const valColor = isTarget ? '#00F0FF' : (w.isCurrent ? '#fff' : 'var(--text-muted)');

      return `
<div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:3px;">
<span style="font-size:9.5px; font-weight:800; font-family:var(--font-mono); color:${valColor};">${w.val}</span>
<div style="width:100%; max-width:32px; height:${h}px; ${barStyle} border-radius:3px;"></div>
<span style="font-size:9px; font-weight:700; color:${w.isCurrent ? 'var(--primary)' : 'var(--text-muted)'}; margin-top:1px;">${w.label}</span>
</div>
      `;
    }).join('');

    const cardBorder = isProgReady
      ? 'border:1px solid rgba(0,240,255,0.6); box-shadow:0 0 18px rgba(0,240,255,0.22); background:linear-gradient(135deg, rgba(0,240,255,0.06) 0%, rgba(15,23,42,0.85) 100%);'
      : 'border:1px solid rgba(255,255,255,0.07); background:rgba(15,23,42,0.5);';

    cardsHtml += `
<div class="strength-progression-card" style="${cardBorder} border-radius:12px; padding:12px 14px; position:relative; overflow:hidden;">
        
<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
<div>
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:14px;">${lift.icon}</span>
<strong style="color:#fff; font-size:13px; font-family:var(--font-display); letter-spacing:-0.01em;">${lift.name}</strong>
</div>
<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">
              Prescribed: <span style="color:#e2e8f0; font-weight:700;">${prescribedWeight}kg × ${prescribedReps}</span> • ${lift.family}
</div>
</div>
<div>
            ${isProgReady ? `
<span style="background:linear-gradient(90deg, #00F0FF, #10b981); color:#000; font-size:10px; font-weight:900; padding:3px 8px; border-radius:4px; letter-spacing:0.04em; box-shadow:0 0 10px rgba(0,240,255,0.6); display:inline-block; white-space:nowrap;">
                +2.5 kg Ready
</span>
            ` : `
<span style="background:rgba(255,255,255,0.06); color:var(--text-muted); font-size:9.5px; font-weight:700; padding:2px 7px; border-radius:4px; display:inline-block; white-space:nowrap;">
                Baseline Solid
</span>
            `}
</div>
</div>

        
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:7px 10px; margin-bottom:10px;">
<div>
<div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.04em;">Last Logged Set</div>
<div style="font-size:13px; font-weight:800; color:#fff; font-family:var(--font-mono); margin-top:2px;">
              ${lastLoggedWeight}kg <small style="color:var(--text-muted); font-size:10px;">× ${lastLoggedReps} reps</small>
</div>
</div>
<div style="text-align:right;">
<div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.04em;">Calculated e1RM</div>
<div style="font-size:13px; font-weight:800; color:${isProgReady ? '#00F0FF' : '#fff'}; font-family:var(--font-mono); margin-top:2px;">
              ${w4Val} kg ${isProgReady ? `<small style="color:#10b981; font-weight:800;">(+${Math.max(2.5, Number((w4Val - baselineE1rm).toFixed(1)))}kg)</small>` : ''}
</div>
</div>
</div>

        
<div>
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); margin-bottom:5px;">
<span style="font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">4-Week e1RM Progression Visual</span>
<span style="font-family:var(--font-mono); color:${isProgReady ? '#10b981' : 'var(--text-muted)'}; font-weight:700;">
              ${isProgReady ? '✓ Progressive Overload Met' : 'Consistent Load Retention'}
</span>
</div>
<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; background:rgba(0,0,0,0.32); border:1px solid rgba(255,255,255,0.04); border-radius:8px; padding:8px 8px 6px; align-items:flex-end; height:74px;">
            ${barsHtml}
</div>
</div>
</div>
    `;
  }

  container.innerHTML = `
    
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:13px;">🏋️</span>
<span style="font-size:10.5px; font-weight:800; letter-spacing:0.08em; color:#fff; text-transform:uppercase;">
          4-WEEK COMPOUND STRENGTH e1RM PROGRESSION
</span>
</div>
<span style="font-size:10px; font-weight:700; color:var(--primary); font-family:var(--font-mono); background:rgba(0,240,255,0.1); border:1px solid rgba(0,240,255,0.25); padding:2px 7px; border-radius:4px;">
        Linear Overload
</span>
</div>

    
    ${cardsHtml}
  `;
}

// ==================== HISTORY SET EDITOR MODAL & QUICK WATCH FIX ====================
let _editHistorySetCtx = null;

function _ensureEditHistorySetModal() {
  if (typeof document === 'undefined') return null;
  let modal = document.getElementById('editHistorySetModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'editHistorySetModal';
  modal.className = 'modal-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
<div class="modal-card" style="max-width:360px;">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
    <h3 id="editHistSetTitle" style="margin:0; font-size:15px; font-weight:800; color:#fff;">Edit Logged Set</h3>
    <button type="button" onclick="closeEditHistorySetModal()" style="background:none; border:none; color:var(--text-muted); font-size:18px; cursor:pointer; padding:2px 6px;">✕</button>
  </div>
  <div id="editHistSetSub" style="font-size:11.5px; color:var(--text-muted); margin-bottom:12px;"></div>
  <div id="editHistWatchHint" style="display:none; margin-bottom:10px; padding:7px 9px; border-radius:7px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.4); font-size:11px; color:#fde68a; justify-content:space-between; align-items:center; gap:8px;">
    <span id="editHistWatchHintText"></span>
    <button type="button" id="btnEditHistUseWatch" onclick="applyWatchWeightInEditModal()" style="padding:3px 8px; border-radius:5px; border:1px solid rgba(245,158,11,0.6); background:rgba(245,158,11,0.24); color:#fde68a; font-size:10.5px; font-weight:800; cursor:pointer;"></button>
  </div>
  <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:14px;">
    <div>
      <label style="display:block; font-size:10.5px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">Weight (kg)</label>
      <div style="display:flex; align-items:center; gap:4px;">
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('weight', -2.5)">−</button>
        <input id="editHistWeightInput" type="number" step="0.5" min="0" max="500" class="set-input-box" style="width:100%; text-align:center;" />
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('weight', 2.5)">+</button>
      </div>
    </div>
    <div>
      <label style="display:block; font-size:10.5px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">Reps</label>
      <div style="display:flex; align-items:center; gap:4px;">
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('reps', -1)">−</button>
        <input id="editHistRepsInput" type="number" step="1" min="0" max="200" class="set-input-box" style="width:100%; text-align:center;" />
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('reps', 1)">+</button>
      </div>
    </div>
  </div>
  <div style="display:flex; gap:8px; justify-content:flex-end;">
    <button type="button" onclick="closeEditHistorySetModal()" style="padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05); color:#cbd5e1; font-size:12px; font-weight:700; cursor:pointer;">Cancel</button>
    <button type="button" id="btnSaveEditedHistorySet" onclick="saveEditedHistorySet()" style="padding:8px 14px; border-radius:8px; border:none; background:var(--primary); color:#000; font-size:12px; font-weight:800; cursor:pointer;">Save Changes</button>
  </div>
</div>`;
  if (document.body) document.body.appendChild(modal);
  return modal;
}

function openEditHistorySetModal(sessionId, sessionDate, detailKey, exName, curWeight, curReps, watchWeightOpt) {
  const modal = _ensureEditHistorySetModal();
  if (!modal) return;
  const parsedWatch = (watchWeightOpt !== undefined && watchWeightOpt !== null && String(watchWeightOpt).trim() !== '' && Number.isFinite(Number(watchWeightOpt)))
    ? Number(watchWeightOpt)
    : null;
  _editHistorySetCtx = {
    sessionId: String(sessionId || ''),
    sessionDate: String(sessionDate || ''),
    detailKey: String(detailKey || ''),
    exName: String(exName || 'Exercise'),
    watchWeightKg: parsedWatch
  };
  const titleEl = document.getElementById('editHistSetTitle');
  const subEl = document.getElementById('editHistSetSub');
  const wInput = document.getElementById('editHistWeightInput');
  const rInput = document.getElementById('editHistRepsInput');
  const hintBox = document.getElementById('editHistWatchHint');
  const hintTxt = document.getElementById('editHistWatchHintText');
  const watchBtn = document.getElementById('btnEditHistUseWatch');

  if (titleEl) titleEl.innerText = `Edit ${exName || 'Set'}`;
  if (subEl) subEl.innerText = `${detailKey} • ${sessionDate || 'Today'}`;
  if (wInput) wInput.value = String(Number.isFinite(Number(curWeight)) ? Number(curWeight) : 0);
  if (rInput) rInput.value = String(Number.isFinite(Number(curReps)) ? Number(curReps) : 0);
  if (hintBox && hintTxt && watchBtn) {
    if (parsedWatch !== null && parsedWatch > 0) {
      hintBox.style.display = 'flex';
      hintTxt.innerText = `Garmin watch recorded ${parsedWatch}kg`;
      watchBtn.innerText = `Use ${parsedWatch}kg`;
    } else {
      hintBox.style.display = 'none';
    }
  }
  modal.classList.add('open');
}

function closeEditHistorySetModal() {
  const modal = document.getElementById('editHistorySetModal');
  if (modal) modal.classList.remove('open');
  _editHistorySetCtx = null;
}

function stepEditHistorySetModal(field, delta) {
  const id = field === 'weight' ? 'editHistWeightInput' : 'editHistRepsInput';
  const el = document.getElementById(id);
  if (!el) return;
  const cur = Number(el.value || 0);
  const next = field === 'weight'
    ? Math.max(0, Math.round((cur + Number(delta || 0)) * 10) / 10)
    : Math.max(0, Math.round(cur + Number(delta || 0)));
  el.value = String(next);
  if (typeof beep === 'function') beep(520, 0.04);
}

function applyWatchWeightInEditModal() {
  if (!_editHistorySetCtx || _editHistorySetCtx.watchWeightKg === null) return;
  const wInput = document.getElementById('editHistWeightInput');
  if (wInput) wInput.value = String(_editHistorySetCtx.watchWeightKg);
}

function _applyEditedSetLocallyAndRefresh(data, ctx, newWeight, newReps) {
  try {
    const rawHist = localStorage.getItem('pulse_session_history');
    if (rawHist) {
      const hist = JSON.parse(rawHist);
      if (Array.isArray(hist)) {
        let changed = false;
        hist.forEach(s => {
          if (!s || !s.details || typeof s.details !== 'object') return;
          const sid = String(s.id || s.client_event_id || '');
          const sDate = String(s.date || '').slice(0, 10);
          const idMatch = ctx.sessionId && sid === ctx.sessionId;
          const dateMatch = (!ctx.sessionId || !sid) && ctx.sessionDate && sDate === ctx.sessionDate;
          if ((idMatch || dateMatch || s.details[ctx.detailKey]) && s.details[ctx.detailKey]) {
            if (idMatch || !ctx.sessionId || sDate === ctx.sessionDate) {
              Object.assign(s.details[ctx.detailKey], (data && data.updated_set) ? data.updated_set : { weight: newWeight, reps: newReps });
              changed = true;
            }
          }
        });
        if (changed) localStorage.setItem('pulse_session_history', JSON.stringify(hist));
      }
    }
  } catch (e) {}

  if (data && data.state) {
    window.BAKED_LIVE_STATE = data.state;
    if (typeof applyLiveStateToDom === 'function') {
      applyLiveStateToDom(data.state);
    } else if (typeof renderHistoryList === 'function') {
      renderHistoryList();
    }
  } else if (typeof renderHistoryList === 'function') {
    renderHistoryList();
  }
  if (typeof renderStrengthProgressionChart === 'function') {
    renderStrengthProgressionChart({ force: true });
  }
  if (typeof fetchAnalyticsSummary === 'function') {
    fetchAnalyticsSummary(true);
  }
}

async function _submitHistorySetEdit(ctx, newWeight, newReps) {
  const fetcher = (typeof pulseApiFetch === 'function') ? pulseApiFetch : fetch;
  const res = await fetcher('/api/session/edit_set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: ctx.sessionId || null,
      session_date: ctx.sessionDate || null,
      detail_key: ctx.detailKey,
      weight: newWeight,
      reps: newReps
    }),
    timeoutMs: 8000,
    promptAuthOn401: true
  });
  if (!res || !res.ok) {
    let msg = 'Could not save set edit';
    try { const err = await res.json(); if (err && err.detail) msg = err.detail; } catch (e) {}
    if (typeof showToast === 'function') showToast(`⚠️ ${msg}`);
    return false;
  }
  const data = await res.json();
  _applyEditedSetLocallyAndRefresh(data, ctx, newWeight, newReps);
  if (typeof beep === 'function') beep(760, 0.08);
  if (typeof showToast === 'function') showToast(`✓ Updated set to ${newWeight}kg × ${newReps}r`);
  return true;
}

async function saveEditedHistorySet() {
  if (!_editHistorySetCtx) return;
  const wEl = document.getElementById('editHistWeightInput');
  const rEl = document.getElementById('editHistRepsInput');
  const newW = Number(wEl ? wEl.value : 0);
  const newR = Math.round(Number(rEl ? rEl.value : 0));
  if (!Number.isFinite(newW) || newW < 0 || newW > 500 || !Number.isFinite(newR) || newR < 0 || newR > 200) {
    if (typeof showToast === 'function') showToast('Enter valid weight (0–500kg) and reps (0–200)');
    return;
  }
  const btn = document.getElementById('btnSaveEditedHistorySet');
  if (btn) btn.disabled = true;
  const ctxCopy = { ..._editHistorySetCtx };
  try {
    const ok = await _submitHistorySetEdit(ctxCopy, newW, newR);
    if (ok) closeEditHistorySetModal();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function quickApplyWatchWeightToPulseSet(sessionId, sessionDate, detailKey, watchWeightKg, pulseReps) {
  if (!detailKey || !Number.isFinite(Number(watchWeightKg))) return;
  await _submitHistorySetEdit(
    {
      sessionId: String(sessionId || ''),
      sessionDate: String(sessionDate || ''),
      detailKey: String(detailKey)
    },
    Number(watchWeightKg),
    Math.round(Number(pulseReps || 0))
  );
}

// ==================== GLOBAL ASSIGNMENTS & AUTO-INIT ====================
if (typeof window !== 'undefined') {
  window.getGarminHrZoneBreakdown = getGarminHrZoneBreakdown;
  window.generateHrSvgChart = generateHrSvgChart;
  window.generateZoneBarsHtml = generateZoneBarsHtml;
  window.generateTeDualGaugesHtml = generateTeDualGaugesHtml;
  window.renderHistoryList = renderHistoryList;
  window.renderRenphoTrendChart = renderRenphoTrendChart;
  window.renderStrengthProgressionChart = renderStrengthProgressionChart;
  window.openEditHistorySetModal = openEditHistorySetModal;
  window.closeEditHistorySetModal = closeEditHistorySetModal;
  window.stepEditHistorySetModal = stepEditHistorySetModal;
  window.applyWatchWeightInEditModal = applyWatchWeightInEditModal;
  window.saveEditedHistorySet = saveEditedHistorySet;
  window.quickApplyWatchWeightToPulseSet = quickApplyWatchWeightToPulseSet;
}

let _pulseChartsInitInFlight = false;
function initPulseCharts() {
  if (_pulseChartsInitInFlight) return;
  _pulseChartsInitInFlight = true;
  try {
    try {
      if (typeof renderRenphoTrendChart === 'function') {
        renderRenphoTrendChart();
      }
    } catch (e) {
      console.warn('[PulseCharts] renderRenphoTrendChart init warning:', e);
    }
    try {
      if (typeof renderStrengthProgressionChart === 'function') {
        renderStrengthProgressionChart();
      }
    } catch (e) {
      console.warn('[PulseCharts] renderStrengthProgressionChart init warning:', e);
    }
  } finally {
    _pulseChartsInitInFlight = false;
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initPulseCharts(), { once: true });
  } else {
    initPulseCharts();
  }
}

function getGarminHrZoneBreakdown(t){if(t&&t.hr_zones&&typeof t.hr_zones=="object"){const r=t.hr_zones,h=Number(r.z1??r[1]??r.zone1??0),v=Number(r.z2??r[2]??r.zone2??0),f=Number(r.z3??r[3]??r.zone3??0),S=Number(r.z4??r[4]??r.zone4??0),C=Number(r.z5??r[5]??r.zone5??0),T=h+v+f+S+C;if(T>0){const A=Math.round(h/T*100),W=Math.round(v/T*100),R=Math.round(f/T*100),U=Math.round(S/T*100),Y=Math.round(C/T*100),j=H=>`${Math.floor(H/60)}m ${H%60<10?"0":""}${H%60}s`,J=[{num:5,name:"Maximum / Anaerobic",range:"> 171 bpm",pct:Y,durStr:j(C),color:"#ef4444"},{num:4,name:"Threshold / Hard",range:"152\u2013171 bpm",pct:U,durStr:j(S),color:"#f59e0b"},{num:3,name:"Aerobic / Moderate",range:"133\u2013152 bpm",pct:R,durStr:j(f),color:"#10b981"},{num:2,name:"Easy / Fat Oxidation Base",range:"114\u2013133 bpm",pct:W,durStr:j(v),color:"#00F0FF"},{num:1,name:"Warm Up / Active Recovery",range:"< 114 bpm",pct:A,durStr:j(h),color:"#8b9db5"}];let I=J[0];return J.forEach(H=>{H.pct>I.pct&&(I=H)}),{zones:J,dominantZoneText:"Dominant: Z"+I.num+" ("+I.durStr+" \u2022 "+I.pct+"%)"}}}const s=t.durationMin||t.duration_min||30,c=t.avgHr||t.avg_hr||115,n=t.maxHr||t.max_hr||150,p=`${t.name||""} ${t.subTitle||t.sub_title||""}`.toLowerCase(),a=p.includes("walk")||p.includes("stroll"),y=p.includes("strength")||p.includes("barbell")||p.includes("lift")||p.includes("gym"),g=p.includes("jump")||p.includes("plyo")||p.includes("tuck");let M,$,E,N,F;a||c<95?(M=88,$=12,E=0,N=0,F=0):y?(M=22,$=48,E=22,N=8,F=0):g||n>=162?(M=10,$=25,E=35,N=22,F=8):c<=122?(M=12,$=58,E=24,N=6,F=0):c<=135?(M=8,$=28,E=46,N=15,F=3):(M=5,$=20,E=35,N=28,F=12);const l=r=>{const h=Math.round(r*60),v=Math.floor(h/60),f=h%60;return`${v}m ${f<10?"0":""}${f}s`},o=[{num:5,name:"Maximum / Anaerobic",range:"> 171 bpm",pct:F,durStr:l(s*F/100),color:"#ef4444"},{num:4,name:"Threshold / Hard",range:"152\u2013171 bpm",pct:N,durStr:l(s*N/100),color:"#f59e0b"},{num:3,name:"Aerobic / Moderate",range:"133\u2013152 bpm",pct:E,durStr:l(s*E/100),color:"#10b981"},{num:2,name:"Easy / Fat Oxidation Base",range:"114\u2013133 bpm",pct:$,durStr:l(s*$/100),color:"#00F0FF"},{num:1,name:"Warm Up / Active Recovery",range:"< 114 bpm",pct:M,durStr:l(s*M/100),color:"#8b9db5"}];let u=o[0];return o.forEach(r=>{r.pct>u.pct&&(u=r)}),{zones:o,dominantZoneText:`Dominant: Z${u.num} (${u.durStr} \u2022 ${u.pct}%)`}}function generateHrSvgChart(t){const s=t.durationMin||t.duration_min||30;let c=t.avgHr||t.avg_hr||119,n=t.maxHr||t.max_hr||151,p=[];if(Array.isArray(t.hr_samples)&&t.hr_samples.length>=5){const I=[];for(const H of t.hr_samples){let L=null;typeof H=="number"?L=H:H&&typeof H=="object"&&(L=H.hr??H.bpm??H.value),L=Number(L),!isNaN(L)&&L>30&&L<250&&I.push(L)}if(I.length>=5){if(I.length>80){const L=(I.length-1)/79;for(let D=0;D<80;D++){const ne=Math.min(I.length-1,Math.round(D*L));p.push(I[ne])}}else p=I.slice();const H=I.reduce((L,D)=>L+D,0);c=Math.round(H/I.length),n=Math.max(...I)}}const y=p.length===0;if(y){const H=Math.max(50,c-40);for(let L=0;L<24;L++){const D=L/23;let ne;if(D<.15)ne=H+15+(c-H-15)*(D/.15);else if(D<.85){const e=(D-.15)/.7,d=Math.sin(e*Math.PI*6),i=Math.exp(-Math.pow((e-.72)*8,2));ne=c+d*9+i*(n-c)}else{const e=(D-.85)/.15;ne=c-5-(c-H-10)*e}p.push(Math.min(n,Math.max(H,ne)))}p[17]=n}const g=Math.max(40,Math.min(...p,c-30)),M=Math.max(n+12,168),$=Math.max(20,M-g),E=p.length,N=360,F=130,l=42,o=14,u=26,r=28,h=N-l-o,v=F-u-r,f=p.map((I,H)=>{const L=l+H/(E-1)*h,D=u+(1-(I-g)/$)*v;return{x:Math.round(L*10)/10,y:Math.round(D*10)/10,hr:Math.round(I)}});let S=`M ${f[0].x} ${f[0].y}`;for(let I=0;I<f.length-1;I++){const H=f[I],L=f[I+1],D=(H.x+L.x)/2;S+=` Q ${H.x} ${H.y}, ${D} ${(H.y+L.y)/2}`}const C=f[f.length-1];S+=` L ${C.x} ${C.y}`;const T=`${S} L ${C.x} ${F-r} L ${f[0].x} ${F-r} Z`,A=Math.round((u+(1-(c-g)/$)*v)*10)/10;let W=0,R=p[0];p.forEach((I,H)=>{I>=R&&(R=I,W=H)});const U=f[W]||f[0],Y=y?"OPTICAL SENSOR MODEL":"OPTICAL SENSOR STREAM (GARMIN)",j=`hrGrad_${String(t.id).replace(/[^a-zA-Z0-9]/g,"_")}`,J=Math.round(s/2);return`
<svg viewBox="0 0 ${N} ${F}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="${j}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.38"/>
<stop offset="70%" stop-color="#3B82F6" stop-opacity="0.12"/>
<stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.0"/>
</linearGradient>
</defs>

      
<line x1="${l}" y1="${u}" x2="${N-o}" y2="${u}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${l}" y1="${A}" x2="${N-o}" y2="${A}" stroke="rgba(56,189,248,0.4)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${l}" y1="${F-r}" x2="${N-o}" y2="${F-r}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

      
<text x="${l-4}" y="${A+4}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">${c}</text>
<text x="${l-4}" y="${u+10}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${M}</text>
<text x="${l-4}" y="${F-r}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${g}</text>

      
<path d="${T}" fill="url(#${j})"/>

      
<path d="${S}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.5));"/>

      
<text x="${l+2}" y="${u-8}" fill="${y?"var(--text-muted)":"#00F0FF"}" font-size="12.5" font-weight="800" letter-spacing="0.04em">${Y}</text>

      
<text x="${N-o}" y="${A-5}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">Avg ${c} bpm</text>

      
<circle cx="${U.x}" cy="${U.y}" r="4" fill="#ef4444" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(239,68,68,0.8));"/>
<circle cx="${U.x}" cy="${U.y}" r="7" fill="none" stroke="#ef4444" stroke-width="1" opacity="0.6"/>
<text x="${U.x}" y="${Math.max(14,U.y-8)}" fill="#ef4444" font-size="12.5" font-weight="800" text-anchor="middle">Peak ${n}</text>

      
<text x="${l}" y="${F-6}" fill="var(--text-muted)" font-size="12.5">0:00</text>
<text x="${l+h/2}" y="${F-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${J}:00</text>
<text x="${N-o}" y="${F-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${s.toFixed(1)}m</text>
</svg>
  `}function generateZoneBarsHtml(t){const{zones:s}=getGarminHrZoneBreakdown(t);return s.map(c=>`
<div style="display:flex; flex-direction:column; gap:2px; margin-bottom:6px;">
<div style="display:flex; justify-content:space-between; font-size:10.5px; line-height:1.2;">
<span style="color:#d4d4d8; font-weight:600;">
<span style="color:${c.color}; font-weight:800;">Z${c.num}</span> ${c.name} <small style="color:var(--text-muted); font-size:9.5px;">(${c.range})</small>
</span>
<span style="color:#fff; font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums;">
          ${c.durStr} <small style="color:var(--text-muted);">(${c.pct}%)</small>
</span>
</div>
<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
<div style="height:100%; width:${c.pct}%; background:${c.color}; border-radius:3px; box-shadow:0 0 6px ${c.color}66;"></div>
</div>
</div>
  `).join("")}function generateTeDualGaugesHtml(t){const s=t.aerobicTe??t.aerobic_te,c=t.anaerobicTe??t.anaerobic_te,n=s!=null&&!Number.isNaN(Number(s))?Number(s):0,p=c!=null&&!Number.isNaN(Number(c))?Number(c):0,a=(M,$)=>M>=4.5?{label:"Overreaching",desc:$?"High neuromuscular & PCr fatigue":"Heavy aerobic strain requiring 48h rest",color:"#ef4444"}:M>=3.5?{label:"Highly Improving",desc:$?"Drastically expands glycolytic buffering":"Major stimulus for VO2max expansion",color:"#f59e0b"}:M>=2.5?{label:"Impacting / Building",desc:$?"Improves anaerobic work tolerance":"Stimulates aerobic base & stroke volume",color:"#10b981"}:M>=1.5?{label:"Maintaining Base",desc:$?"Minor anaerobic speed maintenance":"Maintains aerobic fitness & mitochondrial density",color:"#00F0FF"}:{label:"Minor Recovery Stimulus",desc:"Active recovery flush with negligible debt",color:"#38bdf8"},y=a(n,!1),g=a(p,!0);return`
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Aerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${y.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${n.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100,n/5*100)}%; background:${y.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${y.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${y.desc}</div>
</div>

      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Anaerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${g.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${p.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100,p/5*100)}%; background:${g.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${g.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${g.desc}</div>
</div>
</div>
  `}function _parseActivityTimestampMs(t){if(typeof t=="number"&&Number.isFinite(t)&&t>0)return t>1e12?t:t*1e3;if(!t||typeof t!="string")return 0;const s=t.trim();if(!s)return 0;const c=s.includes(" ")&&!s.includes("T")?s.replace(" ","T"):s,n=new Date(c).getTime();return Number.isFinite(n)?n:0}function _formatClockHHMM(t){if(!t||!Number.isFinite(t))return"";const s=new Date(t);return isNaN(s.getTime())?"":`${String(s.getHours()).padStart(2,"0")}:${String(s.getMinutes()).padStart(2,"0")}`}function _coerceSetWeightKg(t){if(typeof t=="number"&&Number.isFinite(t))return t;const s=String(t??"").trim().toLowerCase();if(!s||/^(body(?:weight)?|bw)$/.test(s))return 0;const c=s.replace(/^2\s*[×x]\s*/i,"").replace(/kg$/i,"").trim(),n=parseFloat(c);return Number.isFinite(n)?n:0}function _parsePulseLogWindowMs(t,s,c){if(!t||typeof t!="string")return{startMs:0,endMs:0};const n=t.trim(),p=n.match(/^(\d{1,2}):(\d{2})$/);if(p&&s&&/^\d{4}-\d{2}-\d{2}$/.test(s)){const[y,g,M]=s.split("-").map(Number);let $=new Date(y,g-1,M,Number(p[1]),Number(p[2]),0,0).getTime();return c>0&&c-$>6*3600*1e3&&($+=24*3600*1e3),{startMs:$,endMs:$+59999}}const a=_parseActivityTimestampMs(n);return a>0?{startMs:a,endMs:a+59999}:{startMs:0,endMs:0}}function _garminCategoryMatchesPulseEx(t,s){const c=String(t||"").toLowerCase(),n=String(s||"").toLowerCase();if(!c||!n)return 0;const p=[{g:/squat|lunge|split_squat|thruster/,p:/squat|lunge/},{g:/bench|chest_press|floor_press|push_up|pushup|dip/,p:/bench|floor_press|pushup|dip|chest/},{g:/deadlift|rdl|good_morning|hip_hinge|swing/,p:/rdl|deadlift|swing|hinge/},{g:/row|pull_up|pullup|chin_up|lat_pull|curl/,p:/row|pullup|chin|curl/},{g:/shoulder_press|overhead_press|military_press|z_press/,p:/press|z_press|ohp/}];let a=-1,y=-1;return p.forEach((g,M)=>{g.g.test(c)&&a===-1&&(a=M),g.p.test(n)&&y===-1&&(y=M)}),a===-1||y===-1?0:a===y?1:-1}function decodeGarminStrengthSets(t){const s=t&&Array.isArray(t.exercise_sets)?t.exercise_sets:[];if(!s.length)return null;let n=_parseActivityTimestampMs(t.rawDate||t.date);const p=[],a=[];for(let l=0;l<s.length;l++){const o=s[l];if(!o||typeof o!="object")continue;const u=String(o.set_type||o.setType||"").toUpperCase(),r=Number(o.duration||0),h=Math.round(r);if(u==="REST"){h>0&&a.push(h),n>0&&r>0&&(n+=r*1e3);continue}if(u!=="ACTIVE")continue;const v=_parseActivityTimestampMs(o.start_time||o.startTime),f=v>0?v:n,S=f>0&&r>0?f+r*1e3:f;f>0&&(n=S);const C=Number(o.weight||0),T=C>=1e3?Math.round(C/1e3*10)/10:C>0?Math.round(C*10)/10:0,A=o.reps!==void 0&&o.reps!==null?o.reps:o.repetitionCount,W=A!=null&&A!==""&&!isNaN(Number(A))&&Number(A)>=0?Math.round(Number(A)):null;let R=0;l+1<s.length&&s[l+1]&&String(s[l+1].set_type||s[l+1].setType||"").toUpperCase()==="REST"&&(R=Math.round(Number(s[l+1].duration||0))),p.push({setNum:p.length+1,weightKg:T,weightLabel:T>0?`${T}kg`:"Bodyweight",shortWeightLabel:T>0?`${T}kg`:"BW",durationSec:h,reps:W,exerciseId:o.exercise_id?String(o.exercise_id):"",exerciseName:o.exercise_name?String(o.exercise_name).replace(/_/g," "):"",exerciseCategory:o.exercise_category||o.category?String(o.exercise_category||o.category).replace(/_/g," "):"",role:o.role?String(o.role):"",pulseSetNum:o.pulse_set_num!==void 0&&o.pulse_set_num!==null?Number(o.pulse_set_num):null,pulseWeightKg:o.pulse_weight_kg!==void 0&&o.pulse_weight_kg!==null?Number(o.pulse_weight_kg):null,pulseReps:o.pulse_reps!==void 0&&o.pulse_reps!==null?Number(o.pulse_reps):null,pulseTime:o.pulse_time?String(o.pulse_time):"",weightMismatch:o.weight_mismatch&&typeof o.weight_mismatch=="object"?o.weight_mismatch:null,restAfterSec:R,startMs:f,endMs:S,startClock:f>0?_formatClockHHMM(f):"",endClock:S>0?_formatClockHHMM(S):""})}if(!p.length)return null;const y=p.filter(l=>l.weightKg>0),g=y.length?Math.max(...y.map(l=>l.weightKg)):0,M=g>0?p.filter(l=>l.weightKg===g).length:0,$=a.length?Math.round(a.reduce((l,o)=>l+o,0)/a.length):0,E=p.reduce((l,o)=>l+o.durationSec,0),N=[];p.forEach(l=>{const o=l.weightKg>0?String(l.weightKg):"BW",u=N[N.length-1];u&&u.key===o?(u.count+=1,u.totalDur+=l.durationSec):N.push({key:o,weightKg:l.weightKg,count:1,totalDur:l.durationSec})});const F=N.map((l,o)=>{if(l.weightKg===0)return`${l.count}\xD7BW (${l.totalDur>=60?`${l.totalDur}s core hold`:`${l.totalDur}s`})`;const u=N[o+1];return u&&u.weightKg>0&&l.count<=2&&l.weightKg<=.78*u.weightKg?`${l.count}\xD7${l.weightKg}kg warm-up`:`${l.count}\xD7${l.weightKg}kg`});return{activeSets:p,activeCount:p.length,peakWeightKg:g,peakWeightCount:M,avgRestSec:$,totalTutSec:E,workingSummary:F.join(" \u2022 ")}}window.decodeGarminStrengthSets=decodeGarminStrengthSets;function alignGarminSetsWithPulse(t,s){const c=decodeGarminStrengthSets(t);if(!c||!c.activeSets.length||!s||!s.details||typeof s.details!="object")return null;const n=typeof getAllExercises=="function"?getAllExercises():[],p=String(t.rawDate||t.date||s.date||"").match(/\d{4}-\d{2}-\d{2}/),a=p?p[0]:"",y=[],g={};Object.entries(s.details).forEach(([e,d])=>{if(!d||!d.logged)return;const i=String(d.exercise_id||String(e||"").replace(/_(?:wu)?\d+$/,"")||"exercise");if(!g[i]){const V=n.find(Z=>Z.id===i),K=V?V.name:i.replace(/_/g," ").replace(/\b\w/g,Z=>Z.toUpperCase());g[i]={exId:i,exName:K,items:[]},y.push(i)}const b=String(e).match(/_wu(\d+)$/),x=!!d.explicit_warmup||!!b,k=String(e).match(/_(\d+)$/),O=Number(d.warmup_num||(b?b[1]:g[i].items.length+1)),G=x?0:Number(d.set_num||(k?k[1]:g[i].items.length+1)),_=x?O:1e3+G;g[i].items.push({key:e,raw:d,setNum:G,isExplicitWarmup:x,sortKey:_})});const M=[];let $=0;if(y.forEach(e=>{const d=g[e];d.items.sort((i,b)=>i.sortKey-b.sortKey),d.items.forEach(i=>{const b=i.raw,x=_parsePulseLogWindowMs(b.time,a,$);x.startMs>0&&($=x.startMs);const k=_coerceSetWeightKg(b.weight),O=b.reps!==void 0&&b.reps!==null&&!isNaN(Number(b.reps))?Math.round(Number(b.reps)):0;M.push({idx:M.length,key:i.key,exerciseId:e,exerciseName:d.exName,setNum:i.setNum,isExplicitWarmup:i.isExplicitWarmup,weightKg:k,weightLabel:k>0?`${k}kg`:"BW",reps:O,timeStr:b.time||"",logMinStartMs:x.startMs,logMinEndMs:x.endMs,isWarmupFlag:!!(b.is_warmup||b.status==="warmup")})})}),!M.length)return null;const E=c.activeSets,N=E.length,F=M.length;function l(e,d){let i=0;if(e.endMs>0&&d.logMinStartMs>0){let x=0;e.endMs<d.logMinStartMs?x=d.logMinStartMs-e.endMs:e.endMs>d.logMinEndMs&&(x=e.endMs-d.logMinEndMs);const k=x/1e3;if(k>900)return-1/0;k<=15?i+=55:k<=45?i+=48:k<=90?i+=38:k<=180?i+=24:k<=360?i+=10:i+=-5-(k-360)/30,e.startMs>0&&d.logMinEndMs<e.startMs-3e4&&(i-=6)}else i+=20;if(e.weightKg===0&&d.weightKg===0)i+=30;else if(e.weightKg>0&&d.weightKg>0){const x=Math.abs(e.weightKg-d.weightKg),k=Math.min(e.weightKg,d.weightKg)/Math.max(e.weightKg,d.weightKg);x<=.5?i+=40:x<=2.5?i+=26:k>=.85?i+=14:k>=.65?i+=2:i-=28}else i-=15;if(e.reps!==null&&d.reps>0){const x=Math.abs(e.reps-d.reps);x===0?i+=20:x===1?i+=12:x===2?i+=5:x>=5&&(i-=6)}const b=_garminCategoryMatchesPulseEx(`${e.exerciseCategory} ${e.exerciseName}`,d.exerciseId);return b>0?i+=12:b<0&&(i-=8),i}const o=-18,u=Array.from({length:N+1},()=>new Array(F+1).fill(0)),r=Array.from({length:N+1},()=>new Array(F+1).fill(0));for(let e=1;e<=N;e++)u[e][0]=0,r[e][0]=1;for(let e=1;e<=F;e++)u[0][e]=u[0][e-1]+o,r[0][e]=2;for(let e=1;e<=N;e++)for(let d=1;d<=F;d++){const i=u[e-1][d],b=u[e][d-1]+o,x=l(E[e-1],M[d-1]),k=x>0?u[e-1][d-1]+x:-1/0;k>=i&&k>=b?(u[e][d]=k,r[e][d]=3):i>=b?(u[e][d]=i,r[e][d]=1):(u[e][d]=b,r[e][d]=2)}const h=new Array(N).fill(null),v=[];let f=N,S=F;for(;f>0||S>0;){const e=r[f][S];f>0&&S>0&&e===3?(h[f-1]=M[S-1],f--,S--):f>0&&(S===0||e===1)?f--:(v.unshift(M[S-1]),S--)}const C={},T=[];y.forEach(e=>{const d={exerciseId:e,exerciseName:g[e].exName,warmupSets:[],workingSets:[],extraSets:[],firstMatchedIdx:1/0,lastMatchedIdx:-1,workingWeightKg:0,firstPulseIsWarmup:g[e].items[0]?!!(g[e].items[0].raw.is_warmup||g[e].items[0].raw.status==="warmup"):!1};C[e]=d,T.push(d)});const A=E.map((e,d)=>{const i=h[d];if(!i)return{...e,garminIdx:d,role:"unmatched",pulseSet:null,weightMismatch:null,repDelta:null};const b=e.weightKg>0&&i.weightKg>0&&Math.abs(e.weightKg-i.weightKg)>2.5?{garminKg:e.weightKg,pulseKg:i.weightKg}:null,x=e.reps!==null&&i.reps>0?e.reps-i.reps:null,k=i.isExplicitWarmup?"warmup":"working",O={...e,garminIdx:d,role:k,exerciseId:i.exerciseId,exerciseName:i.exerciseName,pulseSet:i,weightMismatch:b,repDelta:x},G=C[i.exerciseId];return G&&(i.isExplicitWarmup?G.warmupSets.push(O):(G.workingSets.push(O),d<G.firstMatchedIdx&&(G.firstMatchedIdx=d),d>G.lastMatchedIdx&&(G.lastMatchedIdx=d))),O});T.forEach(e=>{const d=e.workingSets.map(i=>i.weightKg).filter(i=>i>0);if(d.length>0){const i=[...d].sort((b,x)=>b-x);e.workingWeightKg=i[Math.floor(i.length/2)]}else e.workingSets.length>0&&(e.workingWeightKg=e.workingSets[0].pulseSet.weightKg)});const W=[];A.forEach((e,d)=>{if(e.pulseSet)return;const i=T.find(x=>x.workingSets.length>0&&d>x.firstMatchedIdx&&d<x.lastMatchedIdx&&(x.workingWeightKg===0||Math.abs(e.weightKg-x.workingWeightKg)<=2.5));if(i){e.role="extra_set",e.exerciseId=i.exerciseId,e.exerciseName=i.exerciseName,i.extraSets.push(e);return}const b=T.filter(x=>x.workingSets.length>0&&x.firstMatchedIdx>d).sort((x,k)=>x.firstMatchedIdx-k.firstMatchedIdx)[0];if(b){const x=A.slice(d+1,b.firstMatchedIdx).some(O=>!!O.pulseSet),k=e.weightKg>0&&b.workingWeightKg>0&&e.weightKg<=.78*b.workingWeightKg||e.weightKg===0&&b.workingWeightKg>0;if(!x&&k){e.role="warmup",e.exerciseId=b.exerciseId,e.exerciseName=b.exerciseName,b.warmupSets.push(e);return}}e.role="unmatched",W.push(e)});const R=T.filter(e=>e.warmupSets.length>0||e.workingSets.length>0||e.extraSets.length>0),U=R.map(e=>{const d=e.warmupSets.length,b=e.workingSets.concat(e.extraSets).length,x=e.workingWeightKg>0?`${e.workingWeightKg}kg`:"BW",k=e.workingSets.map(_=>_.pulseSet&&_.pulseSet.reps>0?_.pulseSet.reps:null).filter(_=>_!==null),O=k.length?` (${k.join(",")}r)`:"",G=[];return d>0&&G.push(`${d} WU`),b>0&&G.push(`${b}\xD7${x}${O}`),`${e.exerciseName}: ${G.join(" + ")}`});A.forEach(e=>{e.pulseSet&&(e.exerciseId=e.pulseSet.exerciseId,e.exerciseName=e.pulseSet.exerciseName)});const Y=A.filter(e=>e.role==="working").length,j=A.filter(e=>e.role==="warmup").length,J=A.filter(e=>e.role==="extra_set").length,I=A.some(e=>e.reps!==null),H=A.reduce((e,d)=>e+(d.reps||0),0),L=Number(t.total_reps||0)>0?Number(t.total_reps):I?H:null,D=M.reduce((e,d)=>e+(d.reps||0),0),ne=L!==null&&L>D&&j+J+W.length>0?L-D:0;return{decoded:c,annotatedSets:A,exerciseGroups:R,unmatchedSets:W,unmatchedPulse:v,matchedCount:Y,warmupCount:j,extraCount:J,hasPerSetGarminReps:I,garminTotalReps:L,pulseTotalReps:D,inferredWarmupReps:ne,matchedSummary:U.join(" \u2022 ")}}window.alignGarminSetsWithPulse=alignGarminSetsWithPulse;function _buildAlignedFromBackendEnrichedSets(t,s){if(!s||!Array.isArray(s.activeSets)||!s.activeSets.length||!s.activeSets.some(r=>r.exerciseId&&r.role))return null;const n={},p=[],a=[],y=[];s.activeSets.forEach((r,h)=>{const v=r.exerciseId||"",f=r.exerciseName||(v?v.replace(/_/g," ").replace(/\b\w/g,R=>R.toUpperCase()):""),S=r.role||(v?"working":"unmatched");let C=null,T=null;if(S==="working"&&v){const R=r.pulseReps!==null?r.pulseReps:r.reps!==null?r.reps:0;C={exerciseId:v,exerciseName:f,setNum:r.pulseSetNum||1,weightKg:r.pulseWeightKg!==null?r.pulseWeightKg:r.weightKg,reps:R,timeStr:r.pulseTime||""},r.reps!==null&&R>0&&(T=r.reps-R)}const A=r.weightMismatch?{garminKg:r.weightMismatch.garminKg??r.weightMismatch.garmin_kg,pulseKg:r.weightMismatch.pulseKg??r.weightMismatch.pulse_kg}:null,W={...r,garminIdx:h,role:S,exerciseId:v,exerciseName:f,pulseSet:C,repDelta:T,weightMismatch:A};y.push(W),v&&(S==="warmup"||S==="working"||S==="extra_set")?(n[v]||(n[v]={exerciseId:v,exerciseName:f,warmupSets:[],workingSets:[],extraSets:[],workingWeightKg:0},p.push(n[v])),S==="warmup"?n[v].warmupSets.push(W):S==="extra_set"?n[v].extraSets.push(W):n[v].workingSets.push(W)):a.push(W)});const g=p.map(r=>{const h=r.workingSets.map(W=>W.weightKg).filter(W=>W>0).sort((W,R)=>W-R);r.workingWeightKg=h.length?h[Math.floor(h.length/2)]:r.workingSets[0]?.pulseSet?.weightKg||0;const v=r.warmupSets.length,f=r.workingSets.length+r.extraSets.length,S=r.workingWeightKg>0?`${r.workingWeightKg}kg`:"BW",C=r.workingSets.map(W=>W.pulseSet&&W.pulseSet.reps>0?W.pulseSet.reps:null).filter(W=>W!==null),T=C.length?` (${C.join(",")}r)`:"",A=[];return v>0&&A.push(`${v} WU`),f>0&&A.push(`${f}\xD7${S}${T}`),`${r.exerciseName}: ${A.join(" + ")}`}),M=y.filter(r=>r.role==="working").length,$=y.filter(r=>r.role==="warmup").length,E=y.filter(r=>r.role==="extra_set").length,N=y.some(r=>r.reps!==null),F=y.reduce((r,h)=>r+(h.reps||0),0),l=Number(t.total_reps||0)>0?Number(t.total_reps):N?F:null,o=y.reduce((r,h)=>r+(h.pulseSet&&h.pulseSet.reps||0),0),u=l!==null&&l>o&&$+E+a.length>0?l-o:0;return{decoded:s,annotatedSets:y,exerciseGroups:p,unmatchedSets:a,unmatchedPulse:[],matchedCount:M,warmupCount:$,extraCount:E,hasPerSetGarminReps:N,garminTotalReps:l,pulseTotalReps:o,inferredWarmupReps:u,matchedSummary:t.matched_exercises_summary||g.join(" \u2022 ")}}function renderHistoryList(){const t=document.getElementById("trainViewHistory");if(!t)return;const s=typeof recentActivitiesData<"u"&&Array.isArray(recentActivitiesData)?recentActivitiesData:window.BAKED_LIVE_STATE&&window.BAKED_LIVE_STATE.garmin&&Array.isArray(window.BAKED_LIVE_STATE.garmin.recent_activities)?window.BAKED_LIVE_STATE.garmin.recent_activities:[],c=document.getElementById("btnTrainHistory");c&&(c.innerText=`History (${s.length})`);const n=typeof escapeHtml=="function"?escapeHtml:(a=>String(a??"").replace(/[&<>"']/g,y=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[y]));t.innerHTML="";const p=typeof buildGarminPulseMatchMap=="function"?buildGarminPulseMatchMap(s):null;s.forEach(a=>{const y=typeof formatActivityDisplay=="function"?formatActivityDisplay(a):{isToday:!1,displayDate:a.date||""},g=y.isToday,M=y.displayDate,$=typeof getEgmWorkoutBreakdown=="function"?getEgmWorkoutBreakdown(a,g):{recoveryPill:"",primaryTakeaway:"",achievements:[],stressors:[],recoveryProtocol:[]},E=getGarminHrZoneBreakdown(a),N=Array.isArray(a.hr_samples)&&a.hr_samples.length>=5,F=N?"OPTICAL SENSOR STREAM (GARMIN)":"OPTICAL SENSOR MODEL",l=p?p.get(String(a.id))||null:typeof getMatchedPulseSessionForGarmin=="function"?getMatchedPulseSessionForGarmin(a,s):null,o=decodeGarminStrengthSets(a),u=o&&l?alignGarminSetsWithPulse(a,l):o?_buildAlignedFromBackendEnrichedSets(a,o):null,r=l?String(l.id||l.client_event_id||""):"",h=l?String(l.dateStr||String(l.date||"").slice(0,10)):"";let v="",f=[];if(l){let i=l.title||"";i||(l.preset==="gym"?i="Option A: Heavy Barbell Strength & Hinge":l.preset==="combat"?i="Option B: Hybrid Work Capacity Circuit":i="Pulse Strength Session");const b=[a.total_sets?`${a.total_sets} Garmin Sets`:l.setsLogged?`${l.setsLogged} Sets Logged`:"",a.avgHr?`${a.avgHr} bpm HR`:"",a.calories?`${a.calories} kcal`:""].filter(Boolean).join(" \u2022 ");let x="";if(l.details&&typeof l.details=="object"){const k={},O=[],G=typeof getAllExercises=="function"?getAllExercises():[];Object.entries(l.details).forEach(([V,K])=>{if(!K||!K.logged)return;const Z=K.exercise_id||String(V||"").replace(/_(?:wu)?\d+$/,"")||"exercise";if(!k[Z]){const q=G.find(te=>te.id===Z);k[Z]={exId:Z,name:q?q.name:Z.replace(/_/g," ").replace(/\b\w/g,te=>te.toUpperCase()),sets:[],plainSets:[]},O.push(Z)}const w=String(V).match(/_wu(\d+)$/),ie=!!K.explicit_warmup||!!w,z=String(V).match(/_(\d+)$/),Q=Number(K.warmup_num||(w?w[1]:k[Z].sets.length+1)),X=ie?0:Number(K.set_num||(z?z[1]:k[Z].sets.length+1)),ee=ie?Q:1e3+X,re=K.weight==="Bodyweight"||K.weight==="Body"||K.weight===0||K.weight==="0",ae=re?0:Number(String(K.weight??"").replace(/^2\s*[×x]\s*/i,"").replace(/kg$/i,"")),le=!re&&K.weight!==void 0&&K.weight!==null&&K.weight!==""?`${K.weight}kg`:re?"BW":"",m=Number(K.reps||0),B=`${m}r`,P=le?`${le} \xD7 ${B}`:B;k[Z].sets.push({detailKey:V,sortKey:ee,isExplicitWu:ie,wNum:Number.isFinite(ae)?ae:0,rNum:Number.isFinite(m)?m:0,labelStr:P}),k[Z].plainSets.push(ie?`WU ${P}`:P)});const _=O.map(V=>k[V]);f=_.map(V=>`${n(V.name)} (${n(V.plainSets.join(", "))})`),_.length>0&&(x=`
<div style="margin-top:6px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:4px; font-size:10.5px;">
              ${_.map(V=>{V.sets.sort((z,Q)=>z.sortKey-Q.sortKey);const K=u&&Array.isArray(u.exerciseGroups)?u.exerciseGroups.find(z=>z.exerciseId===V.exId):null,Z={};K&&Array.isArray(K.workingSets)&&K.workingSets.forEach(z=>{z.weightMismatch&&z.pulseSet&&z.pulseSet.key&&(Z[z.pulseSet.key]=z.weightMismatch.garminKg)});const w=K&&Array.isArray(K.warmupSets)?K.warmupSets.filter(z=>!z.pulseSet).map(z=>{const Q=z.weightKg>0?`${z.weightKg}kg`:"BW",X=z.reps!==null?` \xD7 ${z.reps}r`:"";return`<span title="Warm-up recorded on Garmin watch" style="display:inline-flex; align-items:center; gap:2px; font-size:9.5px; font-family:var(--font-mono); font-weight:700; padding:1px 5px; border-radius:4px; background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.45); color:#fbbf24;">\u{1F525} WU ${n(Q)}${n(X)} \u231A</span>`}).join(""):"",ie=V.sets.map(z=>{const Q=Z[z.detailKey]!==void 0?String(Z[z.detailKey]):"",X=Q!=="",ee=z.isExplicitWu?"background:rgba(245,158,11,0.16); border:1px solid rgba(245,158,11,0.45); color:#fbbf24;":X?"background:rgba(245,158,11,0.14); border:1px solid rgba(245,158,11,0.55); color:#fde68a;":"background:rgba(0,229,255,0.08); border:1px solid rgba(0,229,255,0.22); color:var(--cyan);",re=z.isExplicitWu?"\u{1F525} WU ":"";return`<button type="button" data-sess-id="${n(r)}" data-sess-date="${n(h)}" data-detail-key="${n(z.detailKey)}" data-ex-name="${n(V.name)}" data-weight="${n(z.wNum)}" data-reps="${n(z.rNum)}" data-watch-weight="${n(Q)}" onclick="openEditHistorySetModal(this.dataset.sessId, this.dataset.sessDate, this.dataset.detailKey, this.dataset.exName, Number(this.dataset.weight), Number(this.dataset.reps), this.dataset.watchWeight)" title="Tap to edit weight or reps" style="cursor:pointer; font-family:var(--font-mono); font-size:10px; font-weight:700; padding:1px 5px; border-radius:4px; ${ee}">${re}${n(z.labelStr)} \u270E</button>`}).join("");return`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 7px;">
<div style="font-weight:700; color:#fff; margin-bottom:4px;">${n(V.name)}</div>
<div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${w}${ie}</div>
</div>
              `}).join("")}
</div>
          `)}else if(l.conditioningDrill){const k=l.conditioningDrill,O=k.totalSeconds?`${Math.round(k.totalSeconds/60)}m`:"";x=`
<div style="margin-top:6px; font-size:10.5px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 8px;">
<span style="font-weight:700; color:#fff;">${n(k.name||"Conditioning")}:</span>
<span style="color:var(--cyan); font-family:var(--font-mono); font-size:10px; margin-left:4px;">${n(String(k.format||"interval").toUpperCase())} \u2022 ${k.roundsCompleted||k.rounds||1} rounds ${O?`(${O})`:""}</span>
</div>
        `}v=`
<div style="margin:6px 0 8px; padding:8px 10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:9.5px; font-weight:800; background:rgba(16,185,129,0.22); border:1px solid #10b981; color:#10b981; padding:2px 6px; border-radius:4px; letter-spacing:0.04em;">\u{1F517} MATCHED WITH PULSE</span>
<span style="font-size:11.5px; font-weight:800; color:#fff;">${n(i)}</span>
</div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${b?`<span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono);">${n(b)}</span>`:""}
              <button type="button" class="header-pill-btn" data-act-id="${n(a.id)}" onclick="unlinkGarminPulseMatch(this.dataset.actId)" title="Unlink Pulse session from this Garmin recording" style="padding:1px 6px; font-size:9.5px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:var(--text-secondary); cursor:pointer;">\u2715 Unlink</button>
            </div>
</div>
          ${x}
</div>
      `}let S="";if(o){const i=o.avgRestSec>0?` \u2022 Avg Rest ${o.avgRestSec}s`:"";let b="",x=o.workingSummary,k="";if(u){const O=[`${u.matchedCount} Matched`];u.warmupCount>0&&O.push(`${u.warmupCount} Warm-up${u.warmupCount===1?"":"s"}`),u.extraCount>0&&O.push(`${u.extraCount} Extra`),b=`${o.activeCount} Active Sets \u2022 ${O.join(" + ")}${i}`,x=u.matchedSummary||o.workingSummary;const G=(w,ie="")=>{const z=w.startClock&&w.endClock?`${w.startClock}\u2013${w.endClock}`:"",Q=w.restAfterSec>0?` \u2022 ${w.restAfterSec}s Rest`:"",X=w.exerciseName||ie||w.pulseSet&&w.pulseSet.exerciseName||"";if(w.role==="warmup")return`
<div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.32); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
<strong style="color:#fbbf24;">\u{1F525} ${X?`${n(X)} \u2022 `:""}WARM-UP (G${w.setNum}): ${w.weightKg===0?"BW":n(w.weightLabel)}</strong>
${w.reps!==null?`<span style="color:#fbbf24; font-weight:700;">\u231A ${n(w.reps)}r</span>`:'<span style="color:#fbbf24; font-weight:700;">Unlogged</span>'}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${z?`${n(z)} \u2022 `:""}${w.durationSec}s TUT${Q}
</div>
</div>`;if(w.pulseSet){const ee=w.pulseSet,re=w.reps!==null?w.repDelta===0?`<span style="color:#10b981; font-weight:700;">\u231A ${n(w.reps)}r \u2713</span>`:`<span style="color:#fbbf24; font-weight:700;">\u231A ${n(w.reps)}r vs \u{1F4F1} ${n(ee.reps)}r</span>`:"",ae=w.weightMismatch?`<div style="margin-top:3px; display:flex; align-items:center; justify-content:space-between; gap:6px; flex-wrap:wrap; color:#fbbf24; font-weight:700;">
<span>\u26A0\uFE0F Watch ${n(w.weightMismatch.garminKg)}kg vs App ${n(w.weightMismatch.pulseKg)}kg</span>
${l&&ee.key?`<button type="button" data-sess-id="${n(r)}" data-sess-date="${n(h)}" data-detail-key="${n(ee.key)}" data-watch-wt="${n(w.weightMismatch.garminKg)}" data-reps="${n(ee.reps)}" onclick="quickApplyWatchWeightToPulseSet(this.dataset.sessId, this.dataset.sessDate, this.dataset.detailKey, Number(this.dataset.watchWt), Number(this.dataset.reps))" style="cursor:pointer; font-family:var(--font-mono); font-size:9.5px; font-weight:800; padding:2px 6px; border-radius:4px; background:rgba(245,158,11,0.22); border:1px solid rgba(245,158,11,0.55); color:#fde68a;">\u26A1 Use Watch ${n(w.weightMismatch.garminKg)}kg</button>`:""}
</div>`:"";return`
<div style="background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.24); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
<strong style="color:#fff;">${X?`${n(X)} \u2022 `:""}Set ${n(ee.setNum)} (G${w.setNum}): ${w.weightKg===0?"BW":n(w.weightLabel)} \xD7 ${n(ee.reps)}r</strong>
${re}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${z?`${n(z)} \u2022 `:""}${w.durationSec}s TUT${Q}${ee.timeStr?` \u2022 \u{1F4F1} ${n(ee.timeStr)}`:""}
</div>
${ae}
</div>`}return`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
<strong style="color:#cbd5e1;">${X?`${n(X)} \u2022 `:""}${w.role==="extra_set"?"Extra Set":"Unmatched"} (G${w.setNum}): ${w.weightKg===0?"BW Hold":n(w.weightLabel)}</strong>
${w.reps!==null?`<span style="color:var(--primary); font-weight:700;">\u231A ${n(w.reps)}r</span>`:""}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${z?`${n(z)} \u2022 `:""}${w.durationSec}s TUT${Q}
</div>
</div>`},_=u.exerciseGroups.map(w=>{const ie=[...w.warmupSets,...w.workingSets,...w.extraSets].sort((z,Q)=>z.garminIdx-Q.garminIdx);return`
<div style="margin-bottom:8px;">
<div style="font-size:10.5px; font-weight:800; color:#e2e8f0; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
<span>\u{1F3CB}\uFE0F ${n(w.exerciseName)}</span>
<span style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono);">${w.warmupSets.length>0?`${w.warmupSets.length} WU + `:""}${w.workingSets.length+w.extraSets.length} working</span>
</div>
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:5px;">
${ie.map(z=>G(z,w.exerciseName)).join("")}
</div>
</div>`}).join(""),V=u.unmatchedSets.length>0?`
<div style="margin-bottom:6px;">
<div style="font-size:10px; font-weight:800; color:var(--text-muted); margin-bottom:4px;">Other Watch Sets</div>
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:5px;">
${u.unmatchedSets.map(G).join("")}
</div>
</div>`:"",K=[];u.garminTotalReps!==null&&K.push(`\u231A ${u.garminTotalReps} Garmin reps`),K.push(`\u{1F4F1} ${u.pulseTotalReps} Pulse reps`),u.inferredWarmupReps>0&&K.push(`\u{1F525} ~${u.inferredWarmupReps} warm-up/unlogged reps`);const Z=`
<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5; font-family:var(--font-mono);">
<strong style="color:#10b981;">\u{1F517} Rep Reconciliation:</strong> ${n(K.join(" \u2022 "))}
</div>`;k=`${_}${V}${Z}`}else{const O=o.peakWeightKg>0?`Peak Load ${o.peakWeightKg}kg (${o.peakWeightCount} working ${o.peakWeightCount===1?"set":"sets"})`:"Bodyweight / Core";b=`${o.activeCount} Active Sets \u2022 ${O}${i}`;const G=f.length>0?`<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5;">
<strong style="color:#10b981;">\u{1F517} Pulse Rep Cross-Reference:</strong> ${f.join(" \u2022 ")}
</div>`:"";k=`
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:5px;">
                ${o.activeSets.map(_=>`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center;">
<strong style="color:#fff;">Set ${_.setNum}: ${_.weightKg===0?"BW Hold":n(_.weightLabel)}</strong>
                      ${_.reps!==null?`<span style="color:var(--primary); font-weight:700;">${n(_.reps)} reps</span>`:""}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
                      ${_.startClock?`${n(_.startClock)} \u2022 `:""}${_.durationSec}s TUT${_.restAfterSec>0?` \u2022 ${_.restAfterSec}s Rest`:""}
</div>
</div>
                `).join("")}
</div>
              ${G}`}S=`
<div style="margin:6px 0 8px; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.24); border-radius:9px; padding:8px 10px;">
          
<div style="font-size:10.5px; font-weight:800; color:var(--cyan); letter-spacing:0.02em;">
            \u231A GARMIN F\u0112NIX 8 SET TELEMETRY: <span style="color:#fff;">${n(b)}</span>
</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:3px; font-family:var(--font-mono);">
            ${n(x)}
</div>
          
<details style="margin-top:6px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.07); border-radius:7px; overflow:hidden;">
<summary style="font-size:10.5px; font-weight:700; color:var(--text-secondary); padding:6px 9px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>\u{1F52C} View All ${o.activeCount} Garmin Watch Sets &amp; Rest Intervals (${o.totalTutSec}s TUT)</span>
<span style="color:var(--text-muted);">\u25BE</span>
</summary>
<div style="padding:8px 9px; border-top:1px solid rgba(255,255,255,0.06);">
              ${k}
</div>
</details>
</div>
      `}const C=a.subTitle||a.sub_title||a.name||"Workout",A=/^(cardio|indoor_cardio|cardio_training|hiit|hiit_training|strength|strength_training|fitness_equipment)$/i.test(String(C).trim())&&l&&l.title?`${l.title} (Garmin ${C})`:C,W=a.source==="manual_app_entry",R=!l&&!W&&typeof getUnclaimedPulseSessionsForActivity=="function"?getUnclaimedPulseSessionsForActivity(a,s,p):[],U=R.length>0?`<button type="button" class="header-pill-btn" data-act-id="${n(a.id)}" data-session-key="${n(R[0]._matchKey)}" onclick="linkGarminPulseMatch(this.dataset.actId, this.dataset.sessionKey)" title="Link ${n(R[0].title||"Pulse Workout")}" style="padding:3px 8px; font-size:11px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); color:#10b981; cursor:pointer;">\u{1F517} Link Pulse</button>`:"",Y=a.durationMin??a.duration_min??0,j=a.avgHr??a.avg_hr??null,J=a.maxHr??a.max_hr??null,I=Number(a.aerobicTe??a.aerobic_te??0),H=Number(a.anaerobicTe??a.anaerobic_te??0),L=/walk|run|ruck|hike/i.test(`${a.name||""} ${C} ${a.activity_type_key||""}`),D=a.steps?Number(a.steps):L&&Y?Math.round(Number(Y)*91.5):0,ne=a.distance_miles?Number(a.distance_miles):D>0?Number((D/1810).toFixed(2)):0,e=L&&D>0?`<span>\u2022</span><span style="color:var(--cyan); font-weight:700;">\u{1F463} ${D.toLocaleString()} activity steps${ne>0?` (${ne} mi)`:""}</span>`:"",d=document.createElement("div");d.className=`history-card ${g?"today-highlight":""}`,d.style.background=g?"#141a24":"#11141c",d.style.border=g?"1px solid rgba(0, 229, 255, 0.4)":"1px solid rgba(255,255,255,0.08)",d.style.borderRadius="14px",d.style.padding="12px 14px",d.innerHTML=`
      
<div class="history-top-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
<div>
<div class="history-title" style="font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px;">
            ${n(A)}
</div>
<div class="history-meta-row" style="font-size:11.5px; color:var(--text-muted); margin-top:2px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
<span>${n(M)}</span>
<span>\u2022</span>
<span>\u23F1 ${Y} min</span>
<span>\u2022</span>
<span style="color:var(--primary); font-weight:800;">\u{1F525} ${a.calories||0} kcal</span>
            ${e}
</div>
</div>
<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${g?'<span style="font-size:10px; font-weight:900; color:var(--primary); background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.3); padding:2px 7px; border-radius:4px; letter-spacing:0.04em;">TODAY</span>':""}
          ${$.recoveryPill}
</div>
</div>

      ${v}
      ${S}

      
<div style="font-size:11.5px; color:#d4d4d8; line-height:1.4; margin:4px 0 8px; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;">
        ${$.primaryTakeaway}
</div>

      
<div class="history-stats-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 4px; text-align:center;">
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:var(--primary);">${a.calories||0}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Active Burn</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#fff;">${j||"--"}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Avg HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#38bdf8;">${J||"--"}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Peak HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#a78bfa;">${I.toFixed(1)} / ${H.toFixed(1)}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Aerobic/Anaer</div>
</div>
</div>

      
<div style="margin-top:6px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 10px;">
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; margin-bottom:5px;">
<span style="color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Garmin HR Intensity Zones</span>
<span style="color:var(--primary); font-weight:700; font-family:var(--font-mono); font-size:10.5px;">${E.dominantZoneText}</span>
</div>
<div style="display:flex; height:6px; border-radius:3px; overflow:hidden; gap:2px; background:rgba(255,255,255,0.06);">
          ${E.zones.filter(i=>i.pct>0).map(i=>`<div style="height:100%; width:${i.pct}%; background:${i.color}; border-radius:2px; box-shadow:0 0 4px ${i.color}88;" title="Z${i.num}: ${i.durStr} (${i.pct}%)"></div>`).join("")}
</div>
</div>

      
<div class="benefits-toggle-btn" data-act-id="${n(a.id)}" onclick="toggleBenefitAccordion(this.dataset.actId)" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); padding:8px 12px; border-radius:8px; cursor:pointer; font-size:11.5px; font-weight:700; color:var(--cyan);">
<span>\u{1F52C} View Garmin Telemetry, Charts & Recovery (6 sections)</span>
<span class="accordion-arrow" id="arrow_${n(a.id)}" style="transition:transform 0.2s;">\u25BE</span>
</div>

<div class="benefits-accordion-body" id="benefit_body_${n(a.id)}" style="display:none; flex-direction:column; gap:10px; margin-top:8px; padding:12px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.08); border-radius:12px; font-size:11.5px; line-height:1.45;">
        
        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:var(--primary);">\u{1F4C8}</span> Heart Rate Telemetry Curve
</span>
<span style="font-size:10px; font-weight:700; color:${N?"var(--primary)":"var(--text-muted)"};">${F}</span>
</div>
          ${generateHrSvgChart(a)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#f59e0b;">\u{1F4CA}</span> 5-Zone Physiological Intensity
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">Max HR: 190 bpm</span>
</div>
          ${generateZoneBarsHtml(a)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#a78bfa;">\u{1F3AF}</span> Firstbeat Training Effect (TE)
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">0.0 \u2013 5.0 Scale</span>
</div>
          ${generateTeDualGaugesHtml(a)}
</div>

        
<div style="border-left:2px solid var(--primary); padding-left:8px;">
<div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u2713 4. What This Workout Achieved
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${($.achievements||[]).map(i=>`<div>${i}</div>`).join("")}
</div>
</div>

        
<div style="border-left:2px solid #f59e0b; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#f59e0b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u26A0\uFE0F 5. Potential Stressors & Biomechanical Impact
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${($.stressors||[]).map(i=>`<div>${i}</div>`).join("")}
</div>
</div>

        
<div style="border-left:2px solid #38bdf8; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u{1F6E1}\uFE0F 6. Recommended Recovery Protocol & Window
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${($.recoveryProtocol||[]).map(i=>`<div>${i}</div>`).join("")}
</div>
</div>

</div>

<div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10.5px; color:var(--text-muted);">${W?"Pulse Logged Entry":"Garmin Telemetry"} \u2022 ID: ${n(a.id)}</span>
<div style="display:flex; align-items:center; gap:6px;">
${U}
<button class="header-pill-btn" style="padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:var(--text-secondary);" data-act-id="${n(a.id)}" onclick="openAnnotateModal(this.dataset.actId)">
          Annotate Notes \u270E
</button>
</div>
</div>
    `,t.appendChild(d)})}let _renphoHistoryCache=null,_renphoHistoryFetchedAtMs=0;async function renderRenphoTrendChart(t={}){let s=Array.isArray(_renphoHistoryCache)?_renphoHistoryCache:[];const c=!!(t&&t.force===!0),n=Date.now()-_renphoHistoryFetchedAtMs>300*1e3;if(c||s.length===0||n)try{const m=await(typeof pulseApiFetch=="function"?pulseApiFetch("/api/renpho/history?days=30",{promptAuthOn401:!1}):fetch("/api/renpho/history?days=30"));if(m&&m.ok){const B=await m.json(),P=Array.isArray(B)||B&&Array.isArray(B.history),q=Array.isArray(B)?B:B&&Array.isArray(B.history)?B.history:[];P&&(c||q.length>0||s.length===0)&&(s=q,_renphoHistoryCache=q,_renphoHistoryFetchedAtMs=Date.now(),typeof window<"u"&&(window.PULSE_RENPHO_HISTORY=q))}}catch(m){console.warn("[RenphoChart] Fetch failed, using fallback live state:",m)}try{const m=document.getElementById("bodyAvg7dWeightVal");if(m&&Array.isArray(s)&&s.length>0){const B=s[s.length-1],P=Number(B&&(B["7d_avg_weight"]??B.weight_kg));Number.isFinite(P)&&P>0&&(m.innerText=`7-Day EMA: ${P.toFixed(2)} kg`)}}catch{}let p=document.getElementById("renphoTrendChartContainer");if(!p){p=document.createElement("div"),p.id="renphoTrendChartContainer";const m=document.getElementById("renphoSyncTime"),B=m?m.closest(".card"):document.querySelector("#tab-body .card")||document.querySelector(".card");B?B.appendChild(p):(document.getElementById("tab-today")||document.querySelector("main")||document.body).appendChild(p)}if(!p)return;p.style.marginTop="14px",p.style.paddingTop="12px",p.style.borderTop="1px solid rgba(255,255,255,0.06)";const a=()=>{const m=typeof window<"u"&&window.BAKED_LIVE_STATE?window.BAKED_LIVE_STATE:{},B=m.renpho||m.athlete||(typeof window<"u"?window.athleteProfile:null)||{},P=Number(B.weight_kg),q=Number(B.body_fat_pct),te=Number(B.lean_mass_kg),se=Number.isFinite(P)&&P>0?`Latest reading: ${P.toFixed(2)} kg${Number.isFinite(q)&&q>0?` \u2022 ${q.toFixed(1)}% BF`:""}${Number.isFinite(te)&&te>0?` \u2022 ${te.toFixed(2)} kg LBM`:""}`:"Sync Renpho or log a manual weigh-in to begin tracking.";p.innerHTML=`
<div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.14); border-radius:12px; padding:16px; text-align:center;">
<div style="font-size:12px; font-weight:800; color:#e4e4e7; margin-bottom:4px;">Need \u2265 2 weigh-ins to plot 30-day trend</div>
<div style="font-size:11px; color:var(--text-muted);">${se}</div>
</div>`};if(!s||s.length<2){a();return}const y=m=>{const B=m&&m.timestamp!==void 0&&m.timestamp!==null?Number(m.timestamp):NaN;if(Number.isFinite(B)&&B>0)return B<1e11?B*1e3:B;if(m&&m.date_str){const P=new Date(m.date_str).getTime();if(Number.isFinite(P)&&P>0)return P}return 0};s=s.slice().sort((m,B)=>y(m)-y(B));const g=s.map(m=>{const B=y(m)||Date.now(),P=new Date(B),q=isNaN(P.getTime())?"":`${P.getMonth()+1}/${P.getDate()}`;return{ts:B,dateLabel:q,dateStr:m.date_str||q,bf:Number(m.body_fat_pct||0),lm:Number(m.lean_mass_kg||0),wt:Number(m.weight_kg||0)}}).filter(m=>m.bf>5&&m.lm>20);if(g.length<2){a();return}const M=7*86400*1e3;g.forEach((m,B)=>{const P=g.slice(0,B+1).filter(se=>m.ts-se.ts<=M),q=P.reduce((se,oe)=>se+oe.bf,0)/P.length,te=P.reduce((se,oe)=>se+oe.lm,0)/P.length;m.maBf=Math.round(q*100)/100,m.maLm=Math.round(te*100)/100});const $=g[0],E=g[g.length-1],F=Math.max(86400*1e3,E.ts-$.ts)/(7*86400*1e3),o=(E.bf-$.bf)/F,u=$.wt&&$.lm?$.wt-$.lm:$.wt*($.bf/100),v=((E.wt&&E.lm?E.wt-E.lm:E.wt*(E.bf/100))-u)/F,f=`${v<=0?"":"+"}${v.toFixed(2)} kg/wk`,S=`${o<=0?"":"+"}${o.toFixed(2)} %/wk`,C=g.map(m=>m.bf),T=g.map(m=>m.lm),A=Math.min(...C),W=Math.max(...C),R=Math.min(...T),U=Math.max(...T),Y=Math.max(.15,(W-A)*.12),j=Math.floor((A-Y)*10)/10,J=Math.ceil((W+Y)*10)/10,I=Math.max(.4,J-j),H=Math.max(.2,(U-R)*.12),L=Math.floor((R-H)*10)/10,D=Math.ceil((U+H)*10)/10,ne=Math.max(.6,D-L),e=380,d=180,i=50,b=54,x=24,k=28,O=e-i-b,G=d-x-k,_=g.map((m,B)=>{const P=Math.round((i+B/Math.max(1,g.length-1)*O)*10)/10,q=Math.round((x+(1-(m.bf-j)/I)*G)*10)/10,te=Math.round((x+(1-(m.maBf-j)/I)*G)*10)/10,se=Math.round((x+(1-(m.lm-L)/ne)*G)*10)/10,oe=Math.round((x+(1-(m.maLm-L)/ne)*G)*10)/10;return{...m,x:P,yBf:q,yBfMa:te,yLm:se,yLmMa:oe}}),V=m=>{if(_.length===1)return`M ${_[0].x} ${_[0][m]}`;let B=`M ${_[0].x} ${_[0][m]}`;for(let q=0;q<_.length-1;q++){const te=_[q],se=_[q+1],oe=(te.x+se.x)/2;B+=` Q ${te.x} ${te[m]}, ${oe} ${(te[m]+se[m])/2}`}const P=_[_.length-1];return B+=` L ${P.x} ${P[m]}`,B},K=V("yBf"),Z=V("yBfMa"),w=V("yLm"),ie=V("yLmMa"),z=`${K} L ${_[_.length-1].x} ${d-k} L ${_[0].x} ${d-k} Z`,Q=x,X=Math.round((x+G*.5)*10)/10,ee=d-k,re=g[0].dateLabel||"D-30",ae=g[Math.floor(g.length/2)].dateLabel||"D-15",le=g[g.length-1].dateLabel||"Today";p.innerHTML=`
    
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:12px;">\u{1F4C8}</span>
<span style="font-size:10.5px; font-weight:800; letter-spacing:0.08em; color:#fff; text-transform:uppercase;">
          30-DAY RENPHO TREND
</span>
</div>
<div style="display:flex; align-items:center; gap:5px;">
<span style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase; font-weight:700;">Fat Velocity:</span>
<span style="font-size:11px; font-weight:800; color:#00F0FF; font-family:var(--font-mono); background:rgba(0,240,255,0.12); border:1px solid rgba(0,240,255,0.3); padding:2px 7px; border-radius:4px; box-shadow:0 0 8px rgba(0,240,255,0.25);">
          ${f} <small style="color:var(--text-secondary); font-size:9.5px; font-weight:600;">(${S})</small>
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
<svg viewBox="0 0 ${e} ${d}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="renphoBfGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.32"/>
<stop offset="60%" stop-color="#00F0FF" stop-opacity="0.08"/>
<stop offset="100%" stop-color="#00F0FF" stop-opacity="0.0"/>
</linearGradient>
</defs>

        
<line x1="${i}" y1="${Q}" x2="${e-b}" y2="${Q}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${i}" y1="${X}" x2="${e-b}" y2="${X}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${i}" y1="${ee}" x2="${e-b}" y2="${ee}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

        
<text x="${i-4}" y="${Q+4}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${J.toFixed(1)}%</text>
<text x="${i-4}" y="${X+4}" fill="#38bdf8" font-size="12.5" font-weight="600" text-anchor="end">${((J+j)/2).toFixed(1)}%</text>
<text x="${i-4}" y="${ee}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${j.toFixed(1)}%</text>

        
<text x="${e-b+4}" y="${Q+4}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${D.toFixed(1)}kg</text>
<text x="${e-b+4}" y="${X+4}" fill="#34d399" font-size="12.5" font-weight="600" text-anchor="start">${((D+L)/2).toFixed(1)}kg</text>
<text x="${e-b+4}" y="${ee}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${L.toFixed(1)}kg</text>

        
<path d="${z}" fill="url(#renphoBfGrad)"/>

        
<path d="${Z}" fill="none" stroke="#00F0FF" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>
<path d="${ie}" fill="none" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>

        
<path d="${K}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.6));"/>
<path d="${w}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.6));"/>

        
<circle cx="${_[_.length-1].x}" cy="${_[_.length-1].yBf}" r="4" fill="#00F0FF" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.9));"/>
<circle cx="${_[_.length-1].x}" cy="${_[_.length-1].yLm}" r="4" fill="#10b981" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.9));"/>

        
<text x="${i}" y="${d-6}" fill="var(--text-muted)" font-size="12.5">${re}</text>
<text x="${i+O/2}" y="${d-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${ae}</text>
<text x="${e-b}" y="${d-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${le}</text>
</svg>
</div>

    
<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(0,240,255,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#00F0FF; font-weight:800; text-transform:uppercase;">BF% Range</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${E.bf.toFixed(1)}%</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#00F0FF;">${A.toFixed(1)}%</strong></span>
<span>Max: <strong style="color:#94a3b8;">${W.toFixed(1)}%</strong></span>
</div>
</div>

<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(16,185,129,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#10b981; font-weight:800; text-transform:uppercase;">Lean Mass</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${E.lm.toFixed(1)}kg</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#94a3b8;">${R.toFixed(1)}kg</strong></span>
<span>Max: <strong style="color:#10b981;">${U.toFixed(1)}kg</strong></span>
</div>
</div>
</div>
  `}let _strengthHistoryCache=null,_strengthHistoryFetchedAtMs=0;async function renderStrengthProgressionChart(t={}){let s=_strengthHistoryCache&&typeof _strengthHistoryCache=="object"?_strengthHistoryCache:{},c={};const n=!!(t&&t.force===!0),p=Object.keys(s).length>0,a=Date.now()-_strengthHistoryFetchedAtMs>300*1e3;if(n||!p||a)try{const h=await(typeof pulseApiFetch=="function"?pulseApiFetch("/api/strength/history?days=30",{promptAuthOn401:!1}):fetch("/api/strength/history?days=30"));if(h&&h.ok){const v=await h.json();s=v&&v.exercises||v||{},_strengthHistoryCache=s,_strengthHistoryFetchedAtMs=Date.now()}}catch(h){console.warn("[StrengthChart] Fetch failed, falling back to baked prescriptions:",h)}c=(typeof window<"u"&&window.BAKED_LIVE_STATE?window.BAKED_LIVE_STATE:{}).strength_prescriptions||(typeof window<"u"?window.strengthPrescriptions:null)||{};const g=typeof getAllExercises=="function"?getAllExercises():[],M=(h,v,f)=>{const S=g.find(R=>R&&R.id===h),C=S?typeof S.getBaseWeight=="function"?S.getBaseWeight():S.targetWeight:NaN,T=S?typeof S.getBaseReps=="function"?S.getBaseReps():S.targetReps:NaN,A=typeof C=="number"&&Number.isFinite(C)&&C>0?C:v,W=typeof T=="number"&&Number.isFinite(T)&&T>0?T:f;return{weight:A,reps:W,e1rm:Number((A*(1+W/30)).toFixed(1))}},$=M("barbell_squat",100,8),E=M("barbell_rdl",70,8),N=M("barbell_floor_press",95,6),F=M("barbell_pendlay_row",85,8),l=[{key:"barbell_squat",name:"Barbell Back Squat",icon:"\u{1F3CB}\uFE0F",family:"Quad & Knee Extensor Power",defaultWeight:$.weight,defaultReps:$.reps,defaultE1rm:$.e1rm},{key:"barbell_rdl",name:"Barbell Romanian Deadlift (RDL)",icon:"\u26A1",family:"Hamstring & Glute Hinge Anchor",defaultWeight:E.weight,defaultReps:E.reps,defaultE1rm:E.e1rm},{key:"barbell_floor_press",name:"Barbell Floor Press",icon:"\u{1F6E1}\uFE0F",family:"Horizontal Push / Strict Triceps Power",defaultWeight:N.weight,defaultReps:N.reps,defaultE1rm:N.e1rm},{key:"barbell_pendlay_row",name:"Barbell Pendlay Row",icon:"\u{1F680}",family:"Explosive Dead-Stop Lat Pull",defaultWeight:F.weight,defaultReps:F.reps,defaultE1rm:F.e1rm}];let o=document.getElementById("strengthProgressionContainer");if(!o){o=document.createElement("div"),o.id="strengthProgressionContainer";const h=document.getElementById("trainViewPrescribed")||document.getElementById("tab-train")||document.getElementById("todayTrainingContainer");h?h.appendChild(o):(document.querySelector("main")||document.body).appendChild(o)}o.style.marginTop="14px",o.style.display="flex",o.style.flexDirection="column",o.style.gap="10px";let u="";const r=(h,v)=>{if(typeof h=="number"&&Number.isFinite(h))return h;if(typeof h=="string"){const S=h.match(/-?\d+(?:\.\d+)?/);if(S)return Number(S[0])}const f=Number(h);return Number.isFinite(f)&&f>0?f:v};for(const h of l){const v=c[h.key]||{},f=s[h.key]||[],S=r(v.weight,h.defaultWeight),C=r(v.reps,h.defaultReps),T=r(v.e1rm,h.defaultE1rm),A=r(v.last_logged_weight??(f.length?f[f.length-1].weight:S),S),W=r(v.last_logged_reps??(f.length?f[f.length-1].reps:C),C),R=r(v.last_e1rm??(f.length?f[f.length-1].e1rm:T),T),U=v.progression_ready===!0||v.status==="progression_ready"||A>S||R>T,Y=f.slice(-4);let j,J;if(Y.length>=2)j=Y.map((e,d)=>({label:d===Y.length-1?"Now":`S${d+1}`,val:Number(Number(e.e1rm||T).toFixed(1)),isCurrent:d===Y.length-1})),J=j[j.length-1].val.toFixed(1);else{const e=Number(Number(Y.length===1?Y[0].e1rm||T:U?Math.max(R,T):T).toFixed(1));j=[{label:"Now",val:e,isCurrent:!0}],J=e.toFixed(1)}const I=Math.min(...j.map(e=>e.val)),H=Math.max(...j.map(e=>e.val)),L=Math.max(6,H-I+3),D=j.map(e=>{const d=Math.max(12,Math.round((e.val-(I-1.5))/L*36)),i=e.isCurrent&&U,b=i?"background:linear-gradient(180deg, #00F0FF 0%, #10b981 100%); box-shadow:0 0 10px rgba(0,240,255,0.6);":e.isCurrent?"background:#38bdf8;":"background:rgba(255,255,255,0.18);";return`
<div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:3px;">
<span style="font-size:9.5px; font-weight:800; font-family:var(--font-mono); color:${i?"#00F0FF":e.isCurrent?"#fff":"var(--text-muted)"};">${e.val}</span>
<div style="width:100%; max-width:32px; height:${d}px; ${b} border-radius:3px;"></div>
<span style="font-size:9px; font-weight:700; color:${e.isCurrent?"var(--primary)":"var(--text-muted)"}; margin-top:1px;">${e.label}</span>
</div>
      `}).join("");u+=`
<div class="strength-progression-card" style="${U?"border:1px solid rgba(0,240,255,0.6); box-shadow:0 0 18px rgba(0,240,255,0.22); background:linear-gradient(135deg, rgba(0,240,255,0.06) 0%, rgba(15,23,42,0.85) 100%);":"border:1px solid rgba(255,255,255,0.07); background:rgba(15,23,42,0.5);"} border-radius:12px; padding:12px 14px; position:relative; overflow:hidden;">
        
<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
<div>
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:14px;">${h.icon}</span>
<strong style="color:#fff; font-size:13px; font-family:var(--font-display); letter-spacing:-0.01em;">${h.name}</strong>
</div>
<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">
              Prescribed: <span style="color:#e2e8f0; font-weight:700;">${S}kg \xD7 ${C}</span> \u2022 ${h.family}
</div>
</div>
<div>
            ${U?`
<span style="background:linear-gradient(90deg, #00F0FF, #10b981); color:#000; font-size:10px; font-weight:900; padding:3px 8px; border-radius:4px; letter-spacing:0.04em; box-shadow:0 0 10px rgba(0,240,255,0.6); display:inline-block; white-space:nowrap;">
                +2.5 kg Ready
</span>
            `:`
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
              ${A}kg <small style="color:var(--text-muted); font-size:10px;">\xD7 ${W} reps</small>
</div>
</div>
<div style="text-align:right;">
<div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.04em;">Calculated e1RM</div>
<div style="font-size:13px; font-weight:800; color:${U?"#00F0FF":"#fff"}; font-family:var(--font-mono); margin-top:2px;">
              ${J} kg ${U?`<small style="color:#10b981; font-weight:800;">(+${Math.max(2.5,Number((J-T).toFixed(1)))}kg)</small>`:""}
</div>
</div>
</div>

        
<div>
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); margin-bottom:5px;">
<span style="font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">4-Week e1RM Progression Visual</span>
<span style="font-family:var(--font-mono); color:${U?"#10b981":"var(--text-muted)"}; font-weight:700;">
              ${U?"\u2713 Progressive Overload Met":"Consistent Load Retention"}
</span>
</div>
<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; background:rgba(0,0,0,0.32); border:1px solid rgba(255,255,255,0.04); border-radius:8px; padding:8px 8px 6px; align-items:flex-end; height:74px;">
            ${D}
</div>
</div>
</div>
    `}o.innerHTML=`
    
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:13px;">\u{1F3CB}\uFE0F</span>
<span style="font-size:10.5px; font-weight:800; letter-spacing:0.08em; color:#fff; text-transform:uppercase;">
          4-WEEK COMPOUND STRENGTH e1RM PROGRESSION
</span>
</div>
<span style="font-size:10px; font-weight:700; color:var(--primary); font-family:var(--font-mono); background:rgba(0,240,255,0.1); border:1px solid rgba(0,240,255,0.25); padding:2px 7px; border-radius:4px;">
        Linear Overload
</span>
</div>

    
    ${u}
  `}let _editHistorySetCtx=null;function _ensureEditHistorySetModal(){if(typeof document>"u")return null;let t=document.getElementById("editHistorySetModal");return t||(t=document.createElement("div"),t.id="editHistorySetModal",t.className="modal-overlay",t.setAttribute("role","dialog"),t.setAttribute("aria-modal","true"),t.innerHTML=`
<div class="modal-card" style="max-width:360px;">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
    <h3 id="editHistSetTitle" style="margin:0; font-size:15px; font-weight:800; color:#fff;">Edit Logged Set</h3>
    <button type="button" onclick="closeEditHistorySetModal()" style="background:none; border:none; color:var(--text-muted); font-size:18px; cursor:pointer; padding:2px 6px;">\u2715</button>
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
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('weight', -2.5)">\u2212</button>
        <input id="editHistWeightInput" type="number" step="0.5" min="0" max="500" class="set-input-box" style="width:100%; text-align:center;" />
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('weight', 2.5)">+</button>
      </div>
    </div>
    <div>
      <label style="display:block; font-size:10.5px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">Reps</label>
      <div style="display:flex; align-items:center; gap:4px;">
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('reps', -1)">\u2212</button>
        <input id="editHistRepsInput" type="number" step="1" min="0" max="200" class="set-input-box" style="width:100%; text-align:center;" />
        <button type="button" class="set-stepper-btn" onclick="stepEditHistorySetModal('reps', 1)">+</button>
      </div>
    </div>
  </div>
  <div style="display:flex; gap:8px; justify-content:flex-end;">
    <button type="button" onclick="closeEditHistorySetModal()" style="padding:8px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background:rgba(255,255,255,0.05); color:#cbd5e1; font-size:12px; font-weight:700; cursor:pointer;">Cancel</button>
    <button type="button" id="btnSaveEditedHistorySet" onclick="saveEditedHistorySet()" style="padding:8px 14px; border-radius:8px; border:none; background:var(--primary); color:#000; font-size:12px; font-weight:800; cursor:pointer;">Save Changes</button>
  </div>
</div>`,document.body&&document.body.appendChild(t),t)}function openEditHistorySetModal(t,s,c,n,p,a,y){const g=_ensureEditHistorySetModal();if(!g)return;const M=y!=null&&String(y).trim()!==""&&Number.isFinite(Number(y))?Number(y):null;_editHistorySetCtx={sessionId:String(t||""),sessionDate:String(s||""),detailKey:String(c||""),exName:String(n||"Exercise"),watchWeightKg:M};const $=document.getElementById("editHistSetTitle"),E=document.getElementById("editHistSetSub"),N=document.getElementById("editHistWeightInput"),F=document.getElementById("editHistRepsInput"),l=document.getElementById("editHistWatchHint"),o=document.getElementById("editHistWatchHintText"),u=document.getElementById("btnEditHistUseWatch");$&&($.innerText=`Edit ${n||"Set"}`),E&&(E.innerText=`${c} \u2022 ${s||"Today"}`),N&&(N.value=String(Number.isFinite(Number(p))?Number(p):0)),F&&(F.value=String(Number.isFinite(Number(a))?Number(a):0)),l&&o&&u&&(M!==null&&M>0?(l.style.display="flex",o.innerText=`Garmin watch recorded ${M}kg`,u.innerText=`Use ${M}kg`):l.style.display="none"),g.classList.add("open")}function closeEditHistorySetModal(){const t=document.getElementById("editHistorySetModal");t&&t.classList.remove("open"),_editHistorySetCtx=null}function stepEditHistorySetModal(t,s){const c=t==="weight"?"editHistWeightInput":"editHistRepsInput",n=document.getElementById(c);if(!n)return;const p=Number(n.value||0),a=t==="weight"?Math.max(0,Math.round((p+Number(s||0))*10)/10):Math.max(0,Math.round(p+Number(s||0)));n.value=String(a),typeof beep=="function"&&beep(520,.04)}function applyWatchWeightInEditModal(){if(!_editHistorySetCtx||_editHistorySetCtx.watchWeightKg===null)return;const t=document.getElementById("editHistWeightInput");t&&(t.value=String(_editHistorySetCtx.watchWeightKg))}function _applyEditedSetLocallyAndRefresh(t,s,c,n){try{const p=localStorage.getItem("pulse_session_history");if(p){const a=JSON.parse(p);if(Array.isArray(a)){let y=!1;a.forEach(g=>{if(!g||!g.details||typeof g.details!="object")return;const M=String(g.id||g.client_event_id||""),$=String(g.date||"").slice(0,10),E=s.sessionId&&M===s.sessionId,N=(!s.sessionId||!M)&&s.sessionDate&&$===s.sessionDate;(E||N||g.details[s.detailKey])&&g.details[s.detailKey]&&(E||!s.sessionId||$===s.sessionDate)&&(Object.assign(g.details[s.detailKey],t&&t.updated_set?t.updated_set:{weight:c,reps:n}),y=!0)}),y&&localStorage.setItem("pulse_session_history",JSON.stringify(a))}}}catch{}t&&t.state?(window.BAKED_LIVE_STATE=t.state,typeof applyLiveStateToDom=="function"?applyLiveStateToDom(t.state):typeof renderHistoryList=="function"&&renderHistoryList()):typeof renderHistoryList=="function"&&renderHistoryList(),typeof renderStrengthProgressionChart=="function"&&renderStrengthProgressionChart({force:!0}),typeof fetchAnalyticsSummary=="function"&&fetchAnalyticsSummary(!0)}async function _submitHistorySetEdit(t,s,c){const p=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)("/api/session/edit_set",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({session_id:t.sessionId||null,session_date:t.sessionDate||null,detail_key:t.detailKey,weight:s,reps:c}),timeoutMs:8e3,promptAuthOn401:!0});if(!p||!p.ok){let y="Could not save set edit";try{const g=await p.json();g&&g.detail&&(y=g.detail)}catch{}return typeof showToast=="function"&&showToast(`\u26A0\uFE0F ${y}`),!1}const a=await p.json();return _applyEditedSetLocallyAndRefresh(a,t,s,c),typeof beep=="function"&&beep(760,.08),typeof showToast=="function"&&showToast(`\u2713 Updated set to ${s}kg \xD7 ${c}r`),!0}async function saveEditedHistorySet(){if(!_editHistorySetCtx)return;const t=document.getElementById("editHistWeightInput"),s=document.getElementById("editHistRepsInput"),c=Number(t?t.value:0),n=Math.round(Number(s?s.value:0));if(!Number.isFinite(c)||c<0||c>500||!Number.isFinite(n)||n<0||n>200){typeof showToast=="function"&&showToast("Enter valid weight (0\u2013500kg) and reps (0\u2013200)");return}const p=document.getElementById("btnSaveEditedHistorySet");p&&(p.disabled=!0);const a={..._editHistorySetCtx};try{await _submitHistorySetEdit(a,c,n)&&closeEditHistorySetModal()}finally{p&&(p.disabled=!1)}}async function quickApplyWatchWeightToPulseSet(t,s,c,n,p){!c||!Number.isFinite(Number(n))||await _submitHistorySetEdit({sessionId:String(t||""),sessionDate:String(s||""),detailKey:String(c)},Number(n),Math.round(Number(p||0)))}typeof window<"u"&&(window.getGarminHrZoneBreakdown=getGarminHrZoneBreakdown,window.generateHrSvgChart=generateHrSvgChart,window.generateZoneBarsHtml=generateZoneBarsHtml,window.generateTeDualGaugesHtml=generateTeDualGaugesHtml,window.renderHistoryList=renderHistoryList,window.renderRenphoTrendChart=renderRenphoTrendChart,window.renderStrengthProgressionChart=renderStrengthProgressionChart,window.openEditHistorySetModal=openEditHistorySetModal,window.closeEditHistorySetModal=closeEditHistorySetModal,window.stepEditHistorySetModal=stepEditHistorySetModal,window.applyWatchWeightInEditModal=applyWatchWeightInEditModal,window.saveEditedHistorySet=saveEditedHistorySet,window.quickApplyWatchWeightToPulseSet=quickApplyWatchWeightToPulseSet);let _pulseChartsInitInFlight=!1;function initPulseCharts(){if(!_pulseChartsInitInFlight){_pulseChartsInitInFlight=!0;try{try{typeof renderRenphoTrendChart=="function"&&renderRenphoTrendChart()}catch(t){console.warn("[PulseCharts] renderRenphoTrendChart init warning:",t)}try{typeof renderStrengthProgressionChart=="function"&&renderStrengthProgressionChart()}catch(t){console.warn("[PulseCharts] renderStrengthProgressionChart init warning:",t)}}finally{_pulseChartsInitInFlight=!1}}}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>initPulseCharts(),{once:!0}):initPulseCharts());

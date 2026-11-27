function getGarminHrZoneBreakdown(s){if(s&&s.hr_zones&&typeof s.hr_zones=="object"){const t=s.hr_zones,p=Number(t.z1??t[1]??t.zone1??0),h=Number(t.z2??t[2]??t.zone2??0),g=Number(t.z3??t[3]??t.zone3??0),b=Number(t.z4??t[4]??t.zone4??0),K=Number(t.z5??t[5]??t.zone5??0),k=p+h+g+b+K;if(k>0){const N=Math.round(p/k*100),z=Math.round(h/k*100),P=Math.round(g/k*100),j=Math.round(b/k*100),Z=Math.round(K/k*100),H=F=>`${Math.floor(F/60)}m ${F%60<10?"0":""}${F%60}s`,V=[{num:5,name:"Maximum / Anaerobic",range:"> 171 bpm",pct:Z,durStr:H(K),color:"#ef4444"},{num:4,name:"Threshold / Hard",range:"152\u2013171 bpm",pct:j,durStr:H(b),color:"#f59e0b"},{num:3,name:"Aerobic / Moderate",range:"133\u2013152 bpm",pct:P,durStr:H(g),color:"#10b981"},{num:2,name:"Easy / Fat Oxidation Base",range:"114\u2013133 bpm",pct:z,durStr:H(h),color:"#00F0FF"},{num:1,name:"Warm Up / Active Recovery",range:"< 114 bpm",pct:N,durStr:H(p),color:"#8b9db5"}];let E=V[0];return V.forEach(F=>{F.pct>E.pct&&(E=F)}),{zones:V,dominantZoneText:"Dominant: Z"+E.num+" ("+E.durStr+" \u2022 "+E.pct+"%)"}}}const l=s.durationMin||s.duration_min||30,m=s.avgHr||s.avg_hr||115,n=s.maxHr||s.max_hr||150,c=`${s.name||""} ${s.subTitle||s.sub_title||""}`.toLowerCase(),o=c.includes("walk")||c.includes("stroll"),M=c.includes("strength")||c.includes("barbell")||c.includes("lift")||c.includes("gym"),x=c.includes("jump")||c.includes("plyo")||c.includes("tuck");let _,v,R,T,A;o||m<95?(_=88,v=12,R=0,T=0,A=0):M?(_=22,v=48,R=22,T=8,A=0):x||n>=162?(_=10,v=25,R=35,T=22,A=8):m<=122?(_=12,v=58,R=24,T=6,A=0):m<=135?(_=8,v=28,R=46,T=15,A=3):(_=5,v=20,R=35,T=28,A=12);const a=t=>{const p=Math.round(t*60),h=Math.floor(p/60),g=p%60;return`${h}m ${g<10?"0":""}${g}s`},d=[{num:5,name:"Maximum / Anaerobic",range:"> 171 bpm",pct:A,durStr:a(l*A/100),color:"#ef4444"},{num:4,name:"Threshold / Hard",range:"152\u2013171 bpm",pct:T,durStr:a(l*T/100),color:"#f59e0b"},{num:3,name:"Aerobic / Moderate",range:"133\u2013152 bpm",pct:R,durStr:a(l*R/100),color:"#10b981"},{num:2,name:"Easy / Fat Oxidation Base",range:"114\u2013133 bpm",pct:v,durStr:a(l*v/100),color:"#00F0FF"},{num:1,name:"Warm Up / Active Recovery",range:"< 114 bpm",pct:_,durStr:a(l*_/100),color:"#8b9db5"}];let $=d[0];return d.forEach(t=>{t.pct>$.pct&&($=t)}),{zones:d,dominantZoneText:`Dominant: Z${$.num} (${$.durStr} \u2022 ${$.pct}%)`}}function generateHrSvgChart(s){const l=s.durationMin||s.duration_min||30;let m=s.avgHr||s.avg_hr||119,n=s.maxHr||s.max_hr||151,c=[];if(Array.isArray(s.hr_samples)&&s.hr_samples.length>=5){const E=[];for(const F of s.hr_samples){let W=null;typeof F=="number"?W=F:F&&typeof F=="object"&&(W=F.hr??F.bpm??F.value),W=Number(W),!isNaN(W)&&W>30&&W<250&&E.push(W)}if(E.length>=5){if(E.length>80){const W=(E.length-1)/79;for(let D=0;D<80;D++){const O=Math.min(E.length-1,Math.round(D*W));c.push(E[O])}}else c=E.slice();const F=E.reduce((W,D)=>W+D,0);m=Math.round(F/E.length),n=Math.max(...E)}}const M=c.length===0;if(M){const F=Math.max(50,m-40);for(let W=0;W<24;W++){const D=W/23;let O;if(D<.15)O=F+15+(m-F-15)*(D/.15);else if(D<.85){const e=(D-.15)/.7,r=Math.sin(e*Math.PI*6),i=Math.exp(-Math.pow((e-.72)*8,2));O=m+r*9+i*(n-m)}else{const e=(D-.85)/.15;O=m-5-(m-F-10)*e}c.push(Math.min(n,Math.max(F,O)))}c[17]=n}const x=Math.max(40,Math.min(...c,m-30)),_=Math.max(n+12,168),v=Math.max(20,_-x),R=c.length,T=360,A=130,a=42,d=14,$=26,t=28,p=T-a-d,h=A-$-t,g=c.map((E,F)=>{const W=a+F/(R-1)*p,D=$+(1-(E-x)/v)*h;return{x:Math.round(W*10)/10,y:Math.round(D*10)/10,hr:Math.round(E)}});let b=`M ${g[0].x} ${g[0].y}`;for(let E=0;E<g.length-1;E++){const F=g[E],W=g[E+1],D=(F.x+W.x)/2;b+=` Q ${F.x} ${F.y}, ${D} ${(F.y+W.y)/2}`}const K=g[g.length-1];b+=` L ${K.x} ${K.y}`;const k=`${b} L ${K.x} ${A-t} L ${g[0].x} ${A-t} Z`,N=Math.round(($+(1-(m-x)/v)*h)*10)/10;let z=0,P=c[0];c.forEach((E,F)=>{E>=P&&(P=E,z=F)});const j=g[z]||g[0],Z=M?"OPTICAL SENSOR MODEL":"OPTICAL SENSOR STREAM (GARMIN)",H=`hrGrad_${String(s.id).replace(/[^a-zA-Z0-9]/g,"_")}`,V=Math.round(l/2);return`
<svg viewBox="0 0 ${T} ${A}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="${H}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.38"/>
<stop offset="70%" stop-color="#3B82F6" stop-opacity="0.12"/>
<stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.0"/>
</linearGradient>
</defs>

      
<line x1="${a}" y1="${$}" x2="${T-d}" y2="${$}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${a}" y1="${N}" x2="${T-d}" y2="${N}" stroke="rgba(56,189,248,0.4)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${a}" y1="${A-t}" x2="${T-d}" y2="${A-t}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

      
<text x="${a-4}" y="${N+4}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">${m}</text>
<text x="${a-4}" y="${$+10}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${_}</text>
<text x="${a-4}" y="${A-t}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${x}</text>

      
<path d="${k}" fill="url(#${H})"/>

      
<path d="${b}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.5));"/>

      
<text x="${a+2}" y="${$-8}" fill="${M?"var(--text-muted)":"#00F0FF"}" font-size="12.5" font-weight="800" letter-spacing="0.04em">${Z}</text>

      
<text x="${T-d}" y="${N-5}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">Avg ${m} bpm</text>

      
<circle cx="${j.x}" cy="${j.y}" r="4" fill="#ef4444" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(239,68,68,0.8));"/>
<circle cx="${j.x}" cy="${j.y}" r="7" fill="none" stroke="#ef4444" stroke-width="1" opacity="0.6"/>
<text x="${j.x}" y="${Math.max(14,j.y-8)}" fill="#ef4444" font-size="12.5" font-weight="800" text-anchor="middle">Peak ${n}</text>

      
<text x="${a}" y="${A-6}" fill="var(--text-muted)" font-size="12.5">0:00</text>
<text x="${a+p/2}" y="${A-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${V}:00</text>
<text x="${T-d}" y="${A-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${l.toFixed(1)}m</text>
</svg>
  `}function generateZoneBarsHtml(s){const{zones:l}=getGarminHrZoneBreakdown(s);return l.map(m=>`
<div style="display:flex; flex-direction:column; gap:2px; margin-bottom:6px;">
<div style="display:flex; justify-content:space-between; font-size:10.5px; line-height:1.2;">
<span style="color:#d4d4d8; font-weight:600;">
<span style="color:${m.color}; font-weight:800;">Z${m.num}</span> ${m.name} <small style="color:var(--text-muted); font-size:9.5px;">(${m.range})</small>
</span>
<span style="color:#fff; font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums;">
          ${m.durStr} <small style="color:var(--text-muted);">(${m.pct}%)</small>
</span>
</div>
<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
<div style="height:100%; width:${m.pct}%; background:${m.color}; border-radius:3px; box-shadow:0 0 6px ${m.color}66;"></div>
</div>
</div>
  `).join("")}function generateTeDualGaugesHtml(s){const l=s.aerobicTe??s.aerobic_te,m=s.anaerobicTe??s.anaerobic_te,n=l!=null&&!Number.isNaN(Number(l))?Number(l):0,c=m!=null&&!Number.isNaN(Number(m))?Number(m):0,o=(_,v)=>_>=4.5?{label:"Overreaching",desc:v?"High neuromuscular & PCr fatigue":"Heavy aerobic strain requiring 48h rest",color:"#ef4444"}:_>=3.5?{label:"Highly Improving",desc:v?"Drastically expands glycolytic buffering":"Major stimulus for VO2max expansion",color:"#f59e0b"}:_>=2.5?{label:"Impacting / Building",desc:v?"Improves anaerobic work tolerance":"Stimulates aerobic base & stroke volume",color:"#10b981"}:_>=1.5?{label:"Maintaining Base",desc:v?"Minor anaerobic speed maintenance":"Maintains aerobic fitness & mitochondrial density",color:"#00F0FF"}:{label:"Minor Recovery Stimulus",desc:"Active recovery flush with negligible debt",color:"#38bdf8"},M=o(n,!1),x=o(c,!0);return`
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Aerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${M.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${n.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100,n/5*100)}%; background:${M.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${M.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${M.desc}</div>
</div>

      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Anaerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${x.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${c.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100,c/5*100)}%; background:${x.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${x.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${x.desc}</div>
</div>
</div>
  `}function _parseActivityTimestampMs(s){if(typeof s=="number"&&Number.isFinite(s)&&s>0)return s>1e12?s:s*1e3;if(!s||typeof s!="string")return 0;const l=s.trim();if(!l)return 0;const m=l.includes(" ")&&!l.includes("T")?l.replace(" ","T"):l,n=new Date(m).getTime();return Number.isFinite(n)?n:0}function _formatClockHHMM(s){if(!s||!Number.isFinite(s))return"";const l=new Date(s);return isNaN(l.getTime())?"":`${String(l.getHours()).padStart(2,"0")}:${String(l.getMinutes()).padStart(2,"0")}`}function _coerceSetWeightKg(s){if(typeof s=="number"&&Number.isFinite(s))return s;const l=String(s??"").trim().toLowerCase();if(!l||/^(body(?:weight)?|bw)$/.test(l))return 0;const m=l.replace(/^2\s*[×x]\s*/i,"").replace(/kg$/i,"").trim(),n=parseFloat(m);return Number.isFinite(n)?n:0}function _parsePulseLogWindowMs(s,l,m){if(!s||typeof s!="string")return{startMs:0,endMs:0};const n=s.trim(),c=n.match(/^(\d{1,2}):(\d{2})$/);if(c&&l&&/^\d{4}-\d{2}-\d{2}$/.test(l)){const[M,x,_]=l.split("-").map(Number);let v=new Date(M,x-1,_,Number(c[1]),Number(c[2]),0,0).getTime();return m>0&&m-v>6*3600*1e3&&(v+=24*3600*1e3),{startMs:v,endMs:v+59999}}const o=_parseActivityTimestampMs(n);return o>0?{startMs:o,endMs:o+59999}:{startMs:0,endMs:0}}function _garminCategoryMatchesPulseEx(s,l){const m=String(s||"").toLowerCase(),n=String(l||"").toLowerCase();if(!m||!n)return 0;const c=[{g:/squat|lunge|split_squat|thruster/,p:/squat|lunge/},{g:/bench|chest_press|floor_press|push_up|pushup|dip/,p:/bench|floor_press|pushup|dip|chest/},{g:/deadlift|rdl|good_morning|hip_hinge|swing/,p:/rdl|deadlift|swing|hinge/},{g:/row|pull_up|pullup|chin_up|lat_pull|curl/,p:/row|pullup|chin|curl/},{g:/shoulder_press|overhead_press|military_press|z_press/,p:/press|z_press|ohp/}];let o=-1,M=-1;return c.forEach((x,_)=>{x.g.test(m)&&o===-1&&(o=_),x.p.test(n)&&M===-1&&(M=_)}),o===-1||M===-1?0:o===M?1:-1}function decodeGarminStrengthSets(s){const l=s&&Array.isArray(s.exercise_sets)?s.exercise_sets:[];if(!l.length)return null;let n=_parseActivityTimestampMs(s.rawDate||s.date);const c=[],o=[];for(let a=0;a<l.length;a++){const d=l[a];if(!d||typeof d!="object")continue;const $=String(d.set_type||d.setType||"").toUpperCase(),t=Number(d.duration||0),p=Math.round(t);if($==="REST"){p>0&&o.push(p),n>0&&t>0&&(n+=t*1e3);continue}if($!=="ACTIVE")continue;const h=_parseActivityTimestampMs(d.start_time||d.startTime),g=h>0?h:n,b=g>0&&t>0?g+t*1e3:g;g>0&&(n=b);const K=Number(d.weight||0),k=K>=1e3?Math.round(K/1e3*10)/10:K>0?Math.round(K*10)/10:0,N=d.reps!==void 0&&d.reps!==null?d.reps:d.repetitionCount,z=N!=null&&N!==""&&!isNaN(Number(N))&&Number(N)>=0?Math.round(Number(N)):null;let P=0;a+1<l.length&&l[a+1]&&String(l[a+1].set_type||l[a+1].setType||"").toUpperCase()==="REST"&&(P=Math.round(Number(l[a+1].duration||0))),c.push({setNum:c.length+1,weightKg:k,weightLabel:k>0?`${k}kg`:"Bodyweight",shortWeightLabel:k>0?`${k}kg`:"BW",durationSec:p,reps:z,exerciseId:d.exercise_id?String(d.exercise_id):"",exerciseName:d.exercise_name?String(d.exercise_name).replace(/_/g," "):"",exerciseCategory:d.exercise_category||d.category?String(d.exercise_category||d.category).replace(/_/g," "):"",role:d.role?String(d.role):"",pulseSetNum:d.pulse_set_num!==void 0&&d.pulse_set_num!==null?Number(d.pulse_set_num):null,pulseWeightKg:d.pulse_weight_kg!==void 0&&d.pulse_weight_kg!==null?Number(d.pulse_weight_kg):null,pulseReps:d.pulse_reps!==void 0&&d.pulse_reps!==null?Number(d.pulse_reps):null,pulseTime:d.pulse_time?String(d.pulse_time):"",weightMismatch:d.weight_mismatch&&typeof d.weight_mismatch=="object"?d.weight_mismatch:null,restAfterSec:P,startMs:g,endMs:b,startClock:g>0?_formatClockHHMM(g):"",endClock:b>0?_formatClockHHMM(b):""})}if(!c.length)return null;const M=c.filter(a=>a.weightKg>0),x=M.length?Math.max(...M.map(a=>a.weightKg)):0,_=x>0?c.filter(a=>a.weightKg===x).length:0,v=o.length?Math.round(o.reduce((a,d)=>a+d,0)/o.length):0,R=c.reduce((a,d)=>a+d.durationSec,0),T=[];c.forEach(a=>{const d=a.weightKg>0?String(a.weightKg):"BW",$=T[T.length-1];$&&$.key===d?($.count+=1,$.totalDur+=a.durationSec):T.push({key:d,weightKg:a.weightKg,count:1,totalDur:a.durationSec})});const A=T.map((a,d)=>{if(a.weightKg===0)return`${a.count}\xD7BW (${a.totalDur>=60?`${a.totalDur}s core hold`:`${a.totalDur}s`})`;const $=T[d+1];return $&&$.weightKg>0&&a.count<=2&&a.weightKg<=.78*$.weightKg?`${a.count}\xD7${a.weightKg}kg warm-up`:`${a.count}\xD7${a.weightKg}kg`});return{activeSets:c,activeCount:c.length,peakWeightKg:x,peakWeightCount:_,avgRestSec:v,totalTutSec:R,workingSummary:A.join(" \u2022 ")}}window.decodeGarminStrengthSets=decodeGarminStrengthSets;function alignGarminSetsWithPulse(s,l){const m=decodeGarminStrengthSets(s);if(!m||!m.activeSets.length||!l||!l.details||typeof l.details!="object")return null;const n=typeof getAllExercises=="function"?getAllExercises():[],c=String(s.rawDate||s.date||l.date||"").match(/\d{4}-\d{2}-\d{2}/),o=c?c[0]:"",M=[],x={};Object.entries(l.details).forEach(([e,r])=>{if(!r||!r.logged)return;const i=String(r.exercise_id||String(e||"").replace(/_\d+$/,"")||"exercise");if(!x[i]){const S=n.find(G=>G.id===i),C=S?S.name:i.replace(/_/g," ").replace(/\b\w/g,G=>G.toUpperCase());x[i]={exId:i,exName:C,items:[]},M.push(i)}const f=String(e).match(/_(\d+)$/),u=Number(r.set_num||(f?f[1]:x[i].items.length+1));x[i].items.push({key:e,raw:r,setNum:u})});const _=[];let v=0;if(M.forEach(e=>{const r=x[e];r.items.sort((i,f)=>i.setNum-f.setNum),r.items.forEach(i=>{const f=i.raw,u=_parsePulseLogWindowMs(f.time,o,v);u.startMs>0&&(v=u.startMs);const S=_coerceSetWeightKg(f.weight),C=f.reps!==void 0&&f.reps!==null&&!isNaN(Number(f.reps))?Math.round(Number(f.reps)):0;_.push({idx:_.length,key:i.key,exerciseId:e,exerciseName:r.exName,setNum:i.setNum,weightKg:S,weightLabel:S>0?`${S}kg`:"BW",reps:C,timeStr:f.time||"",logMinStartMs:u.startMs,logMinEndMs:u.endMs,isWarmupFlag:!!(f.is_warmup||f.status==="warmup")})})}),!_.length)return null;const R=m.activeSets,T=R.length,A=_.length;function a(e,r){let i=0;if(e.endMs>0&&r.logMinStartMs>0){let u=0;e.endMs<r.logMinStartMs?u=r.logMinStartMs-e.endMs:e.endMs>r.logMinEndMs&&(u=e.endMs-r.logMinEndMs);const S=u/1e3;if(S>900)return-1/0;S<=15?i+=55:S<=45?i+=48:S<=90?i+=38:S<=180?i+=24:S<=360?i+=10:i+=-5-(S-360)/30,e.startMs>0&&r.logMinEndMs<e.startMs-3e4&&(i-=6)}else i+=20;if(e.weightKg===0&&r.weightKg===0)i+=30;else if(e.weightKg>0&&r.weightKg>0){const u=Math.abs(e.weightKg-r.weightKg),S=Math.min(e.weightKg,r.weightKg)/Math.max(e.weightKg,r.weightKg);u<=.5?i+=40:u<=2.5?i+=26:S>=.85?i+=14:S>=.65?i+=2:i-=28}else i-=15;if(e.reps!==null&&r.reps>0){const u=Math.abs(e.reps-r.reps);u===0?i+=20:u===1?i+=12:u===2?i+=5:u>=5&&(i-=6)}const f=_garminCategoryMatchesPulseEx(`${e.exerciseCategory} ${e.exerciseName}`,r.exerciseId);return f>0?i+=12:f<0&&(i-=8),i}const d=-18,$=Array.from({length:T+1},()=>new Array(A+1).fill(0)),t=Array.from({length:T+1},()=>new Array(A+1).fill(0));for(let e=1;e<=T;e++)$[e][0]=0,t[e][0]=1;for(let e=1;e<=A;e++)$[0][e]=$[0][e-1]+d,t[0][e]=2;for(let e=1;e<=T;e++)for(let r=1;r<=A;r++){const i=$[e-1][r],f=$[e][r-1]+d,u=a(R[e-1],_[r-1]),S=u>0?$[e-1][r-1]+u:-1/0;S>=i&&S>=f?($[e][r]=S,t[e][r]=3):i>=f?($[e][r]=i,t[e][r]=1):($[e][r]=f,t[e][r]=2)}const p=new Array(T).fill(null),h=[];let g=T,b=A;for(;g>0||b>0;){const e=t[g][b];g>0&&b>0&&e===3?(p[g-1]=_[b-1],g--,b--):g>0&&(b===0||e===1)?g--:(h.unshift(_[b-1]),b--)}const K={},k=[];M.forEach(e=>{const r={exerciseId:e,exerciseName:x[e].exName,warmupSets:[],workingSets:[],extraSets:[],firstMatchedIdx:1/0,lastMatchedIdx:-1,workingWeightKg:0,firstPulseIsWarmup:x[e].items[0]?!!(x[e].items[0].raw.is_warmup||x[e].items[0].raw.status==="warmup"):!1};K[e]=r,k.push(r)});const N=R.map((e,r)=>{const i=p[r];if(!i)return{...e,garminIdx:r,role:"unmatched",pulseSet:null,weightMismatch:null,repDelta:null};const f=e.weightKg>0&&i.weightKg>0&&Math.abs(e.weightKg-i.weightKg)>2.5?{garminKg:e.weightKg,pulseKg:i.weightKg}:null,u=e.reps!==null&&i.reps>0?e.reps-i.reps:null,S={...e,garminIdx:r,role:"working",pulseSet:i,weightMismatch:f,repDelta:u},C=K[i.exerciseId];return C&&(C.workingSets.push(S),r<C.firstMatchedIdx&&(C.firstMatchedIdx=r),r>C.lastMatchedIdx&&(C.lastMatchedIdx=r)),S});k.forEach(e=>{const r=e.workingSets.map(i=>i.weightKg).filter(i=>i>0);if(r.length>0){const i=[...r].sort((f,u)=>f-u);e.workingWeightKg=i[Math.floor(i.length/2)]}else e.workingSets.length>0&&(e.workingWeightKg=e.workingSets[0].pulseSet.weightKg)});const z=[];N.forEach((e,r)=>{if(e.pulseSet)return;const i=k.find(u=>u.workingSets.length>0&&r>u.firstMatchedIdx&&r<u.lastMatchedIdx&&(u.workingWeightKg===0||Math.abs(e.weightKg-u.workingWeightKg)<=2.5));if(i){e.role="extra_set",e.exerciseId=i.exerciseId,e.exerciseName=i.exerciseName,i.extraSets.push(e);return}const f=k.filter(u=>u.workingSets.length>0&&u.firstMatchedIdx>r).sort((u,S)=>u.firstMatchedIdx-S.firstMatchedIdx)[0];if(f){const u=N.slice(r+1,f.firstMatchedIdx).some(C=>!!C.pulseSet),S=e.weightKg>0&&f.workingWeightKg>0&&e.weightKg<=.78*f.workingWeightKg||e.weightKg===0&&f.workingWeightKg>0;if(!u&&S){e.role="warmup",e.exerciseId=f.exerciseId,e.exerciseName=f.exerciseName,f.warmupSets.push(e);return}}e.role="unmatched",z.push(e)});const P=k.filter(e=>e.warmupSets.length>0||e.workingSets.length>0||e.extraSets.length>0),j=P.map(e=>{const r=e.warmupSets.length,f=e.workingSets.concat(e.extraSets).length,u=e.workingWeightKg>0?`${e.workingWeightKg}kg`:"BW",S=e.workingSets.map(B=>B.pulseSet&&B.pulseSet.reps>0?B.pulseSet.reps:null).filter(B=>B!==null),C=S.length?` (${S.join(",")}r)`:"",G=[];return r>0&&G.push(`${r} WU`),f>0&&G.push(`${f}\xD7${u}${C}`),`${e.exerciseName}: ${G.join(" + ")}`});N.forEach(e=>{e.pulseSet&&(e.exerciseId=e.pulseSet.exerciseId,e.exerciseName=e.pulseSet.exerciseName)});const Z=N.filter(e=>e.role==="working").length,H=N.filter(e=>e.role==="warmup").length,V=N.filter(e=>e.role==="extra_set").length,E=N.some(e=>e.reps!==null),F=N.reduce((e,r)=>e+(r.reps||0),0),W=Number(s.total_reps||0)>0?Number(s.total_reps):E?F:null,D=_.reduce((e,r)=>e+(r.reps||0),0),O=W!==null&&W>D&&H+V+z.length>0?W-D:0;return{decoded:m,annotatedSets:N,exerciseGroups:P,unmatchedSets:z,unmatchedPulse:h,matchedCount:Z,warmupCount:H,extraCount:V,hasPerSetGarminReps:E,garminTotalReps:W,pulseTotalReps:D,inferredWarmupReps:O,matchedSummary:j.join(" \u2022 ")}}window.alignGarminSetsWithPulse=alignGarminSetsWithPulse;function _buildAlignedFromBackendEnrichedSets(s,l){if(!l||!Array.isArray(l.activeSets)||!l.activeSets.length||!l.activeSets.some(t=>t.exerciseId&&t.role))return null;const n={},c=[],o=[],M=[];l.activeSets.forEach((t,p)=>{const h=t.exerciseId||"",g=t.exerciseName||(h?h.replace(/_/g," ").replace(/\b\w/g,P=>P.toUpperCase()):""),b=t.role||(h?"working":"unmatched");let K=null,k=null;if(b==="working"&&h){const P=t.pulseReps!==null?t.pulseReps:t.reps!==null?t.reps:0;K={exerciseId:h,exerciseName:g,setNum:t.pulseSetNum||1,weightKg:t.pulseWeightKg!==null?t.pulseWeightKg:t.weightKg,reps:P,timeStr:t.pulseTime||""},t.reps!==null&&P>0&&(k=t.reps-P)}const N=t.weightMismatch?{garminKg:t.weightMismatch.garminKg??t.weightMismatch.garmin_kg,pulseKg:t.weightMismatch.pulseKg??t.weightMismatch.pulse_kg}:null,z={...t,garminIdx:p,role:b,exerciseId:h,exerciseName:g,pulseSet:K,repDelta:k,weightMismatch:N};M.push(z),h&&(b==="warmup"||b==="working"||b==="extra_set")?(n[h]||(n[h]={exerciseId:h,exerciseName:g,warmupSets:[],workingSets:[],extraSets:[],workingWeightKg:0},c.push(n[h])),b==="warmup"?n[h].warmupSets.push(z):b==="extra_set"?n[h].extraSets.push(z):n[h].workingSets.push(z)):o.push(z)});const x=c.map(t=>{const p=t.workingSets.map(z=>z.weightKg).filter(z=>z>0).sort((z,P)=>z-P);t.workingWeightKg=p.length?p[Math.floor(p.length/2)]:t.workingSets[0]?.pulseSet?.weightKg||0;const h=t.warmupSets.length,g=t.workingSets.length+t.extraSets.length,b=t.workingWeightKg>0?`${t.workingWeightKg}kg`:"BW",K=t.workingSets.map(z=>z.pulseSet&&z.pulseSet.reps>0?z.pulseSet.reps:null).filter(z=>z!==null),k=K.length?` (${K.join(",")}r)`:"",N=[];return h>0&&N.push(`${h} WU`),g>0&&N.push(`${g}\xD7${b}${k}`),`${t.exerciseName}: ${N.join(" + ")}`}),_=M.filter(t=>t.role==="working").length,v=M.filter(t=>t.role==="warmup").length,R=M.filter(t=>t.role==="extra_set").length,T=M.some(t=>t.reps!==null),A=M.reduce((t,p)=>t+(p.reps||0),0),a=Number(s.total_reps||0)>0?Number(s.total_reps):T?A:null,d=M.reduce((t,p)=>t+(p.pulseSet&&p.pulseSet.reps||0),0),$=a!==null&&a>d&&v+R+o.length>0?a-d:0;return{decoded:l,annotatedSets:M,exerciseGroups:c,unmatchedSets:o,unmatchedPulse:[],matchedCount:_,warmupCount:v,extraCount:R,hasPerSetGarminReps:T,garminTotalReps:a,pulseTotalReps:d,inferredWarmupReps:$,matchedSummary:s.matched_exercises_summary||x.join(" \u2022 ")}}function renderHistoryList(){const s=document.getElementById("trainViewHistory");if(!s)return;const l=typeof recentActivitiesData<"u"&&Array.isArray(recentActivitiesData)?recentActivitiesData:window.BAKED_LIVE_STATE&&window.BAKED_LIVE_STATE.garmin&&Array.isArray(window.BAKED_LIVE_STATE.garmin.recent_activities)?window.BAKED_LIVE_STATE.garmin.recent_activities:[],m=document.getElementById("btnTrainHistory");m&&(m.innerText=`History (${l.length})`);const n=typeof escapeHtml=="function"?escapeHtml:(o=>String(o??"").replace(/[&<>"']/g,M=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[M]));s.innerHTML="";const c=typeof buildGarminPulseMatchMap=="function"?buildGarminPulseMatchMap(l):null;l.forEach(o=>{const M=typeof formatActivityDisplay=="function"?formatActivityDisplay(o):{isToday:!1,displayDate:o.date||""},x=M.isToday,_=M.displayDate,v=typeof getEgmWorkoutBreakdown=="function"?getEgmWorkoutBreakdown(o,x):{recoveryPill:"",primaryTakeaway:"",achievements:[],stressors:[],recoveryProtocol:[]},R=getGarminHrZoneBreakdown(o),T=Array.isArray(o.hr_samples)&&o.hr_samples.length>=5,A=T?"OPTICAL SENSOR STREAM (GARMIN)":"OPTICAL SENSOR MODEL",a=c?c.get(String(o.id))||null:typeof getMatchedPulseSessionForGarmin=="function"?getMatchedPulseSessionForGarmin(o,l):null;let d="",$=[];if(a){let e=a.title||"";e||(a.preset==="gym"?e="Option A: Heavy Barbell Strength & Hinge":a.preset==="combat"?e="Option B: Hybrid Work Capacity Circuit":e="Pulse Strength Session");const r=[o.total_sets?`${o.total_sets} Garmin Sets`:a.setsLogged?`${a.setsLogged} Sets Logged`:"",o.avgHr?`${o.avgHr} bpm HR`:"",o.calories?`${o.calories} kcal`:""].filter(Boolean).join(" \u2022 ");let i="";if(a.details&&typeof a.details=="object"){const f={},u=typeof getAllExercises=="function"?getAllExercises():[];Object.entries(a.details).forEach(([C,G])=>{if(!G||!G.logged)return;const B=G.exercise_id||String(C||"").replace(/_\d+$/,"")||"exercise";if(!f[B]){const ee=u.find(q=>q.id===B);f[B]={name:ee?ee.name:B.replace(/_/g," ").replace(/\b\w/g,q=>q.toUpperCase()),sets:[]}}const J=G.weight!==void 0&&G.weight!==null&&G.weight!=="Bodyweight"?`${G.weight}kg`:G.weight==="Bodyweight"?"BW":"",w=`${G.reps||0}r`;f[B].sets.push(J?`${J} \xD7 ${w}`:w)});const S=Object.values(f);$=S.map(C=>`${n(C.name)} (${n(C.sets.join(", "))})`),S.length>0&&(i=`
<div style="margin-top:6px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:4px; font-size:10.5px;">
              ${S.map(C=>`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 7px;">
<span style="font-weight:700; color:#fff;">${n(C.name)}:</span>
<span style="color:var(--cyan); font-family:var(--font-mono); font-size:10px; margin-left:4px;">${n(C.sets.join(", "))}</span>
</div>
              `).join("")}
</div>
          `)}else if(a.conditioningDrill){const f=a.conditioningDrill,u=f.totalSeconds?`${Math.round(f.totalSeconds/60)}m`:"";i=`
<div style="margin-top:6px; font-size:10.5px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 8px;">
<span style="font-weight:700; color:#fff;">${n(f.name||"Conditioning")}:</span>
<span style="color:var(--cyan); font-family:var(--font-mono); font-size:10px; margin-left:4px;">${n(String(f.format||"interval").toUpperCase())} \u2022 ${f.roundsCompleted||f.rounds||1} rounds ${u?`(${u})`:""}</span>
</div>
        `}d=`
<div style="margin:6px 0 8px; padding:8px 10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:9.5px; font-weight:800; background:rgba(16,185,129,0.22); border:1px solid #10b981; color:#10b981; padding:2px 6px; border-radius:4px; letter-spacing:0.04em;">\u{1F517} MATCHED WITH PULSE</span>
<span style="font-size:11.5px; font-weight:800; color:#fff;">${n(e)}</span>
</div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${r?`<span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono);">${n(r)}</span>`:""}
              <button type="button" class="header-pill-btn" data-act-id="${n(o.id)}" onclick="unlinkGarminPulseMatch(this.dataset.actId)" title="Unlink Pulse session from this Garmin recording" style="padding:1px 6px; font-size:9.5px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:var(--text-secondary); cursor:pointer;">\u2715 Unlink</button>
            </div>
</div>
          ${i}
</div>
      `}const t=decodeGarminStrengthSets(o),p=t&&a?alignGarminSetsWithPulse(o,a):t?_buildAlignedFromBackendEnrichedSets(o,t):null;let h="";if(t){const e=t.avgRestSec>0?` \u2022 Avg Rest ${t.avgRestSec}s`:"";let r="",i=t.workingSummary,f="";if(p){const u=[`${p.matchedCount} Matched`];p.warmupCount>0&&u.push(`${p.warmupCount} Warm-up${p.warmupCount===1?"":"s"}`),p.extraCount>0&&u.push(`${p.extraCount} Extra`),r=`${t.activeCount} Active Sets \u2022 ${u.join(" + ")}${e}`,i=p.matchedSummary||t.workingSummary;const S=(w,ee="")=>{const q=w.startClock&&w.endClock?`${w.startClock}\u2013${w.endClock}`:"",ne=w.restAfterSec>0?` \u2022 ${w.restAfterSec}s Rest`:"",te=w.exerciseName||ee||w.pulseSet&&w.pulseSet.exerciseName||"";if(w.role==="warmup")return`
<div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.32); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
<strong style="color:#fbbf24;">\u{1F525} ${te?`${n(te)} \u2022 `:""}WARM-UP (G${w.setNum}): ${w.weightKg===0?"BW":n(w.weightLabel)}</strong>
${w.reps!==null?`<span style="color:#fbbf24; font-weight:700;">\u231A ${n(w.reps)}r</span>`:'<span style="color:#fbbf24; font-weight:700;">Unlogged</span>'}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${q?`${n(q)} \u2022 `:""}${w.durationSec}s TUT${ne}
</div>
</div>`;if(w.pulseSet){const X=w.pulseSet,se=w.reps!==null?w.repDelta===0?`<span style="color:#10b981; font-weight:700;">\u231A ${n(w.reps)}r \u2713</span>`:`<span style="color:#fbbf24; font-weight:700;">\u231A ${n(w.reps)}r vs \u{1F4F1} ${n(X.reps)}r</span>`:"",ie=w.weightMismatch?`<div style="margin-top:2px; color:#fbbf24; font-weight:700;">\u26A0\uFE0F Watch ${n(w.weightMismatch.garminKg)}kg vs App ${n(w.weightMismatch.pulseKg)}kg</div>`:"";return`
<div style="background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.24); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px; flex-wrap:wrap;">
<strong style="color:#fff;">${te?`${n(te)} \u2022 `:""}Set ${n(X.setNum)} (G${w.setNum}): ${w.weightKg===0?"BW":n(w.weightLabel)} \xD7 ${n(X.reps)}r</strong>
${se}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${q?`${n(q)} \u2022 `:""}${w.durationSec}s TUT${ne}${X.timeStr?` \u2022 \u{1F4F1} ${n(X.timeStr)}`:""}
</div>
${ie}
</div>`}return`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
<strong style="color:#cbd5e1;">${te?`${n(te)} \u2022 `:""}${w.role==="extra_set"?"Extra Set":"Unmatched"} (G${w.setNum}): ${w.weightKg===0?"BW Hold":n(w.weightLabel)}</strong>
${w.reps!==null?`<span style="color:var(--primary); font-weight:700;">\u231A ${n(w.reps)}r</span>`:""}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
${q?`${n(q)} \u2022 `:""}${w.durationSec}s TUT${ne}
</div>
</div>`},C=p.exerciseGroups.map(w=>{const ee=[...w.warmupSets,...w.workingSets,...w.extraSets].sort((q,ne)=>q.garminIdx-ne.garminIdx);return`
<div style="margin-bottom:8px;">
<div style="font-size:10.5px; font-weight:800; color:#e2e8f0; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
<span>\u{1F3CB}\uFE0F ${n(w.exerciseName)}</span>
<span style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono);">${w.warmupSets.length>0?`${w.warmupSets.length} WU + `:""}${w.workingSets.length+w.extraSets.length} working</span>
</div>
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:5px;">
${ee.map(q=>S(q,w.exerciseName)).join("")}
</div>
</div>`}).join(""),G=p.unmatchedSets.length>0?`
<div style="margin-bottom:6px;">
<div style="font-size:10px; font-weight:800; color:var(--text-muted); margin-bottom:4px;">Other Watch Sets</div>
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(185px, 1fr)); gap:5px;">
${p.unmatchedSets.map(S).join("")}
</div>
</div>`:"",B=[];p.garminTotalReps!==null&&B.push(`\u231A ${p.garminTotalReps} Garmin reps`),B.push(`\u{1F4F1} ${p.pulseTotalReps} Pulse reps`),p.inferredWarmupReps>0&&B.push(`\u{1F525} ~${p.inferredWarmupReps} warm-up/unlogged reps`);const J=`
<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5; font-family:var(--font-mono);">
<strong style="color:#10b981;">\u{1F517} Rep Reconciliation:</strong> ${n(B.join(" \u2022 "))}
</div>`;f=`${C}${G}${J}`}else{const u=t.peakWeightKg>0?`Peak Load ${t.peakWeightKg}kg (${t.peakWeightCount} working ${t.peakWeightCount===1?"set":"sets"})`:"Bodyweight / Core";r=`${t.activeCount} Active Sets \u2022 ${u}${e}`;const S=$.length>0?`<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5;">
<strong style="color:#10b981;">\u{1F517} Pulse Rep Cross-Reference:</strong> ${$.join(" \u2022 ")}
</div>`:"";f=`
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:5px;">
                ${t.activeSets.map(C=>`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center;">
<strong style="color:#fff;">Set ${C.setNum}: ${C.weightKg===0?"BW Hold":n(C.weightLabel)}</strong>
                      ${C.reps!==null?`<span style="color:var(--primary); font-weight:700;">${n(C.reps)} reps</span>`:""}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
                      ${C.startClock?`${n(C.startClock)} \u2022 `:""}${C.durationSec}s TUT${C.restAfterSec>0?` \u2022 ${C.restAfterSec}s Rest`:""}
</div>
</div>
                `).join("")}
</div>
              ${S}`}h=`
<div style="margin:6px 0 8px; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.24); border-radius:9px; padding:8px 10px;">
          
<div style="font-size:10.5px; font-weight:800; color:var(--cyan); letter-spacing:0.02em;">
            \u231A GARMIN F\u0112NIX 8 SET TELEMETRY: <span style="color:#fff;">${n(r)}</span>
</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:3px; font-family:var(--font-mono);">
            ${n(i)}
</div>
          
<details style="margin-top:6px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.07); border-radius:7px; overflow:hidden;">
<summary style="font-size:10.5px; font-weight:700; color:var(--text-secondary); padding:6px 9px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>\u{1F52C} View All ${t.activeCount} Garmin Watch Sets &amp; Rest Intervals (${t.totalTutSec}s TUT)</span>
<span style="color:var(--text-muted);">\u25BE</span>
</summary>
<div style="padding:8px 9px; border-top:1px solid rgba(255,255,255,0.06);">
              ${f}
</div>
</details>
</div>
      `}const g=o.subTitle||o.sub_title||o.name||"Workout",K=/^(cardio|indoor_cardio|cardio_training|hiit|hiit_training|strength|strength_training|fitness_equipment)$/i.test(String(g).trim())&&a&&a.title?`${a.title} (Garmin ${g})`:g,k=o.source==="manual_app_entry",N=!a&&!k&&typeof getUnclaimedPulseSessionsForActivity=="function"?getUnclaimedPulseSessionsForActivity(o,l,c):[],z=N.length>0?`<button type="button" class="header-pill-btn" data-act-id="${n(o.id)}" data-session-key="${n(N[0]._matchKey)}" onclick="linkGarminPulseMatch(this.dataset.actId, this.dataset.sessionKey)" title="Link ${n(N[0].title||"Pulse Workout")}" style="padding:3px 8px; font-size:11px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); color:#10b981; cursor:pointer;">\u{1F517} Link Pulse</button>`:"",P=o.durationMin??o.duration_min??0,j=o.avgHr??o.avg_hr??null,Z=o.maxHr??o.max_hr??null,H=Number(o.aerobicTe??o.aerobic_te??0),V=Number(o.anaerobicTe??o.anaerobic_te??0),E=/walk|run|ruck|hike/i.test(`${o.name||""} ${g} ${o.activity_type_key||""}`),F=o.steps?Number(o.steps):E&&P?Math.round(Number(P)*91.5):0,W=o.distance_miles?Number(o.distance_miles):F>0?Number((F/1810).toFixed(2)):0,D=E&&F>0?`<span>\u2022</span><span style="color:var(--cyan); font-weight:700;">\u{1F463} ${F.toLocaleString()} activity steps${W>0?` (${W} mi)`:""}</span>`:"",O=document.createElement("div");O.className=`history-card ${x?"today-highlight":""}`,O.style.background=x?"#141a24":"#11141c",O.style.border=x?"1px solid rgba(0, 229, 255, 0.4)":"1px solid rgba(255,255,255,0.08)",O.style.borderRadius="14px",O.style.padding="12px 14px",O.innerHTML=`
      
<div class="history-top-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
<div>
<div class="history-title" style="font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px;">
            ${n(K)}
</div>
<div class="history-meta-row" style="font-size:11.5px; color:var(--text-muted); margin-top:2px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
<span>${n(_)}</span>
<span>\u2022</span>
<span>\u23F1 ${P} min</span>
<span>\u2022</span>
<span style="color:var(--primary); font-weight:800;">\u{1F525} ${o.calories||0} kcal</span>
            ${D}
</div>
</div>
<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${x?'<span style="font-size:10px; font-weight:900; color:var(--primary); background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.3); padding:2px 7px; border-radius:4px; letter-spacing:0.04em;">TODAY</span>':""}
          ${v.recoveryPill}
</div>
</div>

      ${d}
      ${h}

      
<div style="font-size:11.5px; color:#d4d4d8; line-height:1.4; margin:4px 0 8px; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;">
        ${v.primaryTakeaway}
</div>

      
<div class="history-stats-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 4px; text-align:center;">
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:var(--primary);">${o.calories||0}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Active Burn</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#fff;">${j||"--"}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Avg HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#38bdf8;">${Z||"--"}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Peak HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#a78bfa;">${H.toFixed(1)} / ${V.toFixed(1)}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Aerobic/Anaer</div>
</div>
</div>

      
<div style="margin-top:6px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 10px;">
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; margin-bottom:5px;">
<span style="color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Garmin HR Intensity Zones</span>
<span style="color:var(--primary); font-weight:700; font-family:var(--font-mono); font-size:10.5px;">${R.dominantZoneText}</span>
</div>
<div style="display:flex; height:6px; border-radius:3px; overflow:hidden; gap:2px; background:rgba(255,255,255,0.06);">
          ${R.zones.filter(e=>e.pct>0).map(e=>`<div style="height:100%; width:${e.pct}%; background:${e.color}; border-radius:2px; box-shadow:0 0 4px ${e.color}88;" title="Z${e.num}: ${e.durStr} (${e.pct}%)"></div>`).join("")}
</div>
</div>

      
<div class="benefits-toggle-btn" data-act-id="${n(o.id)}" onclick="toggleBenefitAccordion(this.dataset.actId)" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); padding:8px 12px; border-radius:8px; cursor:pointer; font-size:11.5px; font-weight:700; color:var(--cyan);">
<span>\u{1F52C} View Garmin Telemetry, Charts & Recovery (6 sections)</span>
<span class="accordion-arrow" id="arrow_${n(o.id)}" style="transition:transform 0.2s;">\u25BE</span>
</div>

<div class="benefits-accordion-body" id="benefit_body_${n(o.id)}" style="display:none; flex-direction:column; gap:10px; margin-top:8px; padding:12px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.08); border-radius:12px; font-size:11.5px; line-height:1.45;">
        
        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:var(--primary);">\u{1F4C8}</span> Heart Rate Telemetry Curve
</span>
<span style="font-size:10px; font-weight:700; color:${T?"var(--primary)":"var(--text-muted)"};">${A}</span>
</div>
          ${generateHrSvgChart(o)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#f59e0b;">\u{1F4CA}</span> 5-Zone Physiological Intensity
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">Max HR: 190 bpm</span>
</div>
          ${generateZoneBarsHtml(o)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#a78bfa;">\u{1F3AF}</span> Firstbeat Training Effect (TE)
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">0.0 \u2013 5.0 Scale</span>
</div>
          ${generateTeDualGaugesHtml(o)}
</div>

        
<div style="border-left:2px solid var(--primary); padding-left:8px;">
<div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u2713 4. What This Workout Achieved
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(v.achievements||[]).map(e=>`<div>${e}</div>`).join("")}
</div>
</div>

        
<div style="border-left:2px solid #f59e0b; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#f59e0b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u26A0\uFE0F 5. Potential Stressors & Biomechanical Impact
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(v.stressors||[]).map(e=>`<div>${e}</div>`).join("")}
</div>
</div>

        
<div style="border-left:2px solid #38bdf8; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u{1F6E1}\uFE0F 6. Recommended Recovery Protocol & Window
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(v.recoveryProtocol||[]).map(e=>`<div>${e}</div>`).join("")}
</div>
</div>

</div>

<div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10.5px; color:var(--text-muted);">${k?"Pulse Logged Entry":"Garmin Telemetry"} \u2022 ID: ${n(o.id)}</span>
<div style="display:flex; align-items:center; gap:6px;">
${z}
<button class="header-pill-btn" style="padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:var(--text-secondary);" data-act-id="${n(o.id)}" onclick="openAnnotateModal(this.dataset.actId)">
          Annotate Notes \u270E
</button>
</div>
</div>
    `,s.appendChild(O)})}let _renphoHistoryCache=null,_renphoHistoryFetchedAtMs=0;async function renderRenphoTrendChart(s={}){let l=Array.isArray(_renphoHistoryCache)?_renphoHistoryCache:[];const m=!!(s&&s.force===!0),n=Date.now()-_renphoHistoryFetchedAtMs>300*1e3;if(m||l.length===0||n)try{const y=await(typeof pulseApiFetch=="function"?pulseApiFetch("/api/renpho/history?days=30",{promptAuthOn401:!1}):fetch("/api/renpho/history?days=30"));if(y&&y.ok){const L=await y.json(),I=Array.isArray(L)||L&&Array.isArray(L.history),U=Array.isArray(L)?L:L&&Array.isArray(L.history)?L.history:[];I&&(m||U.length>0||l.length===0)&&(l=U,_renphoHistoryCache=U,_renphoHistoryFetchedAtMs=Date.now(),typeof window<"u"&&(window.PULSE_RENPHO_HISTORY=U))}}catch(y){console.warn("[RenphoChart] Fetch failed, using fallback live state:",y)}try{const y=document.getElementById("bodyAvg7dWeightVal");if(y&&Array.isArray(l)&&l.length>0){const L=l[l.length-1],I=Number(L&&(L["7d_avg_weight"]??L.weight_kg));Number.isFinite(I)&&I>0&&(y.innerText=`7-Day EMA: ${I.toFixed(2)} kg`)}}catch{}let c=document.getElementById("renphoTrendChartContainer");if(!c){c=document.createElement("div"),c.id="renphoTrendChartContainer";const y=document.getElementById("renphoSyncTime"),L=y?y.closest(".card"):document.querySelector("#tab-body .card")||document.querySelector(".card");L?L.appendChild(c):(document.getElementById("tab-today")||document.querySelector("main")||document.body).appendChild(c)}if(!c)return;c.style.marginTop="14px",c.style.paddingTop="12px",c.style.borderTop="1px solid rgba(255,255,255,0.06)";const o=()=>{const y=typeof window<"u"&&window.BAKED_LIVE_STATE?window.BAKED_LIVE_STATE:{},L=y.renpho||y.athlete||(typeof window<"u"?window.athleteProfile:null)||{},I=Number(L.weight_kg),U=Number(L.body_fat_pct),Y=Number(L.lean_mass_kg),Q=Number.isFinite(I)&&I>0?`Latest reading: ${I.toFixed(2)} kg${Number.isFinite(U)&&U>0?` \u2022 ${U.toFixed(1)}% BF`:""}${Number.isFinite(Y)&&Y>0?` \u2022 ${Y.toFixed(2)} kg LBM`:""}`:"Sync Renpho or log a manual weigh-in to begin tracking.";c.innerHTML=`
<div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.14); border-radius:12px; padding:16px; text-align:center;">
<div style="font-size:12px; font-weight:800; color:#e4e4e7; margin-bottom:4px;">Need \u2265 2 weigh-ins to plot 30-day trend</div>
<div style="font-size:11px; color:var(--text-muted);">${Q}</div>
</div>`};if(!l||l.length<2){o();return}const M=y=>{const L=y&&y.timestamp!==void 0&&y.timestamp!==null?Number(y.timestamp):NaN;if(Number.isFinite(L)&&L>0)return L<1e11?L*1e3:L;if(y&&y.date_str){const I=new Date(y.date_str).getTime();if(Number.isFinite(I)&&I>0)return I}return 0};l=l.slice().sort((y,L)=>M(y)-M(L));const x=l.map(y=>{const L=M(y)||Date.now(),I=new Date(L),U=isNaN(I.getTime())?"":`${I.getMonth()+1}/${I.getDate()}`;return{ts:L,dateLabel:U,dateStr:y.date_str||U,bf:Number(y.body_fat_pct||0),lm:Number(y.lean_mass_kg||0),wt:Number(y.weight_kg||0)}}).filter(y=>y.bf>5&&y.lm>20);if(x.length<2){o();return}const _=7*86400*1e3;x.forEach((y,L)=>{const I=x.slice(0,L+1).filter(Q=>y.ts-Q.ts<=_),U=I.reduce((Q,re)=>Q+re.bf,0)/I.length,Y=I.reduce((Q,re)=>Q+re.lm,0)/I.length;y.maBf=Math.round(U*100)/100,y.maLm=Math.round(Y*100)/100});const v=x[0],R=x[x.length-1],A=Math.max(86400*1e3,R.ts-v.ts)/(7*86400*1e3),d=(R.bf-v.bf)/A,$=v.wt&&v.lm?v.wt-v.lm:v.wt*(v.bf/100),h=((R.wt&&R.lm?R.wt-R.lm:R.wt*(R.bf/100))-$)/A,g=`${h<=0?"":"+"}${h.toFixed(2)} kg/wk`,b=`${d<=0?"":"+"}${d.toFixed(2)} %/wk`,K=x.map(y=>y.bf),k=x.map(y=>y.lm),N=Math.min(...K),z=Math.max(...K),P=Math.min(...k),j=Math.max(...k),Z=Math.max(.15,(z-N)*.12),H=Math.floor((N-Z)*10)/10,V=Math.ceil((z+Z)*10)/10,E=Math.max(.4,V-H),F=Math.max(.2,(j-P)*.12),W=Math.floor((P-F)*10)/10,D=Math.ceil((j+F)*10)/10,O=Math.max(.6,D-W),e=380,r=180,i=50,f=54,u=24,S=28,C=e-i-f,G=r-u-S,B=x.map((y,L)=>{const I=Math.round((i+L/Math.max(1,x.length-1)*C)*10)/10,U=Math.round((u+(1-(y.bf-H)/E)*G)*10)/10,Y=Math.round((u+(1-(y.maBf-H)/E)*G)*10)/10,Q=Math.round((u+(1-(y.lm-W)/O)*G)*10)/10,re=Math.round((u+(1-(y.maLm-W)/O)*G)*10)/10;return{...y,x:I,yBf:U,yBfMa:Y,yLm:Q,yLmMa:re}}),J=y=>{if(B.length===1)return`M ${B[0].x} ${B[0][y]}`;let L=`M ${B[0].x} ${B[0][y]}`;for(let U=0;U<B.length-1;U++){const Y=B[U],Q=B[U+1],re=(Y.x+Q.x)/2;L+=` Q ${Y.x} ${Y[y]}, ${re} ${(Y[y]+Q[y])/2}`}const I=B[B.length-1];return L+=` L ${I.x} ${I[y]}`,L},w=J("yBf"),ee=J("yBfMa"),q=J("yLm"),ne=J("yLmMa"),te=`${w} L ${B[B.length-1].x} ${r-S} L ${B[0].x} ${r-S} Z`,X=u,se=Math.round((u+G*.5)*10)/10,ie=r-S,oe=x[0].dateLabel||"D-30",ae=x[Math.floor(x.length/2)].dateLabel||"D-15",le=x[x.length-1].dateLabel||"Today";c.innerHTML=`
    
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
          ${g} <small style="color:var(--text-secondary); font-size:9.5px; font-weight:600;">(${b})</small>
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
<svg viewBox="0 0 ${e} ${r}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="renphoBfGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.32"/>
<stop offset="60%" stop-color="#00F0FF" stop-opacity="0.08"/>
<stop offset="100%" stop-color="#00F0FF" stop-opacity="0.0"/>
</linearGradient>
</defs>

        
<line x1="${i}" y1="${X}" x2="${e-f}" y2="${X}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${i}" y1="${se}" x2="${e-f}" y2="${se}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${i}" y1="${ie}" x2="${e-f}" y2="${ie}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

        
<text x="${i-4}" y="${X+4}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${V.toFixed(1)}%</text>
<text x="${i-4}" y="${se+4}" fill="#38bdf8" font-size="12.5" font-weight="600" text-anchor="end">${((V+H)/2).toFixed(1)}%</text>
<text x="${i-4}" y="${ie}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${H.toFixed(1)}%</text>

        
<text x="${e-f+4}" y="${X+4}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${D.toFixed(1)}kg</text>
<text x="${e-f+4}" y="${se+4}" fill="#34d399" font-size="12.5" font-weight="600" text-anchor="start">${((D+W)/2).toFixed(1)}kg</text>
<text x="${e-f+4}" y="${ie}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${W.toFixed(1)}kg</text>

        
<path d="${te}" fill="url(#renphoBfGrad)"/>

        
<path d="${ee}" fill="none" stroke="#00F0FF" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>
<path d="${ne}" fill="none" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>

        
<path d="${w}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.6));"/>
<path d="${q}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.6));"/>

        
<circle cx="${B[B.length-1].x}" cy="${B[B.length-1].yBf}" r="4" fill="#00F0FF" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.9));"/>
<circle cx="${B[B.length-1].x}" cy="${B[B.length-1].yLm}" r="4" fill="#10b981" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.9));"/>

        
<text x="${i}" y="${r-6}" fill="var(--text-muted)" font-size="12.5">${oe}</text>
<text x="${i+C/2}" y="${r-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${ae}</text>
<text x="${e-f}" y="${r-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${le}</text>
</svg>
</div>

    
<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(0,240,255,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#00F0FF; font-weight:800; text-transform:uppercase;">BF% Range</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${R.bf.toFixed(1)}%</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#00F0FF;">${N.toFixed(1)}%</strong></span>
<span>Max: <strong style="color:#94a3b8;">${z.toFixed(1)}%</strong></span>
</div>
</div>

<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(16,185,129,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#10b981; font-weight:800; text-transform:uppercase;">Lean Mass</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${R.lm.toFixed(1)}kg</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#94a3b8;">${P.toFixed(1)}kg</strong></span>
<span>Max: <strong style="color:#10b981;">${j.toFixed(1)}kg</strong></span>
</div>
</div>
</div>
  `}let _strengthHistoryCache=null,_strengthHistoryFetchedAtMs=0;async function renderStrengthProgressionChart(s={}){let l=_strengthHistoryCache&&typeof _strengthHistoryCache=="object"?_strengthHistoryCache:{},m={};const n=!!(s&&s.force===!0),c=Object.keys(l).length>0,o=Date.now()-_strengthHistoryFetchedAtMs>300*1e3;if(n||!c||o)try{const p=await(typeof pulseApiFetch=="function"?pulseApiFetch("/api/strength/history?days=30",{promptAuthOn401:!1}):fetch("/api/strength/history?days=30"));if(p&&p.ok){const h=await p.json();l=h&&h.exercises||h||{},_strengthHistoryCache=l,_strengthHistoryFetchedAtMs=Date.now()}}catch(p){console.warn("[StrengthChart] Fetch failed, falling back to baked prescriptions:",p)}m=(typeof window<"u"&&window.BAKED_LIVE_STATE?window.BAKED_LIVE_STATE:{}).strength_prescriptions||(typeof window<"u"?window.strengthPrescriptions:null)||{};const x=typeof getAllExercises=="function"?getAllExercises():[],_=(p,h,g)=>{const b=x.find(P=>P&&P.id===p),K=b?typeof b.getBaseWeight=="function"?b.getBaseWeight():b.targetWeight:NaN,k=b?typeof b.getBaseReps=="function"?b.getBaseReps():b.targetReps:NaN,N=typeof K=="number"&&Number.isFinite(K)&&K>0?K:h,z=typeof k=="number"&&Number.isFinite(k)&&k>0?k:g;return{weight:N,reps:z,e1rm:Number((N*(1+z/30)).toFixed(1))}},v=_("barbell_squat",100,8),R=_("barbell_rdl",70,8),T=_("barbell_floor_press",95,6),A=_("barbell_pendlay_row",85,8),a=[{key:"barbell_squat",name:"Barbell Back Squat",icon:"\u{1F3CB}\uFE0F",family:"Quad & Knee Extensor Power",defaultWeight:v.weight,defaultReps:v.reps,defaultE1rm:v.e1rm},{key:"barbell_rdl",name:"Barbell Romanian Deadlift (RDL)",icon:"\u26A1",family:"Hamstring & Glute Hinge Anchor",defaultWeight:R.weight,defaultReps:R.reps,defaultE1rm:R.e1rm},{key:"barbell_floor_press",name:"Barbell Floor Press",icon:"\u{1F6E1}\uFE0F",family:"Horizontal Push / Strict Triceps Power",defaultWeight:T.weight,defaultReps:T.reps,defaultE1rm:T.e1rm},{key:"barbell_pendlay_row",name:"Barbell Pendlay Row",icon:"\u{1F680}",family:"Explosive Dead-Stop Lat Pull",defaultWeight:A.weight,defaultReps:A.reps,defaultE1rm:A.e1rm}];let d=document.getElementById("strengthProgressionContainer");if(!d){d=document.createElement("div"),d.id="strengthProgressionContainer";const p=document.getElementById("trainViewPrescribed")||document.getElementById("tab-train")||document.getElementById("todayTrainingContainer");p?p.appendChild(d):(document.querySelector("main")||document.body).appendChild(d)}d.style.marginTop="14px",d.style.display="flex",d.style.flexDirection="column",d.style.gap="10px";let $="";const t=(p,h)=>{if(typeof p=="number"&&Number.isFinite(p))return p;if(typeof p=="string"){const b=p.match(/-?\d+(?:\.\d+)?/);if(b)return Number(b[0])}const g=Number(p);return Number.isFinite(g)&&g>0?g:h};for(const p of a){const h=m[p.key]||{},g=l[p.key]||[],b=t(h.weight,p.defaultWeight),K=t(h.reps,p.defaultReps),k=t(h.e1rm,p.defaultE1rm),N=t(h.last_logged_weight??(g.length?g[g.length-1].weight:b),b),z=t(h.last_logged_reps??(g.length?g[g.length-1].reps:K),K),P=t(h.last_e1rm??(g.length?g[g.length-1].e1rm:k),k),j=h.progression_ready===!0||h.status==="progression_ready"||N>b||P>k,Z=g.slice(-4);let H,V;if(Z.length>=2)H=Z.map((e,r)=>({label:r===Z.length-1?"Now":`S${r+1}`,val:Number(Number(e.e1rm||k).toFixed(1)),isCurrent:r===Z.length-1})),V=H[H.length-1].val.toFixed(1);else{const e=Number(Number(Z.length===1?Z[0].e1rm||k:j?Math.max(P,k):k).toFixed(1));H=[{label:"Now",val:e,isCurrent:!0}],V=e.toFixed(1)}const E=Math.min(...H.map(e=>e.val)),F=Math.max(...H.map(e=>e.val)),W=Math.max(6,F-E+3),D=H.map(e=>{const r=Math.max(12,Math.round((e.val-(E-1.5))/W*36)),i=e.isCurrent&&j,f=i?"background:linear-gradient(180deg, #00F0FF 0%, #10b981 100%); box-shadow:0 0 10px rgba(0,240,255,0.6);":e.isCurrent?"background:#38bdf8;":"background:rgba(255,255,255,0.18);";return`
<div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:3px;">
<span style="font-size:9.5px; font-weight:800; font-family:var(--font-mono); color:${i?"#00F0FF":e.isCurrent?"#fff":"var(--text-muted)"};">${e.val}</span>
<div style="width:100%; max-width:32px; height:${r}px; ${f} border-radius:3px;"></div>
<span style="font-size:9px; font-weight:700; color:${e.isCurrent?"var(--primary)":"var(--text-muted)"}; margin-top:1px;">${e.label}</span>
</div>
      `}).join("");$+=`
<div class="strength-progression-card" style="${j?"border:1px solid rgba(0,240,255,0.6); box-shadow:0 0 18px rgba(0,240,255,0.22); background:linear-gradient(135deg, rgba(0,240,255,0.06) 0%, rgba(15,23,42,0.85) 100%);":"border:1px solid rgba(255,255,255,0.07); background:rgba(15,23,42,0.5);"} border-radius:12px; padding:12px 14px; position:relative; overflow:hidden;">
        
<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
<div>
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:14px;">${p.icon}</span>
<strong style="color:#fff; font-size:13px; font-family:var(--font-display); letter-spacing:-0.01em;">${p.name}</strong>
</div>
<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">
              Prescribed: <span style="color:#e2e8f0; font-weight:700;">${b}kg \xD7 ${K}</span> \u2022 ${p.family}
</div>
</div>
<div>
            ${j?`
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
              ${N}kg <small style="color:var(--text-muted); font-size:10px;">\xD7 ${z} reps</small>
</div>
</div>
<div style="text-align:right;">
<div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.04em;">Calculated e1RM</div>
<div style="font-size:13px; font-weight:800; color:${j?"#00F0FF":"#fff"}; font-family:var(--font-mono); margin-top:2px;">
              ${V} kg ${j?`<small style="color:#10b981; font-weight:800;">(+${Math.max(2.5,Number((V-k).toFixed(1)))}kg)</small>`:""}
</div>
</div>
</div>

        
<div>
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); margin-bottom:5px;">
<span style="font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">4-Week e1RM Progression Visual</span>
<span style="font-family:var(--font-mono); color:${j?"#10b981":"var(--text-muted)"}; font-weight:700;">
              ${j?"\u2713 Progressive Overload Met":"Consistent Load Retention"}
</span>
</div>
<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; background:rgba(0,0,0,0.32); border:1px solid rgba(255,255,255,0.04); border-radius:8px; padding:8px 8px 6px; align-items:flex-end; height:74px;">
            ${D}
</div>
</div>
</div>
    `}d.innerHTML=`
    
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

    
    ${$}
  `}typeof window<"u"&&(window.getGarminHrZoneBreakdown=getGarminHrZoneBreakdown,window.generateHrSvgChart=generateHrSvgChart,window.generateZoneBarsHtml=generateZoneBarsHtml,window.generateTeDualGaugesHtml=generateTeDualGaugesHtml,window.renderHistoryList=renderHistoryList,window.renderRenphoTrendChart=renderRenphoTrendChart,window.renderStrengthProgressionChart=renderStrengthProgressionChart);let _pulseChartsInitInFlight=!1;function initPulseCharts(){if(!_pulseChartsInitInFlight){_pulseChartsInitInFlight=!0;try{try{typeof renderRenphoTrendChart=="function"&&renderRenphoTrendChart()}catch(s){console.warn("[PulseCharts] renderRenphoTrendChart init warning:",s)}try{typeof renderStrengthProgressionChart=="function"&&renderStrengthProgressionChart()}catch(s){console.warn("[PulseCharts] renderStrengthProgressionChart init warning:",s)}}finally{_pulseChartsInitInFlight=!1}}}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>initPulseCharts(),{once:!0}):initPulseCharts());

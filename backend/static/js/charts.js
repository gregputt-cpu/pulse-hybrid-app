function getGarminHrZoneBreakdown(i){if(i&&i.hr_zones&&typeof i.hr_zones=="object"){const r=i.hr_zones,d=Number(r.z1??r[1]??r.zone1??0),y=Number(r.z2??r[2]??r.zone2??0),u=Number(r.z3??r[3]??r.zone3??0),M=Number(r.z4??r[4]??r.zone4??0),R=Number(r.z5??r[5]??r.zone5??0),S=d+y+u+M+R;if(S>0){const H=Math.round(d/S*100),D=Math.round(y/S*100),I=Math.round(u/S*100),L=Math.round(M/S*100),W=Math.round(R/S*100),E=f=>`${Math.floor(f/60)}m ${f%60<10?"0":""}${f%60}s`,j=[{num:5,name:"Maximum / Anaerobic",range:"> 171 bpm",pct:W,durStr:E(R),color:"#ef4444"},{num:4,name:"Threshold / Hard",range:"152\u2013171 bpm",pct:L,durStr:E(M),color:"#f59e0b"},{num:3,name:"Aerobic / Moderate",range:"133\u2013152 bpm",pct:I,durStr:E(u),color:"#10b981"},{num:2,name:"Easy / Fat Oxidation Base",range:"114\u2013133 bpm",pct:D,durStr:E(y),color:"#00F0FF"},{num:1,name:"Warm Up / Active Recovery",range:"< 114 bpm",pct:H,durStr:E(d),color:"#8b9db5"}];let c=j[0];return j.forEach(f=>{f.pct>c.pct&&(c=f)}),{zones:j,dominantZoneText:"Dominant: Z"+c.num+" ("+c.durStr+" \u2022 "+c.pct+"%)"}}}const s=i.durationMin||i.duration_min||30,a=i.avgHr||i.avg_hr||115,l=i.maxHr||i.max_hr||150,p=`${i.name||""} ${i.subTitle||i.sub_title||""}`.toLowerCase(),e=p.includes("walk")||p.includes("stroll"),N=p.includes("strength")||p.includes("barbell")||p.includes("lift")||p.includes("gym"),x=p.includes("jump")||p.includes("plyo")||p.includes("tuck");let z,g,v,T,t;e||a<95?(z=88,g=12,v=0,T=0,t=0):N?(z=22,g=48,v=22,T=8,t=0):x||l>=162?(z=10,g=25,v=35,T=22,t=8):a<=122?(z=12,g=58,v=24,T=6,t=0):a<=135?(z=8,g=28,v=46,T=15,t=3):(z=5,g=20,v=35,T=28,t=12);const n=r=>{const d=Math.round(r*60),y=Math.floor(d/60),u=d%60;return`${y}m ${u<10?"0":""}${u}s`},k=[{num:5,name:"Maximum / Anaerobic",range:"> 171 bpm",pct:t,durStr:n(s*t/100),color:"#ef4444"},{num:4,name:"Threshold / Hard",range:"152\u2013171 bpm",pct:T,durStr:n(s*T/100),color:"#f59e0b"},{num:3,name:"Aerobic / Moderate",range:"133\u2013152 bpm",pct:v,durStr:n(s*v/100),color:"#10b981"},{num:2,name:"Easy / Fat Oxidation Base",range:"114\u2013133 bpm",pct:g,durStr:n(s*g/100),color:"#00F0FF"},{num:1,name:"Warm Up / Active Recovery",range:"< 114 bpm",pct:z,durStr:n(s*z/100),color:"#8b9db5"}];let A=k[0];return k.forEach(r=>{r.pct>A.pct&&(A=r)}),{zones:k,dominantZoneText:`Dominant: Z${A.num} (${A.durStr} \u2022 ${A.pct}%)`}}function generateHrSvgChart(i){const s=i.durationMin||i.duration_min||30;let a=i.avgHr||i.avg_hr||119,l=i.maxHr||i.max_hr||151,p=[];if(Array.isArray(i.hr_samples)&&i.hr_samples.length>=5){const c=[];for(const f of i.hr_samples){let $=null;typeof f=="number"?$=f:f&&typeof f=="object"&&($=f.hr??f.bpm??f.value),$=Number($),!isNaN($)&&$>30&&$<250&&c.push($)}if(c.length>=5){if(c.length>80){const $=(c.length-1)/79;for(let F=0;F<80;F++){const w=Math.min(c.length-1,Math.round(F*$));p.push(c[w])}}else p=c.slice();const f=c.reduce(($,F)=>$+F,0);a=Math.round(f/c.length),l=Math.max(...c)}}const N=p.length===0;if(N){const f=Math.max(50,a-40);for(let $=0;$<24;$++){const F=$/23;let w;if(F<.15)w=f+15+(a-f-15)*(F/.15);else if(F<.85){const h=(F-.15)/.7,C=Math.sin(h*Math.PI*6),b=Math.exp(-Math.pow((h-.72)*8,2));w=a+C*9+b*(l-a)}else{const h=(F-.85)/.15;w=a-5-(a-f-10)*h}p.push(Math.min(l,Math.max(f,w)))}p[17]=l}const x=Math.max(40,Math.min(...p,a-30)),z=Math.max(l+12,168),g=Math.max(20,z-x),v=p.length,T=360,t=130,n=42,k=14,A=26,r=28,d=T-n-k,y=t-A-r,u=p.map((c,f)=>{const $=n+f/(v-1)*d,F=A+(1-(c-x)/g)*y;return{x:Math.round($*10)/10,y:Math.round(F*10)/10,hr:Math.round(c)}});let M=`M ${u[0].x} ${u[0].y}`;for(let c=0;c<u.length-1;c++){const f=u[c],$=u[c+1],F=(f.x+$.x)/2;M+=` Q ${f.x} ${f.y}, ${F} ${(f.y+$.y)/2}`}const R=u[u.length-1];M+=` L ${R.x} ${R.y}`;const S=`${M} L ${R.x} ${t-r} L ${u[0].x} ${t-r} Z`,H=Math.round((A+(1-(a-x)/g)*y)*10)/10;let D=0,I=p[0];p.forEach((c,f)=>{c>=I&&(I=c,D=f)});const L=u[D]||u[0],W=N?"OPTICAL SENSOR MODEL":"OPTICAL SENSOR STREAM (GARMIN)",E=`hrGrad_${String(i.id).replace(/[^a-zA-Z0-9]/g,"_")}`,j=Math.round(s/2);return`
<svg viewBox="0 0 ${T} ${t}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="${E}" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.38"/>
<stop offset="70%" stop-color="#3B82F6" stop-opacity="0.12"/>
<stop offset="100%" stop-color="#8B5CF6" stop-opacity="0.0"/>
</linearGradient>
</defs>

      
<line x1="${n}" y1="${A}" x2="${T-k}" y2="${A}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${n}" y1="${H}" x2="${T-k}" y2="${H}" stroke="rgba(56,189,248,0.4)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${n}" y1="${t-r}" x2="${T-k}" y2="${t-r}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

      
<text x="${n-4}" y="${H+4}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">${a}</text>
<text x="${n-4}" y="${A+10}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${z}</text>
<text x="${n-4}" y="${t-r}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${x}</text>

      
<path d="${S}" fill="url(#${E})"/>

      
<path d="${M}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.5));"/>

      
<text x="${n+2}" y="${A-8}" fill="${N?"var(--text-muted)":"#00F0FF"}" font-size="12.5" font-weight="800" letter-spacing="0.04em">${W}</text>

      
<text x="${T-k}" y="${H-5}" fill="#38bdf8" font-size="12.5" font-weight="700" text-anchor="end">Avg ${a} bpm</text>

      
<circle cx="${L.x}" cy="${L.y}" r="4" fill="#ef4444" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(239,68,68,0.8));"/>
<circle cx="${L.x}" cy="${L.y}" r="7" fill="none" stroke="#ef4444" stroke-width="1" opacity="0.6"/>
<text x="${L.x}" y="${Math.max(14,L.y-8)}" fill="#ef4444" font-size="12.5" font-weight="800" text-anchor="middle">Peak ${l}</text>

      
<text x="${n}" y="${t-6}" fill="var(--text-muted)" font-size="12.5">0:00</text>
<text x="${n+d/2}" y="${t-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${j}:00</text>
<text x="${T-k}" y="${t-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${s.toFixed(1)}m</text>
</svg>
  `}function generateZoneBarsHtml(i){const{zones:s}=getGarminHrZoneBreakdown(i);return s.map(a=>`
<div style="display:flex; flex-direction:column; gap:2px; margin-bottom:6px;">
<div style="display:flex; justify-content:space-between; font-size:10.5px; line-height:1.2;">
<span style="color:#d4d4d8; font-weight:600;">
<span style="color:${a.color}; font-weight:800;">Z${a.num}</span> ${a.name} <small style="color:var(--text-muted); font-size:9.5px;">(${a.range})</small>
</span>
<span style="color:#fff; font-weight:700; font-family:var(--font-mono); font-variant-numeric:tabular-nums;">
          ${a.durStr} <small style="color:var(--text-muted);">(${a.pct}%)</small>
</span>
</div>
<div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
<div style="height:100%; width:${a.pct}%; background:${a.color}; border-radius:3px; box-shadow:0 0 6px ${a.color}66;"></div>
</div>
</div>
  `).join("")}function generateTeDualGaugesHtml(i){const s=i.aerobicTe??i.aerobic_te,a=i.anaerobicTe??i.anaerobic_te,l=s!=null&&!Number.isNaN(Number(s))?Number(s):0,p=a!=null&&!Number.isNaN(Number(a))?Number(a):0,e=(z,g)=>z>=4.5?{label:"Overreaching",desc:g?"High neuromuscular & PCr fatigue":"Heavy aerobic strain requiring 48h rest",color:"#ef4444"}:z>=3.5?{label:"Highly Improving",desc:g?"Drastically expands glycolytic buffering":"Major stimulus for VO2max expansion",color:"#f59e0b"}:z>=2.5?{label:"Impacting / Building",desc:g?"Improves anaerobic work tolerance":"Stimulates aerobic base & stroke volume",color:"#10b981"}:z>=1.5?{label:"Maintaining Base",desc:g?"Minor anaerobic speed maintenance":"Maintains aerobic fitness & mitochondrial density",color:"#00F0FF"}:{label:"Minor Recovery Stimulus",desc:"Active recovery flush with negligible debt",color:"#38bdf8"},N=e(l,!1),x=e(p,!0);return`
<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Aerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${N.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${l.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100,l/5*100)}%; background:${N.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${N.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${N.desc}</div>
</div>

      
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:8px 10px;">
<div style="display:flex; justify-content:space-between; align-items:baseline; gap:4px;">
<span style="font-size:9.5px; font-weight:800; color:var(--text-muted); text-transform:uppercase; white-space:nowrap; letter-spacing:0.02em;">Anaerobic TE</span>
<span style="font-size:15px; font-weight:700; color:${x.color}; font-family:'Space Grotesk',sans-serif; font-variant-numeric:tabular-nums; white-space:nowrap;">${p.toFixed(1)} <small style="font-size:9.5px; color:var(--text-muted); font-weight:500;">/ 5.0</small></span>
</div>
<div style="height:5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin:5px 0;">
<div style="height:100%; width:${Math.min(100,p/5*100)}%; background:${x.color}; border-radius:3px;"></div>
</div>
<div style="font-size:10.5px; font-weight:700; color:#fff;">${x.label}</div>
<div style="font-size:9.5px; color:var(--text-muted); line-height:1.3; margin-top:2px;">${x.desc}</div>
</div>
</div>
  `}function decodeGarminStrengthSets(i){const s=i&&Array.isArray(i.exercise_sets)?i.exercise_sets:[];if(!s.length)return null;const a=[],l=[];for(let t=0;t<s.length;t++){const n=s[t];if(!n||typeof n!="object")continue;const k=String(n.set_type||"").toUpperCase(),A=Math.round(Number(n.duration||0));if(k==="REST"){A>0&&l.push(A);continue}if(k!=="ACTIVE")continue;const r=Number(n.weight||0),d=r>=1e3?Math.round(r/1e3*10)/10:r>0?Math.round(r*10)/10:0;let y=0;t+1<s.length&&s[t+1]&&String(s[t+1].set_type||"").toUpperCase()==="REST"&&(y=Math.round(Number(s[t+1].duration||0))),a.push({setNum:a.length+1,weightKg:d,weightLabel:d>0?`${d}kg`:"Bodyweight",shortWeightLabel:d>0?`${d}kg`:"BW",durationSec:A,reps:n.reps!=null&&Number(n.reps)>0?Number(n.reps):null,exerciseName:n.exercise_name?String(n.exercise_name).replace(/_/g," "):"",restAfterSec:y})}if(!a.length)return null;const p=a.filter(t=>t.weightKg>0),e=p.length?Math.max(...p.map(t=>t.weightKg)):0,N=e>0?a.filter(t=>t.weightKg===e).length:0,x=l.length?Math.round(l.reduce((t,n)=>t+n,0)/l.length):0,z=a.reduce((t,n)=>t+n.durationSec,0),g=[],v={};a.forEach(t=>{const n=t.weightKg>0?String(t.weightKg):"BW";v[n]||(v[n]={key:n,weightKg:t.weightKg,count:0,totalDur:0},g.push(v[n])),v[n].count+=1,v[n].totalDur+=t.durationSec});const T=g.map(t=>t.weightKg===0?`${t.count}\xD7BW (${t.totalDur>=60?`${t.totalDur}s core hold`:`${t.totalDur}s`})`:e>0&&t.weightKg<e?`${t.count}\xD7${t.weightKg}kg warm-up`:e>0&&t.weightKg===e?`${t.count}\xD7${t.weightKg}kg working ${t.count===1?"set":"sets"}`:`${t.count}\xD7${t.weightKg}kg`);return{activeSets:a,activeCount:a.length,peakWeightKg:e,peakWeightCount:N,avgRestSec:x,totalTutSec:z,workingSummary:T.join(" \u2022 ")}}window.decodeGarminStrengthSets=decodeGarminStrengthSets;function renderHistoryList(){const i=document.getElementById("trainViewHistory");if(!i)return;const s=typeof recentActivitiesData<"u"&&Array.isArray(recentActivitiesData)?recentActivitiesData:window.BAKED_LIVE_STATE&&window.BAKED_LIVE_STATE.garmin&&Array.isArray(window.BAKED_LIVE_STATE.garmin.recent_activities)?window.BAKED_LIVE_STATE.garmin.recent_activities:[],a=document.getElementById("btnTrainHistory");a&&(a.innerText=`History (${s.length})`);const l=typeof escapeHtml=="function"?escapeHtml:(e=>String(e??"").replace(/[&<>"']/g,N=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[N]));i.innerHTML="";const p=typeof buildGarminPulseMatchMap=="function"?buildGarminPulseMatchMap(s):null;s.forEach(e=>{const N=typeof formatActivityDisplay=="function"?formatActivityDisplay(e):{isToday:!1,displayDate:e.date||""},x=N.isToday,z=N.displayDate,g=typeof getEgmWorkoutBreakdown=="function"?getEgmWorkoutBreakdown(e,x):{recoveryPill:"",primaryTakeaway:"",achievements:[],stressors:[],recoveryProtocol:[]},v=getGarminHrZoneBreakdown(e),T=Array.isArray(e.hr_samples)&&e.hr_samples.length>=5,t=T?"OPTICAL SENSOR STREAM (GARMIN)":"OPTICAL SENSOR MODEL",n=p?p.get(String(e.id))||null:typeof getMatchedPulseSessionForGarmin=="function"?getMatchedPulseSessionForGarmin(e,s):null;let k="",A=[];if(n){let w=n.title||"";w||(n.preset==="gym"?w="Option A: Heavy Barbell Strength & Hinge":n.preset==="combat"?w="Option B: Hybrid Work Capacity Circuit":w="Pulse Strength Session");const h=[e.total_sets?`${e.total_sets} Garmin Sets`:n.setsLogged?`${n.setsLogged} Sets Logged`:"",e.avgHr?`${e.avgHr} bpm HR`:"",e.calories?`${e.calories} kcal`:""].filter(Boolean).join(" \u2022 ");let C="";if(n.details&&typeof n.details=="object"){const b={},G=typeof getAllExercises=="function"?getAllExercises():[];Object.entries(n.details).forEach(([K,V])=>{if(!V||!V.logged)return;const q=V.exercise_id||String(K||"").replace(/_\d+$/,"")||"exercise";if(!b[q]){const X=G.find(J=>J.id===q);b[q]={name:X?X.name:q.replace(/_/g," ").replace(/\b\w/g,J=>J.toUpperCase()),sets:[]}}const B=V.weight!==void 0&&V.weight!==null&&V.weight!=="Bodyweight"?`${V.weight}kg`:V.weight==="Bodyweight"?"BW":"",Y=`${V.reps||0}r`;b[q].sets.push(B?`${B} \xD7 ${Y}`:Y)});const O=Object.values(b);A=O.map(K=>`${l(K.name)} (${l(K.sets.join(", "))})`),O.length>0&&(C=`
<div style="margin-top:6px; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:4px; font-size:10.5px;">
              ${O.map(K=>`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 7px;">
<span style="font-weight:700; color:#fff;">${l(K.name)}:</span>
<span style="color:var(--cyan); font-family:var(--font-mono); font-size:10px; margin-left:4px;">${l(K.sets.join(", "))}</span>
</div>
              `).join("")}
</div>
          `)}else if(n.conditioningDrill){const b=n.conditioningDrill,G=b.totalSeconds?`${Math.round(b.totalSeconds/60)}m`:"";C=`
<div style="margin-top:6px; font-size:10.5px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:4px 8px;">
<span style="font-weight:700; color:#fff;">${l(b.name||"Conditioning")}:</span>
<span style="color:var(--cyan); font-family:var(--font-mono); font-size:10px; margin-left:4px;">${l(String(b.format||"interval").toUpperCase())} \u2022 ${b.roundsCompleted||b.rounds||1} rounds ${G?`(${G})`:""}</span>
</div>
        `}k=`
<div style="margin:6px 0 8px; padding:8px 10px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:9.5px; font-weight:800; background:rgba(16,185,129,0.22); border:1px solid #10b981; color:#10b981; padding:2px 6px; border-radius:4px; letter-spacing:0.04em;">\u{1F517} MATCHED WITH PULSE</span>
<span style="font-size:11.5px; font-weight:800; color:#fff;">${l(w)}</span>
</div>
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              ${h?`<span style="font-size:10px; color:var(--text-muted); font-family:var(--font-mono);">${l(h)}</span>`:""}
              <button type="button" class="header-pill-btn" data-act-id="${l(e.id)}" onclick="unlinkGarminPulseMatch(this.dataset.actId)" title="Unlink Pulse session from this Garmin recording" style="padding:1px 6px; font-size:9.5px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.14); color:var(--text-secondary); cursor:pointer;">\u2715 Unlink</button>
            </div>
</div>
          ${C}
</div>
      `}const r=decodeGarminStrengthSets(e);let d="";if(r){const w=r.peakWeightKg>0?`Peak Load ${r.peakWeightKg}kg (${r.peakWeightCount} working ${r.peakWeightCount===1?"set":"sets"})`:"Bodyweight / Core",h=r.avgRestSec>0?` \u2022 Avg Rest ${r.avgRestSec}s`:"",C=A.length>0?`<div style="margin-top:6px; padding:6px 8px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:6px; font-size:10.5px; color:#d1fae5;">
<strong style="color:#10b981;">\u{1F517} Pulse Rep Cross-Reference:</strong> ${A.join(" \u2022 ")}
</div>`:"";d=`
<div style="margin:6px 0 8px; background:rgba(0,229,255,0.06); border:1px solid rgba(0,229,255,0.24); border-radius:9px; padding:8px 10px;">
          
<div style="font-size:10.5px; font-weight:800; color:var(--cyan); letter-spacing:0.02em;">
            \u231A GARMIN F\u0112NIX 8 SET TELEMETRY: <span style="color:#fff;">${r.activeCount} Active Sets \u2022 ${l(w)}${l(h)}</span>
</div>
<div style="font-size:10px; color:var(--text-muted); margin-top:3px; font-family:var(--font-mono);">
            ${l(r.workingSummary)}
</div>
          
<details style="margin-top:6px; background:rgba(0,0,0,0.28); border:1px solid rgba(255,255,255,0.07); border-radius:7px; overflow:hidden;">
<summary style="font-size:10.5px; font-weight:700; color:var(--text-secondary); padding:6px 9px; cursor:pointer; list-style:none; display:flex; justify-content:space-between; align-items:center;">
<span>\u{1F52C} View All ${r.activeCount} Garmin Watch Sets &amp; Rest Intervals (${r.totalTutSec}s TUT)</span>
<span style="color:var(--text-muted);">\u25BE</span>
</summary>
<div style="padding:8px 9px; border-top:1px solid rgba(255,255,255,0.06);">
<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:5px;">
                ${r.activeSets.map(b=>`
<div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:5px 7px; font-size:10px; font-family:var(--font-mono);">
<div style="display:flex; justify-content:space-between; align-items:center;">
<strong style="color:#fff;">Set ${b.setNum}: ${b.weightKg===0?"BW Hold":l(b.weightLabel)}</strong>
                      ${b.reps?`<span style="color:var(--primary); font-weight:700;">${l(b.reps)} reps</span>`:""}
</div>
<div style="color:var(--text-muted); margin-top:2px;">
                      ${b.durationSec}s TUT${b.restAfterSec>0?` \u2022 ${b.restAfterSec}s Rest`:""}
</div>
</div>
                `).join("")}
</div>
              ${C}
</div>
</details>
</div>
      `}const y=e.subTitle||e.sub_title||e.name||"Workout",M=/^(cardio|indoor_cardio|cardio_training|hiit|hiit_training|strength|strength_training|fitness_equipment)$/i.test(String(y).trim())&&n&&n.title?`${n.title} (Garmin ${y})`:y,R=e.source==="manual_app_entry",S=!n&&!R&&typeof getUnclaimedPulseSessionsForActivity=="function"?getUnclaimedPulseSessionsForActivity(e,s,p):[],H=S.length>0?`<button type="button" class="header-pill-btn" data-act-id="${l(e.id)}" data-session-key="${l(S[0]._matchKey)}" onclick="linkGarminPulseMatch(this.dataset.actId, this.dataset.sessionKey)" title="Link ${l(S[0].title||"Pulse Workout")}" style="padding:3px 8px; font-size:11px; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.35); color:#10b981; cursor:pointer;">\u{1F517} Link Pulse</button>`:"",D=e.durationMin??e.duration_min??0,I=e.avgHr??e.avg_hr??null,L=e.maxHr??e.max_hr??null,W=Number(e.aerobicTe??e.aerobic_te??0),E=Number(e.anaerobicTe??e.anaerobic_te??0),j=/walk|run|ruck|hike/i.test(`${e.name||""} ${y} ${e.activity_type_key||""}`),c=e.steps?Number(e.steps):j&&D?Math.round(Number(D)*91.5):0,f=e.distance_miles?Number(e.distance_miles):c>0?Number((c/1810).toFixed(2)):0,$=j&&c>0?`<span>\u2022</span><span style="color:var(--cyan); font-weight:700;">\u{1F463} ${c.toLocaleString()} activity steps${f>0?` (${f} mi)`:""}</span>`:"",F=document.createElement("div");F.className=`history-card ${x?"today-highlight":""}`,F.style.background=x?"#141a24":"#11141c",F.style.border=x?"1px solid rgba(0, 229, 255, 0.4)":"1px solid rgba(255,255,255,0.08)",F.style.borderRadius="14px",F.style.padding="12px 14px",F.innerHTML=`
      
<div class="history-top-row" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
<div>
<div class="history-title" style="font-size:14px; font-weight:800; color:#fff; display:flex; align-items:center; gap:6px;">
            ${l(M)}
</div>
<div class="history-meta-row" style="font-size:11.5px; color:var(--text-muted); margin-top:2px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
<span>${l(z)}</span>
<span>\u2022</span>
<span>\u23F1 ${D} min</span>
<span>\u2022</span>
<span style="color:var(--primary); font-weight:800;">\u{1F525} ${e.calories||0} kcal</span>
            ${$}
</div>
</div>
<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
          ${x?'<span style="font-size:10px; font-weight:900; color:var(--primary); background:rgba(0,229,255,0.15); border:1px solid rgba(0,229,255,0.3); padding:2px 7px; border-radius:4px; letter-spacing:0.04em;">TODAY</span>':""}
          ${g.recoveryPill}
</div>
</div>

      ${k}
      ${d}

      
<div style="font-size:11.5px; color:#d4d4d8; line-height:1.4; margin:4px 0 8px; padding:6px 10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:8px;">
        ${g.primaryTakeaway}
</div>

      
<div class="history-stats-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:4px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 4px; text-align:center;">
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:var(--primary);">${e.calories||0}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Active Burn</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#fff;">${I||"--"}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Avg HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#38bdf8;">${L||"--"}<small style="font-size:10px; color:var(--text-muted);">bpm</small></div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Peak HR</div>
</div>
<div>
<div class="hstat-num" style="font-size:13px; font-weight:800; color:#a78bfa;">${W.toFixed(1)} / ${E.toFixed(1)}</div>
<div class="hstat-lbl" style="font-size:9.5px; color:var(--text-muted); text-transform:uppercase;">Aerobic/Anaer</div>
</div>
</div>

      
<div style="margin-top:6px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.05); border-radius:8px; padding:6px 10px;">
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; margin-bottom:5px;">
<span style="color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Garmin HR Intensity Zones</span>
<span style="color:var(--primary); font-weight:700; font-family:var(--font-mono); font-size:10.5px;">${v.dominantZoneText}</span>
</div>
<div style="display:flex; height:6px; border-radius:3px; overflow:hidden; gap:2px; background:rgba(255,255,255,0.06);">
          ${v.zones.filter(w=>w.pct>0).map(w=>`<div style="height:100%; width:${w.pct}%; background:${w.color}; border-radius:2px; box-shadow:0 0 4px ${w.color}88;" title="Z${w.num}: ${w.durStr} (${w.pct}%)"></div>`).join("")}
</div>
</div>

      
<div class="benefits-toggle-btn" data-act-id="${l(e.id)}" onclick="toggleBenefitAccordion(this.dataset.actId)" style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); padding:8px 12px; border-radius:8px; cursor:pointer; font-size:11.5px; font-weight:700; color:var(--cyan);">
<span>\u{1F52C} View Garmin Telemetry, Charts & Recovery (6 sections)</span>
<span class="accordion-arrow" id="arrow_${l(e.id)}" style="transition:transform 0.2s;">\u25BE</span>
</div>

<div class="benefits-accordion-body" id="benefit_body_${l(e.id)}" style="display:none; flex-direction:column; gap:10px; margin-top:8px; padding:12px; background:rgba(0,0,0,0.45); border:1px solid rgba(255,255,255,0.08); border-radius:12px; font-size:11.5px; line-height:1.45;">
        
        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:var(--primary);">\u{1F4C8}</span> Heart Rate Telemetry Curve
</span>
<span style="font-size:10px; font-weight:700; color:${T?"var(--primary)":"var(--text-muted)"};">${t}</span>
</div>
          ${generateHrSvgChart(e)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#f59e0b;">\u{1F4CA}</span> 5-Zone Physiological Intensity
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">Max HR: 190 bpm</span>
</div>
          ${generateZoneBarsHtml(e)}
</div>

        
<div style="background:linear-gradient(180deg, rgba(30,41,59,0.3) 0%, rgba(10,15,29,0.6) 100%); border:1px solid rgba(56,189,248,0.2); border-radius:10px; padding:10px 12px;">
<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
<span style="font-size:11px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:0.05em; display:flex; align-items:center; gap:5px;">
<span style="color:#a78bfa;">\u{1F3AF}</span> Firstbeat Training Effect (TE)
</span>
<span style="font-size:10px; font-weight:700; color:var(--text-muted);">0.0 \u2013 5.0 Scale</span>
</div>
          ${generateTeDualGaugesHtml(e)}
</div>

        
<div style="border-left:2px solid var(--primary); padding-left:8px;">
<div style="font-size:11px; font-weight:800; color:var(--primary); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u2713 4. What This Workout Achieved
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(g.achievements||[]).map(w=>`<div>${w}</div>`).join("")}
</div>
</div>

        
<div style="border-left:2px solid #f59e0b; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#f59e0b; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u26A0\uFE0F 5. Potential Stressors & Biomechanical Impact
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(g.stressors||[]).map(w=>`<div>${w}</div>`).join("")}
</div>
</div>

        
<div style="border-left:2px solid #38bdf8; padding-left:8px; margin-top:2px;">
<div style="font-size:11px; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:4px;">
            \u{1F6E1}\uFE0F 6. Recommended Recovery Protocol & Window
</div>
<div style="color:#d4d4d8; display:flex; flex-direction:column; gap:4px;">
            ${(g.recoveryProtocol||[]).map(w=>`<div>${w}</div>`).join("")}
</div>
</div>

</div>

<div style="margin-top:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
<span style="font-size:10.5px; color:var(--text-muted);">${R?"Pulse Logged Entry":"Garmin Telemetry"} \u2022 ID: ${l(e.id)}</span>
<div style="display:flex; align-items:center; gap:6px;">
${H}
<button class="header-pill-btn" style="padding:3px 8px; font-size:11px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:var(--text-secondary);" data-act-id="${l(e.id)}" onclick="openAnnotateModal(this.dataset.actId)">
          Annotate Notes \u270E
</button>
</div>
</div>
    `,i.appendChild(F)})}let _renphoHistoryCache=null,_renphoHistoryFetchedAtMs=0;async function renderRenphoTrendChart(i={}){let s=Array.isArray(_renphoHistoryCache)?_renphoHistoryCache:[];const a=!!(i&&i.force===!0),l=Date.now()-_renphoHistoryFetchedAtMs>300*1e3;if(a||s.length===0||l)try{const o=await(typeof pulseApiFetch=="function"?pulseApiFetch("/api/renpho/history?days=30",{promptAuthOn401:!1}):fetch("/api/renpho/history?days=30"));if(o&&o.ok){const m=await o.json(),_=Array.isArray(m)||m&&Array.isArray(m.history),P=Array.isArray(m)?m:m&&Array.isArray(m.history)?m.history:[];_&&(a||P.length>0||s.length===0)&&(s=P,_renphoHistoryCache=P,_renphoHistoryFetchedAtMs=Date.now(),typeof window<"u"&&(window.PULSE_RENPHO_HISTORY=P))}}catch(o){console.warn("[RenphoChart] Fetch failed, using fallback live state:",o)}try{const o=document.getElementById("bodyAvg7dWeightVal");if(o&&Array.isArray(s)&&s.length>0){const m=s[s.length-1],_=Number(m&&(m["7d_avg_weight"]??m.weight_kg));Number.isFinite(_)&&_>0&&(o.innerText=`7-Day EMA: ${_.toFixed(2)} kg`)}}catch{}let p=document.getElementById("renphoTrendChartContainer");if(!p){p=document.createElement("div"),p.id="renphoTrendChartContainer";const o=document.getElementById("renphoSyncTime"),m=o?o.closest(".card"):document.querySelector("#tab-body .card")||document.querySelector(".card");m?m.appendChild(p):(document.getElementById("tab-today")||document.querySelector("main")||document.body).appendChild(p)}if(!p)return;p.style.marginTop="14px",p.style.paddingTop="12px",p.style.borderTop="1px solid rgba(255,255,255,0.06)";const e=()=>{const o=typeof window<"u"&&window.BAKED_LIVE_STATE?window.BAKED_LIVE_STATE:{},m=o.renpho||o.athlete||(typeof window<"u"?window.athleteProfile:null)||{},_=Number(m.weight_kg),P=Number(m.body_fat_pct),Z=Number(m.lean_mass_kg),U=Number.isFinite(_)&&_>0?`Latest reading: ${_.toFixed(2)} kg${Number.isFinite(P)&&P>0?` \u2022 ${P.toFixed(1)}% BF`:""}${Number.isFinite(Z)&&Z>0?` \u2022 ${Z.toFixed(2)} kg LBM`:""}`:"Sync Renpho or log a manual weigh-in to begin tracking.";p.innerHTML=`
<div style="background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.14); border-radius:12px; padding:16px; text-align:center;">
<div style="font-size:12px; font-weight:800; color:#e4e4e7; margin-bottom:4px;">Need \u2265 2 weigh-ins to plot 30-day trend</div>
<div style="font-size:11px; color:var(--text-muted);">${U}</div>
</div>`};if(!s||s.length<2){e();return}const N=o=>{const m=o&&o.timestamp!==void 0&&o.timestamp!==null?Number(o.timestamp):NaN;if(Number.isFinite(m)&&m>0)return m<1e11?m*1e3:m;if(o&&o.date_str){const _=new Date(o.date_str).getTime();if(Number.isFinite(_)&&_>0)return _}return 0};s=s.slice().sort((o,m)=>N(o)-N(m));const x=s.map(o=>{const m=N(o)||Date.now(),_=new Date(m),P=isNaN(_.getTime())?"":`${_.getMonth()+1}/${_.getDate()}`;return{ts:m,dateLabel:P,dateStr:o.date_str||P,bf:Number(o.body_fat_pct||0),lm:Number(o.lean_mass_kg||0),wt:Number(o.weight_kg||0)}}).filter(o=>o.bf>5&&o.lm>20);if(x.length<2){e();return}const z=7*86400*1e3;x.forEach((o,m)=>{const _=x.slice(0,m+1).filter(U=>o.ts-U.ts<=z),P=_.reduce((U,Q)=>U+Q.bf,0)/_.length,Z=_.reduce((U,Q)=>U+Q.lm,0)/_.length;o.maBf=Math.round(P*100)/100,o.maLm=Math.round(Z*100)/100});const g=x[0],v=x[x.length-1],t=Math.max(86400*1e3,v.ts-g.ts)/(7*86400*1e3),k=(v.bf-g.bf)/t,A=g.wt&&g.lm?g.wt-g.lm:g.wt*(g.bf/100),y=((v.wt&&v.lm?v.wt-v.lm:v.wt*(v.bf/100))-A)/t,u=`${y<=0?"":"+"}${y.toFixed(2)} kg/wk`,M=`${k<=0?"":"+"}${k.toFixed(2)} %/wk`,R=x.map(o=>o.bf),S=x.map(o=>o.lm),H=Math.min(...R),D=Math.max(...R),I=Math.min(...S),L=Math.max(...S),W=Math.max(.15,(D-H)*.12),E=Math.floor((H-W)*10)/10,j=Math.ceil((D+W)*10)/10,c=Math.max(.4,j-E),f=Math.max(.2,(L-I)*.12),$=Math.floor((I-f)*10)/10,F=Math.ceil((L+f)*10)/10,w=Math.max(.6,F-$),h=380,C=180,b=50,G=54,O=24,K=28,V=h-b-G,q=C-O-K,B=x.map((o,m)=>{const _=Math.round((b+m/Math.max(1,x.length-1)*V)*10)/10,P=Math.round((O+(1-(o.bf-E)/c)*q)*10)/10,Z=Math.round((O+(1-(o.maBf-E)/c)*q)*10)/10,U=Math.round((O+(1-(o.lm-$)/w)*q)*10)/10,Q=Math.round((O+(1-(o.maLm-$)/w)*q)*10)/10;return{...o,x:_,yBf:P,yBfMa:Z,yLm:U,yLmMa:Q}}),Y=o=>{if(B.length===1)return`M ${B[0].x} ${B[0][o]}`;let m=`M ${B[0].x} ${B[0][o]}`;for(let P=0;P<B.length-1;P++){const Z=B[P],U=B[P+1],Q=(Z.x+U.x)/2;m+=` Q ${Z.x} ${Z[o]}, ${Q} ${(Z[o]+U[o])/2}`}const _=B[B.length-1];return m+=` L ${_.x} ${_[o]}`,m},X=Y("yBf"),J=Y("yBfMa"),oe=Y("yLm"),re=Y("yLmMa"),ie=`${X} L ${B[B.length-1].x} ${C-K} L ${B[0].x} ${C-K} Z`,ee=O,te=Math.round((O+q*.5)*10)/10,ne=C-K,ae=x[0].dateLabel||"D-30",se=x[Math.floor(x.length/2)].dateLabel||"D-15",le=x[x.length-1].dateLabel||"Today";p.innerHTML=`
    
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
          ${u} <small style="color:var(--text-secondary); font-size:9.5px; font-weight:600;">(${M})</small>
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
<svg viewBox="0 0 ${h} ${C}" style="width:100%; height:auto; overflow:visible; font-family:var(--font-mono);">
<defs>
<linearGradient id="renphoBfGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#00F0FF" stop-opacity="0.32"/>
<stop offset="60%" stop-color="#00F0FF" stop-opacity="0.08"/>
<stop offset="100%" stop-color="#00F0FF" stop-opacity="0.0"/>
</linearGradient>
</defs>

        
<line x1="${b}" y1="${ee}" x2="${h-G}" y2="${ee}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
<line x1="${b}" y1="${te}" x2="${h-G}" y2="${te}" stroke="rgba(255,255,255,0.05)" stroke-dasharray="3,3" stroke-width="1"/>
<line x1="${b}" y1="${ne}" x2="${h-G}" y2="${ne}" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

        
<text x="${b-4}" y="${ee+4}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${j.toFixed(1)}%</text>
<text x="${b-4}" y="${te+4}" fill="#38bdf8" font-size="12.5" font-weight="600" text-anchor="end">${((j+E)/2).toFixed(1)}%</text>
<text x="${b-4}" y="${ne}" fill="#00F0FF" font-size="12.5" font-weight="700" text-anchor="end">${E.toFixed(1)}%</text>

        
<text x="${h-G+4}" y="${ee+4}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${F.toFixed(1)}kg</text>
<text x="${h-G+4}" y="${te+4}" fill="#34d399" font-size="12.5" font-weight="600" text-anchor="start">${((F+$)/2).toFixed(1)}kg</text>
<text x="${h-G+4}" y="${ne}" fill="#10b981" font-size="12.5" font-weight="700" text-anchor="start">${$.toFixed(1)}kg</text>

        
<path d="${ie}" fill="url(#renphoBfGrad)"/>

        
<path d="${J}" fill="none" stroke="#00F0FF" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>
<path d="${re}" fill="none" stroke="#10b981" stroke-width="1.6" stroke-dasharray="4,3" opacity="0.85"/>

        
<path d="${X}" fill="none" stroke="#00F0FF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.6));"/>
<path d="${oe}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.6));"/>

        
<circle cx="${B[B.length-1].x}" cy="${B[B.length-1].yBf}" r="4" fill="#00F0FF" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(0,240,255,0.9));"/>
<circle cx="${B[B.length-1].x}" cy="${B[B.length-1].yLm}" r="4" fill="#10b981" stroke="#fff" stroke-width="1.5" style="filter:drop-shadow(0 0 6px rgba(16,185,129,0.9));"/>

        
<text x="${b}" y="${C-6}" fill="var(--text-muted)" font-size="12.5">${ae}</text>
<text x="${b+V/2}" y="${C-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="middle">${se}</text>
<text x="${h-G}" y="${C-6}" fill="var(--text-muted)" font-size="12.5" text-anchor="end">${le}</text>
</svg>
</div>

    
<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(0,240,255,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#00F0FF; font-weight:800; text-transform:uppercase;">BF% Range</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${v.bf.toFixed(1)}%</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#00F0FF;">${H.toFixed(1)}%</strong></span>
<span>Max: <strong style="color:#94a3b8;">${D.toFixed(1)}%</strong></span>
</div>
</div>

<div style="background:rgba(0,0,0,0.3); border:1px solid rgba(16,185,129,0.18); border-radius:8px; padding:6px 8px;">
<div style="display:flex; justify-content:space-between; align-items:baseline;">
<span style="font-size:9.5px; color:#10b981; font-weight:800; text-transform:uppercase;">Lean Mass</span>
<span style="font-size:12px; font-weight:800; color:#fff; font-family:var(--font-mono);">${v.lm.toFixed(1)}kg</span>
</div>
<div style="font-size:9.5px; color:var(--text-muted); font-family:var(--font-mono); margin-top:2px; display:flex; justify-content:space-between;">
<span>Min: <strong style="color:#94a3b8;">${I.toFixed(1)}kg</strong></span>
<span>Max: <strong style="color:#10b981;">${L.toFixed(1)}kg</strong></span>
</div>
</div>
</div>
  `}let _strengthHistoryCache=null,_strengthHistoryFetchedAtMs=0;async function renderStrengthProgressionChart(i={}){let s=_strengthHistoryCache&&typeof _strengthHistoryCache=="object"?_strengthHistoryCache:{},a={};const l=!!(i&&i.force===!0),p=Object.keys(s).length>0,e=Date.now()-_strengthHistoryFetchedAtMs>300*1e3;if(l||!p||e)try{const d=await(typeof pulseApiFetch=="function"?pulseApiFetch("/api/strength/history?days=30",{promptAuthOn401:!1}):fetch("/api/strength/history?days=30"));if(d&&d.ok){const y=await d.json();s=y&&y.exercises||y||{},_strengthHistoryCache=s,_strengthHistoryFetchedAtMs=Date.now()}}catch(d){console.warn("[StrengthChart] Fetch failed, falling back to baked prescriptions:",d)}a=(typeof window<"u"&&window.BAKED_LIVE_STATE?window.BAKED_LIVE_STATE:{}).strength_prescriptions||(typeof window<"u"?window.strengthPrescriptions:null)||{};const x=typeof getAllExercises=="function"?getAllExercises():[],z=(d,y,u)=>{const M=x.find(I=>I&&I.id===d),R=M?typeof M.getBaseWeight=="function"?M.getBaseWeight():M.targetWeight:NaN,S=M?typeof M.getBaseReps=="function"?M.getBaseReps():M.targetReps:NaN,H=typeof R=="number"&&Number.isFinite(R)&&R>0?R:y,D=typeof S=="number"&&Number.isFinite(S)&&S>0?S:u;return{weight:H,reps:D,e1rm:Number((H*(1+D/30)).toFixed(1))}},g=z("barbell_squat",100,8),v=z("barbell_rdl",70,8),T=z("barbell_floor_press",95,6),t=z("barbell_pendlay_row",85,8),n=[{key:"barbell_squat",name:"Barbell Back Squat",icon:"\u{1F3CB}\uFE0F",family:"Quad & Knee Extensor Power",defaultWeight:g.weight,defaultReps:g.reps,defaultE1rm:g.e1rm},{key:"barbell_rdl",name:"Barbell Romanian Deadlift (RDL)",icon:"\u26A1",family:"Hamstring & Glute Hinge Anchor",defaultWeight:v.weight,defaultReps:v.reps,defaultE1rm:v.e1rm},{key:"barbell_floor_press",name:"Barbell Floor Press",icon:"\u{1F6E1}\uFE0F",family:"Horizontal Push / Strict Triceps Power",defaultWeight:T.weight,defaultReps:T.reps,defaultE1rm:T.e1rm},{key:"barbell_pendlay_row",name:"Barbell Pendlay Row",icon:"\u{1F680}",family:"Explosive Dead-Stop Lat Pull",defaultWeight:t.weight,defaultReps:t.reps,defaultE1rm:t.e1rm}];let k=document.getElementById("strengthProgressionContainer");if(!k){k=document.createElement("div"),k.id="strengthProgressionContainer";const d=document.getElementById("trainViewPrescribed")||document.getElementById("tab-train")||document.getElementById("todayTrainingContainer");d?d.appendChild(k):(document.querySelector("main")||document.body).appendChild(k)}k.style.marginTop="14px",k.style.display="flex",k.style.flexDirection="column",k.style.gap="10px";let A="";const r=(d,y)=>{if(typeof d=="number"&&Number.isFinite(d))return d;if(typeof d=="string"){const M=d.match(/-?\d+(?:\.\d+)?/);if(M)return Number(M[0])}const u=Number(d);return Number.isFinite(u)&&u>0?u:y};for(const d of n){const y=a[d.key]||{},u=s[d.key]||[],M=r(y.weight,d.defaultWeight),R=r(y.reps,d.defaultReps),S=r(y.e1rm,d.defaultE1rm),H=r(y.last_logged_weight??(u.length?u[u.length-1].weight:M),M),D=r(y.last_logged_reps??(u.length?u[u.length-1].reps:R),R),I=r(y.last_e1rm??(u.length?u[u.length-1].e1rm:S),S),L=y.progression_ready===!0||y.status==="progression_ready"||H>M||I>S,W=u.slice(-4);let E,j;if(W.length>=2)E=W.map((h,C)=>({label:C===W.length-1?"Now":`S${C+1}`,val:Number(Number(h.e1rm||S).toFixed(1)),isCurrent:C===W.length-1})),j=E[E.length-1].val.toFixed(1);else{const h=Number(Number(W.length===1?W[0].e1rm||S:L?Math.max(I,S):S).toFixed(1));E=[{label:"Now",val:h,isCurrent:!0}],j=h.toFixed(1)}const c=Math.min(...E.map(h=>h.val)),f=Math.max(...E.map(h=>h.val)),$=Math.max(6,f-c+3),F=E.map(h=>{const C=Math.max(12,Math.round((h.val-(c-1.5))/$*36)),b=h.isCurrent&&L,G=b?"background:linear-gradient(180deg, #00F0FF 0%, #10b981 100%); box-shadow:0 0 10px rgba(0,240,255,0.6);":h.isCurrent?"background:#38bdf8;":"background:rgba(255,255,255,0.18);";return`
<div style="display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:3px;">
<span style="font-size:9.5px; font-weight:800; font-family:var(--font-mono); color:${b?"#00F0FF":h.isCurrent?"#fff":"var(--text-muted)"};">${h.val}</span>
<div style="width:100%; max-width:32px; height:${C}px; ${G} border-radius:3px;"></div>
<span style="font-size:9px; font-weight:700; color:${h.isCurrent?"var(--primary)":"var(--text-muted)"}; margin-top:1px;">${h.label}</span>
</div>
      `}).join("");A+=`
<div class="strength-progression-card" style="${L?"border:1px solid rgba(0,240,255,0.6); box-shadow:0 0 18px rgba(0,240,255,0.22); background:linear-gradient(135deg, rgba(0,240,255,0.06) 0%, rgba(15,23,42,0.85) 100%);":"border:1px solid rgba(255,255,255,0.07); background:rgba(15,23,42,0.5);"} border-radius:12px; padding:12px 14px; position:relative; overflow:hidden;">
        
<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
<div>
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:14px;">${d.icon}</span>
<strong style="color:#fff; font-size:13px; font-family:var(--font-display); letter-spacing:-0.01em;">${d.name}</strong>
</div>
<div style="font-size:10.5px; color:var(--text-muted); margin-top:2px;">
              Prescribed: <span style="color:#e2e8f0; font-weight:700;">${M}kg \xD7 ${R}</span> \u2022 ${d.family}
</div>
</div>
<div>
            ${L?`
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
              ${H}kg <small style="color:var(--text-muted); font-size:10px;">\xD7 ${D} reps</small>
</div>
</div>
<div style="text-align:right;">
<div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing:0.04em;">Calculated e1RM</div>
<div style="font-size:13px; font-weight:800; color:${L?"#00F0FF":"#fff"}; font-family:var(--font-mono); margin-top:2px;">
              ${j} kg ${L?`<small style="color:#10b981; font-weight:800;">(+${Math.max(2.5,Number((j-S).toFixed(1)))}kg)</small>`:""}
</div>
</div>
</div>

        
<div>
<div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--text-muted); margin-bottom:5px;">
<span style="font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">4-Week e1RM Progression Visual</span>
<span style="font-family:var(--font-mono); color:${L?"#10b981":"var(--text-muted)"}; font-weight:700;">
              ${L?"\u2713 Progressive Overload Met":"Consistent Load Retention"}
</span>
</div>
<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; background:rgba(0,0,0,0.32); border:1px solid rgba(255,255,255,0.04); border-radius:8px; padding:8px 8px 6px; align-items:flex-end; height:74px;">
            ${F}
</div>
</div>
</div>
    `}k.innerHTML=`
    
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

    
    ${A}
  `}typeof window<"u"&&(window.getGarminHrZoneBreakdown=getGarminHrZoneBreakdown,window.generateHrSvgChart=generateHrSvgChart,window.generateZoneBarsHtml=generateZoneBarsHtml,window.generateTeDualGaugesHtml=generateTeDualGaugesHtml,window.renderHistoryList=renderHistoryList,window.renderRenphoTrendChart=renderRenphoTrendChart,window.renderStrengthProgressionChart=renderStrengthProgressionChart);let _pulseChartsInitInFlight=!1;function initPulseCharts(){if(!_pulseChartsInitInFlight){_pulseChartsInitInFlight=!0;try{try{typeof renderRenphoTrendChart=="function"&&renderRenphoTrendChart()}catch(i){console.warn("[PulseCharts] renderRenphoTrendChart init warning:",i)}try{typeof renderStrengthProgressionChart=="function"&&renderStrengthProgressionChart()}catch(i){console.warn("[PulseCharts] renderStrengthProgressionChart init warning:",i)}}finally{_pulseChartsInitInFlight=!1}}}typeof document<"u"&&(document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>initPulseCharts(),{once:!0}):initPulseCharts());

(function(){"use strict";const Y="pulse_autonomic_cache_v1",q=[{key:"dizziness_vertigo",label:"Dizziness / Vertigo"},{key:"lightheaded_presyncope",label:"Lightheadedness / Presyncope"},{key:"dissociation",label:"Dissociation / Detachment"},{key:"confusion_brain_fog",label:"Confusion / Brain Fog"},{key:"impending_doom",label:"Impending Doom / Adrenaline"},{key:"visual_changes",label:"Visual Changes"},{key:"blackout",label:"Blackout / Loss of Consciousness"}],Q=[{key:"standing_quickly",label:"Standing Up Quickly"},{key:"driving",label:"Driving (ID. Buzz)"},{key:"fasted_state",label:"Fasted State"},{key:"post_exercise",label:"Post-Exercise"},{key:"poor_sleep",label:"Poor Sleep"},{key:"high_workload",label:"High Workload / Screen"},{key:"illness_infection",label:"Illness / Infection"},{key:"dehydration_heat",label:"Dehydration / Heat"},{key:"caffeine_stimulant",label:"Caffeine / Stimulant"}],J=[{key:"fever_chills",label:"Fever / Chills"},{key:"fatigue_malaise",label:"Deep Fatigue / Malaise"},{key:"respiratory_sinus",label:"Respiratory / Sinus"},{key:"gi_nausea",label:"GI Upset / Nausea"},{key:"headache_aches",label:"Headache / Body Aches"},{key:"elevated_rhr_stress",label:"High RHR / Poor Sleep"}];let S="capture",$=new Set,A=new Set,I="moderate",P="",D=null,M=!1,E=new Set,k=new Set,g="",f="moderate",_=new Set,b="",N=null,F=!1;function l(e){return typeof escapeHtml=="function"?escapeHtml(e):String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function w(){if(typeof getLocalDateStr=="function")return getLocalDateStr();const e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`}function se(){const e=new Date,t=o=>String(o).padStart(2,"0");return`${e.getFullYear()}-${t(e.getMonth()+1)}-${t(e.getDate())}T${t(e.getHours())}:${t(e.getMinutes())}`}function W(e){const t=new Date;t.setDate(t.getDate()-e);const o=s=>String(s).padStart(2,"0");return`${t.getFullYear()}-${o(t.getMonth()+1)}-${o(t.getDate())}`}function ie(e){const t=String(e||"").split("-").map(Number);if(t.length!==3)return e;const o=new Date(t[0],t[1]-1,t[2]),s=w();if(e===s)return"Today";const i=W(1);return e===i?"Yest":o.toLocaleDateString("en-GB",{weekday:"short",day:"numeric"})}function O(e){const t=Date.parse(String(e||""));if(!Number.isFinite(t))return"00:00";const o=Math.max(0,Math.floor((Date.now()-t)/1e3)),s=Math.floor(o/3600),i=Math.floor(o%3600/60),n=o%60,a=c=>String(c).padStart(2,"0");return s>0?`${s}:${a(i)}:${a(n)}`:`${a(i)}:${a(n)}`}function T(e){if(!e)return"--";const t=Date.parse(String(e));return Number.isFinite(t)?new Date(t).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):String(e).slice(0,16)}function ne(){return{evaluated_at:null,date_str:w(),system_state:"IDLE",alert_level:0,safety_banner:{active:!1,level:0,tone:"calm",title:"Autonomic Baseline Calm",reasons:[],advisory:"Autonomic metrics within normal baseline.",avoid_driving:!1,avoid_solo_exertion:!1},level1:{active:!1,triggers:[],sleep_avg_stress:null,hrv_last_night:null,hrv_7d_baseline:null},level2:{active:!1,current_streak_mins:0,max_streak_mins:0},acute_spike:null,active_episode:null,illness:{active_today:!1,today_log:null,current_streak_days:0,last_illness_date:null,days_since_illness_ended:null,post_illness_ramp_active:!1,recovery_scale_shield:{active:!1,hours_remaining:0,note:""},recent_logs:[]},patterns:{total_episodes:0,count_7d:0,count_30d:0,acute_duration_stats:{count:0,avg:null,median:null,min:null,max:null},total_recovery_stats:{count:0,avg:null,median:null,min:null,max:null},top_symptoms:[],top_triggers:[],illness_co_occurrence_pct:0,time_of_day:[],pathway_counts:[],prodrome_comparison:{},prodromal_risk:{score:0,level:"low",label:"Low / Calm Autonomic Baseline",drivers:[]}},recent_episodes:[],symptom_catalog:q,trigger_catalog:Q,illness_symptom_catalog:J,clinical_disclaimer:"Self-monitoring & Garmin biometric correlation record only. Non-diagnostic."}}function y(){if(typeof window<"u"&&window.PULSE_ANALYTICS_SUMMARY&&window.PULSE_ANALYTICS_SUMMARY.autonomic)return window.PULSE_ANALYTICS_SUMMARY.autonomic;try{const e=localStorage.getItem(Y);if(e){const t=JSON.parse(e);if(t&&typeof t=="object"&&t.system_state)return(!window.PULSE_ANALYTICS_SUMMARY||typeof window.PULSE_ANALYTICS_SUMMARY!="object")&&(window.PULSE_ANALYTICS_SUMMARY={}),window.PULSE_ANALYTICS_SUMMARY.autonomic=t,t}}catch{}return ne()}function K(e,t,o){if(!(!e||typeof e!="object")){typeof window<"u"&&((!window.PULSE_ANALYTICS_SUMMARY||typeof window.PULSE_ANALYTICS_SUMMARY!="object")&&(window.PULSE_ANALYTICS_SUMMARY={}),window.PULSE_ANALYTICS_SUMMARY.autonomic=e,o&&(window.PULSE_ANALYTICS_SUMMARY.flex_refeed=o));try{localStorage.setItem(Y,JSON.stringify(e)),window.PULSE_ANALYTICS_SUMMARY&&localStorage.setItem("pulse_analytics_summary_cache",JSON.stringify(window.PULSE_ANALYTICS_SUMMARY))}catch{}if(t&&typeof applyLiveStateToDom=="function"&&applyLiveStateToDom(t),C(),typeof renderTodayTrainingRecommendations=="function")try{renderTodayTrainingRecommendations()}catch{}if(typeof renderFlexRefeedCard=="function"&&window.PULSE_ANALYTICS_SUMMARY)try{renderFlexRefeedCard(window.PULSE_ANALYTICS_SUMMARY)}catch{}if(typeof renderPostRefeedScaleShield=="function"&&window.PULSE_ANALYTICS_SUMMARY)try{renderPostRefeedScaleShield(window.PULSE_ANALYTICS_SUMMARY)}catch{}}}function ae(e){if(!e){D=null;return}D!==e.id&&(D=e.id,$=new Set(Array.isArray(e.symptoms)?e.symptoms:[]),A=new Set(Array.isArray(e.triggers)?e.triggers:[]),I=e.severity||"moderate",P=e.notes||"")}function z(){N&&(clearInterval(N),N=null)}function X(){const t=y().active_episode,o=typeof document<"u"?document.getElementById("autonomicModal"):null,s=!!(o&&o.classList&&o.classList.contains("open"));t&&(t.state==="ACUTE_EPISODE"||t.state==="POST_EPISODE_RECOVERY")?!N&&(s||t.state==="ACUTE_EPISODE")&&(N=setInterval(()=>{const n=y().active_episode;if(!n){z();return}const a=document.getElementById("autonomicLiveTimerDigits");a&&(a.innerText=O(n.onset_time));const c=document.getElementById("autonomicQuickEpisodeLabel");c&&(c.innerText=`Turn Active (${O(n.onset_time)})`)},1e3)):z()}function le(e){const t=document.getElementById("autonomicPillDot"),o=document.getElementById("autonomicPillText");if(!t||!o)return;const s=e.active_episode,i=e.illness||{},n=Number(e.alert_level||0);t.className="pill-dot",s&&s.state==="ACUTE_EPISODE"?(t.classList.add("red"),o.innerText="Turn Active"):s&&s.state==="POST_EPISODE_RECOVERY"?(t.classList.add("amber"),o.innerText="Recovering"):n>=2?(t.classList.add("red"),o.innerText="Level 2 Alert"):n===1?(t.classList.add("amber"),o.innerText="Level 1 Alert"):i.active_today?(t.classList.add("violet"),o.innerText="Sick Mode"):(t.classList.add("teal"),o.innerText="Calm")}function re(e){const t=document.getElementById("autonomicSafetyBanner"),o=document.getElementById("autonomicSpikeBanner"),s=document.getElementById("illnessStatusBannerToday"),i=document.getElementById("autonomicQuickBar"),n=e.safety_banner||{},a=e.active_episode,c=e.illness||{};if(t)if(n.active){const r=n.tone==="red"?"tone-red":"tone-amber",m=Array.isArray(n.reasons)?n.reasons:[],d=a?`<button type="button" class="autonomic-tap-btn ${a.state==="ACUTE_EPISODE"?"is-acute":"is-recovery"}" onclick="openAutonomicModal('capture')">\u23F1 Open Episode Recovery Tracker</button>`:'<button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow()">\u26A1 Log Funny Turn Now (1-Tap)</button>';t.style.display="block",t.innerHTML=`
          <div class="autonomic-safety-banner ${r}" role="alert" aria-live="polite">
            <div class="autonomic-safety-title">
              <span>${n.level>=2?"\u{1F6A8}":"\u26A0\uFE0F"} ${l(n.title||"Autonomic Safety Alert")}</span>
              <span class="autonomic-risk-pill">${n.level>=2?"LEVEL 2":"LEVEL 1"}</span>
            </div>
            ${m.length?`<div class="autonomic-safety-copy">${m.map(v=>`\u2022 ${l(v)}`).join("<br>")}</div>`:""}
            <div class="autonomic-safety-copy"><strong>Do Not Drive (Volkswagen ID. Buzz) or train solo high-risk</strong> until autonomic metrics normalize and symptoms clear.</div>
            <div class="autonomic-safety-actions">
              ${d}
            </div>
          </div>
        `}else t.style.display="none",t.innerHTML="";const p=e.acute_spike;if(o&&(p&&p.detected&&(!a||a.state!=="ACUTE_EPISODE")?(o.style.display="block",o.innerHTML=`
          <div class="autonomic-spike-banner" role="alert">
            <div class="autonomic-safety-title">
              <span>\u{1F4C8} Unprovoked Biometric Spike Detected</span>
              <span>${l(T(p.spike_time))}</span>
            </div>
            <div class="autonomic-safety-copy">${l(p.reason||"Garmin detected sudden stress or HR deviation outside workouts.")} Are you having a funny turn?</div>
            <div class="autonomic-safety-actions" style="display:grid; grid-template-columns:2fr 1fr; gap:8px;">
              <button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow(${Number(p.spike_ts_ms)||0}, true)">\u26A1 Yes \u2014 Capture Episode</button>
              <button type="button" class="autonomic-tap-btn is-outline" onclick="dismissAutonomicSpike(${Number(p.spike_ts_ms)||0})">Dismiss</button>
            </div>
          </div>
        `):(o.style.display="none",o.innerHTML="")),s)if(c.active_today){const r=c.today_log||{};s.style.display="block",s.innerHTML=`
          <div class="illness-today-banner">
            <div class="autonomic-safety-title">
              <span>\u{1F912} Illness Recovery Mode Active (Day ${Math.max(1,Number(c.current_streak_days||1))})</span>
              <span>${l(String(r.severity||"moderate").toUpperCase())}</span>
            </div>
            <div class="autonomic-safety-copy">Maintenance Fuel &amp; Rest Mode active \u2022 Protein locked \u2022 Sick days excluded from 14d Adaptive TDEE.</div>
            <div class="autonomic-safety-actions">
              <button type="button" class="autonomic-tap-btn is-illness" onclick="openAutonomicModal('illness')">Manage Sick Log &amp; Backdate Days</button>
            </div>
          </div>
        `}else c.post_illness_ramp_active?(s.style.display="block",s.innerHTML=`
          <div class="illness-today-banner">
            <div class="autonomic-safety-title">
              <span>\u{1F6E1}\uFE0F Day-1 Post-Illness Return Ramp</span>
              <span>48h Scale Shield</span>
            </div>
            <div class="autonomic-safety-copy">First day back after illness: training capped to gentle flush &amp; scale fluctuations protected by 48h Recovery Shield.</div>
            <div class="autonomic-safety-actions">
              <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('illness')">View Illness Log</button>
            </div>
          </div>
        `):(s.style.display="none",s.innerHTML="");if(i){const r=!!(a&&(a.state==="ACUTE_EPISODE"||a.state==="POST_EPISODE_RECOVERY")),m=r?a.state==="ACUTE_EPISODE"?`Turn Active (${O(a.onset_time)})`:"Recovery Check-In":"Log Funny Turn",d=c.active_today?`Sick Mode (Day ${Math.max(1,Number(c.current_streak_days||1))})`:"Log Sick Day";i.innerHTML=`
        <button type="button" class="autonomic-quick-btn ${r?"is-acute":""}" onclick="openAutonomicModal('capture')">
          <span>${r?"\u23F1":"\u26A1"}</span>
          <span id="autonomicQuickEpisodeLabel">${l(m)}</span>
        </button>
        <button type="button" class="autonomic-quick-btn ${c.active_today?"is-illness":""}" onclick="openAutonomicModal('illness')">
          <span>\u{1F912}</span>
          <span>${l(d)}</span>
        </button>
      `}}function ce(e){const t=document.getElementById("autonomicBodySummaryCard");if(!t)return;const o=e.patterns||{},s=o.prodromal_risk||{level:"low",label:"Low Baseline",score:0,drivers:[]},i=e.level1||{},n=e.level2||{},a=o.total_recovery_stats||{},c=s.level==="high"?"risk-high":s.level==="elevated"?"risk-elevated":"risk-low";t.style.display="block",t.innerHTML=`
      <div class="autonomic-risk-card ${c}">
        <div class="autonomic-safety-title">
          <span>\u{1F6E1}\uFE0F Autonomic &amp; Illness Tracker</span>
          <span class="autonomic-risk-pill">${l(String(s.level||"low").toUpperCase())} \u2022 ${Number(s.score||0)}</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">${l(s.label||"")}</div>
        <div class="autonomic-stat-grid cols-3" style="margin-top:8px;">
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">Episodes (30d)</div>
            <div class="autonomic-stat-val">${Number(o.count_30d||0)}</div>
          </div>
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">Avg Rec Lag</div>
            <div class="autonomic-stat-val">${a.avg!==null&&a.avg!==void 0?`${Math.round(Number(a.avg))}m`:"--"}</div>
          </div>
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">4h Stress Streak</div>
            <div class="autonomic-stat-val">${Number(n.max_streak_mins||0)}m</div>
          </div>
        </div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:6px;">
          Sleep Stress Avg: <strong>${i.sleep_avg_stress!=null?i.sleep_avg_stress:"--"}</strong> \u2022 HRV Night: <strong>${i.hrv_last_night!=null?`${i.hrv_last_night}ms`:"--"}</strong> (7d Base: ${i.hrv_7d_baseline!=null?`${i.hrv_7d_baseline}ms`:"--"})
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
          <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('patterns')">\u{1F4CA} Patterns &amp; Risk</button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('export')">\u{1FA7A} Clinical Export</button>
        </div>
      </div>
    `}function x(e){const t=document.getElementById("autonomicViewCapture");if(!t)return;const o=e.active_episode,s=Array.isArray(e.symptom_catalog)&&e.symptom_catalog.length?e.symptom_catalog:q,i=Array.isArray(e.trigger_catalog)&&e.trigger_catalog.length?e.trigger_catalog:Q;if(o&&(o.state==="ACUTE_EPISODE"||o.state==="POST_EPISODE_RECOVERY")){ae(o);const c=o.state==="ACUTE_EPISODE",p=!!o.user_recovered_at,r=!!o.biometric_recovered_at,m=c?`
          <button type="button" class="autonomic-tap-btn is-recovery" onclick="updateActiveEpisode('mark_acute_end')">
            \u2713 Acute Peak Subsided (Start Recovery Check)
          </button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="updateActiveEpisode('confirm_resolved_override')">
            \u2713 Episode Fully Cleared Now
          </button>
        `:`
          ${p?`<button type="button" class="autonomic-tap-btn is-calm" disabled>\u2713 You Marked Feeling Normal (${l(T(o.user_recovered_at))})</button>`:`<button type="button" class="autonomic-tap-btn is-calm" onclick="updateActiveEpisode('mark_user_recovered')">\u2713 I Feel Back to Normal Now</button>`}
          ${r?"":`<button type="button" class="autonomic-tap-btn is-outline" onclick="updateActiveEpisode('confirm_resolved_override')">Garmin Offline / Stale \u2014 Mark Fully Resolved</button>`}
        `;t.innerHTML=`
        <div class="autonomic-timer-hero">
          <div style="font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-secondary);">
            ${c?"ACUTE EPISODE IN PROGRESS":"POST-EPISODE RECOVERY TIMER"}
          </div>
          <div id="autonomicLiveTimerDigits" class="autonomic-timer-digits">${l(O(o.onset_time))}</div>
          <div style="font-size:12px; color:var(--text-secondary);">Started ${l(T(o.onset_time))}</div>

          <div class="autonomic-hybrid-status-row">
            <div class="autonomic-hybrid-badge ${c?"":"is-done"}">
              ${c?"\u23F3":"\u2713"} Acute Ended${o.acute_duration_mins!=null?` (${o.acute_duration_mins}m)`:""}
            </div>
            <div class="autonomic-hybrid-badge ${p?"is-done":""}">
              ${p?"\u2713":"\u25CB"} Feel Normal
            </div>
            <div class="autonomic-hybrid-badge ${r?"is-done":""}">
              ${r?"\u2713":"\u25CB"} Garmin Stress \u226425
            </div>
          </div>

          <div class="autonomic-safety-actions" style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
            ${m}
          </div>
        </div>

        <div class="autonomic-safety-banner tone-amber" style="margin-top:10px;">
          <div class="autonomic-safety-copy"><strong>Do NOT drive (Volkswagen ID. Buzz)</strong> or perform solo high-risk exertion until full recovery completes.</div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Severity</label>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            ${["mild","moderate","severe"].map(d=>`
              <button type="button" class="autonomic-chip ${I===d?"is-selected":""}" onclick="setActiveDraftSeverity('${d}')">
                <span class="autonomic-chip-check">${I===d?"\u2713":""}</span>
                <span>${d.toUpperCase()}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Symptoms Experienced (Tap All That Apply)</label>
          <div class="autonomic-chip-grid">
            ${s.map(d=>{const v=$.has(d.key);return`
                <button type="button" class="autonomic-chip ${v?"is-selected":""}" onclick="toggleEpisodeDraftSymptom('${l(d.key)}')">
                  <span class="autonomic-chip-check">${v?"\u2713":""}</span>
                  <span>${l(d.label)}</span>
                </button>
              `}).join("")}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Context &amp; Triggers</label>
          <div class="autonomic-chip-grid">
            ${i.map(d=>{const v=A.has(d.key);return`
                <button type="button" class="autonomic-chip ${v?"is-selected":""}" onclick="toggleEpisodeDraftTrigger('${l(d.key)}')">
                  <span class="autonomic-chip-check">${v?"\u2713":""}</span>
                  <span>${l(d.label)}</span>
                </button>
              `}).join("")}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label" for="epDraftNotesInput">Notes (Optional)</label>
          <textarea id="epDraftNotesInput" class="autonomic-input" rows="2" placeholder="What happened right before, posture, food, warning aura..." oninput="setActiveDraftNotes(this.value)">${l(P)}</textarea>
        </div>

        <div style="margin-top:10px; display:flex; gap:8px;">
          <button type="button" class="autonomic-tap-btn is-calm" style="flex:2;" onclick="saveActiveEpisodeDetails()">\u2713 Save Symptoms &amp; Notes</button>
        </div>
      `;return}const a=(e.illness||{}).active_today?'<div class="autonomic-safety-copy" style="margin-top:6px;">\u{1F912} Active illness will automatically link to any logged episode today.</div>':"";t.innerHTML=`
      <div class="autonomic-risk-card risk-low" style="text-align:left;">
        <div class="autonomic-safety-title">
          <span>\u26A1 Immediate Capture</span>
          <span>1-Tap</span>
        </div>
        <div class="autonomic-safety-copy">Experiencing dizziness, presyncope, dissociation, visual shift, or dread? Tap once to timestamp onset immediately; fill in symptoms once clear.</div>
        ${a}
        <div style="margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow()">
            \u26A1 I'm Having a Funny Turn Now
          </button>
        </div>
      </div>

      <div style="margin-top:12px;">
        <button type="button" class="autonomic-tap-btn is-outline" onclick="toggleBackdateEpisodeForm()">
          ${M?"\u25B2 Hide Past / Backdated Episode Form":"\u{1F552} Log Past / Backdated Funny Turn"}
        </button>
      </div>

      ${M?`
        <div class="autonomic-episode-card" style="margin-top:10px;">
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
              <label class="autonomic-label" for="bdOnsetTime">Episode Start (Date &amp; Time)</label>
              <input id="bdOnsetTime" type="datetime-local" class="autonomic-input" value="${l(se())}">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div>
                <label class="autonomic-label" for="bdAcuteMins">Acute Peak (mins)</label>
                <input id="bdAcuteMins" type="number" min="0" max="600" class="autonomic-input" value="10" placeholder="10">
              </div>
              <div>
                <label class="autonomic-label" for="bdRecoveryMins">Full Normal (mins)</label>
                <input id="bdRecoveryMins" type="number" min="0" max="1440" class="autonomic-input" value="45" placeholder="45">
              </div>
            </div>
            <div>
              <label class="autonomic-label">Symptoms</label>
              <div class="autonomic-chip-grid">
                ${s.map(c=>{const p=E.has(c.key);return`
                    <button type="button" class="autonomic-chip ${p?"is-selected":""}" onclick="toggleBackdateSymptom('${l(c.key)}')">
                      <span class="autonomic-chip-check">${p?"\u2713":""}</span>
                      <span>${l(c.label)}</span>
                    </button>
                  `}).join("")}
              </div>
            </div>
            <div>
              <label class="autonomic-label">Triggers / Context</label>
              <div class="autonomic-chip-grid">
                ${i.map(c=>{const p=k.has(c.key);return`
                    <button type="button" class="autonomic-chip ${p?"is-selected":""}" onclick="toggleBackdateTrigger('${l(c.key)}')">
                      <span class="autonomic-chip-check">${p?"\u2713":""}</span>
                      <span>${l(c.label)}</span>
                    </button>
                  `}).join("")}
              </div>
            </div>
            <div>
              <label class="autonomic-label" for="bdSeverity">Severity</label>
              <select id="bdSeverity" class="autonomic-input">
                <option value="mild">Mild</option>
                <option value="moderate" selected>Moderate</option>
                <option value="severe">Severe</option>
              </select>
            </div>
            <div>
              <label class="autonomic-label" for="bdNotes">Notes</label>
              <textarea id="bdNotes" class="autonomic-input" rows="2" placeholder="Context, warning signs, posture..."></textarea>
            </div>
            <button type="button" class="autonomic-tap-btn is-calm" onclick="submitBackdatedEpisode()">\u2713 Save Past Episode &amp; Attach \xB160m Garmin Data</button>
          </div>
        </div>
      `:""}
    `}function U(e){const t=document.getElementById("autonomicViewIllness");if(!t)return;const o=e.illness||{},s=Array.isArray(o.recent_logs)?o.recent_logs:[],i={};s.forEach(r=>{r&&r.date_str&&(i[r.date_str]=r)});const n=w();g||(g=n);const a=i[g]||null;a&&_.size===0&&!b&&(f=a.severity||"moderate",b=a.notes||"",_=new Set(Array.isArray(a.symptoms)?a.symptoms:[]));const c=[];for(let r=6;r>=0;r--)c.push(W(r));const p=Array.isArray(e.illness_symptom_catalog)&&e.illness_symptom_catalog.length?e.illness_symptom_catalog:J;t.innerHTML=`
      <div class="illness-today-banner">
        <div class="autonomic-safety-title">
          <span>\u{1F912} Illness &amp; Sick-Day Mode</span>
          <span>${o.active_today?`Active (Day ${Math.max(1,Number(o.current_streak_days||1))})`:"Not Sick Today"}</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">
          Logging illness days shifts today's Fuel to <strong>Maintenance (Protein Locked)</strong>, swaps training to <strong>Rest</strong>, excludes sick days (+1d rebound) from <strong>14d Adaptive TDEE</strong>, activates a <strong>48h Recovery Scale Shield</strong> after clearing, and links illness to episode patterns.
        </div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          ${o.active_today?`<button type="button" class="autonomic-tap-btn is-calm" onclick="saveIllnessLog('${n}', 'clear')">\u2713 I'm Better Today (Clear Today)</button>`:`<button type="button" class="autonomic-tap-btn is-illness" onclick="saveIllnessLog('${n}', 'active')">\u{1F912} Mark Today as Sick</button>`}
        </div>
      </div>

      <div style="margin-top:12px;">
        <label class="autonomic-label">Quick Backdate / Toggle Recent Days (e.g. Mon / Tue / Wed)</label>
        <div class="autonomic-day-strip">
          ${c.map(r=>{const m=!!i[r];return`
              <button type="button" class="autonomic-day-chip ${m?"is-sick":""} ${g===r?"is-selected":""}" onclick="selectIllnessDate('${r}')">
                <span>${l(ie(r))}</span>
                <span>${m?"\u{1F912} Sick":"Clear"}</span>
              </button>
            `}).join("")}
        </div>
      </div>

      <div class="autonomic-episode-card" style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <strong style="font-size:13px; color:var(--text);">Selected Date: ${l(g)}</strong>
            <div style="font-size:11.5px; color:var(--text-secondary);">${a?`Currently Logged (${l(a.severity)})`:"Not marked as ill"}</div>
          </div>
          <input type="date" id="illnessDateInput" class="autonomic-input" style="width:auto;" max="${n}" value="${l(g)}" onchange="selectIllnessDate(this.value)">
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label">Illness Severity</label>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            ${["mild","moderate","severe"].map(r=>`
              <button type="button" class="autonomic-chip ${f===r?"is-selected":""}" onclick="setIllnessSeverity('${r}')">
                <span class="autonomic-chip-check">${f===r?"\u2713":""}</span>
                <span>${r.toUpperCase()}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label">Symptoms</label>
          <div class="autonomic-chip-grid">
            ${p.map(r=>{const m=_.has(r.key);return`
                <button type="button" class="autonomic-chip ${m?"is-selected":""}" onclick="toggleIllnessSymptom('${l(r.key)}')">
                  <span class="autonomic-chip-check">${m?"\u2713":""}</span>
                  <span>${l(r.label)}</span>
                </button>
              `}).join("")}
          </div>
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label" for="illnessNotesInput">Notes (Cravings, Fever, Recovery)</label>
          <textarea id="illnessNotesInput" class="autonomic-input" rows="2" placeholder="e.g. Viral malaise, strong cravings, resting..." oninput="setIllnessNotes(this.value)">${l(b)}</textarea>
        </div>

        <div style="display:grid; grid-template-columns:2fr 1fr; gap:8px; margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-illness" onclick="saveIllnessLog('${l(g)}', 'active')">\u2713 Save Sick Day</button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="saveIllnessLog('${l(g)}', 'clear')">Clear Day</button>
        </div>
      </div>
    `}function de(e,t){return!Array.isArray(e)||e.length===0?'<div style="font-size:11px; color:var(--text-secondary);">Waiting for Garmin watch sync...</div>':`<div class="autonomic-spark-row">${e.slice(0,32).map(s=>{const i=Number(s.v||0),n=Math.max(12,Math.min(100,Math.round(i/t*100)));return`<div class="autonomic-spark-bar ${i>=75?"is-high":i>25?"is-mid":"is-low"}" style="height:${n}%;" title="${l(`${s.offset_m}m: ${i}`)}"></div>`}).join("")}</div>`}function pe(e){const t=document.getElementById("autonomicViewPatterns");if(!t)return;const o=e.patterns||{},s=o.prodromal_risk||{level:"low",label:"Low Baseline",score:0,drivers:[]},i=Array.isArray(s.drivers)?s.drivers:[],n=e.level1||{},a=e.level2||{},c=o.acute_duration_stats||{},p=o.total_recovery_stats||{},r=Array.isArray(o.top_symptoms)?o.top_symptoms:[],m=Array.isArray(o.top_triggers)?o.top_triggers:[],d=o.prodrome_comparison||{},v=Array.isArray(e.recent_episodes)?e.recent_episodes:[],R=s.level==="high"?"risk-high":s.level==="elevated"?"risk-elevated":"risk-low";t.innerHTML=`
      <div class="autonomic-risk-card ${R}">
        <div class="autonomic-safety-title">
          <span>\u{1F3AF} Heading Toward Episode Risk</span>
          <span class="autonomic-risk-pill">${l(String(s.level||"low").toUpperCase())} (${Number(s.score||0)}/100)</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">${l(s.label||"")}</div>
        ${i.length?`
          <div class="autonomic-driver-list">
            ${i.map(u=>`<div class="autonomic-driver-item">\u2022 ${l(u)}</div>`).join("")}
          </div>
        `:'<div class="autonomic-driver-item" style="margin-top:6px;">No active prodromal red flags detected on current telemetry.</div>'}
      </div>

      <div class="autonomic-stat-grid cols-3" style="margin-top:10px;">
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Sleep Stress</div>
          <div class="autonomic-stat-val">${n.sleep_avg_stress!=null?n.sleep_avg_stress:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Rest \u226425</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Overnight HRV</div>
          <div class="autonomic-stat-val">${n.hrv_last_night!=null?`${n.hrv_last_night}ms`:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">7d: ${n.hrv_7d_baseline!=null?`${n.hrv_7d_baseline}ms`:"--"}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Day &gt;25 Streak</div>
          <div class="autonomic-stat-val">${Number(a.max_streak_mins||0)}m</div>
          <div style="font-size:10px; color:var(--text-secondary);">Alert \u2265240m</div>
        </div>
      </div>

      <div class="autonomic-stat-grid cols-3" style="margin-top:8px;">
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Total Logged</div>
          <div class="autonomic-stat-val">${Number(o.total_episodes||0)}</div>
          <div style="font-size:10px; color:var(--text-secondary);">7d: ${Number(o.count_7d||0)} \u2022 30d: ${Number(o.count_30d||0)}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Avg Acute Peak</div>
          <div class="autonomic-stat-val">${c.avg!=null?`${Math.round(Number(c.avg))}m`:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Med: ${c.median!=null?`${Math.round(Number(c.median))}m`:"--"}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Avg Full Lag</div>
          <div class="autonomic-stat-val">${p.avg!=null?`${Math.round(Number(p.avg))}m`:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Med: ${p.median!=null?`${Math.round(Number(p.median))}m`:"--"}</div>
        </div>
      </div>

      <div class="autonomic-episode-card" style="margin-top:10px;">
        <div style="font-size:12px; font-weight:800; color:var(--text);">Pre-Episode vs Normal Day Biometrics</div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px; line-height:1.5;">
          Prior-Night HRV: Ep days <strong>${d.episode_days_avg_hrv!=null?`${d.episode_days_avg_hrv}ms`:"--"}</strong> vs Baseline <strong>${d.baseline_days_avg_hrv!=null?`${d.baseline_days_avg_hrv}ms`:"--"}</strong><br>
          Sleep Stress Avg: Ep days <strong>${d.episode_days_avg_sleep_stress!=null?d.episode_days_avg_sleep_stress:"--"}</strong> vs Baseline <strong>${d.baseline_days_avg_sleep_stress!=null?d.baseline_days_avg_sleep_stress:"--"}</strong><br>
          Illness Co-Occurrence: <strong>${Number(o.illness_co_occurrence_pct||0)}%</strong> of episodes overlapped sick days
        </div>
      </div>

      ${r.length||m.length?`
        <div class="autonomic-stat-grid cols-2" style="margin-top:10px;">
          <div class="autonomic-episode-card">
            <div style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:4px;">Top Symptoms</div>
            ${r.slice(0,5).map(u=>`<div style="font-size:11.5px; color:var(--text-secondary);">\u2022 ${l(u.label)} (${u.count}, ${u.pct}%)</div>`).join("")||'<div style="font-size:11.5px; color:var(--text-secondary);">None logged yet</div>'}
          </div>
          <div class="autonomic-episode-card">
            <div style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:4px;">Top Triggers</div>
            ${m.slice(0,5).map(u=>`<div style="font-size:11.5px; color:var(--text-secondary);">\u2022 ${l(u.label)} (${u.count}, ${u.pct}%)</div>`).join("")||'<div style="font-size:11.5px; color:var(--text-secondary);">None logged yet</div>'}
          </div>
        </div>
      `:""}

      <div style="margin-top:12px;">
        <label class="autonomic-label">Episode Timeline &amp; \xB160m Garmin Snapshots (${v.length})</label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${v.length?v.map(u=>{const h=u.biometric_snapshot||{},j=h.stress||{},oe=h.hr||{};return`
              <div class="autonomic-episode-card">
                <div class="autonomic-episode-head">
                  <div>
                    <strong style="font-size:13px; color:var(--text);">${l(T(u.onset_time))}</strong>
                    <div style="font-size:11px; color:var(--text-secondary);">
                      ${l(u.state)} \u2022 ${l(String(u.severity||"moderate").toUpperCase())}
                      ${u.acute_duration_mins!=null?` \u2022 Peak ${u.acute_duration_mins}m`:""}
                      ${u.total_recovery_duration_mins!=null?` \u2022 Recovery ${u.total_recovery_duration_mins}m`:""}
                      ${u.illness_active?" \u2022 \u{1F912} Sick":""}
                    </div>
                  </div>
                  <button type="button" class="autonomic-chip" style="min-height:36px; padding:4px 8px; flex:0;" onclick="deleteLoggedEpisode('${l(u.id)}')" title="Delete Episode">\u{1F5D1}\uFE0F</button>
                </div>
                <div class="autonomic-tag-list" style="margin-top:6px;">
                  ${(u.symptoms||[]).map(G=>`<span class="autonomic-tag">${l(G.replace(/_/g," "))}</span>`).join("")}
                  ${(u.triggers||[]).map(G=>`<span class="autonomic-tag">${l(G.replace(/_/g," "))}</span>`).join("")}
                </div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:6px;">
                  Snapshot (${l(u.biometric_snapshot_status||"pending")}): Peak Stress <strong>${j.peak!=null?j.peak:"--"}</strong> \u2022 Peak HR <strong>${oe.peak!=null?`${oe.peak} bpm`:"--"}</strong> \u2022 Prior HRV <strong>${h.prior_night_hrv!=null?`${h.prior_night_hrv}ms`:"--"}</strong>
                </div>
                ${de(j.series,100)}
                ${u.notes?`<div style="font-size:11.5px; color:var(--text); margin-top:5px;">"${l(u.notes)}"</div>`:""}
              </div>
            `}).join(""):'<div class="autonomic-episode-card" style="font-size:12px; color:var(--text-secondary);">No funny turns logged yet. Tap Capture to log live or backdate prior turns.</div>'}
        </div>
      </div>
    `}function ue(e){const t=document.getElementById("autonomicViewExport");if(!t)return;const o=Array.isArray(e.differential_pathways)?e.differential_pathways:[],s=e.patterns||{};t.innerHTML=`
      <div class="autonomic-disclaimer-box">
        <strong>Non-Diagnostic Clinical Review Notice:</strong><br>
        ${l(e.clinical_disclaimer||"Self-monitoring record only \u2014 review with GP / Neurology / Cardiology.")}
      </div>

      <div class="autonomic-episode-card" style="margin-top:10px;">
        <div style="font-size:13px; font-weight:800; color:var(--text);">One-Click Clinician Exports</div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px;">
          Includes ${Number(s.total_episodes||0)} logged episode(s), recovery lag durations, illness overlap, and \xB160 minute Fenix 8 Stress, Heart Rate &amp; prior-night HRV telemetry formatted for GP, Neurology (ambulatory EEG/MRI), and Cardiology (Holter/tilt-table).
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-calm" onclick="openClinicalReportPrintView()">
            \u{1F5A8} Open Clinical Summary / Save PDF
          </button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="downloadAutonomicCsv()">
            \u2B07 Download Clinical CSV Spreadsheet
          </button>
        </div>
      </div>

      <div style="margin-top:12px;">
        <label class="autonomic-label">Four Differential Pathways Monitored (Open Differential)</label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${o.map(i=>`
            <div class="autonomic-episode-card">
              <strong style="font-size:12.5px; color:var(--text);">${l(i.label)}</strong>
              <div style="font-size:11.5px; color:var(--text-secondary); margin-top:3px;">${l(i.summary)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `}function C(e){if(e&&e.autonomic&&typeof window<"u"){(!window.PULSE_ANALYTICS_SUMMARY||typeof window.PULSE_ANALYTICS_SUMMARY!="object")&&(window.PULSE_ANALYTICS_SUMMARY={}),window.PULSE_ANALYTICS_SUMMARY.autonomic=e.autonomic;try{localStorage.setItem(Y,JSON.stringify(e.autonomic))}catch{}}const t=y();le(t),re(t),ce(t),S==="capture"?x(t):S==="illness"?U(t):S==="patterns"?pe(t):S==="export"&&ue(t),X()}function H(e){const t=["capture","illness","patterns","export"];S=t.includes(e)?e:"capture",t.forEach(o=>{const s=document.getElementById(`btnAutonomicView_${o}`),i=document.getElementById(`autonomicView${o.charAt(0).toUpperCase()}${o.slice(1)}`);s&&s.classList&&s.classList.toggle("active",o===S),i&&i.classList&&i.classList.toggle("active",o===S)}),C()}function Z(e){const t=document.getElementById("autonomicModal");t&&t.classList&&t.classList.add("open"),e?H(e):C(),typeof pulseHaptic=="function"&&pulseHaptic(20)}function me(){const e=document.getElementById("autonomicModal");e&&e.classList&&e.classList.remove("open"),X()}function B(){return new Date().toISOString()}async function L(e,t,o){let s=!1;try{const n=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t),timeoutMs:6e3});if(n&&n.ok){const a=await n.json();return a&&a.autonomic&&K(a.autonomic,a.state||null,a.flex_refeed||null),a}typeof window._shouldQueueOfflineResponse=="function"?s=window._shouldQueueOfflineResponse(n):s=!n||n.status===0||n.status>=500||n.status===401}catch{s=!0}if(s){if(typeof window.enqueueOfflineWrite=="function"&&window.enqueueOfflineWrite(e,t,"POST"),typeof o=="function"){const i=JSON.parse(JSON.stringify(y()));o(i),K(i,null,null)}typeof showToast=="function"&&showToast("Saved locally offline \u2014 will sync automatically when online")}return null}async function ve(e=0,t=!1){if(!F){F=!0;try{const o=Date.now(),s=e&&Number(e)>0?new Date(Number(e)).toISOString():B(),i=`ep_${o}_${Math.random().toString(36).slice(2,8)}`,n=`evt_${o}_${Math.random().toString(36).slice(2,8)}`;await L("/api/health/episodes",{id:i,onset_time:s,severity:"moderate",symptoms:[],triggers:[],spike_auto_detected:!!t,client_event_id:n},c=>{const p={id:i,client_event_id:n,state:"ACUTE_EPISODE",onset_time:s,date_str:w(),acute_peak_end_time:null,full_recovery_time:null,user_recovered_at:null,biometric_recovered_at:null,severity:"moderate",symptoms:[],triggers:c.illness&&c.illness.active_today?["illness_infection"]:[],illness_active:!!(c.illness&&c.illness.active_today),notes:"",biometric_snapshot_status:"pending"};c.active_episode=p,c.system_state="ACUTE_EPISODE",c.alert_level=2,c.safety_banner={active:!0,level:2,tone:"red",title:"ACTIVE EPISODE TRACKING",reasons:["Acute episode capture started (offline queue active)"],advisory:"Avoid driving (Volkswagen ID. Buzz) or solo exertion until recovered.",avoid_driving:!0,avoid_solo_exertion:!0},c.recent_episodes=[p].concat(c.recent_episodes||[])}),D=null,Z("capture"),typeof showToast=="function"&&showToast("\u26A1 Episode capture started \u2014 rest safely")}finally{F=!1}}}async function ee(e){const o=y().active_episode;if(!o)return;const s=B(),i={id:o.id,client_event_id:o.client_event_id||void 0,action:e,timestamp:s,symptoms:Array.from($),triggers:Array.from(A),severity:I,notes:P};await L("/api/health/episodes/update",i,n=>{const a=n.active_episode;a&&(a.symptoms=i.symptoms,a.triggers=i.triggers,a.severity=i.severity,a.notes=i.notes,e==="mark_acute_end"?(a.acute_peak_end_time=s,a.state="POST_EPISODE_RECOVERY",n.system_state="POST_EPISODE_RECOVERY"):e==="mark_user_recovered"?(a.user_recovered_at=s,a.acute_peak_end_time||(a.acute_peak_end_time=s),a.state="POST_EPISODE_RECOVERY",n.system_state="POST_EPISODE_RECOVERY"):e==="confirm_resolved_override"&&(a.acute_peak_end_time||(a.acute_peak_end_time=s),a.user_recovered_at=a.user_recovered_at||s,a.full_recovery_time=s,a.state="RESOLVED",n.active_episode=null,n.system_state=n.level1&&n.level1.active||n.level2&&n.level2.active?"VULNERABILITY_ALERT":"IDLE",n.safety_banner.active=n.system_state==="VULNERABILITY_ALERT"),n.recent_episodes=(n.recent_episodes||[]).map(c=>c.id===a.id?a:c))}),e==="confirm_resolved_override"&&(D=null,typeof showToast=="function"&&showToast("\u2713 Episode marked fully resolved"))}function ye(){return ee("edit_details").then(()=>{typeof showToast=="function"&&showToast("\u2713 Episode symptoms & triggers saved")})}function ge(e){$.has(e)?$.delete(e):$.add(e),x(y())}function _e(e){A.has(e)?A.delete(e):A.add(e),x(y())}function fe(e){I=e,x(y())}function be(e){P=String(e||"")}function he(){M=!M,x(y())}function Se(e){E.has(e)?E.delete(e):E.add(e),x(y())}function we(e){k.has(e)?k.delete(e):k.add(e),x(y())}async function xe(){const e=(document.getElementById("bdOnsetTime")||{}).value,t=Math.max(0,Number((document.getElementById("bdAcuteMins")||{}).value||0)),o=Math.max(0,Number((document.getElementById("bdRecoveryMins")||{}).value||0)),s=(document.getElementById("bdSeverity")||{}).value||"moderate",i=(document.getElementById("bdNotes")||{}).value||"",n=e?new Date(e):new Date,a=Number.isFinite(n.getTime())?n.getTime():Date.now(),c=t>0?new Date(a+t*6e4).toISOString():null,p=o>0?new Date(a+o*6e4).toISOString():null,r=Date.now(),d={id:`ep_${r}_${Math.random().toString(36).slice(2,8)}`,onset_time:new Date(a).toISOString(),acute_peak_end_time:c,full_recovery_time:p,severity:s,symptoms:Array.from(E),triggers:Array.from(k),notes:i,client_event_id:`evt_${r}_${Math.random().toString(36).slice(2,8)}`};await L("/api/health/episodes",d,v=>{const R={...d,date_str:d.onset_time.slice(0,10),state:p?"RESOLVED":c?"POST_EPISODE_RECOVERY":"ACUTE_EPISODE",acute_duration_mins:t||null,total_recovery_duration_mins:o||null,biometric_snapshot_status:"pending"};v.recent_episodes=[R].concat(v.recent_episodes||[])}),M=!1,E.clear(),k.clear(),H("patterns"),typeof showToast=="function"&&showToast("\u2713 Past episode saved with Garmin snapshot")}async function $e(e){e&&(await L("/api/health/episodes/delete",{id:e},t=>{t.recent_episodes=(t.recent_episodes||[]).filter(o=>o.id!==e),t.active_episode&&t.active_episode.id===e&&(t.active_episode=null)}),typeof showToast=="function"&&showToast("Episode deleted"))}async function Ae(e){await L("/api/health/autonomic/dismiss-spike",{spike_ts_ms:Number(e)||Date.now()},t=>{t.acute_spike=null})}function Ee(e){g=String(e||w()).slice(0,10);const t=y(),s=(t.illness&&Array.isArray(t.illness.recent_logs)?t.illness.recent_logs:[]).find(i=>i.date_str===g);s?(f=s.severity||"moderate",b=s.notes||"",_=new Set(Array.isArray(s.symptoms)?s.symptoms:[])):(f="moderate",b="",_=new Set),U(t)}function ke(e){f=e,U(y())}function Te(e){_.has(e)?_.delete(e):_.add(e),U(y())}function Le(e){b=String(e||"")}async function Ie(e,t="active"){const o=String(e||g||w()).slice(0,10),s={date_str:o,status:t,severity:f,symptoms:Array.from(_),notes:b};if(await L("/api/health/illness",s,i=>{i.illness||(i.illness={active_today:!1,recent_logs:[]});const n=Array.isArray(i.illness.recent_logs)?i.illness.recent_logs.filter(a=>a.date_str!==o):[];t!=="clear"&&n.unshift({date_str:o,status:t,severity:f,symptoms:s.symptoms,notes:b}),i.illness.recent_logs=n,o===w()&&(i.illness.active_today=t!=="clear")}),typeof fetchAnalyticsSummary=="function")try{await fetchAnalyticsSummary(!0)}catch{}typeof showToast=="function"&&showToast(t==="clear"?`\u2713 Cleared sick log for ${o}`:`\u{1F912} Saved Sick Day (${o})`)}async function De(){try{const i=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)("/api/health/episodes/export?format=csv",{timeoutMs:8e3});if(i&&i.ok){const n=await i.text();V("pulse-clinical-episodes.csv",n,"text/csv;charset=utf-8"),typeof showToast=="function"&&showToast("\u2B07 Clinical CSV downloaded");return}}catch{}const e=y().recent_episodes||[],t=[["episode_id","date_uk","onset_time_uk","state","severity","acute_mins","recovery_mins","symptoms","triggers","notes"]];e.forEach(s=>{t.push([s.id,s.date_str,s.onset_time,s.state,s.severity,s.acute_duration_mins??"",s.total_recovery_duration_mins??"",(s.symptoms||[]).join("; "),(s.triggers||[]).join("; "),String(s.notes||"").replace(/"/g,'""')])});const o=t.map(s=>s.map(i=>`"${String(i??"").replace(/"/g,'""')}"`).join(",")).join(`
`);V("pulse-clinical-episodes-offline.csv",o,"text/csv;charset=utf-8"),typeof showToast=="function"&&showToast("\u2B07 Offline Clinical CSV downloaded")}function V(e,t,o){if(typeof document>"u"||typeof Blob>"u"||!URL||typeof URL.createObjectURL!="function")return;const s=new Blob([t],{type:o}),i=URL.createObjectURL(s),n=document.createElement("a");n.href=i,n.download=e,document.body.appendChild(n),n.click(),document.body.removeChild(n),setTimeout(()=>{try{URL.revokeObjectURL(i)}catch{}},1e3)}function te(e){const t=e||{},o=t.patterns||{},s=o.acute_duration_stats||{},i=o.total_recovery_stats||{},n=Array.isArray(t.episodes)?t.episodes:t.recent_episodes||[],a=Array.isArray(t.illness_logs)?t.illness_logs:t.illness&&t.illness.recent_logs||[],c=t.clinical_disclaimer||"Self-monitoring & Garmin biometric correlation record only. Non-diagnostic.",p=n.map(r=>{const m=r.biometric_snapshot||{},d=m.stress||{},v=m.hr||{},R=(r.symptoms||[]).map(h=>l(h.replace(/_/g," "))).join(", ")||"None recorded",u=(r.triggers||[]).map(h=>l(h.replace(/_/g," "))).join(", ")||"None recorded";return`
        <tr>
          <td><strong>${l(T(r.onset_time))}</strong><br><small>${l(r.severity||"moderate")}${r.illness_active?" \u2022 Sick day":""}</small></td>
          <td>Peak: ${r.acute_duration_mins!=null?`${r.acute_duration_mins}m`:"--"}<br>Full Rec: ${r.total_recovery_duration_mins!=null?`${r.total_recovery_duration_mins}m`:"--"}</td>
          <td>${R}</td>
          <td>${u}</td>
          <td>Stress: Pre ${d.pre_avg??"--"} / Peak ${d.peak??"--"} / Post ${d.post_avg??"--"}<br>HR: Pre ${v.pre_avg??"--"} / Peak ${v.peak??"--"} / Post ${v.post_avg??"--"} bpm<br>Prior HRV: ${m.prior_night_hrv??"--"}ms \u2022 Sleep Stress: ${m.prior_night_sleep_stress??"--"}</td>
          <td>${l(r.notes||"")}</td>
        </tr>
      `}).join("");return`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PULSE Clinical Autonomic &amp; Paroxysmal Episode Report</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 28px; line-height: 1.45; font-size: 13px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .meta { color: #374151; font-size: 12px; margin-bottom: 14px; }
  .disclaimer { border: 1.5px solid #b45309; background: #fffbeb; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
  .box { border: 1px solid #d1d5db; padding: 10px; border-radius: 6px; }
  .box .lbl { font-size: 11px; color: #4b5563; text-transform: uppercase; font-weight: bold; }
  .box .val { font-size: 18px; font-weight: bold; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th, td { border: 1px solid #d1d5db; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: bold; }
  @media print { .no-print { display: none; } body { margin: 12mm; } }
</style>
</head>
<body>
  <div class="no-print" style="margin-bottom:14px;">
    <button onclick="window.print()" style="padding:10px 16px; font-weight:bold; cursor:pointer;">\u{1F5A8} Print / Save as PDF</button>
  </div>
  <h1>PULSE \u2014 Paroxysmal Episode &amp; Autonomic Clinical Summary</h1>
  <div class="meta">Generated: ${l(T(t.generated_at||B()))} \u2022 Review Context: GP / Neurology (Ambulatory EEG / MRI) / Cardiology (Holter / Tilt-Table)</div>
  <div class="disclaimer"><strong>Non-Diagnostic Scope:</strong> ${l(c)} Routine 20\u201340 min resting surface EEG was normal; differential tracking covers Autonomic Dysregulation, Paroxysmal Focal Neurological Signaling, Transient Perfusion/Orthostatic Shifts, and Metabolic/Fuel/Illness Load Triggers.</div>
  <div class="grid">
    <div class="box"><div class="lbl">Total Episodes</div><div class="val">${Number(o.total_episodes||n.length||0)}</div></div>
    <div class="box"><div class="lbl">Avg Acute Peak</div><div class="val">${s.avg!=null?`${Math.round(Number(s.avg))} min`:"--"}</div></div>
    <div class="box"><div class="lbl">Avg Full Recovery</div><div class="val">${i.avg!=null?`${Math.round(Number(i.avg))} min`:"--"}</div></div>
    <div class="box"><div class="lbl">Sick Days Logged</div><div class="val">${a.length}</div></div>
  </div>
  <h3>Paroxysmal Episode Timeline &amp; \xB160 Minute Garmin Telemetry</h3>
  <table>
    <thead>
      <tr>
        <th>Onset &amp; Severity</th>
        <th>Durations</th>
        <th>Symptoms</th>
        <th>Triggers / Context</th>
        <th>\xB160m Fenix 8 Biometrics</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>${p||'<tr><td colspan="6">No episodes recorded.</td></tr>'}</tbody>
  </table>
  ${a.length?`
    <h3 style="margin-top:18px;">Logged Illness / Intercurrent Infection Days</h3>
    <table>
      <thead><tr><th>Date</th><th>Status &amp; Severity</th><th>Symptoms</th><th>Notes</th></tr></thead>
      <tbody>${a.map(r=>`<tr><td>${l(r.date_str)}</td><td>${l(r.status)} (${l(r.severity)})</td><td>${l((r.symptoms||[]).join(", "))}</td><td>${l(r.notes||"")}</td></tr>`).join("")}</tbody>
    </table>
  `:""}
</body>
</html>`}async function Me(){let e=null;try{const s=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)("/api/health/episodes/export?format=json",{timeoutMs:8e3});s&&s.ok&&(e=await s.json())}catch{}if(!e){const o=y();e={generated_at:B(),clinical_disclaimer:o.clinical_disclaimer,patterns:o.patterns,illness_logs:o.illness&&o.illness.recent_logs||[],episodes:o.recent_episodes||[]}}const t=te(e);if(typeof window<"u"&&typeof window.open=="function"){const o=window.open("","_blank","noopener");if(o&&o.document)return o.document.open(),o.document.write(t),o.document.close(),t}return V("pulse-clinical-report.html",t,"text/html;charset=utf-8"),t}typeof window<"u"&&(window.getAutonomicSummary=y,window.renderAutonomicUi=C,window.openAutonomicModal=Z,window.closeAutonomicModal=me,window.switchAutonomicView=H,window.startAcuteEpisodeNow=ve,window.updateActiveEpisode=ee,window.saveActiveEpisodeDetails=ye,window.toggleEpisodeDraftSymptom=ge,window.toggleEpisodeDraftTrigger=_e,window.setActiveDraftSeverity=fe,window.setActiveDraftNotes=be,window.toggleBackdateEpisodeForm=he,window.toggleBackdateSymptom=Se,window.toggleBackdateTrigger=we,window.submitBackdatedEpisode=xe,window.deleteLoggedEpisode=$e,window.dismissAutonomicSpike=Ae,window.selectIllnessDate=Ee,window.setIllnessSeverity=ke,window.toggleIllnessSymptom=Te,window.setIllnessNotes=Le,window.saveIllnessLog=Ie,window.downloadAutonomicCsv=De,window.openClinicalReportPrintView=Me,window.buildClinicalReportHtml=te,window._stopAutonomicTimer=z),typeof document<"u"&&typeof document.addEventListener=="function"&&document.addEventListener("DOMContentLoaded",()=>{try{C()}catch{}},{once:!0})})();

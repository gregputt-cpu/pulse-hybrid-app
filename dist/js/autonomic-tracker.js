(function(){"use strict";const z="pulse_autonomic_cache_v1",q=[{key:"dizziness_vertigo",label:"Dizziness / Vertigo"},{key:"lightheaded_presyncope",label:"Lightheadedness / Presyncope"},{key:"dissociation",label:"Dissociation / Detachment"},{key:"confusion_brain_fog",label:"Confusion / Brain Fog"},{key:"impending_doom",label:"Impending Doom / Adrenaline"},{key:"visual_changes",label:"Visual Changes"},{key:"blackout",label:"Blackout / Loss of Consciousness"}],Q=[{key:"standing_quickly",label:"Standing Up Quickly"},{key:"driving",label:"Driving (ID. Buzz)"},{key:"fasted_state",label:"Fasted State"},{key:"post_exercise",label:"Post-Exercise"},{key:"poor_sleep",label:"Poor Sleep"},{key:"high_workload",label:"High Workload / Screen"},{key:"illness_infection",label:"Illness / Infection"},{key:"dehydration_heat",label:"Dehydration / Heat"},{key:"caffeine_stimulant",label:"Caffeine / Stimulant"}],W=[{key:"fever_chills",label:"Fever / Chills"},{key:"fatigue_malaise",label:"Deep Fatigue / Malaise"},{key:"respiratory_sinus",label:"Respiratory / Sinus"},{key:"gi_nausea",label:"GI Upset / Nausea"},{key:"headache_aches",label:"Headache / Body Aches"},{key:"elevated_rhr_stress",label:"High RHR / Poor Sleep"}];let w="capture",T=new Set,L=new Set,M="moderate",O="",E=null,R=!1,I=new Set,D=new Set,g="",b="moderate",f=new Set,h="",C=null,F=!1;function l(e){return typeof escapeHtml=="function"?escapeHtml(e):String(e??"").replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[t])}function $(){if(typeof getLocalDateStr=="function")return getLocalDateStr();const e=new Date;return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`}function se(){const e=new Date,t=o=>String(o).padStart(2,"0");return`${e.getFullYear()}-${t(e.getMonth()+1)}-${t(e.getDate())}T${t(e.getHours())}:${t(e.getMinutes())}`}function J(e){const t=new Date;t.setDate(t.getDate()-e);const o=s=>String(s).padStart(2,"0");return`${t.getFullYear()}-${o(t.getMonth()+1)}-${o(t.getDate())}`}function ie(e){const t=String(e||"").split("-").map(Number);if(t.length!==3)return e;const o=new Date(t[0],t[1]-1,t[2]),s=$();if(e===s)return"Today";const a=J(1);return e===a?"Yest":o.toLocaleDateString("en-GB",{weekday:"short",day:"numeric"})}function B(e){const t=Date.parse(String(e||""));if(!Number.isFinite(t))return"00:00";const o=Math.max(0,Math.floor((Date.now()-t)/1e3)),s=Math.floor(o/3600),a=Math.floor(o%3600/60),i=o%60,n=r=>String(r).padStart(2,"0");return s>0?`${s}:${n(a)}:${n(i)}`:`${n(a)}:${n(i)}`}function A(e){if(!e)return"--";const t=Date.parse(String(e));return Number.isFinite(t)?new Date(t).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):String(e).slice(0,16)}function ne(){return{evaluated_at:null,date_str:$(),system_state:"IDLE",alert_level:0,safety_banner:{active:!1,level:0,tone:"calm",title:"Autonomic Baseline Calm",reasons:[],advisory:"Autonomic metrics within normal baseline.",avoid_driving:!1,avoid_solo_exertion:!1},level1:{active:!1,triggers:[],sleep_avg_stress:null,hrv_last_night:null,hrv_7d_baseline:null},level2:{active:!1,current_streak_mins:0,max_streak_mins:0},acute_spike:null,active_episode:null,illness:{active_today:!1,today_log:null,current_streak_days:0,last_illness_date:null,days_since_illness_ended:null,post_illness_ramp_active:!1,recovery_scale_shield:{active:!1,hours_remaining:0,note:""},recent_logs:[]},patterns:{total_episodes:0,count_7d:0,count_30d:0,acute_duration_stats:{count:0,avg:null,median:null,min:null,max:null},total_recovery_stats:{count:0,avg:null,median:null,min:null,max:null},top_symptoms:[],top_triggers:[],illness_co_occurrence_pct:0,time_of_day:[],pathway_counts:[],prodrome_comparison:{},prodromal_risk:{score:0,level:"low",label:"Low / Calm Autonomic Baseline",drivers:[]}},recent_episodes:[],symptom_catalog:q,trigger_catalog:Q,illness_symptom_catalog:W,clinical_disclaimer:"Self-monitoring & Garmin biometric correlation record only. Non-diagnostic."}}function y(){if(typeof window<"u"&&window.PULSE_ANALYTICS_SUMMARY&&window.PULSE_ANALYTICS_SUMMARY.autonomic)return window.PULSE_ANALYTICS_SUMMARY.autonomic;try{const e=localStorage.getItem(z);if(e){const t=JSON.parse(e);if(t&&typeof t=="object"&&t.system_state)return(!window.PULSE_ANALYTICS_SUMMARY||typeof window.PULSE_ANALYTICS_SUMMARY!="object")&&(window.PULSE_ANALYTICS_SUMMARY={}),window.PULSE_ANALYTICS_SUMMARY.autonomic=t,t}}catch{}return ne()}function K(e,t,o){if(!(!e||typeof e!="object")){typeof window<"u"&&((!window.PULSE_ANALYTICS_SUMMARY||typeof window.PULSE_ANALYTICS_SUMMARY!="object")&&(window.PULSE_ANALYTICS_SUMMARY={}),window.PULSE_ANALYTICS_SUMMARY.autonomic=e,o&&(window.PULSE_ANALYTICS_SUMMARY.flex_refeed=o));try{localStorage.setItem(z,JSON.stringify(e)),window.PULSE_ANALYTICS_SUMMARY&&localStorage.setItem("pulse_analytics_summary_cache",JSON.stringify(window.PULSE_ANALYTICS_SUMMARY))}catch{}if(t&&typeof applyLiveStateToDom=="function"&&applyLiveStateToDom(t),P(),typeof renderTodayTrainingRecommendations=="function")try{renderTodayTrainingRecommendations()}catch{}if(typeof renderFlexRefeedCard=="function"&&window.PULSE_ANALYTICS_SUMMARY)try{renderFlexRefeedCard(window.PULSE_ANALYTICS_SUMMARY)}catch{}if(typeof renderPostRefeedScaleShield=="function"&&window.PULSE_ANALYTICS_SUMMARY)try{renderPostRefeedScaleShield(window.PULSE_ANALYTICS_SUMMARY)}catch{}}}function ae(e){if(!e){E=null;return}E!==e.id&&(E=e.id,T=new Set(Array.isArray(e.symptoms)?e.symptoms:[]),L=new Set(Array.isArray(e.triggers)?e.triggers:[]),M=e.severity||"moderate",O=e.notes||"")}function N(){C&&(clearInterval(C),C=null)}function X(){const t=y().active_episode,o=typeof document<"u"?document.getElementById("autonomicModal"):null,s=!!(o&&o.classList&&o.classList.contains("open"));t&&(t.state==="ACUTE_EPISODE"||t.state==="POST_EPISODE_RECOVERY")?!C&&(s||t.state==="ACUTE_EPISODE")&&(C=setInterval(()=>{const i=y().active_episode;if(!i){N();return}const n=document.getElementById("autonomicLiveTimerDigits");n&&(n.innerText=B(i.onset_time));const r=document.getElementById("autonomicQuickEpisodeLabel");r&&(r.innerText=`Turn Active (${B(i.onset_time)})`)},1e3)):N()}function le(e){const t=document.getElementById("autonomicPillDot"),o=document.getElementById("autonomicPillText");if(!t||!o)return;const s=e.active_episode,a=e.illness||{},i=Number(e.alert_level||0);t.className="pill-dot",s&&s.state==="ACUTE_EPISODE"?(t.classList.add("red"),o.innerText="Turn Active"):s&&s.state==="POST_EPISODE_RECOVERY"?(t.classList.add("amber"),o.innerText="Recovering"):i>=2?(t.classList.add("red"),o.innerText="Level 2 Alert"):i===1?(t.classList.add("amber"),o.innerText="Level 1 Alert"):a.active_today?(t.classList.add("violet"),o.innerText="Sick Mode"):(t.classList.add("teal"),o.innerText="Calm")}function ce(e){const t=document.getElementById("autonomicSafetyBanner"),o=document.getElementById("autonomicSpikeBanner"),s=document.getElementById("illnessStatusBannerToday"),a=document.getElementById("autonomicQuickBar"),i=e.safety_banner||{},n=e.active_episode,r=e.illness||{};if(t)if(i.active){const c=i.tone==="red"?"tone-red":"tone-amber",v=Array.isArray(i.reasons)?i.reasons:[],m=n?`
            <button type="button" class="autonomic-tap-btn ${n.state==="ACUTE_EPISODE"?"is-acute":"is-recovery"}" onclick="openAutonomicModal('capture')">\u23F1 Open Episode Tracker</button>
            <button type="button" class="autonomic-tap-btn is-calm" onclick="endEpisodeNow('${l(n.id)}')">\u23F9 End Episode Now</button>
          `:'<button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow()">\u26A1 Log Funny Turn Now (1-Tap)</button>';t.style.display="block",t.innerHTML=`
          <div class="autonomic-safety-banner ${c}" role="alert" aria-live="polite">
            <div class="autonomic-safety-title">
              <span>${i.level>=2?"\u{1F6A8}":"\u26A0\uFE0F"} ${l(i.title||"Autonomic Safety Alert")}</span>
              <span class="autonomic-risk-pill">${i.level>=2?"LEVEL 2":"LEVEL 1"}</span>
            </div>
            ${v.length?`<div class="autonomic-safety-copy">${v.map(u=>`\u2022 ${l(u)}`).join("<br>")}</div>`:""}
            <div class="autonomic-safety-copy"><strong>Do Not Drive (Volkswagen ID. Buzz) or train solo high-risk</strong> until autonomic metrics normalize and symptoms clear.</div>
            <div class="autonomic-safety-actions">
              ${m}
            </div>
          </div>
        `}else t.style.display="none",t.innerHTML="";const d=e.acute_spike;if(o&&(d&&d.detected&&(!n||n.state!=="ACUTE_EPISODE")?(o.style.display="block",o.innerHTML=`
          <div class="autonomic-spike-banner" role="alert">
            <div class="autonomic-safety-title">
              <span>\u{1F4C8} Unprovoked Biometric Spike Detected</span>
              <span>${l(A(d.spike_time))}</span>
            </div>
            <div class="autonomic-safety-copy">${l(d.reason||"Garmin detected sudden stress or HR deviation outside workouts.")} Are you having a funny turn?</div>
            <div class="autonomic-safety-actions" style="display:grid; grid-template-columns:2fr 1fr; gap:8px;">
              <button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow(${Number(d.spike_ts_ms)||0}, true)">\u26A1 Yes \u2014 Capture Episode</button>
              <button type="button" class="autonomic-tap-btn is-outline" onclick="dismissAutonomicSpike(${Number(d.spike_ts_ms)||0})">Dismiss</button>
            </div>
          </div>
        `):(o.style.display="none",o.innerHTML="")),s)if(r.active_today){const c=r.today_log||{};s.style.display="block",s.innerHTML=`
          <div class="illness-today-banner">
            <div class="autonomic-safety-title">
              <span>\u{1F912} Illness Recovery Mode Active (Day ${Math.max(1,Number(r.current_streak_days||1))})</span>
              <span>${l(String(c.severity||"moderate").toUpperCase())}</span>
            </div>
            <div class="autonomic-safety-copy">Maintenance Fuel &amp; Rest Mode active \u2022 Protein locked \u2022 Sick days excluded from 14d Adaptive TDEE.</div>
            <div class="autonomic-safety-actions">
              <button type="button" class="autonomic-tap-btn is-illness" onclick="openAutonomicModal('illness')">Manage Sick Log &amp; Backdate Days</button>
            </div>
          </div>
        `}else r.post_illness_ramp_active?(s.style.display="block",s.innerHTML=`
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
        `):(s.style.display="none",s.innerHTML="");if(a){const c=!!(n&&(n.state==="ACUTE_EPISODE"||n.state==="POST_EPISODE_RECOVERY")),v=c?n.state==="ACUTE_EPISODE"?`Turn Active (${B(n.onset_time)})`:"Recovery Check-In":"Log Funny Turn",m=r.active_today?`Sick Mode (Day ${Math.max(1,Number(r.current_streak_days||1))})`:"Log Sick Day";a.innerHTML=`
        <button type="button" class="autonomic-quick-btn ${c?"is-acute":""}" onclick="openAutonomicModal('capture')">
          <span>${c?"\u23F1":"\u26A1"}</span>
          <span id="autonomicQuickEpisodeLabel">${l(v)}</span>
        </button>
        <button type="button" class="autonomic-quick-btn ${r.active_today?"is-illness":""}" onclick="openAutonomicModal('illness')">
          <span>\u{1F912}</span>
          <span>${l(m)}</span>
        </button>
      `}}function re(e){const t=document.getElementById("autonomicBodySummaryCard");if(!t)return;const o=e.patterns||{},s=o.prodromal_risk||{level:"low",label:"Low Baseline",score:0,drivers:[]},a=e.level1||{},i=e.level2||{},n=o.total_recovery_stats||{},r=s.level==="high"?"risk-high":s.level==="elevated"?"risk-elevated":"risk-low";t.style.display="block",t.innerHTML=`
      <div class="autonomic-risk-card ${r}">
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
            <div class="autonomic-stat-val">${n.avg!==null&&n.avg!==void 0?`${Math.round(Number(n.avg))}m`:"--"}</div>
          </div>
          <div class="autonomic-stat-box">
            <div class="autonomic-stat-label">4h Stress Streak</div>
            <div class="autonomic-stat-val">${Number(i.max_streak_mins||0)}m</div>
          </div>
        </div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:6px;">
          Sleep Stress Avg: <strong>${a.sleep_avg_stress!=null?a.sleep_avg_stress:"--"}</strong> \u2022 HRV Night: <strong>${a.hrv_last_night!=null?`${a.hrv_last_night}ms`:"--"}</strong> (7d Base: ${a.hrv_7d_baseline!=null?`${a.hrv_7d_baseline}ms`:"--"})
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
          <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('patterns')">\u{1F4CA} Patterns &amp; Risk</button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="openAutonomicModal('export')">\u{1FA7A} Clinical Export</button>
        </div>
      </div>
    `}function x(e){const t=document.getElementById("autonomicViewCapture");if(!t)return;const o=e.active_episode,s=Array.isArray(e.symptom_catalog)&&e.symptom_catalog.length?e.symptom_catalog:q,a=Array.isArray(e.trigger_catalog)&&e.trigger_catalog.length?e.trigger_catalog:Q;if(o&&(o.state==="ACUTE_EPISODE"||o.state==="POST_EPISODE_RECOVERY")){ae(o);const d=o.state==="ACUTE_EPISODE",c=!!o.user_recovered_at,v=!!o.biometric_recovered_at,m=d?`
          <button type="button" class="autonomic-tap-btn is-recovery" onclick="updateActiveEpisode('mark_acute_end')">
            \u23F8 Acute Peak Ended (Start Recovery Timer)
          </button>
          <button type="button" class="autonomic-tap-btn is-calm" onclick="updateActiveEpisode('confirm_resolved_override')">
            \u23F9 End &amp; Close Episode Now
          </button>
        `:`
          ${c?`<div class="autonomic-safety-copy" style="width:100%;">\u2713 Marked normal (${l(A(o.user_recovered_at))}) \u2014 waiting for Garmin stress \u226425, or close immediately below:</div>`:`<button type="button" class="autonomic-tap-btn is-recovery" onclick="updateActiveEpisode('mark_user_recovered')">\u2713 I Feel Normal (Wait for Garmin Stress \u226425)</button>`}
          <button type="button" class="autonomic-tap-btn is-calm" onclick="updateActiveEpisode('confirm_resolved_override')">
            \u23F9 End &amp; Close Episode Now
          </button>
        `;t.innerHTML=`
        <div class="autonomic-timer-hero">
          <div style="font-size:12px; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; color:var(--text-secondary);">
            ${d?"ACUTE EPISODE IN PROGRESS":"POST-EPISODE RECOVERY TIMER"}
          </div>
          <div id="autonomicLiveTimerDigits" class="autonomic-timer-digits">${l(B(o.onset_time))}</div>
          <div style="font-size:12px; color:var(--text-secondary);">Started ${l(A(o.onset_time))}</div>

          <div class="autonomic-hybrid-status-row">
            <div class="autonomic-hybrid-badge ${d?"":"is-done"}">
              ${d?"\u23F3":"\u2713"} Acute Ended${o.acute_duration_mins!=null?` (${o.acute_duration_mins}m)`:""}
            </div>
            <div class="autonomic-hybrid-badge ${c?"is-done":""}">
              ${c?"\u2713":"\u25CB"} Feel Normal
            </div>
            <div class="autonomic-hybrid-badge ${v?"is-done":""}">
              ${v?"\u2713":"\u25CB"} Garmin Stress \u226425
            </div>
          </div>

          <div class="autonomic-safety-actions is-stacked" style="margin-top:10px;">
            ${m}
          </div>
        </div>

        <div class="autonomic-safety-banner tone-amber" style="margin-top:10px;">
          <div class="autonomic-safety-copy"><strong>Do NOT drive (Volkswagen ID. Buzz)</strong> or perform solo high-risk exertion until full recovery completes.</div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Severity</label>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            ${["mild","moderate","severe"].map(u=>`
              <button type="button" class="autonomic-chip ${M===u?"is-selected":""}" onclick="setActiveDraftSeverity('${u}')">
                <span class="autonomic-chip-check">${M===u?"\u2713":""}</span>
                <span>${u.toUpperCase()}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Symptoms Experienced (Tap All That Apply)</label>
          <div class="autonomic-chip-grid">
            ${s.map(u=>{const _=T.has(u.key);return`
                <button type="button" class="autonomic-chip ${_?"is-selected":""}" onclick="toggleEpisodeDraftSymptom('${l(u.key)}')">
                  <span class="autonomic-chip-check">${_?"\u2713":""}</span>
                  <span>${l(u.label)}</span>
                </button>
              `}).join("")}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label">Context &amp; Triggers</label>
          <div class="autonomic-chip-grid">
            ${a.map(u=>{const _=L.has(u.key);return`
                <button type="button" class="autonomic-chip ${_?"is-selected":""}" onclick="toggleEpisodeDraftTrigger('${l(u.key)}')">
                  <span class="autonomic-chip-check">${_?"\u2713":""}</span>
                  <span>${l(u.label)}</span>
                </button>
              `}).join("")}
          </div>
        </div>

        <div style="margin-top:12px;">
          <label class="autonomic-label" for="epDraftNotesInput">Notes (Optional)</label>
          <textarea id="epDraftNotesInput" class="autonomic-input" rows="2" placeholder="What happened right before, posture, food, warning aura..." oninput="setActiveDraftNotes(this.value)">${l(O)}</textarea>
        </div>

        <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="autonomic-tap-btn is-calm" onclick="saveActiveEpisodeDetails()">\u2713 Save Symptoms &amp; Notes</button>
          <button type="button" class="autonomic-tap-btn is-danger-ghost" onclick="deleteLoggedEpisode('${l(o.id)}')">\u{1F5D1}\uFE0F Delete / Discard This Episode</button>
        </div>
      `;return}const n=(e.illness||{}).active_today?'<div class="autonomic-safety-copy" style="margin-top:6px;">\u{1F912} Active illness will automatically link to any logged episode today.</div>':"",r=(Array.isArray(e.recent_episodes)?e.recent_episodes:[]).slice(0,5);t.innerHTML=`
      <div class="autonomic-risk-card risk-low" style="text-align:left;">
        <div class="autonomic-safety-title">
          <span>\u26A1 Immediate Capture</span>
          <span>1-Tap</span>
        </div>
        <div class="autonomic-safety-copy">Experiencing dizziness, presyncope, dissociation, visual shift, or dread? Tap once to timestamp onset immediately; fill in symptoms once clear.</div>
        ${n}
        <div style="margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-acute" onclick="startAcuteEpisodeNow()">
            \u26A1 I'm Having a Funny Turn Now
          </button>
        </div>
      </div>

      <div style="margin-top:12px;">
        <button type="button" class="autonomic-tap-btn is-outline" onclick="toggleBackdateEpisodeForm()">
          ${R?"\u25B2 Hide Past / Backdated Episode Form":"\u{1F552} Log Past / Backdated Funny Turn"}
        </button>
      </div>

      ${R?`
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
                ${s.map(d=>{const c=I.has(d.key);return`
                    <button type="button" class="autonomic-chip ${c?"is-selected":""}" onclick="toggleBackdateSymptom('${l(d.key)}')">
                      <span class="autonomic-chip-check">${c?"\u2713":""}</span>
                      <span>${l(d.label)}</span>
                    </button>
                  `}).join("")}
              </div>
            </div>
            <div>
              <label class="autonomic-label">Triggers / Context</label>
              <div class="autonomic-chip-grid">
                ${a.map(d=>{const c=D.has(d.key);return`
                    <button type="button" class="autonomic-chip ${c?"is-selected":""}" onclick="toggleBackdateTrigger('${l(d.key)}')">
                      <span class="autonomic-chip-check">${c?"\u2713":""}</span>
                      <span>${l(d.label)}</span>
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

      ${r.length?`
        <div style="margin-top:14px;">
          <label class="autonomic-label">Recent Logged Episodes (${r.length})</label>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${r.map(d=>`
              <div class="autonomic-episode-card">
                <div class="autonomic-episode-head">
                  <div>
                    <strong style="font-size:13px; color:var(--text);">${l(A(d.onset_time))}</strong>
                    <div style="font-size:11px; color:var(--text-secondary);">
                      ${l(d.state)} \u2022 ${l(String(d.severity||"moderate").toUpperCase())}
                      ${d.total_recovery_duration_mins!=null?` \u2022 ${d.total_recovery_duration_mins}m`:""}
                    </div>
                  </div>
                  <div class="autonomic-ep-actions">
                    ${d.state!=="RESOLVED"?`<button type="button" class="autonomic-mini-btn is-calm" onclick="endEpisodeNow('${l(d.id)}')">\u23F9 End Now</button>`:""}
                    <button type="button" class="autonomic-mini-btn is-danger" onclick="deleteLoggedEpisode('${l(d.id)}')">\u{1F5D1}\uFE0F Delete</button>
                  </div>
                </div>
              </div>
            `).join("")}
          </div>
        </div>
      `:""}
    `}function Y(e){const t=document.getElementById("autonomicViewIllness");if(!t)return;const o=e.illness||{},s=Array.isArray(o.recent_logs)?o.recent_logs:[],a={};s.forEach(c=>{c&&c.date_str&&(a[c.date_str]=c)});const i=$();g||(g=i);const n=a[g]||null;n&&f.size===0&&!h&&(b=n.severity||"moderate",h=n.notes||"",f=new Set(Array.isArray(n.symptoms)?n.symptoms:[]));const r=[];for(let c=6;c>=0;c--)r.push(J(c));const d=Array.isArray(e.illness_symptom_catalog)&&e.illness_symptom_catalog.length?e.illness_symptom_catalog:W;t.innerHTML=`
      <div class="illness-today-banner">
        <div class="autonomic-safety-title">
          <span>\u{1F912} Illness &amp; Sick-Day Mode</span>
          <span>${o.active_today?`Active (Day ${Math.max(1,Number(o.current_streak_days||1))})`:"Not Sick Today"}</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">
          Logging illness days shifts today's Fuel to <strong>Maintenance (Protein Locked)</strong>, swaps training to <strong>Rest</strong>, excludes sick days (+1d rebound) from <strong>14d Adaptive TDEE</strong>, activates a <strong>48h Recovery Scale Shield</strong> after clearing, and links illness to episode patterns.
        </div>
        <div style="margin-top:10px; display:flex; gap:8px;">
          ${o.active_today?`<button type="button" class="autonomic-tap-btn is-calm" onclick="saveIllnessLog('${i}', 'clear')">\u2713 I'm Better Today (Clear Today)</button>`:`<button type="button" class="autonomic-tap-btn is-illness" onclick="saveIllnessLog('${i}', 'active')">\u{1F912} Mark Today as Sick</button>`}
        </div>
      </div>

      <div style="margin-top:12px;">
        <label class="autonomic-label">Quick Backdate / Toggle Recent Days (e.g. Mon / Tue / Wed)</label>
        <div class="autonomic-day-strip">
          ${r.map(c=>{const v=!!a[c];return`
              <button type="button" class="autonomic-day-chip ${v?"is-sick":""} ${g===c?"is-selected":""}" onclick="selectIllnessDate('${c}')">
                <span>${l(ie(c))}</span>
                <span>${v?"\u{1F912} Sick":"Clear"}</span>
              </button>
            `}).join("")}
        </div>
      </div>

      <div class="autonomic-episode-card" style="margin-top:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <div>
            <strong style="font-size:13px; color:var(--text);">Selected Date: ${l(g)}</strong>
            <div style="font-size:11.5px; color:var(--text-secondary);">${n?`Currently Logged (${l(n.severity)})`:"Not marked as ill"}</div>
          </div>
          <input type="date" id="illnessDateInput" class="autonomic-input" style="width:auto;" max="${i}" value="${l(g)}" onchange="selectIllnessDate(this.value)">
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label">Illness Severity</label>
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
            ${["mild","moderate","severe"].map(c=>`
              <button type="button" class="autonomic-chip ${b===c?"is-selected":""}" onclick="setIllnessSeverity('${c}')">
                <span class="autonomic-chip-check">${b===c?"\u2713":""}</span>
                <span>${c.toUpperCase()}</span>
              </button>
            `).join("")}
          </div>
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label">Symptoms</label>
          <div class="autonomic-chip-grid">
            ${d.map(c=>{const v=f.has(c.key);return`
                <button type="button" class="autonomic-chip ${v?"is-selected":""}" onclick="toggleIllnessSymptom('${l(c.key)}')">
                  <span class="autonomic-chip-check">${v?"\u2713":""}</span>
                  <span>${l(c.label)}</span>
                </button>
              `}).join("")}
          </div>
        </div>

        <div style="margin-top:10px;">
          <label class="autonomic-label" for="illnessNotesInput">Notes (Cravings, Fever, Recovery)</label>
          <textarea id="illnessNotesInput" class="autonomic-input" rows="2" placeholder="e.g. Viral malaise, strong cravings, resting..." oninput="setIllnessNotes(this.value)">${l(h)}</textarea>
        </div>

        <div style="display:grid; grid-template-columns:2fr 1fr; gap:8px; margin-top:10px;">
          <button type="button" class="autonomic-tap-btn is-illness" onclick="saveIllnessLog('${l(g)}', 'active')">\u2713 Save Sick Day</button>
          <button type="button" class="autonomic-tap-btn is-outline" onclick="saveIllnessLog('${l(g)}', 'clear')">Clear Day</button>
        </div>
      </div>
    `}function de(e,t){return!Array.isArray(e)||e.length===0?'<div style="font-size:11px; color:var(--text-secondary);">Waiting for Garmin watch sync...</div>':`<div class="autonomic-spark-row">${e.slice(0,32).map(s=>{const a=Number(s.v||0),i=Math.max(12,Math.min(100,Math.round(a/t*100)));return`<div class="autonomic-spark-bar ${a>=75?"is-high":a>25?"is-mid":"is-low"}" style="height:${i}%;" title="${l(`${s.offset_m}m: ${a}`)}"></div>`}).join("")}</div>`}function pe(e){const t=document.getElementById("autonomicViewPatterns");if(!t)return;const o=e.patterns||{},s=o.prodromal_risk||{level:"low",label:"Low Baseline",score:0,drivers:[]},a=Array.isArray(s.drivers)?s.drivers:[],i=e.level1||{},n=e.level2||{},r=o.acute_duration_stats||{},d=o.total_recovery_stats||{},c=Array.isArray(o.top_symptoms)?o.top_symptoms:[],v=Array.isArray(o.top_triggers)?o.top_triggers:[],m=o.prodrome_comparison||{},u=Array.isArray(e.recent_episodes)?e.recent_episodes:[],_=s.level==="high"?"risk-high":s.level==="elevated"?"risk-elevated":"risk-low";t.innerHTML=`
      <div class="autonomic-risk-card ${_}">
        <div class="autonomic-safety-title">
          <span>\u{1F3AF} Heading Toward Episode Risk</span>
          <span class="autonomic-risk-pill">${l(String(s.level||"low").toUpperCase())} (${Number(s.score||0)}/100)</span>
        </div>
        <div class="autonomic-safety-copy" style="margin-top:4px;">${l(s.label||"")}</div>
        ${a.length?`
          <div class="autonomic-driver-list">
            ${a.map(p=>`<div class="autonomic-driver-item">\u2022 ${l(p)}</div>`).join("")}
          </div>
        `:'<div class="autonomic-driver-item" style="margin-top:6px;">No active prodromal red flags detected on current telemetry.</div>'}
      </div>

      <div class="autonomic-stat-grid cols-3" style="margin-top:10px;">
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Sleep Stress</div>
          <div class="autonomic-stat-val">${i.sleep_avg_stress!=null?i.sleep_avg_stress:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Rest \u226425</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Overnight HRV</div>
          <div class="autonomic-stat-val">${i.hrv_last_night!=null?`${i.hrv_last_night}ms`:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">7d: ${i.hrv_7d_baseline!=null?`${i.hrv_7d_baseline}ms`:"--"}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Day &gt;25 Streak</div>
          <div class="autonomic-stat-val">${Number(n.max_streak_mins||0)}m</div>
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
          <div class="autonomic-stat-val">${r.avg!=null?`${Math.round(Number(r.avg))}m`:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Med: ${r.median!=null?`${Math.round(Number(r.median))}m`:"--"}</div>
        </div>
        <div class="autonomic-stat-box">
          <div class="autonomic-stat-label">Avg Full Lag</div>
          <div class="autonomic-stat-val">${d.avg!=null?`${Math.round(Number(d.avg))}m`:"--"}</div>
          <div style="font-size:10px; color:var(--text-secondary);">Med: ${d.median!=null?`${Math.round(Number(d.median))}m`:"--"}</div>
        </div>
      </div>

      <div class="autonomic-episode-card" style="margin-top:10px;">
        <div style="font-size:12px; font-weight:800; color:var(--text);">Pre-Episode vs Normal Day Biometrics</div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px; line-height:1.5;">
          Prior-Night HRV: Ep days <strong>${m.episode_days_avg_hrv!=null?`${m.episode_days_avg_hrv}ms`:"--"}</strong> vs Baseline <strong>${m.baseline_days_avg_hrv!=null?`${m.baseline_days_avg_hrv}ms`:"--"}</strong><br>
          Sleep Stress Avg: Ep days <strong>${m.episode_days_avg_sleep_stress!=null?m.episode_days_avg_sleep_stress:"--"}</strong> vs Baseline <strong>${m.baseline_days_avg_sleep_stress!=null?m.baseline_days_avg_sleep_stress:"--"}</strong><br>
          Illness Co-Occurrence: <strong>${Number(o.illness_co_occurrence_pct||0)}%</strong> of episodes overlapped sick days
        </div>
      </div>

      ${c.length||v.length?`
        <div class="autonomic-stat-grid cols-2" style="margin-top:10px;">
          <div class="autonomic-episode-card">
            <div style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:4px;">Top Symptoms</div>
            ${c.slice(0,5).map(p=>`<div style="font-size:11.5px; color:var(--text-secondary);">\u2022 ${l(p.label)} (${p.count}, ${p.pct}%)</div>`).join("")||'<div style="font-size:11.5px; color:var(--text-secondary);">None logged yet</div>'}
          </div>
          <div class="autonomic-episode-card">
            <div style="font-size:12px; font-weight:800; color:var(--text); margin-bottom:4px;">Top Triggers</div>
            ${v.slice(0,5).map(p=>`<div style="font-size:11.5px; color:var(--text-secondary);">\u2022 ${l(p.label)} (${p.count}, ${p.pct}%)</div>`).join("")||'<div style="font-size:11.5px; color:var(--text-secondary);">None logged yet</div>'}
          </div>
        </div>
      `:""}

      <div style="margin-top:12px;">
        <label class="autonomic-label">Episode Timeline &amp; \xB160m Garmin Snapshots (${u.length})</label>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${u.length?u.map(p=>{const S=p.biometric_snapshot||{},j=S.stress||{},oe=S.hr||{};return`
              <div class="autonomic-episode-card">
                <div class="autonomic-episode-head">
                  <div>
                    <strong style="font-size:13px; color:var(--text);">${l(A(p.onset_time))}</strong>
                    <div style="font-size:11px; color:var(--text-secondary);">
                      ${l(p.state)} \u2022 ${l(String(p.severity||"moderate").toUpperCase())}
                      ${p.acute_duration_mins!=null?` \u2022 Peak ${p.acute_duration_mins}m`:""}
                      ${p.total_recovery_duration_mins!=null?` \u2022 Recovery ${p.total_recovery_duration_mins}m`:""}
                      ${p.illness_active?" \u2022 \u{1F912} Sick":""}
                    </div>
                  </div>
                  <div class="autonomic-ep-actions">
                    ${p.state!=="RESOLVED"?`<button type="button" class="autonomic-mini-btn is-calm" onclick="endEpisodeNow('${l(p.id)}')">\u23F9 End Now</button>`:""}
                    <button type="button" class="autonomic-mini-btn is-danger" onclick="deleteLoggedEpisode('${l(p.id)}')">\u{1F5D1}\uFE0F Delete</button>
                  </div>
                </div>
                <div class="autonomic-tag-list" style="margin-top:6px;">
                  ${(p.symptoms||[]).map(G=>`<span class="autonomic-tag">${l(G.replace(/_/g," "))}</span>`).join("")}
                  ${(p.triggers||[]).map(G=>`<span class="autonomic-tag">${l(G.replace(/_/g," "))}</span>`).join("")}
                </div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:6px;">
                  Snapshot (${l(p.biometric_snapshot_status||"pending")}): Peak Stress <strong>${j.peak!=null?j.peak:"--"}</strong> \u2022 Peak HR <strong>${oe.peak!=null?`${oe.peak} bpm`:"--"}</strong> \u2022 Prior HRV <strong>${S.prior_night_hrv!=null?`${S.prior_night_hrv}ms`:"--"}</strong>
                </div>
                ${de(j.series,100)}
                ${p.notes?`<div style="font-size:11.5px; color:var(--text); margin-top:5px;">"${l(p.notes)}"</div>`:""}
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
          ${o.map(a=>`
            <div class="autonomic-episode-card">
              <strong style="font-size:12.5px; color:var(--text);">${l(a.label)}</strong>
              <div style="font-size:11.5px; color:var(--text-secondary); margin-top:3px;">${l(a.summary)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `}function P(e){if(e&&e.autonomic&&typeof window<"u"){(!window.PULSE_ANALYTICS_SUMMARY||typeof window.PULSE_ANALYTICS_SUMMARY!="object")&&(window.PULSE_ANALYTICS_SUMMARY={}),window.PULSE_ANALYTICS_SUMMARY.autonomic=e.autonomic;try{localStorage.setItem(z,JSON.stringify(e.autonomic))}catch{}}const t=y();le(t),ce(t),re(t),w==="capture"?x(t):w==="illness"?Y(t):w==="patterns"?pe(t):w==="export"&&ue(t),X()}function V(e){const t=["capture","illness","patterns","export"];w=t.includes(e)?e:"capture",t.forEach(o=>{const s=document.getElementById(`btnAutonomicView_${o}`),a=document.getElementById(`autonomicView${o.charAt(0).toUpperCase()}${o.slice(1)}`);s&&s.classList&&s.classList.toggle("active",o===w),a&&a.classList&&a.classList.toggle("active",o===w)}),P()}function Z(e){const t=document.getElementById("autonomicModal");t&&t.classList&&t.classList.add("open"),e?V(e):P(),typeof pulseHaptic=="function"&&pulseHaptic(20)}function me(){const e=document.getElementById("autonomicModal");e&&e.classList&&e.classList.remove("open"),X()}function U(){return new Date().toISOString()}async function k(e,t,o){let s=!1;try{const i=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)(e,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(t),timeoutMs:6e3});if(i&&i.ok){const n=await i.json();return n&&n.autonomic&&K(n.autonomic,n.state||null,n.flex_refeed||null),n}typeof window._shouldQueueOfflineResponse=="function"?s=window._shouldQueueOfflineResponse(i):s=!i||i.status===0||i.status>=500||i.status===401}catch{s=!0}if(s){if(typeof window.enqueueOfflineWrite=="function"&&window.enqueueOfflineWrite(e,t,"POST"),typeof o=="function"){const a=JSON.parse(JSON.stringify(y()));o(a),K(a,null,null)}typeof showToast=="function"&&showToast("Saved locally offline \u2014 will sync automatically when online")}return null}async function ve(e=0,t=!1){if(!F){F=!0;try{const o=Date.now(),s=e&&Number(e)>0?new Date(Number(e)).toISOString():U(),a=`ep_${o}_${Math.random().toString(36).slice(2,8)}`,i=`evt_${o}_${Math.random().toString(36).slice(2,8)}`;await k("/api/health/episodes",{id:a,onset_time:s,severity:"moderate",symptoms:[],triggers:[],spike_auto_detected:!!t,client_event_id:i},r=>{const d={id:a,client_event_id:i,state:"ACUTE_EPISODE",onset_time:s,date_str:$(),acute_peak_end_time:null,full_recovery_time:null,user_recovered_at:null,biometric_recovered_at:null,severity:"moderate",symptoms:[],triggers:r.illness&&r.illness.active_today?["illness_infection"]:[],illness_active:!!(r.illness&&r.illness.active_today),notes:"",biometric_snapshot_status:"pending"};r.active_episode=d,r.system_state="ACUTE_EPISODE",r.alert_level=2,r.safety_banner={active:!0,level:2,tone:"red",title:"ACTIVE EPISODE TRACKING",reasons:["Acute episode capture started (offline queue active)"],advisory:"Avoid driving (Volkswagen ID. Buzz) or solo exertion until recovered.",avoid_driving:!0,avoid_solo_exertion:!0},r.recent_episodes=[d].concat(r.recent_episodes||[])}),E=null,Z("capture"),typeof showToast=="function"&&showToast("\u26A1 Episode capture started \u2014 rest safely")}finally{F=!1}}}async function ee(e){const o=y().active_episode;if(!o)return;const s=U(),a={id:o.id,client_event_id:o.client_event_id||void 0,action:e,timestamp:s,symptoms:Array.from(T),triggers:Array.from(L),severity:M,notes:O};await k("/api/health/episodes/update",a,i=>{const n=i.active_episode;n&&(n.symptoms=a.symptoms,n.triggers=a.triggers,n.severity=a.severity,n.notes=a.notes,e==="mark_acute_end"?(n.acute_peak_end_time=s,n.state="POST_EPISODE_RECOVERY",i.system_state="POST_EPISODE_RECOVERY"):e==="mark_user_recovered"?(n.user_recovered_at=s,n.acute_peak_end_time||(n.acute_peak_end_time=s),n.state="POST_EPISODE_RECOVERY",i.system_state="POST_EPISODE_RECOVERY"):e==="confirm_resolved_override"&&(n.acute_peak_end_time||(n.acute_peak_end_time=s),n.user_recovered_at=n.user_recovered_at||s,n.full_recovery_time=s,n.state="RESOLVED",i.active_episode=null,i.system_state=i.level1&&i.level1.active||i.level2&&i.level2.active?"VULNERABILITY_ALERT":"IDLE",i.safety_banner.active=i.system_state==="VULNERABILITY_ALERT"),i.recent_episodes=(i.recent_episodes||[]).map(r=>r.id===n.id?n:r))}),e==="confirm_resolved_override"?(E=null,N(),typeof showToast=="function"&&showToast("\u2713 Episode ended & resolved")):e==="mark_acute_end"?typeof showToast=="function"&&showToast("\u2713 Acute peak marked ended \u2014 recovery timer active"):e==="mark_user_recovered"&&typeof showToast=="function"&&showToast("\u2713 Feeling normal logged \u2014 tap End & Close Episode Now to finish immediately")}async function ye(e){const t=y(),o=e||t.active_episode&&t.active_episode.id;if(!o)return;const s=U();await k("/api/health/episodes/update",{id:o,action:"confirm_resolved_override",timestamp:s},i=>{i.active_episode&&i.active_episode.id===o&&(i.active_episode=null,i.system_state=i.level1&&i.level1.active||i.level2&&i.level2.active?"VULNERABILITY_ALERT":"IDLE",i.safety_banner.active=i.system_state==="VULNERABILITY_ALERT"),i.recent_episodes=(i.recent_episodes||[]).map(n=>n.id!==o?n:{...n,acute_peak_end_time:n.acute_peak_end_time||s,user_recovered_at:n.user_recovered_at||s,full_recovery_time:s,state:"RESOLVED"})}),E=null,N(),typeof showToast=="function"&&showToast("\u2713 Episode ended & resolved")}function ge(){return ee("edit_details").then(()=>{typeof showToast=="function"&&showToast("\u2713 Episode symptoms & triggers saved")})}function _e(e){T.has(e)?T.delete(e):T.add(e),x(y())}function fe(e){L.has(e)?L.delete(e):L.add(e),x(y())}function be(e){M=e,x(y())}function he(e){O=String(e||"")}function Se(){R=!R,x(y())}function we(e){I.has(e)?I.delete(e):I.add(e),x(y())}function Ee(e){D.has(e)?D.delete(e):D.add(e),x(y())}async function $e(){const e=(document.getElementById("bdOnsetTime")||{}).value,t=Math.max(0,Number((document.getElementById("bdAcuteMins")||{}).value||0)),o=Math.max(0,Number((document.getElementById("bdRecoveryMins")||{}).value||0)),s=(document.getElementById("bdSeverity")||{}).value||"moderate",a=(document.getElementById("bdNotes")||{}).value||"",i=e?new Date(e):new Date,n=Number.isFinite(i.getTime())?i.getTime():Date.now(),r=t>0?new Date(n+t*6e4).toISOString():null,d=o>0?new Date(n+o*6e4).toISOString():null,c=Date.now(),m={id:`ep_${c}_${Math.random().toString(36).slice(2,8)}`,onset_time:new Date(n).toISOString(),acute_peak_end_time:r,full_recovery_time:d,severity:s,symptoms:Array.from(I),triggers:Array.from(D),notes:a,client_event_id:`evt_${c}_${Math.random().toString(36).slice(2,8)}`};await k("/api/health/episodes",m,u=>{const _={...m,date_str:m.onset_time.slice(0,10),state:d?"RESOLVED":r?"POST_EPISODE_RECOVERY":"ACUTE_EPISODE",acute_duration_mins:t||null,total_recovery_duration_mins:o||null,biometric_snapshot_status:"pending"};u.recent_episodes=[_].concat(u.recent_episodes||[])}),R=!1,I.clear(),D.clear(),V("patterns"),typeof showToast=="function"&&showToast("\u2713 Past episode saved with Garmin snapshot")}async function Ae(e){e&&(await k("/api/health/episodes/delete",{id:e},t=>{t.recent_episodes=(t.recent_episodes||[]).filter(o=>o.id!==e),t.active_episode&&t.active_episode.id===e&&(t.active_episode=null,t.system_state=t.level1&&t.level1.active||t.level2&&t.level2.active?"VULNERABILITY_ALERT":"IDLE",t.safety_banner&&(t.safety_banner.active=t.system_state==="VULNERABILITY_ALERT"))}),E=null,N(),typeof showToast=="function"&&showToast("\u{1F5D1}\uFE0F Episode deleted"))}async function xe(e){await k("/api/health/autonomic/dismiss-spike",{spike_ts_ms:Number(e)||Date.now()},t=>{t.acute_spike=null})}function ke(e){g=String(e||$()).slice(0,10);const t=y(),s=(t.illness&&Array.isArray(t.illness.recent_logs)?t.illness.recent_logs:[]).find(a=>a.date_str===g);s?(b=s.severity||"moderate",h=s.notes||"",f=new Set(Array.isArray(s.symptoms)?s.symptoms:[])):(b="moderate",h="",f=new Set),Y(t)}function Te(e){b=e,Y(y())}function Le(e){f.has(e)?f.delete(e):f.add(e),Y(y())}function Ie(e){h=String(e||"")}async function De(e,t="active"){const o=String(e||g||$()).slice(0,10),s={date_str:o,status:t,severity:b,symptoms:Array.from(f),notes:h};if(await k("/api/health/illness",s,a=>{a.illness||(a.illness={active_today:!1,recent_logs:[]});const i=Array.isArray(a.illness.recent_logs)?a.illness.recent_logs.filter(n=>n.date_str!==o):[];t!=="clear"&&i.unshift({date_str:o,status:t,severity:b,symptoms:s.symptoms,notes:h}),a.illness.recent_logs=i,o===$()&&(a.illness.active_today=t!=="clear")}),typeof fetchAnalyticsSummary=="function")try{await fetchAnalyticsSummary(!0)}catch{}typeof showToast=="function"&&showToast(t==="clear"?`\u2713 Cleared sick log for ${o}`:`\u{1F912} Saved Sick Day (${o})`)}async function Ne(){try{const a=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)("/api/health/episodes/export?format=csv",{timeoutMs:8e3});if(a&&a.ok){const i=await a.text();H("pulse-clinical-episodes.csv",i,"text/csv;charset=utf-8"),typeof showToast=="function"&&showToast("\u2B07 Clinical CSV downloaded");return}}catch{}const e=y().recent_episodes||[],t=[["episode_id","date_uk","onset_time_uk","state","severity","acute_mins","recovery_mins","symptoms","triggers","notes"]];e.forEach(s=>{t.push([s.id,s.date_str,s.onset_time,s.state,s.severity,s.acute_duration_mins??"",s.total_recovery_duration_mins??"",(s.symptoms||[]).join("; "),(s.triggers||[]).join("; "),String(s.notes||"").replace(/"/g,'""')])});const o=t.map(s=>s.map(a=>`"${String(a??"").replace(/"/g,'""')}"`).join(",")).join(`
`);H("pulse-clinical-episodes-offline.csv",o,"text/csv;charset=utf-8"),typeof showToast=="function"&&showToast("\u2B07 Offline Clinical CSV downloaded")}function H(e,t,o){if(typeof document>"u"||typeof Blob>"u"||!URL||typeof URL.createObjectURL!="function")return;const s=new Blob([t],{type:o}),a=URL.createObjectURL(s),i=document.createElement("a");i.href=a,i.download=e,document.body.appendChild(i),i.click(),document.body.removeChild(i),setTimeout(()=>{try{URL.revokeObjectURL(a)}catch{}},1e3)}function te(e){const t=e||{},o=t.patterns||{},s=o.acute_duration_stats||{},a=o.total_recovery_stats||{},i=Array.isArray(t.episodes)?t.episodes:t.recent_episodes||[],n=Array.isArray(t.illness_logs)?t.illness_logs:t.illness&&t.illness.recent_logs||[],r=t.clinical_disclaimer||"Self-monitoring & Garmin biometric correlation record only. Non-diagnostic.",d=i.map(c=>{const v=c.biometric_snapshot||{},m=v.stress||{},u=v.hr||{},_=(c.symptoms||[]).map(S=>l(S.replace(/_/g," "))).join(", ")||"None recorded",p=(c.triggers||[]).map(S=>l(S.replace(/_/g," "))).join(", ")||"None recorded";return`
        <tr>
          <td><strong>${l(A(c.onset_time))}</strong><br><small>${l(c.severity||"moderate")}${c.illness_active?" \u2022 Sick day":""}</small></td>
          <td>Peak: ${c.acute_duration_mins!=null?`${c.acute_duration_mins}m`:"--"}<br>Full Rec: ${c.total_recovery_duration_mins!=null?`${c.total_recovery_duration_mins}m`:"--"}</td>
          <td>${_}</td>
          <td>${p}</td>
          <td>Stress: Pre ${m.pre_avg??"--"} / Peak ${m.peak??"--"} / Post ${m.post_avg??"--"}<br>HR: Pre ${u.pre_avg??"--"} / Peak ${u.peak??"--"} / Post ${u.post_avg??"--"} bpm<br>Prior HRV: ${v.prior_night_hrv??"--"}ms \u2022 Sleep Stress: ${v.prior_night_sleep_stress??"--"}</td>
          <td>${l(c.notes||"")}</td>
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
  <div class="meta">Generated: ${l(A(t.generated_at||U()))} \u2022 Review Context: GP / Neurology (Ambulatory EEG / MRI) / Cardiology (Holter / Tilt-Table)</div>
  <div class="disclaimer"><strong>Non-Diagnostic Scope:</strong> ${l(r)} Routine 20\u201340 min resting surface EEG was normal; differential tracking covers Autonomic Dysregulation, Paroxysmal Focal Neurological Signaling, Transient Perfusion/Orthostatic Shifts, and Metabolic/Fuel/Illness Load Triggers.</div>
  <div class="grid">
    <div class="box"><div class="lbl">Total Episodes</div><div class="val">${Number(o.total_episodes||i.length||0)}</div></div>
    <div class="box"><div class="lbl">Avg Acute Peak</div><div class="val">${s.avg!=null?`${Math.round(Number(s.avg))} min`:"--"}</div></div>
    <div class="box"><div class="lbl">Avg Full Recovery</div><div class="val">${a.avg!=null?`${Math.round(Number(a.avg))} min`:"--"}</div></div>
    <div class="box"><div class="lbl">Sick Days Logged</div><div class="val">${n.length}</div></div>
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
    <tbody>${d||'<tr><td colspan="6">No episodes recorded.</td></tr>'}</tbody>
  </table>
  ${n.length?`
    <h3 style="margin-top:18px;">Logged Illness / Intercurrent Infection Days</h3>
    <table>
      <thead><tr><th>Date</th><th>Status &amp; Severity</th><th>Symptoms</th><th>Notes</th></tr></thead>
      <tbody>${n.map(c=>`<tr><td>${l(c.date_str)}</td><td>${l(c.status)} (${l(c.severity)})</td><td>${l((c.symptoms||[]).join(", "))}</td><td>${l(c.notes||"")}</td></tr>`).join("")}</tbody>
    </table>
  `:""}
</body>
</html>`}async function Me(){let e=null;try{const s=await(typeof pulseApiFetch=="function"?pulseApiFetch:fetch)("/api/health/episodes/export?format=json",{timeoutMs:8e3});s&&s.ok&&(e=await s.json())}catch{}if(!e){const o=y();e={generated_at:U(),clinical_disclaimer:o.clinical_disclaimer,patterns:o.patterns,illness_logs:o.illness&&o.illness.recent_logs||[],episodes:o.recent_episodes||[]}}const t=te(e);if(typeof window<"u"&&typeof window.open=="function"){const o=window.open("","_blank","noopener");if(o&&o.document)return o.document.open(),o.document.write(t),o.document.close(),t}return H("pulse-clinical-report.html",t,"text/html;charset=utf-8"),t}typeof window<"u"&&(window.getAutonomicSummary=y,window.renderAutonomicUi=P,window.openAutonomicModal=Z,window.closeAutonomicModal=me,window.switchAutonomicView=V,window.startAcuteEpisodeNow=ve,window.endEpisodeNow=ye,window.updateActiveEpisode=ee,window.saveActiveEpisodeDetails=ge,window.toggleEpisodeDraftSymptom=_e,window.toggleEpisodeDraftTrigger=fe,window.setActiveDraftSeverity=be,window.setActiveDraftNotes=he,window.toggleBackdateEpisodeForm=Se,window.toggleBackdateSymptom=we,window.toggleBackdateTrigger=Ee,window.submitBackdatedEpisode=$e,window.deleteLoggedEpisode=Ae,window.dismissAutonomicSpike=xe,window.selectIllnessDate=ke,window.setIllnessSeverity=Te,window.toggleIllnessSymptom=Le,window.setIllnessNotes=Ie,window.saveIllnessLog=De,window.downloadAutonomicCsv=Ne,window.openClinicalReportPrintView=Me,window.buildClinicalReportHtml=te,window._stopAutonomicTimer=N),typeof document<"u"&&typeof document.addEventListener=="function"&&document.addEventListener("DOMContentLoaded",()=>{try{P()}catch{}},{once:!0})})();

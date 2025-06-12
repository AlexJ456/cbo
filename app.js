document.addEventListener('DOMContentLoaded', () => {
    const app     = document.getElementById('app-content');
    const canvas  = document.getElementById('breath-canvas');
    const container = document.querySelector('.container');
    canvas.width  = container.clientWidth;
    canvas.height = container.clientHeight;

    /* ---------- State ---------- */
    const PHASE_DURATION = 5.5;          // 5.5-second inhale / exhale
    const state = {
        isPlaying      : false,
        countdown      : PHASE_DURATION, // displayed value
        count          : 0,              // 0 = inhale, 1 = exhale
        totalTime      : 0,              // elapsed seconds
        soundEnabled   : false,
        timeLimit      : '',             // minutes (string)
        timeLimitReached : false,
        sessionComplete : false,
        pulseStartTime : null,
        halfTickDone   : false           // ensures 5.5 → 5 then full-seconds
    };

    /* ---------- Wake-lock and audio ---------- */
    let wakeLock = null;
    let audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const icons = {
        play     : `<svg class="icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
        pause    : `<svg class="icon" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
        volume2  : `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
        volumeX  : `<svg class="icon" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
        rotateCcw: `<svg class="icon" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
        clock    : `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    };

    /* ---------- Helper functions ---------- */
    const getInstruction = c => (c === 0 ? 'Inhale' : 'Exhale');
    const formatTime = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

    function playTone() {
        if (!state.soundEnabled) return;
        try {
            const osc = audioContext.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, audioContext.currentTime);
            osc.connect(audioContext.destination);
            osc.start();
            osc.stop(audioContext.currentTime + 0.12);
        } catch (e) {
            console.error('Tone error:', e);
        }
    }

    /* ---------- Wake Lock ---------- */
    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try { wakeLock = await navigator.wakeLock.request('screen'); }
            catch(e){ console.log('Wake-lock failed:', e); }
        }
    }
    function releaseWakeLock() {
        if (wakeLock) wakeLock.release().catch(()=>{}).finally(()=>wakeLock=null);
    }

    /* ---------- Main interval ---------- */
    let interval;           // 500-ms interval
    let animationFrameId;
    let halfTickCounter = 0;

    function startInterval() {
        clearInterval(interval);
        state.countdown   = PHASE_DURATION;
        state.halfTickDone = false;
        halfTickCounter   = 0;

        interval = setInterval(() => {
            halfTickCounter++;

            /* totalTime updated every full second (2 half-ticks) */
            if (halfTickCounter % 2 === 0) state.totalTime++;

            /* Handle countdown display */
            if (!state.halfTickDone) {               // first 0.5-sec slice
                state.countdown = 5;                 // 5.5 → 5
                state.halfTickDone = true;
            } else {
                state.countdown -= 1;
            }

            /* Check time-limit */
            if (state.timeLimit && !state.timeLimitReached) {
                const limitSec = parseInt(state.timeLimit) * 60;
                if (state.totalTime >= limitSec) state.timeLimitReached = true;
            }

            /* Phase finished? (countdown reached 0) */
            if (state.countdown === 0) {
                /* If we’ve just finished an EXHALE and the time limit
                   has been reached, finish session here so we always
                   end on an exhale. */
                if (state.count === 1 && state.timeLimitReached) {
                    state.sessionComplete = true;
                    state.isPlaying = false;
                    clearInterval(interval);
                    cancelAnimationFrame(animationFrameId);
                    releaseWakeLock();
                    render();
                    return;
                }

                /* Switch phase */
                state.count       = (state.count + 1) % 2;  // 0 ↔ 1
                state.countdown   = PHASE_DURATION;
                state.halfTickDone = false;
                playTone();
                state.pulseStartTime = performance.now();
            }

            render();
        }, 500);
    }

    /* ---------- Animation (vertical line) ---------- */
    function animate() {
        if (!state.isPlaying) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);

        /* Layout of line: right-hand 25 % of screen */
        const lineX       = canvas.width * 0.75;
        const topPadding  = 150;
        const bottomPad   = 100;
        const lineY1      = topPadding;
        const lineY2      = canvas.height - bottomPad;
        const lineHeight  = lineY2 - lineY1;

        /* Draw the line */
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth   = 6;
        ctx.beginPath();
        ctx.moveTo(lineX, lineY1);
        ctx.lineTo(lineX, lineY2);
        ctx.stroke();

        /* Progress along current phase */
        const elapsedInPhase = (PHASE_DURATION - state.countdown) +
                               (state.halfTickDone ? 0.5 : 0); // account for half-tick
        const progress = elapsedInPhase / PHASE_DURATION;       // 0→1

        /* Dot position */
        let dotY;
        if (state.count === 0) {    // inhale -> move UP
            dotY = lineY2 - progress * lineHeight;
        } else {                    // exhale -> move DOWN
            dotY = lineY1 + progress * lineHeight;
        }

        /* Dot pulse on phase change */
        let radius = 12; // bigger dot
        if (state.pulseStartTime) {
            const pulseElapsed = (performance.now() - state.pulseStartTime) / 1000;
            if (pulseElapsed < 0.4) {
                radius += 8 * Math.sin(Math.PI * (pulseElapsed / 0.4));
            }
        }

        ctx.beginPath();
        ctx.arc(lineX, dotY, radius, 0, 2 * Math.PI);
        ctx.fillStyle = '#ff0000';
        ctx.fill();

        animationFrameId = requestAnimationFrame(animate);
    }

    /* ---------- UI actions ---------- */
    function togglePlay() {
        state.isPlaying = !state.isPlaying;

        if (state.isPlaying) {
            if (audioContext.state === 'suspended') audioContext.resume();
            state.totalTime       = 0;
            state.timeLimitReached= false;
            state.sessionComplete = false;
            state.count           = 0;
            startInterval();
            animate();
            playTone();
            requestWakeLock();
        } else {
            clearInterval(interval);
            cancelAnimationFrame(animationFrameId);
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0,0,canvas.width,canvas.height);
            releaseWakeLock();
        }
        render();
    }

    function resetToStart() {
        clearInterval(interval);
        cancelAnimationFrame(animationFrameId);
        Object.assign(state, {
            isPlaying:false,countdown:PHASE_DURATION,count:0,totalTime:0,
            timeLimit:'',timeLimitReached:false,sessionComplete:false
        });
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,canvas.width,canvas.height);
        releaseWakeLock();
        render();
    }
    const toggleSound = () => { state.soundEnabled = !state.soundEnabled; render(); };
    const handleTimeLimitChange = e => { state.timeLimit = e.target.value.replace(/[^0-9]/g,''); };
    function startWithPreset(min){ state.timeLimit=min.toString(); togglePlay(); } // auto-start

    /* ---------- Render ---------- */
    function render() {
        let html = `<h1>Coherent Breathing</h1>`;

        if (state.isPlaying) {
            html += `
              <div class="timer">Total: ${formatTime(state.totalTime)}</div>
              <div class="instruction">${getInstruction(state.count)}</div>
              <div class="countdown">${state.countdown === 5 ? '5' : state.countdown}</div>
              <button id="toggle-play" class="pause-button">
                  ${icons.pause} Pause
              </button>
            `;
        }

        if (!state.isPlaying && !state.sessionComplete) {
            html += `
              <div class="settings">
                  <div class="form-group">
                      <label class="switch">
                          <input type="checkbox" id="sound-toggle" ${state.soundEnabled?'checked':''}>
                          <span class="slider"></span>
                      </label>
                      <label for="sound-toggle">
                          ${state.soundEnabled?icons.volume2:icons.volumeX}
                          Sound ${state.soundEnabled?'On':'Off'}
                      </label>
                  </div>
                  <div class="form-group">
                      <input id="time-limit" type="number" placeholder="Time limit" min="0" step="1"
                             value="${state.timeLimit}">
                      <label for="time-limit">Minutes (optional)</label>
                  </div>
              </div>
              <div class="prompt">Press start to begin</div>
              <button id="toggle-play">
                  ${icons.play} Start
              </button>
              <div class="shortcut-buttons">
                  <button id="preset-2min"  class="preset-button">${icons.clock} 2&nbsp;min</button>
                  <button id="preset-5min"  class="preset-button">${icons.clock} 5&nbsp;min</button>
                  <button id="preset-10min" class="preset-button">${icons.clock} 10&nbsp;min</button>
              </div>
            `;
        }

        if (state.sessionComplete) {
            html += `
              <div class="complete">Complete!</div>
              <button id="reset">${icons.rotateCcw} Back to Start</button>
            `;
        }

        app.innerHTML = html;

        /* ------ Wire up buttons / inputs ------ */
        const qs = sel => document.querySelector(sel);
        if (qs('#toggle-play')) qs('#toggle-play').addEventListener('click', togglePlay);
        if (qs('#reset'))       qs('#reset').addEventListener('click', resetToStart);
        if (qs('#sound-toggle'))qs('#sound-toggle').addEventListener('change', toggleSound);
        if (qs('#time-limit'))  qs('#time-limit').addEventListener('input', handleTimeLimitChange);

        if (qs('#preset-2min')) qs('#preset-2min').addEventListener('click',()=>startWithPreset(2));
        if (qs('#preset-5min')) qs('#preset-5min').addEventListener('click',()=>startWithPreset(5));
        if (qs('#preset-10min'))qs('#preset-10min').addEventListener('click',()=>startWithPreset(10));
    }

    render();
});

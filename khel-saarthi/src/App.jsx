// src/App.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * POSE_MODE:
 *  - "cdn"  : (default) jsDelivr se load (internet chaiye)
 *  - "local": /public/wasm + /public/models se (no-internet deploy)
 *  - "off"  : pose band (UI/record/upload sab chalega)
 */
const POSE_MODE = "cdn";
const TASKS_VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// ---------- Helpers ----------
function isNonEmptyString(x) { return typeof x === "string" && x.trim().length > 0; }
function toNonEmptyString(x) { if (x == null) return null; const s = String(x).trim(); return s ? s : null; }
function isMetricKind(x) { return x === "reps" || x === "seconds"; }
function toRenderableText(x, fallback = "") { const s = toNonEmptyString(x); return s ?? fallback; }
function angleDeg(A, B, C) {
  // null-safe to prevent runtime errors if any landmark missing
  if (!A || !B || !C) return 180;
  const ab = { x: A.x - B.x, y: A.y - B.y };
  const cb = { x: C.x - B.x, y: C.y - B.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag1 = Math.hypot(ab.x, ab.y), mag2 = Math.hypot(cb.x, cb.y);
  if (!mag1 || !mag2) return 180;
  const cos = Math.min(1, Math.max(-1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function dist(A, B) {
  if (!A || !B) return 0;
  return Math.hypot(A.x - B.x, A.y - B.y);
}


// ---------- Safe Catalog ----------
const DEFAULT_TESTS = [
  { id: "sprint100m",   title: "100m Sprint",              desc: "Run 100 meters as fast as possible.",             metric: "seconds", icon: "🏃" },
  { id: "pushups",      title: "Push-ups (60s)",           desc: "Max correct push-ups in 60 seconds.",            metric: "reps",    icon: "💪" },
  { id: "squats",       title: "Bodyweight Squats (60s)",  desc: "Max full-depth squats in 60 seconds.",           metric: "reps",    icon: "🦵" },
  { id: "jumpingjacks", title: "Jumping Jacks (30s)",      desc: "Max full-extension jumping jacks in 30 seconds.",metric: "reps",    icon: "⭐" },
  { id: "plank",        title: "Forearm Plank Hold",       desc: "Hold a straight plank as long as possible.",     metric: "seconds", icon: "📏" },
];
// --- Drill instruction art (public URLs) ---
const TEST_ART = {
  pushups: "/drills/push-up.png",
  plank: "/drills/plank-hold.png",
};


function sanitizeTestsCatalog(input) {
  if (!Array.isArray(input)) return DEFAULT_TESTS.slice();
  const out = []; const seen = new Set();
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const id = toNonEmptyString(row.id);
    const title = toNonEmptyString(row.title);
    const desc = toNonEmptyString(row.desc);
    const icon = toNonEmptyString(row.icon);
    const metric = isMetricKind(row.metric) ? row.metric : null;
    if (!id || !title || !desc || !icon || !metric) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, desc, icon, metric });
  }
  return out.length ? out : DEFAULT_TESTS.slice();
}
const TESTS_CATALOG_SAFE = sanitizeTestsCatalog(DEFAULT_TESTS);

// --- Level-1 progress helpers ---
const L1_TEST_IDS = DEFAULT_TESTS.map(t => t.id);
function l1AllDone(progress, athlete) {
  const set = progress[athlete] || {};
  return L1_TEST_IDS.every(id => !!set[id]);
}
function l1Missing(progress, athlete) {
  const set = progress[athlete] || {};
  return DEFAULT_TESTS.filter(t => !set[t.id]).map(t => t.title);
}

// ---------- Random Helpers (demo fallbacks) ----------
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max, decimals = 2) { const val = Math.random() * (max - min) + min; return parseFloat(val.toFixed(decimals)); }
function fakeScoreFor(testId) {
  switch (testId) {
    case "sprint100m":   return { value: randomFloat(11.5, 25.0, 2), unit: "s" };
    case "pushups":      return { value: randomInt(10, 60),           unit: "reps" };
    case "squats":       return { value: randomInt(15, 70),           unit: "reps" };
    case "jumpingjacks": return { value: randomInt(20, 70),           unit: "reps" };
    case "plank":        return { value: randomInt(20, 180),          unit: "s"   };
    default:             return { value: 0, unit: "?" };
  }
}
function fakeConsistency(prev) { if (prev == null) return randomFloat(78, 96, 1); const drift = randomFloat(-4, 4, 1); return Math.max(50, Math.min(99.9, parseFloat((prev + drift).toFixed(1)))); }
function formatTime(ts) { const d = new Date(ts); return d.toLocaleString(); }
function generateRecordingFilename(now = Date.now()) { return `recording_${now}.webm`; }
function safeId() { try { return crypto.randomUUID() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`; } catch { return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`; } }
function initials(name) { return name.trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||"").join("") || "A"; }

// ---------- UI Components ----------
function AppHeader({ title, onBack, profile, onProfile }) {
  return (
    <div className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-gray-200">
      <div className="mx-auto max-w-md px-4 py-3 flex items-center gap-3">
        {onBack ? (
          <button onClick={onBack} className="p-2 rounded-xl border border-gray-200 active:scale-95" aria-label="Back">←</button>
        ) : (<div className="w-8" />)}
        <h1 className="text-lg font-semibold flex-1">{toRenderableText(title, "KHEL SAARTHI")}</h1>
        {profile && (
          <button onClick={onProfile} className="flex items-center gap-2 active:scale-95">
            <div className="text-sm font-medium hidden sm:block truncate max-w-[100px]">
              {toRenderableText(profile.name, "Profile")}
            </div>
            <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden grid place-items-center">
              {profile.photoUrl ? (
                <img src={profile.photoUrl} className="w-full h-full object-cover" alt="Profile" />
              ) : (
                <span className="text-xs">{initials(toRenderableText(profile.name, "A"))}</span>
              )}
            </div>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * VideoCapture with lazy-loaded MediaPipe Pose.
 * Props:
 *  - onVideoReady(file)
 *  - testId
 *  - onLiveMetric(metricObj)
 */
function VideoCapture({ onVideoReady, testId, onLiveMetric }) {
  const [streamSupported, setStreamSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [stream, setStream] = useState(null);
  const videoRef = useRef(null);

  // MediaPipe
  const poseRef = useRef(null);
  const rafRef = useRef(0);
  // make loop stoppable + throttle overlay

const lastOverlayTsRef = useRef(0);

// portrait preview toggle (9:16)
const [portrait, setPortrait] = useState(true);

// overlay state: frame color, hip horizon, distance hint, posture tip
const [overlay, setOverlay] = useState({ frame: "bad", hipY: null, hint: "", posture: "" });

// 60s timer
const [timerMs, setTimerMs] = useState(0);
const timerRef = useRef(null);

  const aliveRef = useRef(false);

  // Live metric overlay
  const [liveMetric, setLocalLiveMetric] = useState(null);

  // Evaluator state
  const evalRef = useRef({
    // pushups
    phase: "top", lastToggle: 0, reps: 0,
    // squats
    sPhase: "top", sLast: 0, sReps: 0,
    // jumping jacks
    jState: "closed", jLast: 0, jReps: 0, baseShoulderWidth: null,
    // plank
    pStart: null, pMax: 0, pGood: false,
  });

useEffect(() => {
  return () => {
    aliveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    try { poseRef.current?.close?.(); } catch {}
    if (stream) stream.getTracks().forEach((t) => t.stop());
    poseRef.current = null;
  };
}, [stream]);



  function emitLiveMetric(m) {
    setLocalLiveMetric(m);
    onLiveMetric && onLiveMetric(m);
  }

  function evalPushups(lm) {
    const R = (i) => lm?.[i] ? { x: lm[i].x, y: lm[i].y } : null;
    const shoulder = R(12), elbow = R(14), wrist = R(16);
    const hip = R(24), ankle = R(28);
    const elbowAng = angleDeg(shoulder, elbow, wrist);
    const hipLine = angleDeg(shoulder, hip, ankle);
    const goodPlank = (hipLine > 165 && hipLine < 195);
    const t = performance.now();
    const s = evalRef.current;
    if (s.phase === "top" && elbowAng < 80 && goodPlank && t - s.lastToggle > 250) {
      s.phase = "bottom"; s.lastToggle = t;
    } else if (s.phase === "bottom" && elbowAng > 155 && t - s.lastToggle > 250) {
      s.phase = "top"; s.lastToggle = t; s.reps += 1;
    }
    emitLiveMetric({ testId: "pushups", value: s.reps, unit: "reps", extras: { elbowAng, goodPlank }});
  }
  function evalSquats(lm) {
    const R = (i) => lm?.[i] ? { x: lm[i].x, y: lm[i].y } : null;
    const hip = R(24), knee = R(26), ankle = R(28);
    const kneeAng = angleDeg(hip, knee, ankle);
    const t = performance.now();
    const s = evalRef.current;
    if (s.sPhase === "top" && kneeAng < 85 && t - s.sLast > 300) {
      s.sPhase = "bottom"; s.sLast = t;
    } else if (s.sPhase === "bottom" && kneeAng > 165 && t - s.sLast > 300) {
      s.sPhase = "top"; s.sLast = t; s.sReps += 1;
    }
    emitLiveMetric({ testId: "squats", value: s.sReps, unit: "reps", extras: { kneeAng }});
  }
  function evalJumpingJacks(lm) {
  const R = (i) => lm?.[i] ? { x: lm[i].x, y: lm[i].y } : null;
  const Lw = R(15), Rw = R(16);
  const La = R(27), Ra = R(28);
  const Ls = R(11), Rs = R(12);
  const head = R(0) || R(7) || R(8);

  // shoulder width baseline (smoothed)
  const sh = (Ls && Rs) ? dist(Ls, Rs) : 0;
  const s = evalRef.current;
  if (sh) s.baseShoulderWidth = s.baseShoulderWidth ? (0.9 * s.baseShoulderWidth + 0.1 * sh) : sh;

  const base = s.baseShoulderWidth || sh || 0;
  const feetApart = base && dist(La, Ra) >= 1.25 * base; // was 1.4 (too strict)
  const handsUp = !!head && Lw?.y < head.y - 0.02 && Rw?.y < head.y - 0.02;

  const t = performance.now();
  const debounce = 220; // ms

  if (s.jState === "closed" && feetApart && handsUp && t - s.jLast > debounce) {
    s.jState = "open"; s.jLast = t;
  } else if (s.jState === "open" && !feetApart && !handsUp && t - s.jLast > debounce) {
    s.jState = "closed"; s.jLast = t; s.jReps += 1;
  }

  emitLiveMetric({
    testId: "jumpingjacks",
    value: s.jReps,
    unit: "reps",
    extras: { feetApart, handsUp },
  });
}


  function evalPlank(lm) {
  const G = (i) => (lm?.[i] ? { x: lm[i].x, y: lm[i].y } : null);
  const Sh = G(12) || G(11);
  const Hp = G(24) || G(23);
  const An = G(28) || G(27);

  const s = evalRef.current;

  const lineDeg = angleDeg(Sh, Hp, An); // 180° = straight
  const midYA = (Sh?.y + An?.y) / 2;
  const hipCentered = Sh && Hp && An ? Math.abs(Hp.y - midYA) <= 0.045 : false;

  // not too strict: ±12° window + hip centered
  const good = lineDeg >= 168 && lineDeg <= 192 && hipCentered;

  const now = performance.now();
  const gateMs = 400; // need ~0.4s of good form before timer starts

  if (good) {
    if (!s.pGood) { s.pGood = true; s.pGate = now; s.pStart = null; }
    if (!s.pStart && now - s.pGate >= gateMs) s.pStart = now;
    if (s.pStart) {
      const sec = (now - s.pStart) / 1000;
      s.pMax = Math.max(s.pMax || 0, sec);
    }
  } else {
    // pause when form breaks; keep max
    s.pGood = false; s.pGate = null; s.pStart = null;
  }

  emitLiveMetric({
    testId: "plank",
    value: Math.floor(s.pMax || 0),
    unit: "s",
    extras: { good },
  });
}

  function detect(lm) {
  switch (testId) {
    case "pushups":       return evalPushups(lm);
    case "squats":        return evalSquats(lm);
    case "jumpingjacks":  return evalJumpingJacks(lm);
    case "plank":         return evalPlank(lm);
    default:              return;
  }
}

 function updateOverlay(lm) {
  const now = performance.now();
  if (now - lastOverlayTsRef.current < 100) return; // ~10 Hz
  lastOverlayTsRef.current = now;

  // landmarks → bbox
  const pts = lm?.filter(Boolean) || [];
  if (!pts.length) return;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }

  // green ROI (loose margins, advisory only)
  const roi = portrait
    ? { L: 0.10, R: 0.90, T: 0.06, B: 0.94 }   // more vertical space
    : { L: 0.12, R: 0.88, T: 0.08, B: 0.92 };

  let frame = "bad";
  const insideX = minX >= roi.L && maxX <= roi.R;
  const insideY = minY >= roi.T && maxY <= roi.B;
  if (insideX && insideY) frame = "good";
  else if (
    minX >= roi.L - 0.03 && maxX <= roi.R + 0.03 &&
    minY >= roi.T - 0.03 && maxY <= roi.B + 0.03
  ) frame = "ok";

  // horizon line at mid-hips
  const LHIP = lm[23], RHIP = lm[24];
  const hipY = (LHIP && RHIP) ? (LHIP.y + RHIP.y) / 2 : (LHIP?.y ?? RHIP?.y ?? null);

  // distance hint using shoulder width
  const LSH = lm[11], RSH = lm[12];
  const shoulderW = (LSH && RSH) ? Math.hypot(LSH.x - RSH.x, LSH.y - RSH.y) : 0;
  const roiW = roi.R - roi.L;
  let hint = "";
  if (shoulderW) {
    const rel = shoulderW / roiW;           // how much of ROI width shoulders cover
    if (rel > 0.36) hint = "Step back";
    else if (rel < 0.16) hint = "Step closer";
  }

  // posture chip (only for squats)
  let posture = "";
  if (testId === "squats") {
    const HIP = lm[24] || lm[23], KNEE = lm[26] || lm[25], ANK = lm[28] || lm[27];
    if (HIP && KNEE && ANK) {
      // reuse your angle logic
      const kneeAng = angleDeg(HIP, KNEE, ANK);
      if (kneeAng > 130) posture = "Go lower";
      else if (kneeAng < 95) posture = "Rise up";
      else posture = "Good";
    }
  }

  setOverlay({ frame, hipY, hint, posture });
}


  async function ensurePoseLoaded() {
    if (POSE_MODE === "off") return false;
    if (poseRef.current) return true;
    try {
      let FilesetResolver, PoseLandmarker, baseUrl, modelAssetPath;

      if (POSE_MODE === "local") {
        const mod = await import("@mediapipe/tasks-vision");
        ({ FilesetResolver, PoseLandmarker } = mod);
        baseUrl = "/wasm"; // put wasm files in public/wasm
        modelAssetPath = "/models/pose_landmarker_full.task"; // public/models
      } else {
        const mod = await import(/* @vite-ignore */ TASKS_VISION_URL);
        ({ FilesetResolver, PoseLandmarker } = mod);
        baseUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
        modelAssetPath =
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
      }

      const fileset = await FilesetResolver.forVisionTasks(baseUrl);
      poseRef.current = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      return true;
    } catch (e) {
      console.warn("Pose load failed (recording still works):", e);
      return false;
    }
  }

 async function runLoop() {
  if (!aliveRef.current) return;

  try {
    if (!videoRef.current || !poseRef.current || videoRef.current.readyState < 2) {
      rafRef.current = aliveRef.current ? requestAnimationFrame(runLoop) : 0;
      return;
    }
    const now = performance.now();
    const res = await poseRef.current.detectForVideo(videoRef.current, now);
    const lm = res?.landmarks?.[0];
    if (lm) {
      updateOverlay(lm);   // ← new overlay info
      detect(lm);          // ← your existing counter logic
    }
  } catch (e) {
    // swallow errors
  } finally {
    if (aliveRef.current) rafRef.current = requestAnimationFrame(runLoop);
  }
}


  async function initCamera() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(s);
      setStreamSupported(true);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.onloadedmetadata = async () => {
          try { await videoRef.current.play(); } catch {}
          // Lazy-load pose AFTER camera is live
          await ensurePoseLoaded();
          cancelAnimationFrame(rafRef.current);
          aliveRef.current = true;
          runLoop();
        };
      }
    } catch {
      setStreamSupported(false);
    }
  }

  function startRecording() {
  if (!stream || typeof window.MediaRecorder === "undefined") return;

  // reset evaluators
  evalRef.current = {
    // pushups
    phase: "top", lastToggle: 0, reps: 0,
    // squats
    sPhase: "top", sLast: 0, sReps: 0,
    // jumping jacks
    jState: "closed", jLast: 0, jReps: 0, baseShoulderWidth: null,
    // plank
    // plank init inside evalRef.current = { ... }
   pStart: null, pMax: 0, pGood: false, pGate: null,

  };
  setLocalLiveMetric(null);

  // prepare recorder
  chunksRef.current = [];
  const mr = new MediaRecorder(stream, { mimeType: "video/webm" });
  mediaRecorderRef.current = mr;

  mr.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
  };

  mr.onstop = () => {
    // stop loop & timer so UI is responsive and metric is final
    aliveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    // snapshot final metric at stop
    let metric = null;
    if (testId === "plank") {
      metric = { testId: "plank", value: Math.floor(evalRef.current.pMax || 0), unit: "s" };
    } else if (testId === "pushups") {
      metric = { testId: "pushups", value: evalRef.current.reps, unit: "reps" };
    } else if (testId === "squats") {
      metric = { testId: "squats", value: evalRef.current.sReps, unit: "reps" };
    } else if (testId === "jumpingjacks") {
      metric = { testId: "jumpingjacks", value: evalRef.current.jReps, unit: "reps" };
    }
    if (metric) emitLiveMetric(metric);

    // create file and continue flow
    const blob = new Blob(chunksRef.current, { type: "video/webm" });
    const file = new File([blob], generateRecordingFilename(), { type: "video/webm" });
    chunksRef.current = [];
    onVideoReady(file, metric);
  };

  // start recording
  mr.start();
  setRecording(true);

  // 60s auto-stop timer
  if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  setTimerMs(0);
  timerRef.current = setInterval(() => {
    setTimerMs((t) => {
      const next = t + 1000;
      if (next >= 60000) {
        clearInterval(timerRef.current); timerRef.current = null;
        stopRecording();
      }
      return next;
    });
  }, 1000);
}


  

  function stopRecording() {
  if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  mediaRecorderRef.current?.stop();
  setRecording(false);
}


  return (
    <div className="space-y-3">
      <div className={`rounded-2xl overflow-hidden bg-black ${portrait ? "aspect-[9/16]" : "aspect-video"} relative flex items-center justify-center`}>

        {streamSupported ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

  {/* Portrait/Landscape toggle */}
  <button
    onClick={() => setPortrait((p) => !p)}
    className="absolute top-2 left-2 px-2 py-1 text-[11px] rounded-lg bg-white/80 backdrop-blur shadow pointer-events-auto"
    title="Toggle Portrait/Landscape"
  >
    {portrait ? "Portrait 9:16" : "Landscape 16:9"}
  </button>

  {/* ROI box (advisory only) */}
  <div className="absolute inset-0 pointer-events-none">
    <div
      className={`absolute rounded-xl border-2 ${overlay.frame === "good" ? "border-emerald-500"
        : overlay.frame === "ok" ? "border-amber-500" : "border-rose-500"}`}
      style={{
        left: portrait ? "10%" : "12%", right: portrait ? "10%" : "12%",
        top: portrait ? "6%" : "8%", bottom: portrait ? "6%" : "8%"
      }}
    />
  </div>

  {/* Horizon line at hips */}
  {overlay.hipY != null && (
    <div className="absolute left-0 right-0 pointer-events-none"
         style={{ top: `${overlay.hipY * 100}%` }}>
      <div className="h-0.5 bg-emerald-400/80"></div>
    </div>
  )}

  {/* Distance hint */}
  {overlay.hint && (
    <div className="absolute top-2 right-2 text-[11px] bg-white/85 px-2 py-1 rounded-lg shadow">
      {overlay.hint}
    </div>
  )}

  {/* Posture chip (e.g., squats) */}
  {overlay.posture && (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[12px] bg-white/85 px-3 py-1 rounded-full shadow">
      {overlay.posture}
    </div>
  )}

  {/* 60s timer */}
  {recording && (
    <div className="absolute top-2 inset-x-0 flex items-center justify-center pointer-events-none">
      <div className="flex items-center gap-2 bg-black/35 text-white text-xs px-2 py-1 rounded-lg">
        <span>
          {String(Math.floor(timerMs / 60000)).padStart(2, "0")}:
          {String(Math.floor((timerMs % 60000) / 1000)).padStart(2, "0")}
        </span>
        {/* simple progress ring */}
        <svg width="20" height="20" viewBox="0 0 36 36" className="block">
          <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
          <circle cx="18" cy="18" r="16" fill="none"
            stroke="white" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${(timerMs / 60000) * 100} 100`} transform="rotate(-90 18 18)" />
        </svg>
      </div>
    </div>
  )}

  {liveMetric && (
    <div className="absolute bottom-2 right-2 bg-white/85 backdrop-blur px-3 py-1 rounded-xl text-xs shadow">
      <span className="font-semibold">{liveMetric.testId}</span>: {liveMetric.value} {liveMetric.unit}
    </div>
  )}
          </>
        ) : (
          <div className="text-white/80 text-sm p-4 text-center">
            Camera preview will appear here. If blocked or unsupported, Please allow Permission.
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={initCamera} className="py-3 rounded-2xl border border-gray-300 active:scale-95">
          {stream ? "Refresh Camera" : "Enable Camera"}
        </button>

        {recording ? (
          <button onClick={stopRecording} className="py-3 rounded-2xl bg-red-500 text-white active:scale-95">
            Stop & Save
          </button>
        ) : (
          <button
  onClick={startRecording}
  disabled={!stream}
  className={
    "py-3 rounded-2xl text-white active:scale-95 " +
    (stream
      ? "bg-emerald-600 hover:bg-emerald-700"
      : "bg-gray-400 cursor-not-allowed")
  }
>
  Record
</button>


        )}
      </div>
      
    </div>
  );
}

function CandidateDetailsScreen({ athleteName, onBack, onSave }) {
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [photoUrl, setPhotoUrl] = useState(null);

  return (
    <div className="min-h-dvh bg-white">
      <AppHeader title="Candidate Details" onBack={onBack} />
      <main className="mx-auto max-w-md px-4 py-6 space-y-4">
        <div className="grid gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Name</label>
            <input value={toRenderableText(athleteName, "Guest Athlete")} disabled
              className="w-full rounded-2xl border border-gray-300 px-4 py-3 bg-gray-50" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Gender</label>
            <select value={gender} onChange={(e)=>setGender(e.target.value)}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3">
              <option value="">Select</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Age</label>
            <input type="number" inputMode="numeric" placeholder="e.g., 18"
              value={age} onChange={(e)=>setAge(e.target.value)}
              className="w-full rounded-2xl border border-gray-300 px-4 py-3" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Profile Photo (optional)</label>
            <label className="block">
              <div className="w-full rounded-2xl border border-dashed border-gray-300 p-4 text-center cursor-pointer">
                Upload image
              </div>
              <input type="file" accept="image/*" className="hidden"
                onChange={(e)=>{ const f = e.target.files?.[0]; if (!f) return;
                  const reader = new FileReader();
                  reader.onload = ()=> setPhotoUrl(reader.result);
                  reader.readAsDataURL(f);
                }} />
            </label>
            {photoUrl && (
              <div className="mt-2 w-16 h-16 rounded-full overflow-hidden">
                <img src={photoUrl} className="w-full h-full object-cover" alt="Uploaded" />
              </div>
            )}
          </div>
        </div>
        <button onClick={()=> {
          const p = { name: athleteName, gender, age: age? Number(age): null, photoUrl: photoUrl || null };
          onSave(p);
        }} className="w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">
          Save & Continue
        </button>
      </main>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState({ name: "landing" });
  const [name, setName] = useState("");
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [l1Progress, setL1Progress] = useState({}); // { [athlete]: { [testId]: true } }
  const [liveMetric, setLiveMetric] = useState(null);   // from VideoCapture

  // load saved history/profile
  useEffect(() => {
    const saved = localStorage.getItem("ks_history");
    if (saved) { try { const arr = JSON.parse(saved); if (Array.isArray(arr)) setHistory(arr); } catch {} }
    const p = localStorage.getItem("ks_profile");
    if (p) { try { setProfile(JSON.parse(p)); } catch {} }
  }, []);
  // persist
  useEffect(() => { localStorage.setItem("ks_history", JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem("ks_profile", JSON.stringify(profile)); }, [profile]);

  // load & persist L1 progress
  useEffect(() => { const raw = localStorage.getItem("ks_l1_progress"); if (raw) { try { setL1Progress(JSON.parse(raw) || {}); } catch {} }}, []);
  useEffect(() => { localStorage.setItem("ks_l1_progress", JSON.stringify(l1Progress)); }, [l1Progress]);

  function markL1Completed(athlete, testId) {
    setL1Progress(prev => {
      const set = prev[athlete] || {};
      return { ...prev, [athlete]: { ...set, [testId]: true } };
    });
  }

  function getTestOrFallback(testId) {
    const t = TESTS_CATALOG_SAFE.find(x => x.id === testId);
    return t ?? { id: "unknown", title: "Unknown Test", desc: "—", metric: "reps", icon: "❓" };
  }

  function toHomeFromAnywhere() {
    const athlete = (view.athlete ?? profile?.name ?? name) || "Guest Athlete";
    setView({ name: "home", athlete });
  }

  function onVideo(file, finalMetric) {
    if (view.name !== "upload") return;
    setView({ 
  name: "processing", 
  athlete: view.athlete, 
  testId: view.testId, 
  fileName: file.name,
  metrics: finalMetric   
});


    setTimeout(() => {
      const test = getTestOrFallback(view.testId);

      // Prefer metric passed from camera stop; else last live; else fallback
let metric = null;
if (finalMetric && finalMetric.testId === view.testId) {
  metric = { value: finalMetric.value ?? 0, unit: finalMetric.unit ?? "reps" };
} else if (liveMetric && liveMetric.testId === view.testId) {
  metric = { value: liveMetric.value, unit: liveMetric.unit };
} else {
  metric = fakeScoreFor(view.testId);
}



      const prevOfSame = history.filter((h) => h.athlete === view.athlete && h.testId === view.testId).at(-1);
      const consistency = fakeConsistency(prevOfSame?.stageBreakdown.find((s) => s.stage === "Consistency")?.score ?? null);
      const stageBreakdown = [
        { stage: "L1 App Score", score: randomInt(60, 90) },
        { stage: "L2 Manual", score: randomInt(50, 95) },
        { stage: "Consistency", score: consistency },
      ];
      const flags = [];
      if (Math.random() < 0.2) flags.push("Soft Flag: Large jump vs baseline");
      if (Math.random() < 0.1) flags.push("Hard Flag: Outlier vs cohort");

      const res = {
        id: safeId(),
        athlete: view.athlete,
        testId: view.testId,
        testTitle: test.title,
        createdAt: Date.now(),
        fileName: file.name,
        metrics: {
          value: metric.value,
          unit: metric.unit,
          duration:
            view.testId === "pushups" || view.testId === "squats" ? "60s"
            : view.testId === "jumpingjacks" ? "30s"
            : undefined,
        },
        stageBreakdown,
        flags,
      };
      setHistory((h) => [...h, res]);
      markL1Completed(view.athlete, view.testId);
      setView({ name: "result", athlete: view.athlete, summary: res });
    }, 900);
  }

  function attachSaiToLatest() {
    if (view.name !== "result") return;
    const updated = { ...view.summary, sai: { l1Percentile: 85, eligibleL2: true } };
    setHistory((arr) => arr.map((r) => (r.id === updated.id ? updated : r)));
    setView({ name: "result", athlete: view.athlete, summary: updated });
  }

  // ------------------- Renders -------------------

  if (view.name === "landing") {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-emerald-50 to-white">
        <AppHeader title="KHEL SAARTHI" />
        <main className="mx-auto max-w-md px-4 py-10 space-y-4">
          <div className="text-center">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-emerald-600 text-white grid place-items-center text-2xl shadow-lg">KS</div>
            <h2 className="mt-4 text-xl font-semibold">Welcome</h2>
            <p className="text-sm text-gray-600">Choose your login</p>
          </div>
          <button onClick={() => setView({ name: "candidateLogin" })}
            className="w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">Candidate Login</button>
          <button onClick={() => setView({ name: "reviewSai" })}
            className="w-full py-3 rounded-2xl border border-gray-300 active:scale-95">Official Login</button>
        </main>
      </div>
    );
  }

  if (view.name === "candidateLogin") {
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Candidate Login" onBack={() => setView({ name: "landing" })} />
        <main className="mx-auto max-w-md px-4 py-6">
          <label className="block mb-3 text-sm font-medium">Name</label>
          <input className="w-full rounded-2xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="e.g., A. Sharma" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={() => setView({ name: "candidateDetails", athleteName: name.trim() || "Guest Athlete" })}
            className="mt-4 w-full py-3 rounded-2xl bg-emerald-600 text-white font-medium active:scale-95">Continue</button>
          <p className="mt-6 text-xs text-gray-500 text-center">Demo only. Data stays in your browser.</p>
        </main>
      </div>
    );
  }

  if (view.name === "candidateDetails") {
    return (
      <CandidateDetailsScreen
        athleteName={view.athleteName}
        onBack={() => setView({ name: "candidateLogin" })}
        onSave={(p) => { setProfile(p); localStorage.setItem("ks_profile", JSON.stringify(p)); setView({ name: "candidateHub", profile: p }); }}
      />
    );
  }

  if (view.name === "candidateHub") {
    const p = view.profile;
    return (
      <div className="min-h-dvh bg-[#FAFAF7]">
        <AppHeader title="KHEL SAARTHI • SAI" profile={p}
          onProfile={()=>alert(`Profile\nName: ${p.name}\nGender: ${p.gender||'-'}\nAge: ${p.age??'-'}`)} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-5">
          <div className="rounded-2xl bg-white border border-gray-200 p-4">
            <div className="font-semibold mb-2">Step 1: Verify identity</div>
            <div className="text-sm text-gray-600">(Demo) Face and ID match ✓</div>
          </div>
          <div className="rounded-2xl bg-white border border-gray-200 p-4">
            <div className="font-semibold mb-3">Tutorials – Recording Tips</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {["Lighting & framing","Keep phone stable","Full body in frame","Clear background"].map((t,i)=>(
                <div key={i} className="rounded-xl border border-gray-200 p-3 bg-gray-50">🎬 {t}</div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-white border border-gray-200 p-4">
            <div className="font-semibold mb-3">How it works</div>
            <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700">
              <li>Level 1: Upload/Record short clips for core drills</li>
              <li>Wait for SAI scorecard (percentile)</li>
              <li>Level 2: Upload advanced drills</li>
              <li>SAI final scorecard after 7 days</li>
            </ol>
          </div>
          <button onClick={() => setView({ name: "home", athlete: p.name })}
            className="w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">Start Level 1</button>
        </main>
      </div>
    );
  }

  if (view.name === "reviewSai") {
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Official Login" onBack={() => setView({ name: "landing" })} />
        <main className="mx-auto max-w-md px-4 py-10 text-center text-gray-600">
          Official portal will be available soon.
        </main>
      </div>
    );
  }

  if (view.name === "home") {
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Level 1 – Pick a Test"
          profile={profile || {name: view.athlete, gender: "", age: null}}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: view.athlete, gender: "", age: null} })}
          onBack={() => setView({ name: "candidateHub", profile: profile || {name: view.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <div className="text-gray-500">Athlete</div>
              <div className="font-semibold">{toRenderableText(view.athlete, "Athlete")}</div>
            </div>
            <button onClick={() => setView({ name: "history", athlete: view.athlete })}
              className="text-sm px-3 py-2 rounded-xl border border-gray-300 active:scale-95">History</button>
          </div>

          <div className="text-xs text-gray-600">
            Progress: {Object.keys(l1Progress[view.athlete] || {}).length} / {L1_TEST_IDS.length} completed
          </div>

          <div className="grid grid-cols-1 gap-3">
            {Array.isArray(TESTS_CATALOG_SAFE) && TESTS_CATALOG_SAFE
              .filter((t) => t && isNonEmptyString(t.id) && isNonEmptyString(t.title) && isNonEmptyString(t.desc) && isMetricKind(t.metric))
              .map((t) => (
                <button key={t.id} onClick={() => setView({ name: "test", athlete: view.athlete, testId: t.id })}
                  className="text-left p-4 rounded-2xl border border-gray-200 active:scale-[.99] bg-gray-50 hover:bg-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">{toRenderableText(t.icon, "")}</div>
                    <div>
                      <div className="font-semibold">{toRenderableText(t.title, "Test")}</div>
                      <div className="text-sm text-gray-600">{toRenderableText(t.desc, "")}</div>
                    </div>
                    <div className="ml-auto">
                      {l1Progress[view.athlete]?.[t.id] && (
                        <span className="text-[11px] px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800">✓ Done</span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </main>
      </div>
    );
  }

if (view.name === "test") {
  const test = getTestOrFallback(view.testId);
  return (
    <div className="min-h-dvh bg-white">
      <AppHeader
        title={toRenderableText(test.title, "Test")}
        onBack={() => setView({ name: "home", athlete: view.athlete })}
        profile={profile}
        onProfile={() =>
          setView({
            name: "candidateHub",
            profile: profile || { name: view.athlete, gender: "", age: null },
          })
        }
      />
      <main className="mx-auto max-w-md px-4 py-5 space-y-5">
  {view.testId === "sprint100m" ? (
    <>
      {/* Sprint special card */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="font-semibold mb-1">100m Sprint — GPS Mode</div>
        <ul className="list-disc pl-5 text-sm text-amber-800 space-y-1">
          <li>Turn ON GPS on your phone.</li>
          <li>Keep the phone with you and run 100m on a straight track.</li>
          <li>Video capture is disabled for this drill in Level 1.</li>
        </ul>
        <div className="text-xs text-amber-700 mt-2">(Future: automatic timing using GPS + IMU)</div>
      </div>

      {/* Fake Start button to mark sprint done */}
      <button
        onClick={() => {
          markL1Completed(view.athlete, "sprint100m");
          alert("100m Sprint marked complete (demo). Finish the other drills to unlock Level 2.");
          setView({ name: "home", athlete: view.athlete });
        }}
        className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-medium active:scale-95"
      >
        Mark Sprint as Done
      </button>
    </>
  ) : (
    <>
      {/* ---------- Instructions Card ---------- */}
      <div className="rounded-2xl bg-gray-50 border border-gray-200 p-4">
        <div className="font-semibold mb-1">Instructions</div>
        <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
          <li>{toRenderableText(test.desc, "Follow on-screen instructions.")}</li>
          <li>Place the phone in a stable position with full body in frame.</li>
          <li>Good lighting improves recognition quality.</li>

          {/* Jumping Jacks-specific rule */}
          {view.testId === "jumpingjacks" && (
            <li>
              <span className="font-medium">How it counts:</span> Start <b>CLOSED</b> (feet together, hands down) → 
              go <b>FULLY OPEN</b> (feet wide + both wrists above head) → back to <b>CLOSED</b>. 
              Hold ~0.25s each for proper counting.
            </li>
          )}

          {/* Extra tip for Push-ups & Plank */}
          {(view.testId === "pushups" || view.testId === "plank") && (
            <li>
              Rotate your phone to <b>landscape</b>, turn on <b>Auto-rotate</b>, then{" "}
              <b>refresh</b> once for clearer detection.
            </li>
          )}

          {/* Plank-specific rule */}
          {view.testId === "plank" && (
            <li>
              <span className="font-medium">How plank is counted:</span> Timer starts only when
              your body is straight (shoulder–hip–ankle aligned) and steady ~0.4s; it pauses if
              form breaks.
            </li>
          )}
        </ul>
      </div>
      {/* ---------- /Instructions Card ---------- */}

      {/* ---------- Instruction art (only for Push-ups & Plank) ---------- */}
      {(view.testId === "pushups" || view.testId === "plank") && (
        <div className="rounded-2xl border border-gray-200 bg-white p-2">
          <div className="w-full aspect-video max-h-64 overflow-hidden flex items-center justify-center">
            <img
              src={view.testId === "plank" ? "/drills/plank-hold.png" : "/drills/push-up.png"}
              alt={`${test.title} guide`}
              loading="lazy"
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      )}
      {/* ---------- /Instruction art ---------- */}

      {/* Start button */}
      <button
        onClick={() =>
          setView({ name: "upload", athlete: view.athlete, testId: view.testId })
        }
        className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-medium active:scale-95"
      >
        Start – Record
      </button>
    </>
  )}
</main>

    </div>
  );
}


  if (view.name === "upload") {
    const test = getTestOrFallback(view.testId);
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title={`Record – ${toRenderableText(test.title, "Test")}`}
          onBack={() => setView({ name: "test", athlete: view.athlete, testId: view.testId })}
          profile={profile}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: view.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-5">
          {view.testId === "sprint100m" ? (
  <div className="rounded-2xl border border-gray-200 p-4 bg-amber-50">
    <div className="font-semibold mb-1">100m Sprint — GPS Mode (coming soon)</div>
    <ul className="list-disc pl-5 text-sm text-amber-800 space-y-1">
      <li>Turn ON GPS on your phone.</li>
      <li>Keep the phone with you and run 100m on a straight track.</li>
      <li>Video capture is disabled for this drill in Level 1.</li>
    </ul>
    <div className="text-xs text-amber-700 mt-2">(Future update: automatic timing using GPS + IMU)</div>
  </div>
) : (
  <>
    <VideoCapture
      testId={view.testId}
      onLiveMetric={setLiveMetric}
      onVideoReady={onVideo}
    />
    <div className="text-xs text-gray-500 text-center">
      Tip: Short clips (5–15s) are enough for the demo.
    </div>
  </>
)}


        </main>
      </div>
    );
  }

  if (view.name === "processing") {
    const test = getTestOrFallback(view.testId);
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Processing…" />
        <main className="mx-auto max-w-md px-4 py-10">
          <div className="mx-auto w-40 h-40 rounded-full border-8 border-emerald-100 grid place-items-center animate-pulse">
            <div className="w-24 h-24 rounded-full border-8 border-emerald-200" />
          </div>
          <div className="text-center mt-6">
            <div className="font-semibold">Analyzing {toRenderableText(test.title, "Test")}</div>
            <div className="text-sm text-gray-600 mt-1">{toRenderableText(view.fileName, "video.webm")}</div>
            <div className="text-xs text-gray-500 mt-3">AI: estimating reps/time, consistency & flags…</div>
          </div>
        </main>
      </div>
    );
  }

  if (view.name === "result") {
    const r = view.summary;
    const raw = r.stageBreakdown.find(s=>s.stage==="L1 App Score")?.score ?? randomInt(60,90);
    const hasSai = !!r.sai;
    const allDone = l1AllDone(l1Progress, r.athlete);
    const missingTitles = l1Missing(l1Progress, r.athlete);

    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Results" onBack={toHomeFromAnywhere}
          profile={profile}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: r.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-5">
          <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
            <div className="text-sm text-gray-600">Athlete</div>
            <div className="font-semibold">{toRenderableText(r.athlete, "Athlete")}</div>
            <div className="text-sm text-gray-600 mt-3">Test</div>
            <div className="font-semibold">{toRenderableText(r.testTitle, "Test")}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <div className="text-xs text-gray-600">Performance</div>
                <div className="text-xl font-bold">{r.metrics.value} {toRenderableText(r.metrics.unit, "")}</div>
                {r.metrics.duration && (<div className="text-xs text-gray-500">Window: {toRenderableText(r.metrics.duration, "")}</div>)}
              </div>
              <div className="p-3 rounded-xl bg-white border border-gray-200">
                <div className="text-xs text-gray-600">Date</div>
                <div className="text-sm font-medium">{formatTime(r.createdAt)}</div>
                {r.fileName && (<div className="text-[11px] text-gray-500 truncate" title={toRenderableText(r.fileName, "video.webm")}>📹 {toRenderableText(r.fileName, "video.webm")}</div>)}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 p-4">
            <div className="font-semibold mb-2">RAW Score</div>
            <div className="text-sm text-gray-700">{toRenderableText(r.testTitle, "Test")}: <span className="font-semibold">{raw}/100</span></div>
            <div className="mt-3 text-xs text-gray-500">Breakdown</div>
            <div className="grid grid-cols-2 gap-3 mt-1">
              {r.stageBreakdown.map((s) => (
                <div key={s.stage} className="p-3 rounded-xl bg-gray-50 border border-gray-200">
                  <div className="text-xs text-gray-600">{toRenderableText(s.stage, "Stage")}</div>
                  <div className="text-lg font-semibold">{s.stage === "Consistency" ? `${s.score}%` : `${s.score}/100`}</div>
                </div>
              ))}
            </div>
          </div>

          {!hasSai ? (
  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
    <div className="font-semibold">Wait for SAI scorecard</div>
    {!allDone ? (
      <div className="text-sm text-amber-700">
        Complete all Level 1 drills and then refresh to view your percentile.
      </div>
    ) : (
      <>
        <div className="text-sm text-amber-700">
          All L1 drills completed. Tap refresh to fetch the demo percentile.
        </div>
        <button
          onClick={attachSaiToLatest}
          className="mt-3 w-full py-3 rounded-2xl bg-amber-600 text-white active:scale-95"
        >
          Refresh SAI Scorecard
        </button>
      </>
    )}
  </div>
) : (
  <div className="rounded-2xl border border-gray-200 p-4 bg-emerald-50">
    <div className="font-semibold mb-1">SAI Evaluation (Demo)</div>
    <div className="text-sm">Percentile: <span className="font-semibold">{r.sai.l1Percentile}th</span></div>

    {!allDone ? (
      <>
        <div className="text-sm mt-2 text-emerald-800">
          Complete all Level 1 drills to unlock Level 2.
        </div>
        {missingTitles.length > 0 && (
          <div className="mt-2 text-xs text-gray-700">
            Remaining: {missingTitles.join(", ")}
          </div>
        )}
        <button onClick={toHomeFromAnywhere}
          className="mt-3 w-full py-3 rounded-2xl border border-gray-300 active:scale-95">
          Do Remaining Level 1 Drills
        </button>
      </>
    ) : (
      <button onClick={() => setView({ name: "saiGate", athlete: r.athlete, summary: r })}
        className="mt-3 w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">
        Continue to Level 2 Drills
      </button>
    )}
  </div>
)}


          <div className="grid grid-cols-2 gap-3">
            <button onClick={toHomeFromAnywhere} className="py-3 rounded-2xl border border-gray-300 active:scale-95">New Test</button>
            <button onClick={() => setView({ name: "history", athlete: r.athlete })}
              className="py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">See History</button>
          </div>
        </main>
      </div>
    );
  }

  if (view.name === "saiGate") {
    const r = view.summary;
    const drills = ["Short Dribble Cones (video)", "20m Sprint with Ball (video)", "Target Shooting – 5 attempts (video)"];
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="SAI – Eligibility" onBack={() => setView({ name: "result", athlete: r.athlete, summary: r })}
          profile={profile}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: r.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-5">
          <div className="rounded-2xl border border-gray-200 p-4 bg-emerald-50">
            <div className="font-semibold">L1 Percentile (SAI): {r.sai?.l1Percentile ?? 85}th</div>
            <div className="text-sm mt-1 text-emerald-700 font-medium">Eligible for Level 2</div>
          </div>
          <div className="rounded-2xl border border-gray-200 p-4">
            <div className="font-semibold mb-2">Level 2 – Football Drills</div>
            <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">{drills.map((d)=>(<li key={d}>{d}</li>))}</ul>
            <button onClick={() => {
              const uploads = Object.fromEntries(drills.map((d) => [d, null]));
              setView({ name: "level2", athlete: r.athlete, drills, uploads, fromResultId: r.id });
            }} className="mt-3 w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">Start Level 2 Uploads</button>
          </div>
        </main>
      </div>
    );
  }

  if (view.name === "level2") {
    const { drills, uploads } = view;
    function setUpload(label, file) {
      if (view.name !== "level2") return;
      const nextUploads = { ...uploads, [label]: file };
      setView({ ...view, uploads: nextUploads });
    }
    function submitL2() {
      const count = Object.values(uploads).filter(Boolean).length;
      if (count < 2) { alert("Please upload at least 2 drill videos."); return; }
      setView({ name: "submittedL2", athlete: view.athlete });
    }
    const fromSummary = history.find(h=>h.id===view.fromResultId) || null;
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Level 2 – Uploads"
          onBack={() => setView({ name: "saiGate", athlete: view.athlete, summary: fromSummary || { id: "tmp", athlete: view.athlete, testId: "", testTitle: "", createdAt: Date.now(), metrics: { value: 0, unit: "" }, stageBreakdown: [], flags: [] } })}
          profile={profile}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: view.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-5">
          {drills.map((label) => (
            <div key={label} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
              <div className="font-semibold text-sm">{label}</div>
              <label className="block mt-3">
                <div className="w-full rounded-2xl border border-dashed border-gray-300 p-4 text-center cursor-pointer active:scale-[.99]">
                  <div className="text-sm font-medium">Upload video</div>
                  <div className="text-xs text-gray-500">MP4 / MOV / WEBM</div>
                </div>
                <input type="file" accept="video/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0] || null; setUpload(label, f); }} />
              </label>
              {uploads[label] && (<div className="mt-2 text-xs text-gray-600 truncate">📹 {uploads[label].name}</div>)}
            </div>
          ))}
          <button onClick={submitL2} className="w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">Submit to SAI</button>
        </main>
      </div>
    );
  }

  if (view.name === "submittedL2") {
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="Submission Received"
          onBack={()=> setView({ name: "home", athlete: view.athlete })}
          profile={profile}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: view.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-6 space-y-4">
          <div className="rounded-2xl border border-gray-200 p-4 bg-emerald-50">
            <div className="font-semibold">Level 2 drills submitted to SAI</div>
            <div className="text-sm text-emerald-700 mt-1">Final SAI scorecard will be available in ~7 days (demo).</div>
          </div>
          <button onClick={()=> setView({ name: "history", athlete: view.athlete })}
            className="w-full py-3 rounded-2xl border border-gray-300 active:scale-95">View History</button>
          <button onClick={()=> setView({ name: "home", athlete: view.athlete })}
            className="w-full py-3 rounded-2xl bg-emerald-600 text-white active:scale-95">Back to Level 1</button>
        </main>
      </div>
    );
  }

  if (view.name === "history") {
    const list = history.filter((h) => h.athlete === view.athlete).reverse();
    return (
      <div className="min-h-dvh bg-white">
        <AppHeader title="History" onBack={toHomeFromAnywhere}
          profile={profile}
          onProfile={()=> setView({ name: "candidateHub", profile: profile || {name: view.athlete, gender: "", age: null} })} />
        <main className="mx-auto max-w-md px-4 py-5 space-y-4">
          {list.length === 0 ? (
            <div className="text-center text-sm text-gray-600">No sessions yet.</div>
          ) : (
            list.map((r) => (
              <div key={r.id} className="rounded-2xl border border-gray-200 p-4 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-600">{toRenderableText(r.testTitle, "Test")}</div>
                    <div className="font-semibold text-sm">{formatTime(r.createdAt)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-600">Result</div>
                    <div className="font-bold">{r.metrics.value} {toRenderableText(r.metrics.unit, "")}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {r.stageBreakdown.map((s) => (
                    <div key={s.stage} className="rounded-xl bg-white border border-gray-200 p-2">
                      <div className="text-[10px] text-gray-500">{toRenderableText(s.stage.split(" ")[0], "Stage")}</div>
                      <div className="text-sm font-semibold">{s.stage === "Consistency" ? `${s.score}%` : `${s.score}/100`}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </main>
      </div>
    );
  }

  return null;
}

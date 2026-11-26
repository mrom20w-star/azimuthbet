import { useEffect, useRef, useState } from "react";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getDatabase, onValue, ref } from "firebase/database";

const REGISTER_URL =
  "http://refpa48172.com/L?tag=d_6351867m_195736c_&site=6351867&ad=195736";
const PROMO_CODE = "AXC9";
const CRASH_DB_URL = "https://mrwan-dd795-default-rtdb.firebaseio.com";

type CrashPhase = "waiting" | "flight" | "crashed";

interface CrashCurrentData {
  roundNumber: number;
  phase: CrashPhase;
  crashPoint: number;
  roundStartedAt?: number;
  flightStartedAt?: number;
  updatedAt?: number;
}

interface LockedPrediction {
  roundNumber: number;
  crashPoint: number;
}

interface CompletedRound {
  roundNumber: number;
  crashPoint: number;
}

function getCrashDatabase() {
  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({ databaseURL: CRASH_DB_URL });
  return getDatabase(app);
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Strict round-sync refs
  const dbClosedRef = useRef<boolean>(false);
  const latestServerCurrentRef = useRef<CrashCurrentData | null>(null);
  const lockedPredictionRef = useRef<LockedPrediction | null>(null);

  const [progress, setProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);

  const [toastMsg, setToastMsg] = useState("تم النسخ بنجاح!");
  const [showToast, setShowToast] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [idError, setIdError] = useState(false);

  const [password, setPassword] = useState("");
  const [keyError, setKeyError] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [isActivated, setIsActivated] = useState(false);
  const [showCheckModal, setShowCheckModal] = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [showWarningModal, setShowWarningModal] = useState(false);

  // Firebase RTDB Crash Live State
  const [dbClosed, setDbClosed] = useState(false);
  const [dbErrorMsg, setDbErrorMsg] = useState<string | null>(null);
  const [livePhase, setLivePhase] = useState<CrashPhase | null>(null);
  const [liveRoundNumber, setLiveRoundNumber] = useState<number | null>(null);
  const [lockedPrediction, setLockedPrediction] =
    useState<LockedPrediction | null>(null);
  const [isFetchingRound, setIsFetchingRound] = useState(false);
  const [completedRounds, setCompletedRounds] = useState<CompletedRound[]>([]);

  // Blue Particle Background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const createParticle = () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2.2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.45,
      speedY: (Math.random() - 0.5) * 0.45,
      color: Math.random() > 0.5 ? "#3b82f6" : "#00d4ff",
      alpha: Math.random() * 0.55 + 0.15,
    });

    const particles = Array.from({ length: 50 }, createParticle);
    let rafId = 0;

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.speedX;
        p.y += p.speedY;
        if (
          p.x < 0 ||
          p.x > canvas.width ||
          p.y < 0 ||
          p.y > canvas.height
        ) {
          Object.assign(p, createParticle());
        }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      rafId = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // Initial Loader Progress
  useEffect(() => {
    let val = 0;
    let doneTimer: number | null = null;
    const interval = window.setInterval(() => {
      val += Math.random() * 2.2 + 1.2;
      if (val >= 100) {
        val = 100;
        window.clearInterval(interval);
        doneTimer = window.setTimeout(() => {
          setIsLoaded(true);
        }, 400);
      }
      setProgress(val);
    }, 65);

    return () => {
      window.clearInterval(interval);
      if (doneTimer) window.clearTimeout(doneTimer);
    };
  }, []);

  // Real-time Firebase RTDB synchronization (crash/current & crash/enabled)
  useEffect(() => {
    if (!isActivated) return;

    const db = getCrashDatabase();
    const currentRef = ref(db, "crash/current");
    const enabledRef = ref(db, "crash/enabled");

    let rootClosed = false;
    let enabledClosed = false;
    let permissionClosed = false;

    const syncClosedState = (reason?: string) => {
      const closed = rootClosed || enabledClosed || permissionClosed;
      dbClosedRef.current = closed;
      if (closed) {
        lockedPredictionRef.current = null;
        latestServerCurrentRef.current = null;
        setDbClosed(true);
        setDbErrorMsg(reason || "قاعدة البيانات مغلقة حالياً");
        setLockedPrediction(null);
        setLivePhase(null);
        setLiveRoundNumber(null);
      } else {
        setDbClosed(false);
        setDbErrorMsg(null);
      }
    };

    const handleCurrentSnapshotData = (raw: unknown) => {
      if (raw === false) {
        rootClosed = true;
        syncClosedState("قاعدة البيانات مغلقة حالياً");
        return;
      }

      if (dbClosedRef.current) return;
      if (!raw || typeof raw !== "object") return;

      const data = raw as Partial<CrashCurrentData>;
      const roundNumber =
        typeof data.roundNumber === "number" ? data.roundNumber : null;
      const phase =
        data.phase === "waiting" ||
        data.phase === "flight" ||
        data.phase === "crashed"
          ? data.phase
          : null;
      const crashPoint =
        typeof data.crashPoint === "number" ? data.crashPoint : null;

      if (roundNumber !== null && phase && crashPoint !== null) {
        latestServerCurrentRef.current = {
          roundNumber,
          phase,
          crashPoint,
          roundStartedAt: data.roundStartedAt,
          flightStartedAt: data.flightStartedAt,
          updatedAt: data.updatedAt,
        };
      }

      if (phase) setLivePhase(phase);
      if (roundNumber !== null) setLiveRoundNumber(roundNumber);

      // When a currently shown round finishes (crashed) or moves to a newer round,
      // reset the displayed odd back to 0.00x and wait for the user to press "ابدأ الدور".
      const activeLocked = lockedPredictionRef.current;
      if (
        activeLocked &&
        roundNumber !== null &&
        ((phase === "crashed" && roundNumber === activeLocked.roundNumber) ||
          roundNumber > activeLocked.roundNumber)
      ) {
        setCompletedRounds((prev) => {
          if (prev.some((r) => r.roundNumber === activeLocked.roundNumber)) {
            return prev;
          }
          return [
            {
              roundNumber: activeLocked.roundNumber,
              crashPoint: activeLocked.crashPoint,
            },
            ...prev.slice(0, 7),
          ];
        });
        lockedPredictionRef.current = null;
        setLockedPrediction(null);
      }
    };

    // Initial REST bootstrap to check root closure & cache current state
    const bootstrapFromRest = async () => {
      try {
        const [shallowRes, currentRes] = await Promise.all([
          fetch(`${CRASH_DB_URL}/crash.json?shallow=true`, {
            cache: "no-store",
          }),
          fetch(`${CRASH_DB_URL}/crash/current.json`, {
            cache: "no-store",
          }),
        ]);

        if (
          shallowRes.status === 401 ||
          shallowRes.status === 403 ||
          currentRes.status === 401 ||
          currentRes.status === 403
        ) {
          permissionClosed = true;
          syncClosedState("قاعدة البيانات مغلقة (صلاحية الوصول مرفوضة)");
          return;
        }

        if (shallowRes.ok) {
          const val = await shallowRes.json();
          if (val === false) {
            rootClosed = true;
            syncClosedState("قاعدة البيانات مغلقة حالياً من الإدارة");
            return;
          }
          rootClosed = false;
          syncClosedState();
        }

        if (currentRes.ok) {
          const currentData = await currentRes.json();
          handleCurrentSnapshotData(currentData);
        }
      } catch {
        // Ignore transient network check errors; onValue handles live state
      }
    };

    void bootstrapFromRest();

    const unsubEnabled = onValue(
      enabledRef,
      (snapshot) => {
        const enabledVal = snapshot.val();
        permissionClosed = false;
        if (enabledVal === false) {
          enabledClosed = true;
          syncClosedState("قاعدة البيانات مغلقة حالياً (crash/enabled = false)");
        } else {
          enabledClosed = false;
          syncClosedState();
        }
      },
      (err) => {
        const msg = String(err?.message || "");
        permissionClosed = true;
        if (
          msg.includes("PERMISSION_DENIED") ||
          msg.toLowerCase().includes("permission")
        ) {
          syncClosedState("قاعدة البيانات مغلقة (PERMISSION_DENIED)");
        } else {
          syncClosedState("قاعدة البيانات مغلقة أو غير متاحة حالياً");
        }
      }
    );

    const unsubCurrent = onValue(
      currentRef,
      (snapshot) => {
        const raw = snapshot.val();
        if (!raw || typeof raw !== "object") {
          if (raw === false) {
            rootClosed = true;
            syncClosedState("قاعدة البيانات مغلقة حالياً");
          }
          return;
        }
        handleCurrentSnapshotData(raw);
      },
      (err) => {
        const msg = String(err?.message || "");
        permissionClosed = true;
        if (
          msg.includes("PERMISSION_DENIED") ||
          msg.toLowerCase().includes("permission")
        ) {
          syncClosedState("قاعدة البيانات مغلقة (PERMISSION_DENIED)");
        } else {
          syncClosedState("قاعدة البيانات مغلقة أو تعذر الاتصال");
        }
      }
    );

    return () => {
      unsubEnabled();
      unsubCurrent();
    };
  }, [isActivated]);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setShowToast(false);
    }, 2500);
  };

  const copyText = (text: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const handleCopyPromo = () => {
    copyText(PROMO_CODE);
    triggerToast(`تم نسخ البرومو كود ${PROMO_CODE} بنجاح!`);
  };

  const handlePastePassword = async () => {
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          setPassword(text);
          triggerToast("تم لصق كلمة السر بنجاح!");
          return;
        }
      } catch {
        // fallback to focus
      }
    }
    keyInputRef.current?.focus();
    triggerToast("الصق كلمة السر داخل الحقل مباشرة");
  };

  const handleActivate = () => {
    const cleanId = accountId.trim();
    const cleanKey = password.trim();
    let hasErr = false;

    if (!cleanId || cleanId.length < 3) {
      setIdError(true);
      hasErr = true;
    } else {
      setIdError(false);
    }

    if (cleanKey.toUpperCase() === PROMO_CODE) {
      setKeyError(false);
    } else {
      setKeyError(true);
      hasErr = true;
    }

    if (hasErr) return;

    setCheckProgress(0);
    setShowCheckModal(true);

    let pct = 0;
    const interval = window.setInterval(() => {
      pct += 20;
      setCheckProgress(pct);
      if (pct >= 100) {
        window.clearInterval(interval);
        window.setTimeout(() => {
          setShowCheckModal(false);
          setShowWarningModal(true);
        }, 300);
      }
    }, 150);
  };

  const handleConfirmWarning = () => {
    setShowWarningModal(false);
    setIsActivated(true);
  };

  const handleStartRound = async () => {
    if (dbClosedRef.current) {
      triggerToast("قاعدة البيانات مغلقة حالياً!");
      return;
    }

    // If a prediction is already active for the current round, block re-fetch and notify user
    if (lockedPredictionRef.current !== null) {
      triggerToast("انتظر الجولة تخلص");
      return;
    }

    if (isFetchingRound) return;
    setIsFetchingRound(true);

    try {
      const [enabledRes, currentRes] = await Promise.all([
        fetch(`${CRASH_DB_URL}/crash/enabled.json`, { cache: "no-store" }),
        fetch(`${CRASH_DB_URL}/crash/current.json`, { cache: "no-store" }),
      ]);

      if (
        enabledRes.status === 401 ||
        enabledRes.status === 403 ||
        currentRes.status === 401 ||
        currentRes.status === 403
      ) {
        dbClosedRef.current = true;
        setDbClosed(true);
        setDbErrorMsg("قاعدة البيانات مغلقة (PERMISSION_DENIED)");
        triggerToast("قاعدة البيانات مغلقة حالياً");
        return;
      }

      if (enabledRes.ok) {
        const enabledVal = await enabledRes.json();
        if (enabledVal === false) {
          dbClosedRef.current = true;
          setDbClosed(true);
          setDbErrorMsg("قاعدة البيانات مغلقة حالياً (crash/enabled = false)");
          triggerToast("قاعدة البيانات مغلقة حالياً");
          return;
        }
      }

      let data: Partial<CrashCurrentData> | null = null;
      if (currentRes.ok) {
        const parsed = await currentRes.json();
        if (parsed === false) {
          dbClosedRef.current = true;
          setDbClosed(true);
          setDbErrorMsg("قاعدة البيانات مغلقة حالياً");
          triggerToast("قاعدة البيانات مغلقة حالياً");
          return;
        }
        if (parsed && typeof parsed === "object") {
          data = parsed as Partial<CrashCurrentData>;
        }
      }

      if (!data && latestServerCurrentRef.current) {
        data = latestServerCurrentRef.current;
      }

      const roundNumber =
        data && typeof data.roundNumber === "number" ? data.roundNumber : null;
      const phase =
        data &&
        (data.phase === "waiting" ||
          data.phase === "flight" ||
          data.phase === "crashed")
          ? data.phase
          : null;
      const crashPoint =
        data && typeof data.crashPoint === "number" ? data.crashPoint : null;

      if (phase) setLivePhase(phase);
      if (roundNumber !== null) setLiveRoundNumber(roundNumber);

      if (
        (phase === "waiting" || phase === "flight") &&
        roundNumber !== null &&
        crashPoint !== null &&
        crashPoint >= 1
      ) {
        const nextPrediction = { roundNumber, crashPoint };
        lockedPredictionRef.current = nextPrediction;
        setLockedPrediction(nextPrediction);
        triggerToast(`تم جلب توقع الجولة #${roundNumber} بنجاح ✈️`);
      } else if (phase === "crashed") {
        lockedPredictionRef.current = null;
        setLockedPrediction(null);
        triggerToast("انتظر الجولة تخلص وتبدأ الجولة الجديدة ثم اضغط ابدأ الدور");
      } else {
        triggerToast("لا توجد جولة نشطة حالياً، حاول مرة أخرى بعد لحظة");
      }
    } catch {
      triggerToast("تعذر الاتصال بقاعدة البيانات");
    } finally {
      setIsFetchingRound(false);
    }
  };

  const getStepMessage = () => {
    if (dbClosed) {
      return dbErrorMsg || "قاعدة البيانات مغلقة — التوقعات متوقفة";
    }
    if (!lockedPrediction) {
      return 'اضغط "ابدأ الدور" لجلب توقع الجولة الحالية';
    }
    if (livePhase === "waiting") {
      return `الجولة #${lockedPrediction.roundNumber}: توقع مؤكد قبل الإقلاع ✈️`;
    }
    if (livePhase === "flight") {
      return `الجولة #${lockedPrediction.roundNumber}: الجولة شغالة الآن (انتظر انتهاء الجولة)`;
    }
    return `الجولة #${lockedPrediction.roundNumber}: توقع الجولة جاهز ✈️`;
  };

  const getStatusBadgeText = () => {
    if (dbClosed) return "قاعدة البيانات مغلقة";
    if (livePhase === "waiting") return "WAITING · جولة متاحة";
    if (livePhase === "flight") return "FLIGHT · الجولة شغالة";
    if (livePhase === "crashed") return "CRASHED · انتهت الجولة";
    return "متصل بالنسخة";
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        id="bgCanvas"
        className="fixed inset-0 w-full h-full pointer-events-none z-0"
      />
      <div className="glow-orb-blue" />
      <div className="glow-orb-cyan" />

      {/* Toast Notification */}
      <div
        id="toast"
        className={`fixed top-5 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-slate-900/95 border border-blue-500/50 text-sky-300 font-bold text-xs sm:text-sm shadow-[0_0_35px_rgba(37,99,235,0.6)] transition-all duration-300 flex items-center gap-2 backdrop-blur-md ${
          showToast ? "" : "hidden"
        }`}
      >
        <i className="fa-solid fa-circle-check text-cyan-400" />
        <span id="toastMsg">{toastMsg}</span>
      </div>

      {/* Header */}
      <header className="relative z-10 w-full max-w-xl mx-auto flex items-center justify-between p-3.5 sm:p-4 rounded-2xl glass-card mb-4 border-blue-500/40">
        <a
          href={REGISTER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 group"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl p-0.5 bg-gradient-to-tr from-blue-600 via-sky-500 to-cyan-400 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(37,99,235,0.6)] overflow-hidden">
            <img
              src="/hu.png"
              alt="AzimutBet Logo"
              className="w-full h-full object-cover rounded-[14px]"
            />
          </div>
          <div className="flex flex-col">
            <span className="cyber-font font-black text-lg sm:text-xl tracking-wider flex items-center gap-1.5 text-white group-hover:text-sky-300 transition-colors">
              <span>AzimutBet</span>
              <span className="text-[9px] text-sky-300 font-mono bg-blue-500/20 px-2 py-0.5 rounded-full border border-blue-500/40">
                AVIATOR PRO v9.2
              </span>
            </span>
            <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              AzimutBet ENGINE ACTIVE
            </span>
          </div>
        </a>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyPromo}
            title="نسخ البرومو كود"
            className="px-2.5 py-1.5 rounded-xl bg-slate-950/90 border border-sky-500/50 text-sky-300 text-xs font-bold flex items-center gap-1.5 hover:bg-sky-500/20 transition-all shadow-[0_0_15px_rgba(14,165,233,0.25)] cursor-pointer whitespace-nowrap shrink-0"
          >
            <i className="fa-solid fa-ticket text-cyan-400 text-xs" />
            <span className="cyber-font font-black tracking-wider">
              {PROMO_CODE}
            </span>
            <i className="fa-solid fa-copy text-[10px] text-cyan-400/80" />
          </button>

          <a
            href={REGISTER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-xl bg-blue-500/20 border border-blue-400/50 text-sky-300 text-xs font-bold flex items-center gap-1.5 hover:bg-blue-500/30 transition-all shadow-[0_0_15px_rgba(37,99,235,0.3)] whitespace-nowrap shrink-0"
          >
            <i className="fa-solid fa-user-plus text-xs" />
            <span className="hidden sm:inline">تسجيل جديد</span>
          </a>
        </div>
      </header>

      {/* Screen 1: Loader */}
      {!isLoaded && (
        <div
          id="screen1_Loader"
          className="relative z-10 w-full max-w-xl mx-auto my-auto text-center py-6"
        >
          <div className="flex items-center justify-between gap-2 mb-8 px-2 text-xs">
            <div className="flex items-center gap-2 bg-slate-950/90 border border-blue-500/40 px-3.5 py-1.5 rounded-full text-blue-400 backdrop-blur-md shadow-lg">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
              </span>
              <span className="font-bold tracking-wider uppercase text-[10px] sm:text-xs">
                AZIMUTBET CORE: ACTIVE
              </span>
            </div>

            <div className="flex items-center gap-2 bg-slate-950/90 border border-sky-500/40 px-3.5 py-1.5 rounded-full text-sky-300 backdrop-blur-md shadow-lg">
              <i className="fa-solid fa-plane-up text-cyan-400 text-xs animate-pulse" />
              <span className="font-bold tracking-wider text-[10px] sm:text-xs">
                AVIATOR PREDICTOR
              </span>
            </div>
          </div>

          <div className="relative w-52 h-52 sm:w-60 sm:h-60 mx-auto mb-8 flex items-center justify-center">
            <div className="loader-portal">
              <div className="loader-ring loader-ring-1" />
              <div className="loader-ring loader-ring-2" />
              <div className="loader-ring loader-ring-3" />
              <div className="loader-core-pulse" />
              <div className="relative z-10 flex flex-col items-center justify-center">
                <span className="text-5xl sm:text-6xl mb-1 filter drop-shadow-[0_0_20px_rgba(0,212,255,0.9)] animate-bounce text-cyan-300">
                  ✈️
                </span>
                <h1 className="cyber-font text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-[0_0_20px_rgba(37,99,235,0.9)]">
                  AzimutBet
                </h1>
                <span className="text-[9px] text-sky-300 font-mono tracking-widest uppercase">
                  AVIATOR VIP v9.2
                </span>
              </div>
            </div>
          </div>

          <div className="mb-6">
            <span className="text-xs sm:text-sm font-bold text-slate-200 bg-slate-950/90 border border-blue-500/50 px-5 py-2 rounded-full backdrop-blur-md shadow-lg inline-block">
              <i className="fa-solid fa-microchip text-cyan-400 me-2 animate-pulse" />
              جاري الاتصال بسيرفرات منصة AzimutBet...
            </span>
          </div>

          <div className="space-y-3 max-w-md mx-auto px-2">
            <div className="flex justify-between items-center text-xs font-bold">
              <span
                id="loaderStatusMsg"
                className="text-sky-300 flex items-center gap-2"
              >
                <i className="fa-solid fa-circle-notch fa-spin text-cyan-400" />
                تحضير خوارزمية كشف الطيارة...
              </span>
              <span
                id="loaderPercent"
                className="cyber-font text-lg text-cyan-400 tabular-nums"
              >
                {Math.floor(progress)}%
              </span>
            </div>

            <div className="w-full h-4 bg-slate-950 border border-blue-500/40 rounded-full p-0.5 shadow-inner overflow-hidden">
              <div
                id="loaderBar"
                className="h-full bg-gradient-to-r from-blue-600 via-sky-500 to-cyan-300 rounded-full transition-all duration-200 shadow-[0_0_25px_rgba(37,99,235,0.9)]"
                style={{ width: `${progress}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-slate-400 font-mono">
              <span id="loaderBytes" className="tabular-nums">
                {progress > 0
                  ? `${Math.floor((progress / 100) * 3800)} / 3800 KEYS READY`
                  : "0 KB / 3800 KEYS VAULT"}
              </span>
              <span className="text-cyan-400">STATUS: READY</span>
            </div>
          </div>
        </div>
      )}

      {/* Screen 2: Dashboard */}
      {isLoaded && (
        <div
          id="screen2_Dashboard"
          className="relative z-10 w-full max-w-xl mx-auto space-y-5 pb-10 my-auto"
        >
          {/* Promo & Registration Card */}
          <div className="glass-card p-4 sm:p-5 border-sky-500/40 shadow-[0_0_35px_rgba(14,165,233,0.18)] space-y-4">
            <div className="text-center border-b border-slate-800 pb-3">
              <h2 className="cyber-font font-black text-xl sm:text-2xl text-white">
                سكربت لعبة الطيارة -{" "}
                <a
                  href={REGISTER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:text-cyan-300 underline decoration-sky-400/50 transition-colors"
                >
                  منصة AzimutBet
                </a>
              </h2>
              <p className="text-xs text-slate-300 mt-1">
                استخدم البرومو كود الخاص بنا لضمان أفضل دقة لتوقعات السكربت
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-sky-500/50 flex items-center justify-between gap-3 shadow-inner">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-sky-500/20 border border-sky-400/60 flex items-center justify-center text-cyan-400 text-xl shrink-0 shadow-[0_0_15px_rgba(14,165,233,0.4)]">
                  <i className="fa-solid fa-ticket" />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-mono block">
                    البرومو كود المعتمد:
                  </span>
                  <span className="cyber-font text-2xl font-black tracking-wider text-cyan-300">
                    {PROMO_CODE}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyPromo}
                className="btn-cyan px-4 py-2.5 rounded-xl text-slate-950 font-black text-xs uppercase flex items-center gap-2 active:scale-95 shrink-0 cursor-pointer"
              >
                <i className="fa-solid fa-copy" />
                <span>نسخ البرومو</span>
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/80 border border-blue-500/35 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-200 font-bold">
                <i className="fa-solid fa-wallet text-cyan-400 text-sm shrink-0" />
                <span>الحد الأدنى للإيداع لتشغيل السكربت:</span>
              </div>
              <span className="cyber-font font-black text-cyan-300 tabular-nums shrink-0">
                5$ أو 300 ج.م
              </span>
            </div>

            <div>
              <a
                href={REGISTER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-blue w-full py-3.5 px-4 rounded-xl text-white font-black text-xs sm:text-sm uppercase flex items-center justify-center gap-2 shadow-xl active:scale-95"
              >
                <i className="fa-solid fa-arrow-up-right-from-square text-base" />
                <span>رابط التسجيل المباشر في منصة AzimutBet</span>
              </a>
            </div>
          </div>

          {/* Auth Section */}
          {!isActivated && (
            <div
              id="authSection"
              className="glass-card p-4 sm:p-5 border-blue-500/40 space-y-4 shadow-[0_0_30px_rgba(37,99,235,0.2)]"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-400/50 flex items-center justify-center text-cyan-400 text-base">
                    <i className="fa-solid fa-key" />
                  </div>
                  <div>
                    <h3 className="cyber-font font-bold text-sm sm:text-base text-white">
                      تفعيل سكربت{" "}
                      <a
                        href={REGISTER_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-cyan-300 underline decoration-sky-400/50 transition-colors"
                      >
                        AzimutBet
                      </a>
                    </h3>
                    <span className="text-[10px] text-slate-400 block">
                      أدخل ID الحساب وكلمة السر لبدء تشغيل السكربت ·{" "}
                      <a
                        href={REGISTER_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-cyan-300 underline font-bold"
                      >
                        التسجيل في المنصة
                      </a>
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="idInput"
                  className="block text-xs font-bold text-slate-300"
                >
                  <i className="fa-solid fa-id-card me-1 text-sky-400" /> ID
                  الحساب (أرقام فقط):
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="idInput"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={accountId}
                    onChange={(e) => {
                      setAccountId(e.target.value.replace(/[^0-9]/g, ""));
                      if (idError) setIdError(false);
                    }}
                    placeholder="أدخل ID الحساب الخاص بك..."
                    className="w-full glass-input rounded-xl px-4 py-3 text-white text-sm font-mono tracking-wider placeholder:text-slate-500"
                  />
                </div>
                {idError && (
                  <p
                    id="idErrorText"
                    className="text-sky-400 text-xs font-bold mt-1 flex items-center gap-1"
                  >
                    <i className="fa-solid fa-circle-xmark" />
                    <span>يرجى إدخال ID الحساب (أرقام فقط)!</span>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="keyInput"
                  className="block text-xs font-bold text-slate-300"
                >
                  <i className="fa-solid fa-lock me-1 text-cyan-400" /> كلمة
                  السر الخاصة بالسكربت:
                </label>
                <div className="relative">
                  <input
                    ref={keyInputRef}
                    type={showPassword ? "text" : "password"}
                    id="keyInput"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (keyError) setKeyError(false);
                    }}
                    placeholder="أدخل كلمة السر هنا..."
                    className="w-full glass-input rounded-xl px-4 py-3 text-white text-sm font-mono tracking-wider placeholder:text-slate-500 pl-24"
                  />
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="p-1.5 text-slate-400 hover:text-white text-xs cursor-pointer"
                      aria-label="إظهار أو إخفاء كلمة السر"
                    >
                      <i
                        id="eyeIcon"
                        className={`fa-solid ${
                          showPassword ? "fa-eye-slash" : "fa-eye"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={handlePastePassword}
                      className="text-xs text-cyan-300 font-bold bg-sky-500/10 px-2 py-1 rounded-lg border border-sky-500/30 hover:bg-sky-500/20 cursor-pointer"
                    >
                      لصق
                    </button>
                  </div>
                </div>
                {keyError && (
                  <p
                    id="keyErrorText"
                    className="text-sky-400 text-xs font-bold mt-1 flex items-center gap-1"
                  >
                    <i className="fa-solid fa-circle-xmark" />
                    <span>
                      كلمة السر غير صحيحة! يرجى إدخال كلمة السر المعتمدة.
                    </span>
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleActivate}
                className="btn-blue w-full py-3.5 px-4 rounded-xl text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-2xl active:scale-98 cursor-pointer"
              >
                <i className="fa-solid fa-bolt text-cyan-300 animate-pulse text-base" />
                <span>تأكيد البيانات وتفعيل السكربت</span>
              </button>
            </div>
          )}

          {/* Active Automatic Aviator Predictor synced to Firebase RTDB (No Start/Control Buttons) */}
          {isActivated && (
            <div id="activeGameContainer" className="space-y-4">
              <div
                id="engineAviator"
                className="glass-card p-4 sm:p-5 space-y-4 border-blue-500/50 shadow-[0_0_30px_rgba(37,99,235,0.28)]"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-cyan-400/60 flex items-center justify-center text-xl text-cyan-300 shadow-[0_0_15px_rgba(0,212,255,0.3)]">
                      <i className="fa-solid fa-plane-departure" />
                    </div>
                    <div>
                      <h3 className="cyber-font font-bold text-sm sm:text-base text-white">
                        سكربت الطيارة -{" "}
                        <a
                          href={REGISTER_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-400 hover:text-cyan-300 underline decoration-sky-400/40"
                        >
                          AzimutBet VIP
                        </a>
                      </h3>
                      <span
                        id="aviatorStepText"
                        className={`text-xs font-mono block ${
                          dbClosed ? "text-amber-300" : "text-cyan-300"
                        }`}
                      >
                        {getStepMessage()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Round & Live Firebase Sync Badges */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-sky-300 font-mono font-bold bg-slate-950 px-3.5 py-1.5 rounded-full border border-blue-500/40 tabular-nums">
                    {lockedPrediction
                      ? `الجولة #${lockedPrediction.roundNumber}`
                      : liveRoundNumber !== null
                        ? `الجولة الحالية #${liveRoundNumber}`
                        : "مزامنة الجولة..."}
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border tabular-nums flex items-center gap-1.5 ${
                      dbClosed
                        ? "text-amber-300 bg-amber-500/10 border-amber-500/40"
                        : "text-cyan-300 bg-sky-500/10 border-sky-500/30"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        dbClosed
                          ? "bg-amber-400"
                          : "bg-cyan-400 animate-ping"
                      }`}
                    />
                    <span>{getStatusBadgeText()}</span>
                  </span>
                </div>

                {/* Database Closed Alert OR Live Aviator Radar Display */}
                {dbClosed ? (
                  <div className="rounded-2xl bg-slate-950/95 border border-amber-500/50 p-6 text-center space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/15 border border-amber-400/50 flex items-center justify-center text-amber-300 text-2xl">
                      <i className="fa-solid fa-lock" />
                    </div>
                    <h4 className="cyber-font font-black text-base text-amber-300">
                      قاعدة البيانات مغلقة
                    </h4>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {dbErrorMsg ||
                        "تم إيقاف عرض التوقعات لأن قاعدة البيانات مغلقة حالياً."}
                    </p>
                  </div>
                ) : (
                  <div className="relative rounded-2xl bg-slate-950/95 border border-blue-500/40 overflow-hidden p-5 sm:p-6 flex flex-col items-center justify-center min-h-[210px] shadow-inner">
                    {/* Subtle Grid Lines */}
                    <div
                      className="absolute inset-0 opacity-20 pointer-events-none"
                      style={{
                        backgroundImage:
                          "linear-gradient(to right, rgba(59,130,246,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(59,130,246,0.22) 1px, transparent 1px)",
                        backgroundSize: "28px 28px",
                      }}
                    />

                    {/* Radar Glow Sweep */}
                    <div className="absolute w-52 h-52 rounded-full border border-blue-500/20 flex items-center justify-center pointer-events-none">
                      <div className="w-full h-full rounded-full radar-sweep opacity-50" />
                      <div className="absolute inset-8 rounded-full border border-sky-400/20" />
                    </div>

                    {/* Flight Curve SVG */}
                    <svg
                      viewBox="0 0 320 120"
                      className="absolute inset-x-0 bottom-0 w-full h-28 pointer-events-none opacity-65"
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient
                          id="aviatorFill"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#00d4ff"
                            stopOpacity="0.38"
                          />
                          <stop
                            offset="100%"
                            stopColor="#2563eb"
                            stopOpacity="0"
                          />
                        </linearGradient>
                      </defs>
                      <path
                        d="M0,115 Q160,105 305,15 L305,120 L0,120 Z"
                        fill="url(#aviatorFill)"
                      />
                      <path
                        d="M0,115 Q160,105 305,15"
                        fill="none"
                        stroke="#00d4ff"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>

                    {/* Center Multiplier Readout */}
                    <div className="relative z-10 flex flex-col items-center text-center gap-2">
                      <div className="flex items-center gap-2 text-xs font-mono text-sky-300">
                        <i
                          className={`fa-solid fa-plane-up text-cyan-400 ${
                            livePhase === "flight" && lockedPrediction
                              ? "animate-bounce"
                              : ""
                          }`}
                        />
                        <span>
                          {lockedPrediction
                            ? "نقطة الانفجار المؤكدة للجولة"
                            : "جاهز لجلب توقع الجولة"}
                        </span>
                      </div>

                      <div
                        key={
                          lockedPrediction
                            ? `round-${lockedPrediction.roundNumber}`
                            : "zero-ready"
                        }
                        className={`cyber-font text-5xl sm:text-6xl font-black tracking-tight tabular-nums ${
                          lockedPrediction
                            ? "text-cyan-300 drop-shadow-[0_0_28px_rgba(0,212,255,0.85)] multiplier-pop"
                            : "text-blue-400/70"
                        }`}
                      >
                        {lockedPrediction
                          ? `${lockedPrediction.crashPoint.toFixed(2)}x`
                          : "0.00x"}
                      </div>

                      <span className="text-[11px] font-mono text-slate-300 tabular-nums">
                        {lockedPrediction
                          ? livePhase === "waiting"
                            ? "الحالة: انتظار الإقلاع — التوقع جاهز 100%"
                            : "الحالة: الجولة شغالة — انتظر الجولة تخلص"
                          : 'اضغط "ابدأ الدور" لجلب توقع الجولة الحالية'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Manual Start Round Button */}
                {!dbClosed && (
                  <div className="pt-1">
                    <button
                      type="button"
                      id="aviatorStartRoundBtn"
                      onClick={handleStartRound}
                      disabled={isFetchingRound}
                      className="btn-blue w-full py-3.5 px-4 rounded-xl text-white font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-xl active:scale-95 cursor-pointer disabled:opacity-60"
                    >
                      <i
                        className={`fa-solid ${
                          isFetchingRound
                            ? "fa-circle-notch fa-spin"
                            : lockedPrediction
                              ? "fa-hourglass-half"
                              : "fa-play"
                        } text-cyan-300 text-sm`}
                      />
                      <span>
                        {isFetchingRound
                          ? "جاري جلب التوقع..."
                          : "ابدأ الدور"}
                      </span>
                    </button>
                  </div>
                )}

                {/* Observed Completed Rounds History (100% Real from Firebase RTDB) */}
                {!dbClosed && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>سجل الجولات المكتملة:</span>
                      <span className="text-sky-400">FIREBASE LIVE SYNC</span>
                    </div>
                    {completedRounds.length === 0 ? (
                      <div className="rounded-xl bg-slate-950/80 border border-blue-500/25 py-2.5 px-3 text-center text-[11px] text-slate-400 font-mono">
                        سيتم تسجيل نتائج الجولات فور انتهاء كل جولة مباشرة
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2">
                        {completedRounds.slice(0, 4).map((item) => (
                          <div
                            key={item.roundNumber}
                            className="rounded-xl bg-slate-950/90 border border-blue-500/35 py-2 px-2 text-center"
                          >
                            <div className="cyber-font text-sm font-black text-cyan-300 tabular-nums">
                              {item.crashPoint.toFixed(2)}x
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                              #{item.roundNumber}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Password Check Modal */}
      {showCheckModal && (
        <div
          id="checkModal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
        >
          <div className="glass-card p-6 sm:p-8 max-w-sm w-full text-center border-blue-500/50 shadow-[0_0_60px_rgba(37,99,235,0.35)] space-y-4">
            <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
              <div className="loader-ring loader-ring-1" />
              <i className="fa-solid fa-shield-halved text-2xl text-cyan-400 animate-pulse" />
            </div>
            <h3 className="cyber-font font-bold text-lg text-white">
              جاري التحقق من كلمة السر...
            </h3>
            <p className="text-xs text-slate-300">يتم الآن الاتصال بالسيرفر</p>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-blue-500/30">
              <div
                id="modalCheckBar"
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${checkProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Important Notice Modal */}
      {showWarningModal && (
        <div
          id="warningModal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl"
        >
          <div className="glass-card p-6 sm:p-7 max-w-md w-full border-blue-500/70 shadow-[0_0_70px_rgba(37,99,235,0.4)] space-y-5 text-right relative">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-sky-400/60 flex items-center justify-center text-cyan-300 text-2xl shrink-0">
                ✈️
              </div>
              <div>
                <h3 className="cyber-font font-black text-lg sm:text-xl text-sky-400">
                  تنبيه هام
                </h3>
                <span className="text-[10px] text-slate-400 font-mono">
                  تعليمات تشغيل سكربت لعبة الطيارة
                </span>
              </div>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-slate-200 leading-relaxed bg-slate-950/90 p-4 rounded-2xl border border-slate-800">
              <p className="font-bold text-white leading-relaxed">
                الاسكربت يعمل فقط على منصه{" "}
                <a
                  href={REGISTER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 underline hover:text-cyan-300 font-black"
                >
                  AzimutBet
                </a>{" "}
                و الحسابات المسجّلة بالبرومو كود الخاص بنا لضمان التشغيل الصحيح
                💯
              </p>

              <div className="p-3 rounded-xl bg-blue-500/10 border border-sky-500/40 flex items-start gap-2.5 text-xs">
                <i className="fa-solid fa-coins text-cyan-300 text-base mt-0.5 shrink-0" />
                <p className="font-bold text-sky-200 leading-relaxed">
                  يشترط عمل إيداع لا يقل عن{" "}
                  <span className="text-cyan-300 font-black">5 دولار</span> أو{" "}
                  <span className="text-cyan-300 font-black">
                    300 جنيه مصري
                  </span>{" "}
                  في حسابك على المنصة لضمان تفعيل السكربت والربط التلقائي بشكل
                  صحيح.
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <p className="font-bold text-sky-400 flex items-center gap-1.5">
                  <i className="fa-solid fa-circle-check" />
                  <span>
                    ✅ سجّل الآن على{" "}
                    <a
                      href={REGISTER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-300 underline hover:text-sky-300 font-black"
                    >
                      منصة AzimutBet
                    </a>{" "}
                    واستخدم البرومو كود الخاص بنا:
                  </span>
                </p>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-sky-500/40 flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-300">🎟️ Promo Code:</span>
                  <span className="cyber-font text-base font-black text-cyan-300">
                    {PROMO_CODE}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPromo}
                    className="text-[10px] bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 px-2 py-1 rounded-lg border border-sky-500/40 font-bold cursor-pointer"
                  >
                    نسخ
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <a
                href={REGISTER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-cyan flex-1 py-3 px-4 rounded-xl text-slate-950 font-black text-xs text-center uppercase flex items-center justify-center gap-2 active:scale-95"
              >
                <i className="fa-solid fa-link" />
                <span>التسجيل في AzimutBet</span>
              </a>
              <button
                type="button"
                onClick={handleConfirmWarning}
                className="btn-blue flex-1 py-3 px-4 rounded-xl text-white font-bold text-xs text-center uppercase flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <i className="fa-solid fa-check-double" />
                <span>فهمت ذلك</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

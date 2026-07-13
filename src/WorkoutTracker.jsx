import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

/* ----------------------------- helpers ----------------------------- */

const STORE_KEY = "training-log:v3";
const V2_KEY = "training-log:v2";
const V1_KEY = "training-log:v1";
const KG_PER_LB = 0.45359237;
const KM_PER_MI = 1.609344;

const todayStr = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const round = (n, p = 1) => { const f = 10 ** p; return Math.round(n * f) / f; };

const toKg = (v, sys) => (sys === "imperial" ? v * KG_PER_LB : v);
const fromKg = (v, sys) => (sys === "imperial" ? v / KG_PER_LB : v);
const toKm = (v, sys) => (sys === "imperial" ? v * KM_PER_MI : v);
const fromKm = (v, sys) => (sys === "imperial" ? v / KM_PER_MI : v);

const fmtDate = (s) => { const [y, m, d] = s.split("-"); return `${m}/${d}`; };
const fmtDateLong = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
const fmtPace = (minutes, dist) => {
  if (!dist || dist <= 0) return "—";
  const pace = minutes / dist;
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const entryVolKg = (e) => e.sets.reduce((a, x) => a + x.weightKg * x.reps, 0);
const migrateStrength = (arr) =>
  (arr || []).map((e) => {
    if (Array.isArray(e.sets)) return e;
    const n = typeof e.sets === "number" ? e.sets : 1;
    return { id: e.id || uid(), date: e.date, exercise: e.exercise,
      sets: Array.from({ length: n }, () => ({ weightKg: e.weightKg || 0, reps: e.reps || 0 })) };
  });
const blankSet = () => ({ w: "", r: "" });
const numOrNull = (s) => (s === "" ? null : parseFloat(s));

// nutrition v1 helpers
const foodServings = (food) => {
  const base = food.servings && food.servings.length ? food.servings : [{ label: "serving", grams: 100 }];
  return [...base, { label: "grams", grams: 1 }];
};
const scaleMacros = (per100, grams) => ({
  cal: (per100.cal || 0) * grams / 100,
  protein: (per100.protein || 0) * grams / 100,
  carbs: (per100.carbs || 0) * grams / 100,
  fat: (per100.fat || 0) * grams / 100,
});
const sumDiet = (entries) => entries.reduce((a, e) => ({
  cal: a.cal + e.computed.cal, protein: a.protein + e.computed.protein,
  carbs: a.carbs + e.computed.carbs, fat: a.fat + e.computed.fat,
}), { cal: 0, protein: 0, carbs: 0, fat: 0 });

const TYPES = {
  strength: { label: "Strength", desc: "Lifts — weight, reps, sets", color: "var(--strength)" },
  cardio: { label: "Cardio", desc: "Time, calories, distance, pace", color: "var(--cardio)" },
  body: { label: "Nutrition", desc: "Bodyweight & calorie intake", color: "var(--body)" },
};

// Newest first. Every change to the app gets an entry here.
const CHANGELOG = [
  { date: "Jun 27, 2026", page: "Nutrition", summary: "Shipped food logging v1: personal food library, custom foods and quick-add, and food-by-food daily logging with serving-size scaling. A day's calories and macros are now summed from logged foods; history shows daily totals that tap to expand into individual foods. Bodyweight stays a separate daily field; older manually-typed days are preserved and flagged \u201cmanual.\u201d" },
  { date: "Jun 27, 2026", page: "Setup", summary: "Added an in-app Food Logging Setup form (in the menu) to capture the v1 decision points, assumptions, and notes; answers save on-device with a copy-to-share summary." },
  { date: "Jun 27, 2026", page: "Home", summary: "Moved the date selector up beside the unit toggle and menu button so all three align with the 'THE LOG' title on one row; matched their heights." },
  { date: "Jun 27, 2026", page: "Header", summary: "Aligned the top-right controls (unit toggle and menu button) to the 'THE LOG' title by moving them onto the same row." },
  { date: "Jun 27, 2026", page: "Home", summary: "Removed the 'What are you training?' heading from the Home page." },
  { date: "Jun 27, 2026", page: "Analytics", summary: "Added a dashboard skeleton — controls bar, KPI tiles, chart panels, and table panels — as a non-functional layout framework." },
  { date: "Jun 27, 2026", page: "Nutrition", summary: "Renamed the 'Body' section to 'Nutrition' across the home card, page header, and history." },
  { date: "Jun 27, 2026", page: "Home", summary: "Removed the daily summary scoreboard from the top of the Home page." },
];

// Food-logging setup form (decision intake, answered in-app)
const SETUP_Q = {
  a1: { q: "Quick-add food — minimum required fields", opts: ["Name + calories only (macros optional)", "Name + calories + protein required"], rec: 0 },
  a2: { q: "Legacy manual days (old totals, no foods)", opts: ["Leave read-only, flagged \u201cmanual\u201d", "Add \u201cconvert to a custom food\u201d"], rec: 0 },
  a3: { q: "Quantity entry when logging a food", opts: ["Serving \u00d7 multiplier (grams always available)", "Raw grams only"], rec: 0 },
  a4: { q: "Bodyweight in the expanded history detail", opts: ["Collapsed summary row only", "Also repeat in the expanded detail"], rec: 0 },
};
const SETUP_B = [
  ["b1", "Per-100g storage; each log snapshots the food"],
  ["b2", "Bodyweight stays a separate manual daily field"],
  ["b3", "Extend saved data to v3 (foods + diet); keep existing entries"],
  ["b4", "v1 = library + custom + quick-add + logging + scaling; no external APIs"],
  ["b5", "Origin tags built now; v1 results labeled \u201cYour library\u201d"],
  ["b6", "Meals / composites deferred to v3; no nesting"],
  ["b7", "Change Log: one entry per shipped phase (Nutrition)"],
];
const DEFAULT_SETUP = {
  a1: null, a2: null, a3: null, a4: null,
  b: { b1: "confirm", b2: "confirm", b3: "confirm", b4: "confirm", b5: "confirm", b6: "confirm", b7: "confirm" },
  go: null, notes: "",
};

/* ----------------------------- component --------------------------- */

export default function WorkoutTracker() {
  const [data, setData] = useState({ strength: [], cardio: [], body: [], foods: [], diet: [] });
  const [system, setSystem] = useState("metric");
  const [loaded, setLoaded] = useState(false);

  const [view, setView] = useState("home"); // home | strength | cardio | body | history | analytics | changelog | setup
  const [menuOpen, setMenuOpen] = useState(false);
  const [setup, setSetup] = useState(DEFAULT_SETUP);
  const [copied, setCopied] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [editing, setEditing] = useState(null);

  const [sEx, setSEx] = useState("");
  const [sSets, setSSets] = useState([blankSet()]);

  const [cAct, setCAct] = useState("");
  const [cMin, setCMin] = useState("");
  const [cCal, setCCal] = useState("");
  const [cDist, setCDist] = useState("");
  const [cHr, setCHr] = useState("");

  const [bBw, setBBw] = useState("");
  const [bCal, setBCal] = useState("");
  const [bProt, setBProt] = useState("");
  const [bCarb, setBCarb] = useState("");
  const [bFat, setBFat] = useState("");

  // nutrition v1: bodyweight + food logging
  const [nBw, setNBw] = useState("");
  const [foodQuery, setFoodQuery] = useState("");
  const [panel, setPanel] = useState(null);        // 'log' | 'quick' | 'create' | null
  const [logFood, setLogFood] = useState(null);
  const [logServ, setLogServ] = useState(0);
  const [logQty, setLogQty] = useState("1");
  const [editingDiet, setEditingDiet] = useState(null);
  const [qName, setQName] = useState(""); const [qCal, setQCal] = useState("");
  const [qProt, setQProt] = useState(""); const [qCarb, setQCarb] = useState(""); const [qFat, setQFat] = useState("");
  const [cfName, setCfName] = useState(""); const [cfBrand, setCfBrand] = useState("");
  const [cfBasis, setCfBasis] = useState("100g");
  const [cfCal, setCfCal] = useState(""); const [cfProt, setCfProt] = useState(""); const [cfCarb, setCfCarb] = useState(""); const [cfFat, setCfFat] = useState("");
  const [cfServLabel, setCfServLabel] = useState(""); const [cfServGrams, setCfServGrams] = useState("");
  const [expandDays, setExpandDays] = useState({});

  const [err, setErr] = useState("");
  const [chartView, setChartView] = useState("volume");
  const [chartEx, setChartEx] = useState("__all__");

  const wUnit = system === "imperial" ? "lb" : "kg";
  const dUnit = system === "imperial" ? "mi" : "km";

  /* ---------- load ---------- */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (window.storage) {
          let parsed = null;
          try { const res = await window.storage.get(STORE_KEY); if (res && res.value) parsed = JSON.parse(res.value); } catch (e) {}
          if (!parsed) { try { const v2 = await window.storage.get(V2_KEY); if (v2 && v2.value) parsed = JSON.parse(v2.value); } catch (e) {} }
          if (!parsed) { try { const v1 = await window.storage.get(V1_KEY); if (v1 && v1.value) parsed = JSON.parse(v1.value); } catch (e) {} }
          if (live && parsed) {
            setData({
              strength: migrateStrength(parsed.strength),
              cardio: parsed.cardio || [],
              body: parsed.body || [],
              foods: parsed.foods || [],
              diet: parsed.diet || [],
            });
            if (parsed.system) setSystem(parsed.system);
            if (parsed.setup) setSetup({ ...DEFAULT_SETUP, ...parsed.setup, b: { ...DEFAULT_SETUP.b, ...(parsed.setup.b || {}) } });
          }
        }
      } catch (e) {} finally { if (live) setLoaded(true); }
    })();
    return () => { live = false; };
  }, []);

  /* ---------- save ---------- */
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try { if (window.storage) await window.storage.set(STORE_KEY, JSON.stringify({ ...data, system, setup })); } catch (e) {}
    })();
  }, [data, system, setup, loaded]);

  /* ---------- selected day ---------- */
  const dayStrength = useMemo(() => data.strength.filter((e) => e.date === date), [data.strength, date]);
  const dayCardio = useMemo(() => data.cardio.filter((e) => e.date === date), [data.cardio, date]);
  const dayBody = useMemo(() => data.body.find((e) => e.date === date) || null, [data.body, date]);
  const dayDiet = useMemo(() => data.diet.filter((e) => e.date === date), [data.diet, date]);
  const dayDietTotals = useMemo(() => sumDiet(dayDiet), [dayDiet]);
  // a day's calories: derived from foods if any, else legacy manual, else null
  const derivedCal = dayDiet.length ? Math.round(dayDietTotals.cal) : (dayBody && dayBody.calories != null ? dayBody.calories : null);
  const intakeForDate = (d) => {
    const es = data.diet.filter((e) => e.date === d);
    if (es.length) return Math.round(sumDiet(es).cal);
    const b = data.body.find((e) => e.date === d);
    return b && b.calories != null ? b.calories : null;
  };

  const dayTonnageKg = dayStrength.reduce((a, e) => a + entryVolKg(e), 0);
  const daySets = dayStrength.reduce((a, e) => a + e.sets.length, 0);
  const dayCals = dayCardio.reduce((a, e) => a + (e.calories || 0), 0);
  const dayMin = dayCardio.reduce((a, e) => a + (e.minutes || 0), 0);

  const allTonnageKg = data.strength.reduce((a, e) => a + entryVolKg(e), 0);
  const allCals = data.cardio.reduce((a, e) => a + (e.calories || 0), 0);

  const exList = useMemo(() => Array.from(new Set(data.strength.map((e) => e.exercise))).sort(), [data.strength]);
  const hasAny = data.strength.length > 0 || data.cardio.length > 0 || data.body.length > 0;

  const chartMeta = {
    volume: { color: "#2742B8", unit: ` ${wUnit}`, label: "Volume" },
    calories: { color: "#D2541A", unit: " kcal", label: "Calories" },
    body: { color: "#1F8A6E", unit: ` ${wUnit}`, label: "Bodyweight" },
    intake: { color: "#6A4FB3", unit: " kcal", label: "Intake" },
  }[chartView];

  const chartData = useMemo(() => {
    if (chartView === "volume") {
      const byDate = {};
      data.strength.filter((e) => chartEx === "__all__" || e.exercise === chartEx)
        .forEach((e) => { byDate[e.date] = (byDate[e.date] || 0) + entryVolKg(e); });
      return Object.keys(byDate).sort().map((d) => ({ date: fmtDate(d), value: round(fromKg(byDate[d], system), 0) }));
    }
    if (chartView === "calories") {
      const byDate = {};
      data.cardio.forEach((e) => { byDate[e.date] = (byDate[e.date] || 0) + (e.calories || 0); });
      return Object.keys(byDate).sort().map((d) => ({ date: fmtDate(d), value: byDate[d] }));
    }
    if (chartView === "body")
      return data.body.filter((e) => e.bodyKg != null).sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({ date: fmtDate(e.date), value: round(fromKg(e.bodyKg, system), 1) }));
    const idates = Array.from(new Set([...data.diet.map((e) => e.date), ...data.body.filter((e) => e.calories != null).map((e) => e.date)])).sort();
    return idates.map((d) => ({ date: fmtDate(d), value: intakeForDate(d) })).filter((p) => p.value != null);
  }, [data, chartView, chartEx, system]);

  const groupedDates = useMemo(() => {
    const set = new Set([...data.strength.map((e) => e.date), ...data.cardio.map((e) => e.date), ...data.body.map((e) => e.date)]);
    return Array.from(set).sort().reverse();
  }, [data]);

  /* ---------- nav ---------- */
  const goType = (t) => {
    setView(t); resetForms();
    setChartView(t === "strength" ? "volume" : t === "cardio" ? "calories" : "body");
    setErr(""); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goHome = () => { setView("home"); resetForms(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const goHistory = () => { setView("history"); resetForms(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const goAnalytics = () => { setView("analytics"); resetForms(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const goChangelog = () => { setView("changelog"); resetForms(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const goSetup = () => { setView("setup"); resetForms(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const nav = (t) => {
    setMenuOpen(false);
    if (t === "home") goHome();
    else if (t === "analytics") goAnalytics();
    else if (t === "changelog") goChangelog();
    else if (t === "setup") goSetup();
  };

  const setA = (k, v) => setSetup((s) => ({ ...s, [k]: v }));
  const setB = (k, v) => setSetup((s) => ({ ...s, b: { ...s.b, [k]: v } }));
  const setupSummary = () => {
    const lines = ["Nutrition food logging — my answers", ""];
    Object.keys(SETUP_Q).forEach((k) => {
      const sel = setup[k];
      lines.push(`${k.toUpperCase()}. ${SETUP_Q[k].q}\n   → ${sel == null ? "(unanswered)" : SETUP_Q[k].opts[sel]}`);
    });
    const changed = SETUP_B.filter(([k]) => setup.b[k] === "change").map(([k, t]) => `${k.toUpperCase()} (${t})`);
    lines.push("", `Assumptions to change: ${changed.length ? changed.join("; ") : "none — all confirmed"}`);
    lines.push(`Go-ahead: ${setup.go || "(unanswered)"}`);
    if (setup.notes.trim()) lines.push(`Notes: ${setup.notes.trim()}`);
    return lines.join("\n");
  };
  const copyAnswers = async () => {
    try { await navigator.clipboard.writeText(setupSummary()); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch (e) {}
  };

  /* ---------- form helpers ---------- */
  const resetForms = () => {
    setSEx(""); setSSets([blankSet()]);
    setCAct(""); setCMin(""); setCCal(""); setCDist(""); setCHr("");
    setBBw(""); setBCal(""); setBProt(""); setBCarb(""); setBFat("");
    setEditing(null); setErr("");
  };
  const updateSet = (i, field, val) => setSSets((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  const addSetRow = () => setSSets((rows) => { const last = rows[rows.length - 1]; return [...rows, last ? { w: last.w, r: last.r } : blankSet()]; });
  const removeSetRow = (i) => setSSets((rows) => (rows.length <= 1 ? rows : rows.filter((_, idx) => idx !== i)));

  const addStrength = () => {
    if (!sEx.trim()) return setErr("Name the exercise.");
    const rows = sSets.filter((s) => s.w !== "" || s.r !== "");
    if (rows.length === 0) return setErr("Add at least one set.");
    const parsed = [];
    for (const row of rows) {
      const w = parseFloat(row.w), r = parseInt(row.r, 10);
      if (!(w >= 0) || !(r >= 1)) return setErr("Each set needs a weight and at least 1 rep.");
      parsed.push({ weightKg: round(toKg(w, system), 3), reps: r });
    }
    const entry = { id: editing || uid(), date, exercise: sEx.trim(), sets: parsed };
    setData((d) => ({ ...d, strength: editing ? d.strength.map((e) => (e.id === editing ? entry : e)) : [...d.strength, entry] }));
    resetForms();
  };
  const addCardio = () => {
    const min = parseFloat(cMin), cal = parseFloat(cCal);
    const dist = numOrNull(cDist), hr = numOrNull(cHr);
    if (!cAct.trim()) return setErr("Name the activity.");
    if (!(min >= 0) || !(cal >= 0)) return setErr("Duration and calories need a number.");
    const entry = { id: editing || uid(), date, activity: cAct.trim(), minutes: min, calories: cal,
      distanceKm: dist != null && dist >= 0 ? round(toKm(dist, system), 4) : null,
      avgHr: hr != null && hr >= 0 ? Math.round(hr) : null };
    setData((d) => ({ ...d, cardio: editing ? d.cardio.map((e) => (e.id === editing ? entry : e)) : [...d.cardio, entry] }));
    resetForms();
  };
  const addBody = () => {
    const bw = numOrNull(bBw), cal = numOrNull(bCal), p = numOrNull(bProt), c = numOrNull(bCarb), f = numOrNull(bFat);
    if (bw == null && cal == null && p == null && c == null && f == null) return setErr("Enter at least one value.");
    for (const v of [bw, cal, p, c, f]) if (v != null && !(v >= 0)) return setErr("Values can't be negative.");
    const payload = { date, bodyKg: bw != null ? round(toKg(bw, system), 3) : null, calories: cal, protein: p, carbs: c, fat: f };
    setData((d) => {
      let body;
      if (editing) body = d.body.map((e) => (e.id === editing ? { ...payload, id: editing } : e));
      else {
        const existing = d.body.find((e) => e.date === date);
        body = existing ? d.body.map((e) => (e.id === existing.id ? { ...payload, id: existing.id } : e)) : [...d.body, { ...payload, id: uid() }];
      }
      return { ...d, body };
    });
    resetForms();
  };

  const editStrength = (e) => {
    setView("strength"); setEditing(e.id); setDate(e.date); setSEx(e.exercise);
    setSSets(e.sets.map((x) => ({ w: String(round(fromKg(x.weightKg, system), 2)), r: String(x.reps) })));
    setErr(""); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const editCardio = (e) => {
    setView("cardio"); setEditing(e.id); setDate(e.date);
    setCAct(e.activity); setCMin(String(e.minutes)); setCCal(String(e.calories));
    setCDist(e.distanceKm != null ? String(round(fromKm(e.distanceKm, system), 2)) : "");
    setCHr(e.avgHr != null ? String(e.avgHr) : "");
    setErr(""); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const editBody = (e) => {
    setView("body"); setEditing(e.id); setDate(e.date);
    setBBw(e.bodyKg != null ? String(round(fromKg(e.bodyKg, system), 1)) : "");
    setBCal(e.calories != null ? String(e.calories) : "");
    setBProt(e.protein != null ? String(e.protein) : "");
    setBCarb(e.carbs != null ? String(e.carbs) : "");
    setBFat(e.fat != null ? String(e.fat) : "");
    setErr(""); window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const delEntry = (id, kind) => setData((d) => ({ ...d, [kind]: d[kind].filter((e) => e.id !== id) }));
  const clearAll = () => { if (window.confirm("Delete every logged workout? This can't be undone.")) setData((d) => ({ ...d, strength: [], cardio: [], body: [], diet: [] })); };

  /* ---------- nutrition v1 actions ---------- */
  // keep the bodyweight field in sync with the selected date
  useEffect(() => {
    if (view !== "body") return;
    const b = data.body.find((e) => e.date === date);
    setNBw(b && b.bodyKg != null ? String(round(fromKg(b.bodyKg, system), 1)) : "");
  }, [view, date, data.body, system]);

  const saveBw = () => {
    const bw = numOrNull(nBw);
    const bodyKg = bw != null && bw >= 0 ? round(toKg(bw, system), 3) : null;
    setData((d) => {
      const ex = d.body.find((e) => e.date === date);
      let body;
      if (ex) body = d.body.map((e) => (e.id === ex.id ? { ...e, bodyKg } : e));
      else body = [...d.body, { id: uid(), date, bodyKg, calories: null, protein: null, carbs: null, fat: null }];
      return { ...d, body };
    });
    setErr("");
  };

  const makeEntry = (food, servingLabel, servingGrams, quantity, id) => {
    const grams = servingGrams * quantity;
    const c = scaleMacros(food.per100, grams);
    return {
      id: id || uid(), date, foodId: food.id,
      food: { name: food.name, brand: food.brand || null, per100: food.per100 },
      servingLabel, servingGrams, quantity,
      computed: { cal: round(c.cal, 0), protein: round(c.protein, 1), carbs: round(c.carbs, 1), fat: round(c.fat, 1) },
    };
  };
  const logEntry = (food, servingLabel, servingGrams, quantity) => {
    const entry = makeEntry(food, servingLabel, servingGrams, quantity, editingDiet || undefined);
    setData((d) => ({ ...d, diet: editingDiet ? d.diet.map((e) => (e.id === editingDiet ? entry : e)) : [...d.diet, entry] }));
  };
  const closePanels = () => { setPanel(null); setLogFood(null); setEditingDiet(null); setLogQty("1"); setLogServ(0); setErr(""); };

  const openLog = (food) => { setEditingDiet(null); setLogFood(food); setLogServ(0); setLogQty("1"); setPanel("log"); setErr(""); };
  const doLog = () => {
    const q = parseFloat(logQty);
    if (!(q > 0)) return setErr("Enter a quantity greater than 0.");
    const servs = foodServings(logFood);
    const s = servs[logServ] || servs[0];
    logEntry(logFood, s.label, s.grams, q);
    closePanels(); setFoodQuery("");
  };
  const editDiet = (e) => {
    setView("body"); setEditingDiet(e.id); setDate(e.date);
    setLogFood({ id: e.foodId, name: e.food.name, brand: e.food.brand, per100: e.food.per100, servings: [{ label: e.servingLabel, grams: e.servingGrams }] });
    setLogServ(0); setLogQty(String(e.quantity)); setPanel("log"); setErr("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const quickAdd = () => {
    const name = qName.trim(); const cal = parseFloat(qCal);
    if (!name) return setErr("Name the food.");
    if (!(cal >= 0)) return setErr("Enter calories.");
    const food = {
      id: uid(), name, source: "library", brand: null,
      per100: { cal, protein: parseFloat(qProt) || 0, carbs: parseFloat(qCarb) || 0, fat: parseFloat(qFat) || 0 },
      servings: [{ label: "serving", grams: 100 }], provenance: "user_created", verified: false, createdAt: todayStr(),
    };
    setData((d) => ({ ...d, foods: [...d.foods, food], diet: [...d.diet, makeEntry(food, "serving", 100, 1)] }));
    setQName(""); setQCal(""); setQProt(""); setQCarb(""); setQFat(""); setFoodQuery(""); closePanels();
  };

  const createFood = () => {
    const name = cfName.trim(); if (!name) return setErr("Name the food.");
    const cal = parseFloat(cfCal); if (!(cal >= 0)) return setErr("Enter calories.");
    const prot = parseFloat(cfProt) || 0, carb = parseFloat(cfCarb) || 0, fat = parseFloat(cfFat) || 0;
    let per100, servings;
    if (cfBasis === "100g") { per100 = { cal, protein: prot, carbs: carb, fat: fat }; servings = [{ label: "100 g", grams: 100 }]; }
    else {
      const g = parseFloat(cfServGrams); const label = cfServLabel.trim() || "1 serving";
      if (!(g > 0)) return setErr("Enter the serving weight in grams.");
      per100 = { cal: cal * 100 / g, protein: prot * 100 / g, carbs: carb * 100 / g, fat: fat * 100 / g };
      servings = [{ label, grams: g }];
    }
    const food = { id: uid(), name, source: "library", brand: cfBrand.trim() || null, per100, servings, provenance: "user_created", verified: false, createdAt: todayStr() };
    setData((d) => ({ ...d, foods: [...d.foods, food] }));
    setCfName(""); setCfBrand(""); setCfCal(""); setCfProt(""); setCfCarb(""); setCfFat(""); setCfServLabel(""); setCfServGrams(""); setCfBasis("100g");
    setEditingDiet(null); setLogFood(food); setLogServ(0); setLogQty("1"); setPanel("log"); setErr("");
  };

  const foodResults = useMemo(() => {
    const q = foodQuery.trim().toLowerCase();
    const list = q
      ? data.foods.filter((f) => f.name.toLowerCase().includes(q) || (f.brand || "").toLowerCase().includes(q))
      : [...data.foods].slice(-8).reverse();
    return list.slice(0, 20);
  }, [data.foods, foodQuery]);

  const showWeight = (kg) => round(fromKg(kg, system), 1);
  const showDist = (km) => (km == null ? null : round(fromKm(km, system), 2));
  const showTonnage = (kg) => round(fromKg(kg, system), 0).toLocaleString();

  /* ----------------------------- table renderers ---------------------------- */
  const strengthTable = (list) => (
    <table className="tl-table">
      <thead><tr><th>Exercise</th><th>Sets</th><th>#</th><th>Volume</th><th></th></tr></thead>
      <tbody>
        {list.map((e) => (
          <tr key={e.id}>
            <td className="tl-strong"><span className="tl-dot tl-dot-strength" />{e.exercise}</td>
            <td className="tl-setlist">{e.sets.map((x, i) => (
              <span className="tl-setpill" key={i}>{showWeight(x.weightKg)}<span className="tl-x">×</span>{x.reps}</span>))}</td>
            <td>{e.sets.length}</td>
            <td>{round(fromKg(entryVolKg(e), system), 0).toLocaleString()} {wUnit}</td>
            <td className="tl-rowact"><button onClick={() => editStrength(e)}>Edit</button><button onClick={() => delEntry(e.id, "strength")}>✕</button></td>
          </tr>))}
      </tbody>
    </table>
  );
  const cardioTable = (list) => (
    <table className="tl-table">
      <thead><tr><th>Activity</th><th>Time</th><th>Cal</th><th>Dist</th><th>Pace</th><th>HR</th><th></th></tr></thead>
      <tbody>
        {list.map((e) => { const dist = showDist(e.distanceKm); return (
          <tr key={e.id}>
            <td className="tl-strong"><span className="tl-dot tl-dot-cardio" />{e.activity}</td>
            <td>{e.minutes} min</td><td>{e.calories.toLocaleString()}</td>
            <td>{dist != null ? `${dist} ${dUnit}` : "—"}</td>
            <td>{dist != null ? `${fmtPace(e.minutes, dist)}/${dUnit}` : "—"}</td>
            <td>{e.avgHr != null ? `${e.avgHr}` : "—"}</td>
            <td className="tl-rowact"><button onClick={() => editCardio(e)}>Edit</button><button onClick={() => delEntry(e.id, "cardio")}>✕</button></td>
          </tr>); })}
      </tbody>
    </table>
  );
  const bodyTable = (e) => (
    <table className="tl-table">
      <thead><tr><th>Nutrition</th><th>Weight</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th></th></tr></thead>
      <tbody><tr>
        <td className="tl-strong"><span className="tl-dot tl-dot-body" />Daily</td>
        <td>{e.bodyKg != null ? `${showWeight(e.bodyKg)} ${wUnit}` : "—"}</td>
        <td>{e.calories != null ? `${e.calories.toLocaleString()}` : "—"}</td>
        <td>{e.protein != null ? `${e.protein} g` : "—"}</td>
        <td>{e.carbs != null ? `${e.carbs} g` : "—"}</td>
        <td>{e.fat != null ? `${e.fat} g` : "—"}</td>
        <td className="tl-rowact"><button onClick={() => editBody(e)}>Edit</button><button onClick={() => delEntry(e.id, "body")}>✕</button></td>
      </tr></tbody>
    </table>
  );

  // filtered history for a single modality
  const renderModalityHistory = (modality) => {
    const dates = groupedDates.filter((d) =>
      modality === "body" ? data.body.some((e) => e.date === d) : data[modality].some((e) => e.date === d));
    if (dates.length === 0)
      return <div className="tl-card tl-empty-big">No {TYPES[modality].label.toLowerCase()} entries yet. Add one above.</div>;
    return dates.map((d) => {
      let metric = null;
      if (modality === "strength") { const t = data.strength.filter((e) => e.date === d).reduce((a, e) => a + entryVolKg(e), 0); metric = t > 0 ? `${showTonnage(t)} ${wUnit}` : null; }
      else if (modality === "cardio") { const k = data.cardio.filter((e) => e.date === d).reduce((a, e) => a + (e.calories || 0), 0); metric = `${k.toLocaleString()} kcal`; }
      else { const b = data.body.find((e) => e.date === d); metric = b && b.bodyKg != null ? `${showWeight(b.bodyKg)} ${wUnit}` : null; }
      return (
        <div className="tl-card tl-day" key={d}>
          <div className="tl-day-head">
            <span className="tl-day-date">{fmtDateLong(d)}</span>
            {metric && <span className="tl-day-ton" style={{ color: TYPES[modality].color }}>{metric}</span>}
          </div>
          {modality === "strength" && strengthTable(data.strength.filter((e) => e.date === d))}
          {modality === "cardio" && cardioTable(data.cardio.filter((e) => e.date === d))}
          {modality === "body" && bodyTable(data.body.find((e) => e.date === d))}
        </div>
      );
    });
  };

  const fullHistory = () =>
    groupedDates.map((d) => {
      const s = data.strength.filter((e) => e.date === d);
      const c = data.cardio.filter((e) => e.date === d);
      const b = data.body.find((e) => e.date === d);
      const ton = s.reduce((a, e) => a + entryVolKg(e), 0);
      return (
        <div className="tl-card tl-day" key={d}>
          <div className="tl-day-head">
            <span className="tl-day-date">{fmtDateLong(d)}</span>
            {ton > 0 && <span className="tl-day-ton">{showTonnage(ton)} {wUnit}</span>}
          </div>
          {s.length > 0 && strengthTable(s)}
          {c.length > 0 && cardioTable(c)}
          {b && bodyTable(b)}
        </div>
      );
    });

  const progressionChart = () => (
    <section className="tl-card tl-chart">
      <div className="tl-chart-head">
        <h2>Progression</h2>
        <div className="tl-chart-ctrl">
          <select value={chartView} onChange={(e) => setChartView(e.target.value)}>
            <option value="volume">Strength volume</option>
            <option value="calories">Cardio calories</option>
            <option value="body">Bodyweight</option>
            <option value="intake">Calorie intake</option>
          </select>
          {chartView === "volume" && exList.length > 0 && (
            <select value={chartEx} onChange={(e) => setChartEx(e.target.value)}>
              <option value="__all__">All exercises</option>
              {exList.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>)}
        </div>
      </div>
      {chartData.length === 0 ? <div className="tl-empty">Nothing to chart here yet.</div> : (
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="#D7DAD7" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5A626C" }} tickLine={false} axisLine={{ stroke: "#D7DAD7" }} />
              <YAxis tick={{ fontSize: 11, fill: "#5A626C" }} tickLine={false} axisLine={false} width={48}
                domain={chartView === "body" ? ["dataMin - 2", "dataMax + 2"] : [0, "auto"]} />
              <Tooltip contentStyle={{ border: "1px solid #D7DAD7", borderRadius: 0, fontFamily: "Inter, sans-serif", fontSize: 12 }}
                formatter={(v) => [v.toLocaleString() + chartMeta.unit, chartMeta.label]} />
              <Line type="monotone" dataKey="value" strokeWidth={2.5} stroke={chartMeta.color}
                dot={{ r: 3, fill: chartMeta.color }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>)}
    </section>
  );

  /* ----------------------------- form renderers ---------------------------- */
  const draftVolKg = sSets.reduce((a, s) => { const w = parseFloat(s.w), r = parseInt(s.r, 10); return a + (w >= 0 && r >= 1 ? toKg(w, system) * r : 0); }, 0);

  const renderForm = (t) => (
    <section className="tl-card tl-form">
      <div className="tl-form-top">
        <label className="tl-field tl-field-date"><span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {editing && <span className="tl-editing">Editing entry</span>}
        {t === "body" && !editing && dayBody && <span className="tl-editing tl-editing-body">Updates this day's entry</span>}
      </div>

      {t === "strength" && (
        <div className="tl-strength-form">
          <label className="tl-field tl-field-wide"><span>Exercise</span>
            <input placeholder="Back squat" value={sEx} onChange={(e) => setSEx(e.target.value)} /></label>
          <div className="tl-sets">
            <div className="tl-sets-head"><span className="tl-set-col-n">Set</span><span>Weight ({wUnit})</span><span>Reps</span><span /></div>
            {sSets.map((s, i) => (
              <div className="tl-setrow" key={i}>
                <span className="tl-set-n">{i + 1}</span>
                <input type="number" inputMode="decimal" placeholder="0" value={s.w} onChange={(e) => updateSet(i, "w", e.target.value)} />
                <input type="number" inputMode="numeric" placeholder="0" value={s.r} onChange={(e) => updateSet(i, "r", e.target.value)} />
                <button className="tl-setdel" onClick={() => removeSetRow(i)} disabled={sSets.length <= 1} aria-label={`Remove set ${i + 1}`}>✕</button>
              </div>))}
            <button className="tl-addset" onClick={addSetRow}>+ Add set</button>
          </div>
          {draftVolKg > 0 && <div className="tl-draftvol">Volume this entry · <b>{showTonnage(draftVolKg)} {wUnit}</b></div>}
        </div>)}

      {t === "cardio" && (
        <div className="tl-grid-c">
          <label className="tl-field tl-field-wide"><span>Activity</span>
            <input placeholder="Easy run" value={cAct} onChange={(e) => setCAct(e.target.value)} /></label>
          <label className="tl-field"><span>Time (min)</span>
            <input type="number" inputMode="decimal" placeholder="0" value={cMin} onChange={(e) => setCMin(e.target.value)} /></label>
          <label className="tl-field"><span>Calories</span>
            <input type="number" inputMode="numeric" placeholder="0" value={cCal} onChange={(e) => setCCal(e.target.value)} /></label>
          <label className="tl-field"><span>Distance ({dUnit}) <i>opt</i></span>
            <input type="number" inputMode="decimal" placeholder="0" value={cDist} onChange={(e) => setCDist(e.target.value)} /></label>
          <label className="tl-field"><span>Avg HR <i>opt</i></span>
            <input type="number" inputMode="numeric" placeholder="bpm" value={cHr} onChange={(e) => setCHr(e.target.value)} /></label>
        </div>)}

      {t === "body" && (
        <div className="tl-grid-b">
          <label className="tl-field"><span>Bodyweight ({wUnit})</span>
            <input type="number" inputMode="decimal" placeholder="0" value={bBw} onChange={(e) => setBBw(e.target.value)} /></label>
          <label className="tl-field"><span>Calories in</span>
            <input type="number" inputMode="numeric" placeholder="kcal" value={bCal} onChange={(e) => setBCal(e.target.value)} /></label>
          <label className="tl-field"><span>Protein (g) <i>opt</i></span>
            <input type="number" inputMode="numeric" placeholder="0" value={bProt} onChange={(e) => setBProt(e.target.value)} /></label>
          <label className="tl-field"><span>Carbs (g) <i>opt</i></span>
            <input type="number" inputMode="numeric" placeholder="0" value={bCarb} onChange={(e) => setBCarb(e.target.value)} /></label>
          <label className="tl-field"><span>Fat (g) <i>opt</i></span>
            <input type="number" inputMode="numeric" placeholder="0" value={bFat} onChange={(e) => setBFat(e.target.value)} /></label>
        </div>)}

      {err && <div className="tl-err">{err}</div>}
      <div className="tl-form-actions">
        <button className={"tl-add tl-add-" + t} onClick={t === "strength" ? addStrength : t === "cardio" ? addCardio : addBody}>
          {editing ? "Update entry" : t === "strength" ? "Log lift" : t === "cardio" ? "Log cardio" : "Log body stats"}
        </button>
        {editing && <button className="tl-ghost" onClick={resetForms}>Cancel</button>}
      </div>
    </section>
  );

  // focused header for a modality page
  const typeBoard = (t) => (
    <section className={"tl-board tl-fboard tl-fboard-" + t}>
      <div className="tl-board-date">{TYPES[t].label} · {fmtDateLong(date)}</div>
      {t === "strength" && (
        <div className="tl-fstat">
          <div className="tl-stat-num">{showTonnage(dayTonnageKg)}<span className="tl-stat-unit">{wUnit}</span></div>
          <div className="tl-stat-sub">tonnage · {dayStrength.length} lift{dayStrength.length === 1 ? "" : "s"} · {daySets} sets today</div>
        </div>)}
      {t === "cardio" && (
        <div className="tl-fstat">
          <div className="tl-stat-num">{dayCals.toLocaleString()}<span className="tl-stat-unit">kcal</span></div>
          <div className="tl-stat-sub">burned · {dayCardio.length} session{dayCardio.length === 1 ? "" : "s"} · {dayMin} min today</div>
        </div>)}
      {t === "body" && (
        <div className="tl-board-body tl-fbody">
          <span className="tl-bchip"><i>Bodyweight</i><b>{dayBody && dayBody.bodyKg != null ? `${showWeight(dayBody.bodyKg)} ${wUnit}` : "—"}</b></span>
          <span className="tl-bchip"><i>Calories in</i><b>{derivedCal != null ? `${derivedCal.toLocaleString()} kcal` : "—"}</b></span>
          {dayDiet.length > 0 && (
            <span className="tl-bchip"><i>Protein</i><b>{Math.round(dayDietTotals.protein)} g</b></span>)}
          {derivedCal != null && dayCals > 0 && (
            <span className="tl-bchip"><i>Net of cardio</i><b>{(derivedCal - dayCals).toLocaleString()} kcal</b></span>)}
        </div>)}
    </section>
  );

  /* ----------------------------- render shell ---------------------------- */
  if (!loaded)
    return (<div className="tl-root tl-loading"><style>{CSS}</style><div className="tl-load">Loading your log…</div></div>);

  const Header = ({ showUnit = true, showDate = false }) => {
    const items = [
      { id: "home", label: "Home" },
      { id: "setup", label: "Nutrition Setup" },
      { id: "analytics", label: "Analytics" },
      { id: "changelog", label: "Change Log" },
    ];
    return (
      <header className="tl-head">
        <div className="tl-eyebrow">Personal training log</div>
        <div className="tl-headrow">
          <h1 className="tl-title" onClick={goHome} role="button">THE LOG</h1>
          <div className="tl-headright">
          {showDate && (
            <label className="tl-headdate">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {showUnit && (
            <div className="tl-sys">
              <button className={"tl-sysbtn" + (system === "metric" ? " on" : "")} onClick={() => setSystem("metric")}>kg · km</button>
              <button className={"tl-sysbtn" + (system === "imperial" ? " on" : "")} onClick={() => setSystem("imperial")}>lb · mi</button>
            </div>
          )}
          <div className="tl-menuwrap">
            <button className={"tl-menubtn" + (menuOpen ? " on" : "")} aria-label="Menu"
              aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
              <span className="tl-burger" data-open={menuOpen}><i /><i /><i /></span>
            </button>
            {menuOpen && (
              <>
                <div className="tl-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <nav className="tl-menu" role="menu">
                  <div className="tl-menu-label">Go to</div>
                  {items.map((it) => (
                    <button key={it.id} role="menuitem"
                      className={"tl-menu-item tl-mi-" + it.id + (view === it.id ? " active" : "")}
                      onClick={() => nav(it.id)}>
                      <span className="tl-mi-dot" />{it.label}
                      {view === it.id && <span className="tl-mi-here">●</span>}
                    </button>
                  ))}
                </nav>
              </>
            )}
          </div>
          </div>
        </div>
      </header>
    );
  };

  const backBar = (label) => (
    <button className="tl-back" onClick={goHome}>← {label}</button>
  );

  /* ---------- HOME ---------- */
  if (view === "home") {
    const counts = {
      strength: dayStrength.length,
      cardio: dayCardio.length,
      body: dayDiet.length || (dayBody ? 1 : 0),
    };
    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <Header showDate />

        <section className="tl-pick">
          <div className="tl-eyebrow tl-pick-eyebrow">Start a session</div>

          <div className="tl-cards">
            {Object.keys(TYPES).map((t) => (
              <button key={t} className={"tl-choice tl-choice-" + t} onClick={() => goType(t)}>
                <span className="tl-choice-bar" />
                <span className="tl-choice-name">{TYPES[t].label}</span>
                <span className="tl-choice-desc">{TYPES[t].desc}</span>
                <span className="tl-choice-foot">
                  {counts[t] > 0
                    ? (t === "body" ? `${counts[t]} logged today` : `${counts[t]} logged today`)
                    : "nothing yet today"}
                  <span className="tl-choice-arrow">→</span>
                </span>
              </button>))}
          </div>

          {hasAny && <button className="tl-histlink" onClick={goHistory}>Review full history →</button>}
        </section>

        <footer className="tl-foot">Saved on this device · volume = Σ (weight × reps) across sets</footer>
      </div>
    );
  }

  /* ---------- HISTORY ---------- */
  if (view === "history") {
    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <Header />
        {backBar("Home")}
        <div className="tl-page-head">
          <h2 className="tl-page-title">History</h2>
          {hasAny && <button className="tl-clear" onClick={clearAll}>Clear all</button>}
        </div>
        {hasAny ? progressionChart() : null}
        {groupedDates.length === 0
          ? <div className="tl-card tl-empty-big">No workouts logged yet.</div>
          : fullHistory()}
        <footer className="tl-foot">Saved on this device</footer>
      </div>
    );
  }

  /* ---------- NUTRITION SETUP (in-app decision form) ---------- */
  if (view === "setup") {
    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <Header />
        {backBar("Home")}
        <div className="tl-page-head"><h2 className="tl-page-title">Food Logging Setup</h2></div>
        <div className="tl-setup-intro">
          Tap your choices — everything saves automatically on this device. Recommended options are marked. When you're done, hit <b>Copy my answers</b> and paste them back to me.
        </div>

        {Object.keys(SETUP_Q).map((k) => (
          <div className="tl-card tl-setup-q" key={k}>
            <div className="tl-setup-qlabel"><b>{k.toUpperCase()}.</b> {SETUP_Q[k].q}</div>
            <div className="tl-setup-opts">
              {SETUP_Q[k].opts.map((o, i) => (
                <button key={i} className={"tl-opt" + (setup[k] === i ? " on" : "")} onClick={() => setA(k, i)}>
                  <span>{o}</span>
                  {SETUP_Q[k].rec === i && <span className="tl-opt-rec">rec</span>}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="tl-card tl-setup-q">
          <div className="tl-setup-qlabel"><b>Assumptions</b> — all confirmed by default; switch any to Change</div>
          {SETUP_B.map(([k, t]) => (
            <div className="tl-assume" key={k}>
              <span className="tl-assume-t">{t}</span>
              <span className="tl-assume-tog">
                <button className={"tl-tog" + (setup.b[k] === "confirm" ? " on-confirm" : "")} onClick={() => setB(k, "confirm")}>Confirm</button>
                <button className={"tl-tog" + (setup.b[k] === "change" ? " on-change" : "")} onClick={() => setB(k, "change")}>Change</button>
              </span>
            </div>
          ))}
        </div>

        <div className="tl-card tl-setup-q">
          <div className="tl-setup-qlabel"><b>Go-ahead</b> — build v1?</div>
          <div className="tl-setup-opts">
            {["Build v1 now", "Not yet"].map((o) => (
              <button key={o} className={"tl-opt" + (setup.go === o ? " on" : "")} onClick={() => setA("go", o)}><span>{o}</span></button>
            ))}
          </div>
        </div>

        <div className="tl-card tl-setup-q">
          <div className="tl-setup-qlabel"><b>Notes</b> <span className="tl-opt-opt">optional</span></div>
          <textarea className="tl-setup-notes" rows={3} value={setup.notes}
            placeholder="Anything else — extra requirements, priorities, constraints…"
            onChange={(e) => setA("notes", e.target.value)} />
        </div>

        <div className="tl-card tl-setup-q">
          <div className="tl-setup-qlabel"><b>Your answers</b></div>
          <pre className="tl-sum-pre">{setupSummary()}</pre>
          <button className="tl-add tl-add-body" onClick={copyAnswers}>{copied ? "Copied \u2713" : "Copy my answers"}</button>
        </div>

        <footer className="tl-foot">Saved on this device</footer>
      </div>
    );
  }

  /* ---------- ANALYTICS (dashboard skeleton) ---------- */
  if (view === "analytics") {
    const kpis = ["Total volume", "Sessions logged", "Avg calories in", "Bodyweight change"];
    const skelRows = [0, 1, 2, 3, 4];
    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <Header />
        {backBar("Home")}
        <div className="tl-page-head"><h2 className="tl-page-title">Analytics</h2></div>

        <div className="tl-an-controls">
          <span className="tl-an-pill">Date range ▾</span>
          <span className="tl-an-pill">Metric ▾</span>
          <span className="tl-an-pill">Group by ▾</span>
          <span className="tl-an-note">Layout framework — charts not wired up yet</span>
        </div>

        <div className="tl-an-kpis">
          {kpis.map((label, i) => (
            <div className="tl-card tl-an-kpi" key={i}>
              <div className="tl-an-kpi-label">{label}</div>
              <div className="tl-sk tl-sk-num" />
              <div className="tl-sk tl-sk-line short" />
            </div>
          ))}
        </div>

        <div className="tl-card tl-an-panel">
          <div className="tl-an-panel-head"><h3>Trend over time</h3><span className="tl-an-pill sm">Line ▾</span></div>
          <div className="tl-an-plot tall"><span>Chart area</span></div>
        </div>

        <div className="tl-an-grid2">
          <div className="tl-card tl-an-panel">
            <div className="tl-an-panel-head"><h3>Training split</h3><span className="tl-an-pill sm">By type ▾</span></div>
            <div className="tl-an-plot"><span>Chart area</span></div>
          </div>
          <div className="tl-card tl-an-panel">
            <div className="tl-an-panel-head"><h3>Calorie balance</h3><span className="tl-an-pill sm">Daily ▾</span></div>
            <div className="tl-an-plot"><span>Chart area</span></div>
          </div>
        </div>

        <div className="tl-an-grid2">
          <div className="tl-card tl-an-panel">
            <div className="tl-an-panel-head"><h3>Top exercises</h3></div>
            <div className="tl-an-table">
              <div className="tl-an-tr tl-an-th"><span>Exercise</span><span>Sets</span><span>Volume</span></div>
              {skelRows.map((i) => (
                <div className="tl-an-tr" key={i}>
                  <span className="tl-sk tl-sk-line" /><span className="tl-sk tl-sk-line tiny" /><span className="tl-sk tl-sk-line tiny" />
                </div>
              ))}
            </div>
          </div>
          <div className="tl-card tl-an-panel">
            <div className="tl-an-panel-head"><h3>Recent activity</h3></div>
            <div className="tl-an-table">
              <div className="tl-an-tr tl-an-th"><span>Date</span><span>Type</span><span>Detail</span></div>
              {skelRows.map((i) => (
                <div className="tl-an-tr" key={i}>
                  <span className="tl-sk tl-sk-line tiny" /><span className="tl-sk tl-sk-line tiny" /><span className="tl-sk tl-sk-line" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <footer className="tl-foot">Saved on this device</footer>
      </div>
    );
  }

  /* ---------- CHANGE LOG ---------- */
  if (view === "changelog") {
    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <Header />
        {backBar("Home")}
        <div className="tl-page-head"><h2 className="tl-page-title">Change Log</h2></div>
        {CHANGELOG.length === 0 ? (
          <div className="tl-card tl-blank"><div className="tl-blank-mark" /><p>No changes recorded yet.</p></div>
        ) : (
          <div className="tl-card tl-cl">
            {CHANGELOG.map((c, i) => (
              <div className="tl-cl-row" key={i}>
                <div className="tl-cl-top">
                  <span className="tl-cl-page">{c.page}</span>
                  <span className="tl-cl-date">{c.date}</span>
                </div>
                <div className="tl-cl-sum">{c.summary}</div>
              </div>
            ))}
          </div>
        )}
        <footer className="tl-foot">Saved on this device</footer>
      </div>
    );
  }

  /* ---------- NUTRITION PAGE (v1 food logging) ---------- */
  if (view === "body") {
    const servs = logFood ? foodServings(logFood) : [];
    const previewGrams = logFood && servs[logServ] ? servs[logServ].grams * (parseFloat(logQty) || 0) : 0;
    const preview = logFood ? scaleMacros(logFood.per100, previewGrams) : null;
    const nutDates = Array.from(new Set([...data.diet.map((e) => e.date), ...data.body.map((e) => e.date)])).sort().reverse();

    return (
      <div className="tl-root">
        <style>{CSS}</style>
        <Header />
        {backBar("Home")}
        {typeBoard("body")}

        {/* bodyweight */}
        <section className="tl-card tl-form">
          <label className="tl-field"><span>Bodyweight ({wUnit}) · {fmtDateLong(date)}</span>
            <div className="tl-bwrow">
              <input type="number" inputMode="decimal" placeholder="0" value={nBw} onChange={(e) => setNBw(e.target.value)} />
              <button className="tl-add tl-add-body" onClick={saveBw}>Save</button>
            </div>
          </label>
        </section>

        {/* add food */}
        <section className="tl-card tl-form">
          <div className="tl-setup-qlabel"><b>Add food</b></div>
          <input className="tl-foodsearch" placeholder="Search your foods…" value={foodQuery}
            onChange={(e) => setFoodQuery(e.target.value)} />
          <div className="tl-foodlist">
            {foodResults.length === 0 ? (
              <div className="tl-nut-none">{foodQuery ? "No matches in your library." : "Your library is empty — quick-add or create a food below."}</div>
            ) : foodResults.map((f) => (
              <button key={f.id} className="tl-foodrow" onClick={() => openLog(f)}>
                <span className="tl-foodname">{f.name}{f.brand ? <span className="tl-foodbrand"> · {f.brand}</span> : null}</span>
                <span className="tl-foodmeta">{Math.round(f.per100.cal)} kcal/100g<span className="tl-foodtag">Your library</span></span>
              </button>
            ))}
          </div>
          <div className="tl-foodbtns">
            <button className={"tl-chipbtn" + (panel === "quick" ? " on" : "")} onClick={() => { closePanels(); setQName(foodQuery); setPanel("quick"); }}>+ Quick add</button>
            <button className={"tl-chipbtn" + (panel === "create" ? " on" : "")} onClick={() => { closePanels(); setCfName(foodQuery); setPanel("create"); }}>Create custom food</button>
          </div>

          {/* log panel */}
          {panel === "log" && logFood && (
            <div className="tl-subpanel">
              <div className="tl-setup-qlabel"><b>{editingDiet ? "Edit entry" : "Log"}: {logFood.name}</b></div>
              <div className="tl-loggrid">
                <label className="tl-field"><span>Serving</span>
                  <select value={logServ} onChange={(e) => setLogServ(parseInt(e.target.value, 10))}>
                    {servs.map((s, i) => <option key={i} value={i}>{s.label}{s.grams !== 1 ? ` (${s.grams} g)` : ""}</option>)}
                  </select>
                </label>
                <label className="tl-field"><span>Quantity</span>
                  <input type="number" inputMode="decimal" value={logQty} onChange={(e) => setLogQty(e.target.value)} />
                </label>
              </div>
              {preview && (parseFloat(logQty) > 0) && (
                <div className="tl-preview">= <b>{Math.round(preview.cal)} kcal</b> · P {Math.round(preview.protein)} · C {Math.round(preview.carbs)} · F {Math.round(preview.fat)} <span className="tl-gram">({Math.round(previewGrams)} g)</span></div>
              )}
              {err && <div className="tl-err">{err}</div>}
              <div className="tl-form-actions">
                <button className="tl-add tl-add-body" onClick={doLog}>{editingDiet ? "Update" : "Add to today"}</button>
                <button className="tl-ghost" onClick={closePanels}>Cancel</button>
              </div>
            </div>
          )}

          {/* quick add panel */}
          {panel === "quick" && (
            <div className="tl-subpanel">
              <div className="tl-setup-qlabel"><b>Quick add</b> <span className="tl-opt-opt">name + calories; logs 1 serving to today</span></div>
              <div className="tl-loggrid">
                <label className="tl-field tl-field-wide"><span>Name</span>
                  <input placeholder="e.g. Protein shake" value={qName} onChange={(e) => setQName(e.target.value)} /></label>
                <label className="tl-field"><span>Calories</span>
                  <input type="number" inputMode="numeric" placeholder="kcal" value={qCal} onChange={(e) => setQCal(e.target.value)} /></label>
                <label className="tl-field"><span>Protein (g) <i>opt</i></span>
                  <input type="number" inputMode="numeric" placeholder="0" value={qProt} onChange={(e) => setQProt(e.target.value)} /></label>
                <label className="tl-field"><span>Carbs (g) <i>opt</i></span>
                  <input type="number" inputMode="numeric" placeholder="0" value={qCarb} onChange={(e) => setQCarb(e.target.value)} /></label>
                <label className="tl-field"><span>Fat (g) <i>opt</i></span>
                  <input type="number" inputMode="numeric" placeholder="0" value={qFat} onChange={(e) => setQFat(e.target.value)} /></label>
              </div>
              {err && <div className="tl-err">{err}</div>}
              <div className="tl-form-actions">
                <button className="tl-add tl-add-body" onClick={quickAdd}>Add &amp; log</button>
                <button className="tl-ghost" onClick={closePanels}>Cancel</button>
              </div>
            </div>
          )}

          {/* create custom panel */}
          {panel === "create" && (
            <div className="tl-subpanel">
              <div className="tl-setup-qlabel"><b>Create custom food</b></div>
              <div className="tl-loggrid">
                <label className="tl-field tl-field-wide"><span>Name</span>
                  <input placeholder="e.g. Overnight oats" value={cfName} onChange={(e) => setCfName(e.target.value)} /></label>
                <label className="tl-field tl-field-wide"><span>Brand / restaurant <i>opt</i></span>
                  <input placeholder="optional" value={cfBrand} onChange={(e) => setCfBrand(e.target.value)} /></label>
              </div>
              <div className="tl-basis">
                <span className="tl-basis-label">Nutrition entered per:</span>
                <button className={"tl-chipbtn sm" + (cfBasis === "100g" ? " on" : "")} onClick={() => setCfBasis("100g")}>100 g</button>
                <button className={"tl-chipbtn sm" + (cfBasis === "serving" ? " on" : "")} onClick={() => setCfBasis("serving")}>a serving I define</button>
              </div>
              {cfBasis === "serving" && (
                <div className="tl-loggrid">
                  <label className="tl-field"><span>Serving label</span>
                    <input placeholder="1 cup" value={cfServLabel} onChange={(e) => setCfServLabel(e.target.value)} /></label>
                  <label className="tl-field"><span>Serving weight (g)</span>
                    <input type="number" inputMode="decimal" placeholder="grams" value={cfServGrams} onChange={(e) => setCfServGrams(e.target.value)} /></label>
                </div>
              )}
              <div className="tl-loggrid">
                <label className="tl-field"><span>Calories</span>
                  <input type="number" inputMode="numeric" placeholder="kcal" value={cfCal} onChange={(e) => setCfCal(e.target.value)} /></label>
                <label className="tl-field"><span>Protein (g)</span>
                  <input type="number" inputMode="numeric" placeholder="0" value={cfProt} onChange={(e) => setCfProt(e.target.value)} /></label>
                <label className="tl-field"><span>Carbs (g)</span>
                  <input type="number" inputMode="numeric" placeholder="0" value={cfCarb} onChange={(e) => setCfCarb(e.target.value)} /></label>
                <label className="tl-field"><span>Fat (g)</span>
                  <input type="number" inputMode="numeric" placeholder="0" value={cfFat} onChange={(e) => setCfFat(e.target.value)} /></label>
              </div>
              <div className="tl-basis-note">{cfBasis === "100g" ? "Values are per 100 g." : "Values are for one serving; stored per-100g automatically."}</div>
              {err && <div className="tl-err">{err}</div>}
              <div className="tl-form-actions">
                <button className="tl-add tl-add-body" onClick={createFood}>Save food</button>
                <button className="tl-ghost" onClick={closePanels}>Cancel</button>
              </div>
            </div>
          )}
        </section>

        {/* today's food */}
        <section className="tl-card tl-form">
          <div className="tl-setup-qlabel"><b>Today's food</b> — {fmtDateLong(date)}</div>
          {dayDiet.length === 0 ? (
            <div className="tl-nut-none">Nothing logged yet.</div>
          ) : (
            <>
              <div className="tl-today-totals">
                <span><b>{Math.round(dayDietTotals.cal).toLocaleString()}</b> kcal</span>
                <span>P {Math.round(dayDietTotals.protein)}</span>
                <span>C {Math.round(dayDietTotals.carbs)}</span>
                <span>F {Math.round(dayDietTotals.fat)}</span>
              </div>
              <table className="tl-table">
                <thead><tr><th>Food</th><th>Serving</th><th>Cal</th><th></th></tr></thead>
                <tbody>
                  {dayDiet.map((e) => (
                    <tr key={e.id}>
                      <td className="tl-strong"><span className="tl-dot tl-dot-body" />{e.food.name}</td>
                      <td>{e.quantity} × {e.servingLabel}</td>
                      <td>{Math.round(e.computed.cal).toLocaleString()}</td>
                      <td className="tl-rowact"><button onClick={() => editDiet(e)}>Edit</button><button onClick={() => delEntry(e.id, "diet")}>✕</button></td>
                    </tr>))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {hasAny && progressionChart()}

        <div className="tl-page-head"><h3 className="tl-page-sub">Nutrition history</h3></div>
        {nutDates.length === 0 ? (
          <div className="tl-card tl-empty-big">No nutrition logged yet.</div>
        ) : nutDates.map((d) => {
          const entries = data.diet.filter((e) => e.date === d);
          const b = data.body.find((e) => e.date === d);
          const derived = entries.length ? sumDiet(entries) : null;
          const legacy = !entries.length && b && b.calories != null;
          const totals = derived || (legacy ? { cal: b.calories, protein: b.protein || 0, carbs: b.carbs || 0, fat: b.fat || 0 } : null);
          const open = !!expandDays[d];
          return (
            <div className="tl-card tl-day" key={d}>
              <div className="tl-day-head">
                <button className="tl-day-datebtn" onClick={() => { setDate(d); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{fmtDateLong(d)}</button>
                {b && b.bodyKg != null && <span className="tl-day-ton" style={{ color: "var(--body)" }}>{showWeight(b.bodyKg)} {wUnit}</span>}
              </div>
              {totals ? (
                <div className={"tl-nut-totals" + (entries.length ? " clickable" : "")}
                  onClick={() => entries.length && setExpandDays((s) => ({ ...s, [d]: !s[d] }))}>
                  <span><b>{Math.round(totals.cal).toLocaleString()}</b> kcal</span>
                  <span>P {Math.round(totals.protein)}</span>
                  <span>C {Math.round(totals.carbs)}</span>
                  <span>F {Math.round(totals.fat)}</span>
                  {legacy && <span className="tl-manual-tag">manual</span>}
                  {entries.length > 0 && <span className="tl-exp">{open ? "▾" : "▸"}</span>}
                </div>
              ) : <div className="tl-nut-none">bodyweight only</div>}
              {open && entries.length > 0 && (
                <table className="tl-table">
                  <thead><tr><th>Food</th><th>Serving</th><th>Cal</th><th></th></tr></thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id}>
                        <td className="tl-strong"><span className="tl-dot tl-dot-body" />{e.food.name}</td>
                        <td>{e.quantity} × {e.servingLabel}</td>
                        <td>{Math.round(e.computed.cal).toLocaleString()}</td>
                        <td className="tl-rowact"><button onClick={() => editDiet(e)}>Edit</button><button onClick={() => delEntry(e.id, "diet")}>✕</button></td>
                      </tr>))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
        <footer className="tl-foot">Saved on this device</footer>
      </div>
    );
  }

  /* ---------- MODALITY PAGES ---------- */
  return (
    <div className="tl-root">
      <style>{CSS}</style>
      <Header />
      {backBar("Home")}
      {typeBoard(view)}
      {renderForm(view)}
      {hasAny && progressionChart()}
      <div className="tl-page-head"><h3 className="tl-page-sub">{TYPES[view].label} history</h3></div>
      {renderModalityHistory(view)}
      <footer className="tl-foot">Saved on this device</footer>
    </div>
  );
}

/* ----------------------------- styles ------------------------------ */

const CSS = `
.tl-root{
  --paper:#ECEEEC; --card:#FAFBFA; --ink:#15171C; --steel:#5A626C;
  --line:#D7DAD7; --strength:#2742B8; --cardio:#D2541A; --body:#1F8A6E;
  --strength-lt:#5B86F0; --cardio-lt:#FF7A45; --body-lt:#4FC79E;
  background:var(--paper); color:var(--ink);
  font-family:'Inter',system-ui,sans-serif;
  min-height:100vh; padding:28px 20px 60px; max-width:960px; margin:0 auto; -webkit-font-smoothing:antialiased;
}
.tl-root *{box-sizing:border-box;}
.tl-loading{display:flex;align-items:center;justify-content:center;min-height:60vh;}
.tl-load{font-family:'Archivo';font-weight:700;color:var(--steel);letter-spacing:.04em;}

.tl-head{margin-bottom:22px;}
.tl-headrow{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;}
.tl-eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--steel);font-weight:600;}
.tl-title{font-family:'Archivo';font-weight:900;font-size:clamp(38px,8vw,62px);line-height:.9;letter-spacing:-.02em;margin:4px 0 0;cursor:pointer;}
.tl-sys{display:flex;border:1.5px solid var(--ink);height:38px;}
.tl-sysbtn{background:none;border:none;padding:0 14px;display:flex;align-items:center;font-family:'Archivo';font-weight:700;font-size:13px;cursor:pointer;color:var(--ink);}
.tl-sysbtn.on{background:var(--ink);color:var(--paper);}
.tl-sysbtn:not(.on):hover{background:#E2E5E2;}

.tl-headright{display:flex;align-items:center;gap:10px;}
.tl-headdate input{height:38px;border:1.5px solid var(--ink);background:#fff;font-family:'Inter';font-size:13px;font-weight:500;padding:0 10px;color:var(--ink);border-radius:0;font-variant-numeric:tabular-nums;cursor:pointer;}
.tl-headdate input:focus{outline:2px solid var(--ink);outline-offset:-1px;}
.tl-pick-eyebrow{margin-bottom:14px;}
.tl-menuwrap{position:relative;}
.tl-menubtn{display:flex;align-items:center;justify-content:center;width:40px;height:38px;border:1.5px solid var(--ink);background:none;cursor:pointer;color:var(--ink);}
.tl-menubtn.on,.tl-menubtn:hover{background:var(--ink);color:var(--paper);}
.tl-burger{position:relative;display:flex;flex-direction:column;justify-content:center;gap:4px;width:18px;height:14px;}
.tl-burger i{display:block;height:2px;width:100%;background:currentColor;transition:transform .18s ease,opacity .18s ease;}
.tl-burger[data-open="true"] i:nth-child(1){transform:translateY(6px) rotate(45deg);}
.tl-burger[data-open="true"] i:nth-child(2){opacity:0;}
.tl-burger[data-open="true"] i:nth-child(3){transform:translateY(-6px) rotate(-45deg);}

.tl-menu-backdrop{position:fixed;inset:0;z-index:40;background:transparent;}
.tl-menu{position:absolute;top:calc(100% + 8px);right:0;z-index:50;min-width:208px;background:var(--card);border:1px solid var(--line);box-shadow:0 14px 34px rgba(20,22,28,.16);padding:8px;}
.tl-menu-label{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#a8aeb6;font-weight:600;padding:6px 10px 8px;}
.tl-menu-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;cursor:pointer;font-family:'Archivo';font-weight:700;font-size:15px;color:var(--ink);padding:10px 10px;}
.tl-menu-item:hover{background:#EEF0EE;}
.tl-menu-item.active{background:#E9ECE9;}
.tl-mi-here{margin-left:auto;font-size:9px;color:var(--steel);}
.tl-mi-dot{width:8px;height:8px;border-radius:50%;background:var(--ink);display:inline-block;}
.tl-mi-strength .tl-mi-dot{background:var(--strength);}
.tl-mi-cardio .tl-mi-dot{background:var(--cardio);}
.tl-mi-body .tl-mi-dot{background:var(--body);}
.tl-mi-history .tl-mi-dot{background:var(--steel);}
.tl-mi-analytics .tl-mi-dot{background:#6A4FB3;}
.tl-mi-changelog .tl-mi-dot{background:var(--steel);}
.tl-mi-setup .tl-mi-dot{background:var(--body);}

.tl-blank{padding:48px 24px;text-align:center;color:var(--steel);margin-bottom:14px;}
.tl-blank-mark{width:34px;height:34px;border:2px dashed var(--line);border-radius:50%;margin:0 auto;}
.tl-blank p{font-size:14px;margin:14px 0 0;}

.tl-cl{padding:6px 0;margin-bottom:14px;}
.tl-cl-row{padding:14px 20px;border-top:1px solid #EDEEED;}
.tl-cl-row:first-child{border-top:none;}
.tl-cl-top{display:flex;align-items:center;gap:10px;margin-bottom:5px;}
.tl-cl-page{font-family:'Archivo';font-weight:800;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--ink);padding:3px 9px;}
.tl-cl-date{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8aeb6;font-weight:600;}
.tl-cl-sum{font-size:14px;line-height:1.45;color:var(--ink);}

/* nutrition setup form */
.tl-setup-intro{font-size:13.5px;color:var(--steel);line-height:1.5;margin-bottom:14px;}
.tl-setup-intro b{color:var(--ink);font-weight:700;}
.tl-setup-q{padding:16px 18px;margin-bottom:12px;}
.tl-setup-qlabel{font-size:13.5px;color:var(--ink);margin-bottom:12px;line-height:1.4;}
.tl-setup-qlabel b{font-family:'Archivo';font-weight:800;}
.tl-opt-opt{font-size:11px;color:#a8aeb6;font-weight:500;}
.tl-setup-opts{display:flex;flex-direction:column;gap:8px;}
.tl-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:left;
  background:#fff;border:1.5px solid var(--line);padding:12px 14px;font-family:'Inter';font-size:14px;font-weight:500;color:var(--ink);cursor:pointer;border-radius:0;}
.tl-opt:hover{border-color:var(--body);}
.tl-opt.on{background:var(--body);border-color:var(--body);color:#fff;}
.tl-opt-rec{flex:0 0 auto;font-family:'Archivo';font-weight:700;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--body);background:#e7f4ef;padding:2px 7px;}
.tl-opt.on .tl-opt-rec{background:rgba(255,255,255,.22);color:#fff;}

.tl-assume{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-top:1px solid #EDEEED;}
.tl-assume-t{font-size:13px;color:var(--ink);line-height:1.35;flex:1;}
.tl-assume-tog{display:flex;flex:0 0 auto;}
.tl-tog{border:1px solid var(--line);background:#fff;color:var(--steel);font-family:'Archivo';font-weight:700;font-size:12px;padding:6px 11px;cursor:pointer;}
.tl-tog+.tl-tog{margin-left:-1px;}
.tl-tog.on-confirm{background:var(--body);border-color:var(--body);color:#fff;}
.tl-tog.on-change{background:var(--cardio);border-color:var(--cardio);color:#fff;}

.tl-setup-notes{width:100%;border:1.5px solid var(--line);background:#fff;font-family:'Inter';font-size:14px;padding:10px 11px;border-radius:0;resize:vertical;color:var(--ink);}
.tl-setup-notes:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink);}
.tl-sum-pre{white-space:pre-wrap;word-break:break-word;font-family:'Inter';font-size:12.5px;line-height:1.5;color:var(--ink);background:#F1F3F1;border:1px solid var(--line);padding:12px;margin:0 0 12px;}

/* nutrition v1 food logging */
.tl-bwrow{display:flex;gap:10px;}
.tl-bwrow input{flex:1;font-family:'Inter';font-size:15px;padding:9px 11px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:0;}
.tl-bwrow input:focus{outline:2px solid var(--ink);outline-offset:-1px;}
.tl-bwrow .tl-add{padding:0 22px;}

.tl-foodsearch{width:100%;font-family:'Inter';font-size:15px;padding:11px 12px;border:1.5px solid var(--line);background:#fff;color:var(--ink);border-radius:0;margin-bottom:10px;}
.tl-foodsearch:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink);}
.tl-foodlist{display:flex;flex-direction:column;gap:6px;}
.tl-foodrow{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;text-align:left;background:#fff;border:1px solid var(--line);padding:10px 12px;cursor:pointer;border-radius:0;}
.tl-foodrow:hover{border-color:var(--body);background:#f3f9f6;}
.tl-foodname{font-size:14px;font-weight:600;color:var(--ink);}
.tl-foodbrand{font-weight:400;color:var(--steel);}
.tl-foodmeta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--steel);font-variant-numeric:tabular-nums;}
.tl-foodtag{font-family:'Archivo';font-weight:700;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--body);background:#e7f4ef;padding:2px 6px;}
.tl-foodbtns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;}
.tl-chipbtn{background:none;border:1.5px solid var(--body);color:var(--body);font-family:'Archivo';font-weight:700;font-size:13px;padding:8px 14px;cursor:pointer;border-radius:0;}
.tl-chipbtn:hover{background:#eef7f3;}
.tl-chipbtn.on{background:var(--body);color:#fff;}
.tl-chipbtn.sm{font-size:12px;padding:6px 11px;}

.tl-subpanel{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);}
.tl-loggrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.tl-loggrid .tl-field-wide{grid-column:1 / -1;}
.tl-loggrid select,.tl-loggrid input{font-family:'Inter';font-size:15px;padding:9px 11px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:0;width:100%;}
.tl-loggrid select:focus,.tl-loggrid input:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink);}
.tl-preview{margin-top:12px;font-size:14px;color:var(--ink);}
.tl-preview b{color:var(--body);font-weight:800;}
.tl-gram{color:var(--steel);font-size:12px;}
.tl-basis{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0;}
.tl-basis-label{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--steel);font-weight:600;}
.tl-basis-note{font-size:12px;color:var(--steel);margin-top:10px;}

.tl-today-totals,.tl-nut-totals{display:flex;flex-wrap:wrap;gap:14px;font-size:13.5px;color:var(--ink);font-variant-numeric:tabular-nums;padding:10px 0;}
.tl-today-totals b,.tl-nut-totals b{font-family:'Archivo';font-weight:800;color:var(--body);}
.tl-nut-totals.clickable{cursor:pointer;}
.tl-exp{margin-left:auto;color:var(--steel);}
.tl-nut-none{font-size:13px;color:var(--steel);padding:8px 0;}
.tl-manual-tag{font-family:'Archivo';font-weight:700;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--steel);background:#E4E7E4;padding:2px 6px;}
.tl-day-datebtn{background:none;border:none;padding:0;font-family:'Archivo';font-weight:700;font-size:15px;color:var(--ink);cursor:pointer;text-align:left;}
.tl-day-datebtn:hover{color:var(--body);text-decoration:underline;}

/* analytics dashboard skeleton */
.tl-an-controls{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;}
.tl-an-pill{display:inline-flex;align-items:center;font-family:'Archivo';font-weight:700;font-size:12px;letter-spacing:.02em;color:var(--steel);border:1px solid var(--line);background:var(--card);padding:7px 12px;}
.tl-an-pill.sm{font-size:11px;padding:5px 9px;}
.tl-an-note{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a8aeb6;font-weight:600;margin-left:4px;}

.tl-an-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;}
.tl-an-kpi{padding:14px 16px 16px;}
.tl-an-kpi-label{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--steel);font-weight:600;margin-bottom:4px;}

.tl-an-panel{padding:16px 18px 18px;margin-bottom:14px;}
.tl-an-panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;}
.tl-an-panel-head h3{font-family:'Archivo';font-weight:800;font-size:15px;margin:0;}
.tl-an-plot{display:flex;align-items:center;justify-content:center;height:150px;border:1px dashed #c7ccc7;
  background:repeating-linear-gradient(to top,transparent,transparent 28px,#EDEFED 28px,#EDEFED 29px);}
.tl-an-plot.tall{height:220px;}
.tl-an-plot span{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a8aeb6;font-weight:600;background:var(--card);padding:3px 8px;}

.tl-an-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.tl-an-grid2>.tl-an-panel{margin-bottom:0;}
.tl-an-grid2{margin-bottom:14px;}

.tl-an-table{display:flex;flex-direction:column;}
.tl-an-tr{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;align-items:center;padding:9px 2px;border-top:1px solid #EDEEED;}
.tl-an-tr.tl-an-th{border-top:none;}
.tl-an-tr.tl-an-th span{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#a8aeb6;font-weight:600;}

.tl-sk{position:relative;overflow:hidden;background:#E4E7E4;border-radius:2px;}
.tl-sk::after{content:'';position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.65),transparent);animation:tl-shimmer 1.4s infinite;}
@keyframes tl-shimmer{100%{transform:translateX(100%);}}
.tl-sk-num{height:30px;width:72%;margin:2px 0 9px;}
.tl-sk-line{height:11px;width:100%;}
.tl-sk-line.short{width:48%;}
.tl-sk-line.tiny{width:62%;}

.tl-back{background:none;border:none;color:var(--steel);font-family:'Archivo';font-weight:700;font-size:13px;letter-spacing:.04em;cursor:pointer;padding:0 0 14px;}
.tl-back:hover{color:var(--ink);}

.tl-board{background:var(--ink);color:#F5F6F5;padding:22px 24px 18px;margin-bottom:24px;}
.tl-board-date{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#9aa1ad;font-weight:600;margin-bottom:14px;}
.tl-board-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.tl-stat{padding:4px 0;}
.tl-stat-label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9aa1ad;font-weight:600;margin-bottom:6px;}
.tl-stat-num{font-family:'Archivo';font-weight:900;font-size:clamp(34px,7vw,52px);line-height:1;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;gap:8px;color:#fff;}
.tl-stat-unit{font-size:15px;font-weight:700;}
.tl-stat-strength .tl-stat-unit{color:var(--strength-lt);}
.tl-stat-cardio .tl-stat-unit{color:var(--cardio-lt);}
.tl-stat-sub{font-size:12px;color:#9aa1ad;margin-top:7px;font-weight:500;}
.tl-stat-strength{border-left:3px solid var(--strength-lt);padding-left:14px;}
.tl-stat-cardio{border-left:3px solid var(--cardio-lt);padding-left:14px;}

.tl-fboard{margin-bottom:22px;}
.tl-fstat{padding-left:14px;border-left:3px solid #fff;}
.tl-fboard-strength .tl-fstat{border-left-color:var(--strength-lt);}
.tl-fboard-strength .tl-stat-unit{color:var(--strength-lt);}
.tl-fboard-cardio .tl-fstat{border-left-color:var(--cardio-lt);}
.tl-fboard-cardio .tl-stat-unit{color:var(--cardio-lt);}
.tl-fbody{margin-top:0;}

.tl-board-body{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;}
.tl-bchip{display:flex;flex-direction:column;gap:2px;background:#1f232b;border-left:3px solid var(--body-lt);padding:7px 12px;}
.tl-bchip i{font-style:normal;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9aa1ad;font-weight:600;}
.tl-bchip b{font-family:'Archivo';font-weight:800;font-size:16px;color:#fff;font-variant-numeric:tabular-nums;}

.tl-board-all{margin-top:16px;padding-top:13px;border-top:1px solid #2c2f38;font-size:12px;color:#b6bcc6;}
.tl-board-all b{color:#fff;font-weight:700;}

/* picker */
.tl-pick{margin-bottom:8px;}
.tl-pick-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:16px;flex-wrap:wrap;}
.tl-pick-q{font-family:'Archivo';font-weight:800;font-size:clamp(22px,4vw,30px);margin:4px 0 0;letter-spacing:-.01em;}
.tl-pick-date{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--steel);font-weight:600;}
.tl-pick-date input{font-family:'Inter';font-size:14px;padding:8px 10px;border:1px solid var(--line);background:#fff;border-radius:0;font-variant-numeric:tabular-nums;}
.tl-pick-date input:focus{outline:2px solid var(--ink);outline-offset:-1px;}

.tl-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
.tl-choice{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;background:var(--card);border:1px solid var(--line);padding:20px 18px 16px;cursor:pointer;overflow:hidden;transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease;}
.tl-choice:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(20,22,28,.10);}
.tl-choice-bar{position:absolute;top:0;left:0;right:0;height:4px;}
.tl-choice-strength .tl-choice-bar{background:var(--strength);}
.tl-choice-cardio .tl-choice-bar{background:var(--cardio);}
.tl-choice-body .tl-choice-bar{background:var(--body);}
.tl-choice-strength:hover{border-color:var(--strength);}
.tl-choice-cardio:hover{border-color:var(--cardio);}
.tl-choice-body:hover{border-color:var(--body);}
.tl-choice-name{font-family:'Archivo';font-weight:800;font-size:22px;letter-spacing:-.01em;margin-top:6px;}
.tl-choice-desc{font-size:13px;color:var(--steel);line-height:1.35;min-height:34px;}
.tl-choice-foot{display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:10px;padding-top:11px;border-top:1px solid var(--line);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--steel);font-weight:600;}
.tl-choice-arrow{font-family:'Archivo';font-weight:800;font-size:16px;}
.tl-choice-strength .tl-choice-arrow{color:var(--strength);}
.tl-choice-cardio .tl-choice-arrow{color:var(--cardio);}
.tl-choice-body .tl-choice-arrow{color:var(--body);}

.tl-histlink{margin-top:18px;background:none;border:none;color:var(--steel);font-family:'Archivo';font-weight:700;font-size:14px;letter-spacing:.02em;cursor:pointer;padding:4px 0;}
.tl-histlink:hover{color:var(--ink);}

.tl-page-head{display:flex;justify-content:space-between;align-items:center;margin:6px 0 14px;}
.tl-page-title{font-family:'Archivo';font-weight:900;font-size:28px;margin:0;letter-spacing:-.01em;}
.tl-page-sub{font-family:'Archivo';font-weight:800;font-size:16px;margin:0;color:var(--ink);}

.tl-card{background:var(--card);border:1px solid var(--line);}
.tl-form{padding:18px 20px 20px;margin-bottom:24px;}
.tl-form-top{display:flex;align-items:center;gap:14px;margin-bottom:16px;flex-wrap:wrap;}
.tl-editing{font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--cardio);}
.tl-editing-body{color:var(--body);}

.tl-field{display:flex;flex-direction:column;gap:6px;}
.tl-field>span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--steel);font-weight:600;}
.tl-field>span i{font-style:normal;color:#a8aeb6;font-weight:500;text-transform:none;letter-spacing:0;}
.tl-field input{font-family:'Inter';font-size:15px;padding:9px 11px;border:1px solid var(--line);background:#fff;color:var(--ink);width:100%;border-radius:0;}
.tl-field input:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink);}
.tl-field-date input{font-variant-numeric:tabular-nums;}

.tl-strength-form{display:flex;flex-direction:column;gap:16px;}
.tl-sets{display:flex;flex-direction:column;gap:8px;}
.tl-sets-head{display:grid;grid-template-columns:46px 1fr 1fr 40px;gap:10px;padding:0 2px;}
.tl-sets-head span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--steel);font-weight:600;}
.tl-setrow{display:grid;grid-template-columns:46px 1fr 1fr 40px;gap:10px;align-items:center;}
.tl-set-n{font-family:'Archivo';font-weight:800;font-size:15px;color:var(--strength);text-align:center;font-variant-numeric:tabular-nums;}
.tl-setrow input{font-family:'Inter';font-size:15px;padding:9px 11px;border:1px solid var(--line);background:#fff;color:var(--ink);width:100%;border-radius:0;}
.tl-setrow input:focus{outline:2px solid var(--ink);outline-offset:-1px;border-color:var(--ink);}
.tl-setdel{background:none;border:1px solid var(--line);color:var(--steel);cursor:pointer;height:38px;font-size:12px;border-radius:0;}
.tl-setdel:hover:not(:disabled){border-color:#b3261e;color:#b3261e;}
.tl-setdel:disabled{opacity:.3;cursor:not-allowed;}
.tl-addset{align-self:flex-start;background:none;border:1px dashed var(--strength);color:var(--strength);font-family:'Archivo';font-weight:700;font-size:13px;padding:8px 16px;cursor:pointer;margin-top:2px;}
.tl-addset:hover{background:#eef1fb;}
.tl-draftvol{font-size:13px;color:var(--steel);}
.tl-draftvol b{color:var(--strength);font-weight:700;font-variant-numeric:tabular-nums;}

.tl-grid-c{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:12px;}
.tl-grid-b{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;}

.tl-err{margin-top:13px;color:#b3261e;font-size:13px;font-weight:600;}
.tl-form-actions{display:flex;gap:10px;margin-top:18px;}
.tl-add{border:none;color:#fff;font-family:'Archivo';font-weight:800;font-size:14px;letter-spacing:.04em;text-transform:uppercase;padding:12px 26px;cursor:pointer;}
.tl-add-strength{background:var(--strength);}.tl-add-strength:hover{background:#1d3499;}
.tl-add-cardio{background:var(--cardio);}.tl-add-cardio:hover{background:#b14416;}
.tl-add-body{background:var(--body);}.tl-add-body:hover{background:#176b55;}
.tl-ghost{background:none;border:1px solid var(--line);padding:12px 20px;font-family:'Archivo';font-weight:700;font-size:14px;color:var(--steel);cursor:pointer;}
.tl-ghost:hover{border-color:var(--ink);color:var(--ink);}

.tl-chart{padding:18px 20px 16px;margin-bottom:24px;}
.tl-chart-head{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:8px;flex-wrap:wrap;}
.tl-chart-head h2{font-family:'Archivo';font-weight:800;font-size:17px;margin:0;}
.tl-chart-ctrl{display:flex;gap:8px;}
.tl-chart-ctrl select{font-family:'Inter';font-size:13px;padding:7px 9px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:0;cursor:pointer;}
.tl-empty{color:var(--steel);font-size:14px;padding:24px 4px;}

.tl-clear{background:none;border:1px solid var(--line);color:var(--steel);font-size:12px;font-weight:600;padding:7px 13px;cursor:pointer;}
.tl-clear:hover{border-color:#b3261e;color:#b3261e;}
.tl-empty-big{padding:34px 24px;color:var(--steel);font-size:14px;text-align:center;margin-bottom:14px;}

.tl-day{padding:16px 18px 8px;margin-bottom:14px;}
.tl-day-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;padding-bottom:9px;border-bottom:1px solid var(--line);}
.tl-day-date{font-family:'Archivo';font-weight:700;font-size:15px;}
.tl-day-ton{font-family:'Archivo';font-weight:800;font-size:13px;color:var(--strength);font-variant-numeric:tabular-nums;}

.tl-table{width:100%;border-collapse:collapse;margin-bottom:8px;font-variant-numeric:tabular-nums;}
.tl-table th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#a8aeb6;font-weight:600;padding:5px 8px;}
.tl-table td{font-size:13.5px;padding:8px;border-top:1px solid #EDEEED;color:var(--ink);vertical-align:top;}
.tl-strong{font-weight:600;white-space:nowrap;}
.tl-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:8px;vertical-align:middle;}
.tl-dot-strength{background:var(--strength);}.tl-dot-cardio{background:var(--cardio);}.tl-dot-body{background:var(--body);}
.tl-setlist{display:flex;flex-wrap:wrap;gap:5px;min-width:160px;}
.tl-setpill{display:inline-flex;align-items:center;background:#eef1fb;color:#22307a;border:1px solid #dbe2f8;padding:2px 7px;font-size:12px;font-weight:600;border-radius:2px;}
.tl-setpill .tl-x{color:#9aa6cf;margin:0 2px;font-weight:500;}
.tl-rowact{text-align:right;white-space:nowrap;}
.tl-rowact button{background:none;border:none;cursor:pointer;font-family:'Inter';font-size:12px;font-weight:600;color:var(--steel);padding:3px 6px;}
.tl-rowact button:hover{color:var(--ink);}
.tl-rowact button:last-child:hover{color:#b3261e;}

.tl-foot{margin-top:30px;text-align:center;font-size:11px;letter-spacing:.06em;color:#a8aeb6;}

@media(max-width:680px){
  .tl-board-grid{grid-template-columns:1fr;gap:14px;}
  .tl-cards{grid-template-columns:1fr;}
  .tl-choice-desc{min-height:0;}
  .tl-grid-c,.tl-grid-b{grid-template-columns:1fr 1fr;}
  .tl-field-wide{grid-column:1 / -1;}
  .tl-table{display:block;overflow-x:auto;}
  .tl-an-kpis{grid-template-columns:1fr 1fr;}
  .tl-an-grid2{grid-template-columns:1fr;}
  .tl-loggrid{grid-template-columns:1fr 1fr;}
}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;}.tl-sk::after{animation:none;}}
`;

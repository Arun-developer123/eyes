"use client";

import React, { useEffect, useRef, useState } from "react";
import Cursor from "@/components/Cursor";
import EyeTracker from "@/components/EyeTracker";

/* ---------------------------
   Helpers + mock search data
   --------------------------- */
function makeFavIconDataUrl(title: string, idx: number) {
  const colors = ["#4285F4", "#DB4437", "#F4B400", "#0F9D58"];
  const c = colors[idx % colors.length];
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%' height='100%' fill='${c}' rx='12'/><text x='50%' y='55%' font-family='Arial' font-size='28' fill='white' text-anchor='middle' alignment-baseline='middle'>${title[0] || "G"}</text></svg>`
  );
  return `data:image/svg+xml;charset=utf-8,${svg}`;
}

type Result = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  favicon: string;
};

function buildMockResults(query: string): Result[] {
  if (!query) return [];
  const base = [
    "Official site",
    "Wikipedia",
    "YouTube: tutorial",
    "Blog: deep dive",
    "StackOverflow answer",
    "Docs & API",
  ];
  return base.map((b, i) => ({
    id: `r-${i + 1}`,
    title: `${query} — ${b}`,
    url: `https://example.com/${query.replace(/\s+/g, "-")}/${i + 1}`,
    snippet: `This is a mock snippet for "${query}" (result ${i + 1}). Click to open an in-app preview.`,
    favicon: makeFavIconDataUrl(b, i),
  }));
}

/* ---------------------------
   Eye integration hook (same pattern)
   - records last gaze coords (px) on eye-move or mousemove
   - dispatches click/dbl handling via event listeners (handled elsewhere)
   --------------------------- */
function useEyeToClickIntegration() {
  const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    lastPos.current = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };

    function clamp(pt: { x: number; y: number }) {
      return {
        x: Math.min(Math.max(0, pt.x), window.innerWidth - 1),
        y: Math.min(Math.max(0, pt.y), window.innerHeight - 1),
      };
    }

    function setFromDetail(detail: any) {
      if (!detail) return;
      let x = detail.x;
      let y = detail.y;
      if (typeof x === "number" && typeof y === "number" && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        x = x * window.innerWidth;
        y = y * window.innerHeight;
      }
      if (typeof x === "number" && typeof y === "number" && !isNaN(x) && !isNaN(y)) {
        lastPos.current = clamp({ x: Math.round(x), y: Math.round(y) });
      }
    }

    function onResize() {
      lastPos.current = clamp(lastPos.current);
    }
    window.addEventListener("resize", onResize);

    function onMouse(e: MouseEvent) {
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener("mousemove", onMouse);

    function onEyeMove(e: Event) {
      const ev = e as CustomEvent;
      setFromDetail(ev.detail);
    }
    window.addEventListener("eye-move", onEyeMove as EventListener);

    const clickNames = ["eye-click", "eye-blink", "eye-select", "select", "blink"];
    const dblNames = ["eye-dblclick", "eye-double", "doubleBlink"];

    function triggerAtPoint(type: "click" | "dblclick", coords?: { x: number; y: number }) {
      const { x, y } = clamp(coords ? coords : lastPos.current);
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) return;
      // prefer focusing inputs
      const inputEl = el.closest("input, textarea, [contenteditable='true']") as HTMLElement | null;
      if (inputEl) {
        try { inputEl.focus(); } catch {}
        try { inputEl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); } catch {}
        return;
      }
      const clickable = el.closest("button, a, [role='button'], label") as HTMLElement | null;
      if (clickable) {
        try { clickable.focus?.(); } catch {}
        try { clickable.click(); return; } catch {}
      }
      try {
        const down = new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y });
        const up = new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y });
        const click = new MouseEvent("click", { bubbles: true, clientX: x, clientY: y });
        el.dispatchEvent(down);
        el.dispatchEvent(up);
        el.dispatchEvent(click);
      } catch {}
    }

    function onEyeClick() { triggerAtPoint("click"); }
    function onEyeDbl() { triggerAtPoint("dblclick"); }

    clickNames.forEach((n) => window.addEventListener(n, onEyeClick as EventListener));
    dblNames.forEach((n) => window.addEventListener(n, onEyeDbl as EventListener));

    function onEyeEvent(e: Event) {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      setFromDetail(d);
      if (d.type === "click") triggerAtPoint("click", d);
      if (d.type === "dblclick") triggerAtPoint("dblclick", d);
    }
    window.addEventListener("eye-event", onEyeEvent as EventListener);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("eye-move", onEyeMove as EventListener);
      clickNames.forEach((n) => window.removeEventListener(n, onEyeClick as EventListener));
      dblNames.forEach((n) => window.removeEventListener(n, onEyeDbl as EventListener));
      window.removeEventListener("eye-event", onEyeEvent as EventListener);
    };
  }, []);
}

/* ---------------------------
   Virtual keyboard - gaze-aware (same behaviour as WhatsApp page)
   - highlights key under gaze using elementFromPoint
   - reacts to eye-click / eye-event to type focused key
   - shows preview (currentText)
   --------------------------- */
function VirtualKeyboard({
  visible,
  onKey,
  onClose,
  currentText,
}: {
  visible: boolean;
  onKey: (k: string) => void;
  onClose: () => void;
  currentText: string;
}) {
  const rows = [
    "qwertyuiop".split(""),
    "asdfghjkl".split(""),
    "zxcvbnm".split(""),
  ];
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setHoverKey(null);
      return;
    }

    function clampToViewport(x: number, y: number) {
      return {
        x: Math.min(Math.max(0, Math.round(x)), window.innerWidth - 1),
        y: Math.min(Math.max(0, Math.round(y)), window.innerHeight - 1),
      };
    }

    function handleMove(detail?: any) {
      if (!detail) return;
      let x = detail.x;
      let y = detail.y;
      if (typeof x === "number" && typeof y === "number" && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        x = x * window.innerWidth;
        y = y * window.innerHeight;
      }
      if (typeof x !== "number" || typeof y !== "number" || isNaN(x) || isNaN(y)) return;
      const { x: cx, y: cy } = clampToViewport(x, y);
      const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
      if (!el) {
        setHoverKey(null);
        return;
      }
      const keyEl = el.closest("[data-key]") as HTMLElement | null;
      if (keyEl && keyEl.dataset && keyEl.dataset.key) setHoverKey(keyEl.dataset.key);
      else setHoverKey(null);
    }

    function onMouse(e: MouseEvent) {
      handleMove({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("mousemove", onMouse);

    function onEyeMove(e: Event) {
      const ev = e as CustomEvent;
      handleMove(ev.detail);
    }
    window.addEventListener("eye-move", onEyeMove as EventListener);

    function onEyeClick() {
      if (hoverKey) onKey(hoverKey);
    }
    const clickNames = ["eye-click", "eye-blink", "eye-select", "select", "blink"];
    clickNames.forEach((n) => window.addEventListener(n, onEyeClick as EventListener));

    function onEyeEvent(e: Event) {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      if (d.type === "click") {
        // if coords inside keyboard, trigger key under coords
        let x = d.x;
        let y = d.y;
        if (typeof x === "number" && typeof y === "number") {
          if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            x = x * window.innerWidth;
            y = y * window.innerHeight;
          }
          const el = document.elementFromPoint(Math.round(x), Math.round(y)) as HTMLElement | null;
          const keyEl = el?.closest("[data-key]") as HTMLElement | null;
          if (keyEl && keyEl.dataset.key) {
            onKey(keyEl.dataset.key);
            return;
          }
        }
        if (hoverKey) onKey(hoverKey);
      }
    }
    window.addEventListener("eye-event", onEyeEvent as EventListener);

    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("eye-move", onEyeMove as EventListener);
      clickNames.forEach((n) => window.removeEventListener(n, onEyeClick as EventListener));
      window.removeEventListener("eye-event", onEyeEvent as EventListener);
    };
  }, [visible, hoverKey, onKey]);

  if (!visible) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 bg-white p-3 rounded-lg shadow-lg w-[min(900px,95%)] text-black">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">Virtual Keyboard</div>
        <div className="text-sm">Preview: <span className="font-semibold">{currentText || "—"}</span></div>
        <div>
          <button className="px-2 py-1 rounded bg-gray-100 mr-2" onClick={() => onKey(" ")}>Space</button>
          <button className="px-2 py-1 rounded bg-red-500 text-white" onClick={onClose}>Close</button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={idx} className="flex justify-center gap-2">
            {r.map((k) => {
              const isHover = hoverKey === k;
              return (
                <button
                  key={k}
                  data-key={k}
                  onClick={() => onKey(k)}
                  className={`px-3 py-2 rounded min-w-[44px] h-[44px] ${isHover ? "bg-blue-500 text-white" : "bg-gray-100"}`}
                >
                  {k}
                </button>
              );
            })}
            {idx === 1 && (
              <button data-key="backspace" onClick={() => onKey("backspace")} className={`px-3 py-2 rounded min-w-[64px] h-[44px] bg-yellow-400`}>⌫</button>
            )}
          </div>
        ))}
        <div className="flex justify-center mt-2">
          <button data-key="send" onClick={() => onKey("send")} className="px-6 py-3 rounded bg-green-600 text-white">Search</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Search result card + preview modal
   --------------------------- */
function ResultCard({ r, onOpen }: { r: Result; onOpen: (r: Result) => void }) {
  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(r); }}
      className="p-4 border rounded hover:shadow cursor-pointer bg-white">
      <div className="flex items-start gap-3">
        <img src={r.favicon} alt="" className="w-10 h-10 rounded" />
        <div>
          <div className="text-lg font-medium text-blue-700">{r.title}</div>
          <div className="text-sm text-gray-600">{r.url}</div>
          <div className="text-sm text-gray-700 mt-2">{r.snippet}</div>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ r, onClose }: { r: Result | null; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!r) return null;
  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-start md:items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-3xl bg-white rounded shadow-lg overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">{r.title}</div>
            <div className="text-xs text-gray-500">{r.url}</div>
          </div>
          <button onClick={onClose} className="px-3 py-1 rounded bg-gray-100">Close</button>
        </div>
        <div className="p-6">
          <p className="text-gray-800">{r.snippet}</p>
          <div className="mt-4 p-4 bg-gray-50 rounded">This is an in-app preview. External navigation disabled in demo.</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Main Google-like page
   --------------------------- */
export default function GooglePage(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState<Result | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEyeToClickIntegration();

  // perform mock "search" when query changes (client-side)
  useEffect(() => {
    // small debounce style effect
    const id = setTimeout(() => {
      setResults(buildMockResults(query));
    }, 180);
    return () => clearTimeout(id);
  }, [query]);

  // toggle virtual keyboard on blink (if input focused or gaze on input)
  useEffect(() => {
    function toggleIfInputFocusedOrGazed(detail?: any) {
      try {
        if (detail && typeof detail.x === "number" && typeof detail.y === "number") {
          let x = detail.x, y = detail.y;
          if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
            x = x * window.innerWidth;
            y = y * window.innerHeight;
          }
          const el = document.elementFromPoint(Math.round(x), Math.round(y));
          if (el && (el === inputRef.current || inputRef.current?.contains(el))) {
            setKeyboardVisible((s) => !s);
            return;
          }
        }
        if (document.activeElement === inputRef.current) {
          setKeyboardVisible((s) => !s);
        }
      } catch {}
    }

    const clickNames = ["eye-click", "eye-blink", "eye-select", "select", "blink"];
    const onEyeClick = () => toggleIfInputFocusedOrGazed(undefined);
    clickNames.forEach((n) => window.addEventListener(n, onEyeClick as EventListener));

    function onEyeEvent(e: Event) {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      if (d.type === "click") toggleIfInputFocusedOrGazed(d);
    }
    window.addEventListener("eye-event", onEyeEvent as EventListener);

    return () => {
      clickNames.forEach((n) => window.removeEventListener(n, onEyeClick as EventListener));
      window.removeEventListener("eye-event", onEyeEvent as EventListener);
    };
  }, []);

  function handleVirtualKey(k: string) {
    if (k === "backspace") {
      setQuery((q) => q.slice(0, -1));
      inputRef.current?.focus();
      return;
    }
    if (k === " " || k === "Space") {
      setQuery((q) => q + " ");
      inputRef.current?.focus();
      return;
    }
    if (k === "send" || k === "Enter") {
      // run search => already running via useEffect; focus results
      inputRef.current?.focus();
      return;
    }
    setQuery((q) => q + k);
    inputRef.current?.focus();
  }

  return (
    <div className="w-screen h-screen bg-gray-50 text-gray-900 flex flex-col">
      <Cursor />
      <EyeTracker />

      {/* Top bar (Google-style simplified) */}
      <header className="w-full p-4 flex items-center justify-between bg-white border-b">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold text-blue-600">G</div>
          <div className="text-lg font-semibold">Google Demo</div>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-3 py-1 rounded hover:bg-gray-100">Gmail</button>
          <button className="px-3 py-1 rounded hover:bg-gray-100">Images</button>
        </div>
      </header>

      {/* Main search area */}
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-4xl mx-auto text-center">
          <div className="mb-6">
            <div className="text-4xl font-semibold mb-2">Google</div>
            <p className="text-sm text-gray-600">Search the demo web (in-app preview only)</p>
          </div>

          <div className="flex items-center gap-3 bg-white p-4 rounded shadow-sm">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Google or type a URL"
              className="flex-1 px-4 py-3 outline-none text-lg"
              aria-label="Search"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // results update via effect
                  inputRef.current?.blur();
                }
              }}
            />
            <button onClick={() => { inputRef.current?.focus(); setKeyboardVisible((s)=>!s); }} className="px-4 py-2 rounded bg-gray-100">⌨︎</button>
            <button onClick={() => { /* simulate search */ inputRef.current?.blur(); }} className="px-4 py-2 rounded bg-blue-600 text-white">Search</button>
          </div>

          {/* quick chips */}
          <div className="mt-4 flex gap-2 justify-center flex-wrap">
            {["news", "images", "videos", "maps"].map((c) => (
              <button key={c} onClick={() => setQuery(c)} className="px-3 py-1 rounded bg-white border">{c}</button>
            ))}
          </div>

          {/* results */}
          <section className="mt-8">
            {results.length === 0 ? (
              <div className="text-center text-gray-500">Type to see results</div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {results.map((r) => <ResultCard key={r.id} r={r} onOpen={(res) => setOpen(res)} />)}
              </div>
            )}
          </section>
        </div>
      </main>

      <PreviewModal r={open} onClose={() => setOpen(null)} />
      <VirtualKeyboard visible={keyboardVisible} onKey={handleVirtualKey} onClose={() => setKeyboardVisible(false)} currentText={query} />
    </div>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import Cursor from "@/components/Cursor";
import EyeTracker from "@/components/EyeTracker";

/* ---------------------------
   Types & mock data
   --------------------------- */
type Message = { id: string; text: string; fromMe?: boolean; ts?: number };
type Chat = { id: string; name: string; last: string; unread?: number; avatarColor?: string; messages: Message[] };

function genChats(): Chat[] {
  const now = Date.now();
  const mk = (i: number) => ({
    id: `c-${i}`,
    name: i % 2 === 0 ? `Mom` : `Friend ${i}`,
    last: "Last message preview",
    unread: i === 1 ? 2 : 0,
    avatarColor: ["#25D366", "#06b6d4", "#a78bfa", "#fb7185", "#34d399"][i % 5],
    messages: [
      { id: `m-${i}-1`, text: "Hey! This is a demo chat.", fromMe: false, ts: now - 1000 * 60 * 60 },
      { id: `m-${i}-2`, text: "Eye cursor works here 👍", fromMe: true, ts: now - 1000 * 60 * 40 },
    ],
  });
  return Array.from({ length: 6 }).map((_, i) => mk(i + 1));
}

/* ---------------------------
   Eye -> click integration
   - listens to "eye-move", "eye-event", and blink events
   - translates them to DOM clicks / focuses
   - emits custom events (eye-event / eye-click) when it triggers clicks so UI can react
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
      // support normalized coords 0..1
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

    function dispatchEyeEvents(x: number, y: number, type: string = "click") {
      const nx = x / window.innerWidth;
      const ny = y / window.innerHeight;
      try {
        window.dispatchEvent(new CustomEvent("eye-event", { detail: { x, y, nx, ny, type } }));
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent("eye-click", { detail: { x, y, nx, ny, type } }));
      } catch {}
    }

    function triggerAtPoint(type: "click" | "dblclick", coords?: { x: number; y: number }) {
      const { x, y } = clamp(coords ? coords : lastPos.current);
      let el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (!el) {
        // still emit event so UI can react (e.g., keyboard)
        dispatchEyeEvents(x, y, type);
        return;
      }

      // prefer focusing inputs/contenteditable
      const inputEl = el.closest("input, textarea, [contenteditable='true']") as HTMLElement | null;
      if (inputEl) {
        try { inputEl.focus(); } catch {}
        try {
          inputEl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
        } catch {}
        dispatchEyeEvents(x, y, type);
        return;
      }

      // clickable ancestor
      const clickable = el.closest("button, a, [role='button'], label") as HTMLElement | null;
      if (clickable) {
        try { clickable.focus?.(); } catch {}
        try { clickable.click(); } catch {}
        dispatchEyeEvents(x, y, type);
        return;
      }

      // fallback dispatch
      try {
        const down = new MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y });
        const up = new MouseEvent("mouseup", { bubbles: true, clientX: x, clientY: y });
        const click = new MouseEvent("click", { bubbles: true, clientX: x, clientY: y });
        el.dispatchEvent(down);
        el.dispatchEvent(up);
        el.dispatchEvent(click);
      } catch {}
      dispatchEyeEvents(x, y, type);
    }

    function onEyeClick(e?: Event) {
      triggerAtPoint("click");
    }
    function onEyeDbl(e?: Event) {
      triggerAtPoint("dblclick");
    }

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
   UI Components
   --------------------------- */

/* Sidebar */
function Sidebar({
  chats,
  selected,
  onSelect,
  onSearch,
}: {
  chats: Chat[];
  selected: string | null;
  onSelect: (id: string) => void;
  onSearch: (q: string) => void;
}) {
  return (
    <aside className="w-[340px] min-w-[280px] border-r bg-[#0b141a] text-white h-full flex flex-col">
      <div className="p-4 flex items-center gap-3 border-b">
        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-lg font-semibold">U</div>
        <div className="flex-1">
          <div className="font-semibold">You</div>
          <div className="text-xs text-gray-400">Available</div>
        </div>
        <div className="text-gray-400">⋮</div>
      </div>

      <div className="p-3 border-b">
        <input
          aria-label="Search chats"
          onChange={(e) => onSearch(e.target.value)}
          className="w-full px-3 py-2 rounded bg-[#0f1720] placeholder:text-gray-500 outline-none text-white"
          placeholder="Search or start new chat"
        />
      </div>

      <div className="flex-1 overflow-auto">
        <ul className="divide-y">
          {chats.map((c) => (
            <li
              key={c.id}
              className={`p-3 cursor-pointer hover:bg-white/5 flex items-center gap-3 ${selected === c.id ? "bg-white/5" : ""}`}
              onClick={() => onSelect(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") onSelect(c.id); }}
              aria-label={`Open chat with ${c.name}`}
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: c.avatarColor }}
              >
                {c.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-xs text-gray-400">{c.messages.length ? "Now" : ""}</div>
                </div>
                <div className="text-sm text-gray-300 truncate">{c.messages[c.messages.length - 1]?.text || c.last}</div>
              </div>
              {c.unread ? <div className="bg-green-500 text-xs text-white px-2 py-0.5 rounded">{c.unread}</div> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="p-3 border-t text-xs text-gray-400">Demo UI — no backend</div>
    </aside>
  );
}

/* Message bubble */
function MessageBubble({ m }: { m: Message }) {
  const [timeStr, setTimeStr] = useState<string>("");

  useEffect(() => {
    const t = new Date(m.ts || Date.now());
    setTimeStr(t.toLocaleTimeString());
  }, [m.ts]);

  return (
    <div className={`max-w-[70%] p-3 rounded-lg ${m.fromMe ? "self-end bg-[#25D366] text-black" : "self-start bg-white/10 text-white"}`}>
      <div className="text-sm">{m.text}</div>
      <div className="text-[10px] text-gray-300 mt-1 text-right">{timeStr}</div>
    </div>
  );
}

/* Virtual Keyboard */
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
  const containerRef = useRef<HTMLDivElement | null>(null);

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

    function handleMoveFromDetail(detail?: any) {
      if (!containerRef.current) return;
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
      if (keyEl && keyEl.dataset && keyEl.dataset.key) {
        setHoverKey(keyEl.dataset.key);
      } else {
        setHoverKey(null);
      }
    }

    function onMouse(e: MouseEvent) {
      handleMoveFromDetail({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("mousemove", onMouse);

    function onEyeMove(e: Event) {
      const ev = e as CustomEvent;
      handleMoveFromDetail(ev.detail);
    }
    window.addEventListener("eye-move", onEyeMove as EventListener);

    function onEyeClick(e?: Event) {
      if (hoverKey) {
        onKey(hoverKey);
        return;
      }
    }
    const clickNames = ["eye-click", "eye-blink", "eye-select", "select", "blink"];
    clickNames.forEach((n) => window.addEventListener(n, onEyeClick as EventListener));

    function onEyeEvent(e: Event) {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      if (d.type === "click") {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hoverKey, onKey]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="false"
      className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 bg-[#0b141a] p-3 rounded-lg shadow-lg w-[min(780px,95%)] text-white"
    >
      <div className="flex justify-between items-center mb-2">
        <div className="text-sm">Virtual Keyboard</div>
        <div className="text-xs opacity-80">Preview: <span className="font-medium">{currentText || "—"}</span></div>
        <div>
          <button className="px-2 py-1 rounded bg-white/10 mr-2" onClick={() => onKey(" ")} aria-label="Space">Space</button>
          <button className="px-2 py-1 rounded bg-red-600" onClick={onClose} aria-label="Close keyboard">Close</button>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div className="flex justify-center gap-2" key={idx}>
            {r.map((k) => {
              const isHover = hoverKey === k;
              return (
                <button
                  key={k}
                  data-key={k}
                  className={`px-3 py-2 rounded text-lg min-w-[44px] h-[44px] ${isHover ? "bg-white/30 text-black" : "bg-white/5 hover:bg-white/10"}`}
                  onClick={() => onKey(k)}
                  aria-label={`Key ${k}`}
                >
                  {k}
                </button>
              );
            })}
            {idx === 1 && (
              <button
                data-key="backspace"
                className={`px-3 py-2 rounded min-w-[64px] h-[44px] ${hoverKey === "backspace" ? "bg-white/30 text-black" : "bg-yellow-600"}`}
                onClick={() => onKey("backspace")}
                aria-label="Backspace"
              >
                ⌫
              </button>
            )}
          </div>
        ))}

        <div className="flex justify-center gap-2 mt-2">
          <button
            data-key="send"
            className={`px-4 py-2 rounded bg-green-600 min-w-[120px] h-[44px] ${hoverKey === "send" ? "ring-2 ring-white/50" : ""}`}
            onClick={() => onKey("send")}
            aria-label="Send"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/* ChatWindow */
function ChatWindow({ chat, onSend }: { chat: Chat | null; onSend: (text: string) => void; }) {
  const [text, setText] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [chat?.messages?.length]);

  useEffect(() => {
    // Toggle keyboard when single blink occurs over input OR input is focused
    function toggleIfInputFocusedOrGazed(detail?: any) {
      try {
        if (detail && typeof detail.x === "number" && typeof detail.y === "number") {
          let x = detail.x;
          let y = detail.y;
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

        // fallback: if input is focused at time of blink, toggle keyboard
        if (document.activeElement === inputRef.current) {
          setKeyboardVisible((s) => !s);
        }
      } catch {}
    }

    const clickNames = ["eye-click", "eye-blink", "eye-select", "select", "blink"];
    const onEyeClick = (e?: Event) => {
      if (e && (e as CustomEvent).detail) {
        toggleIfInputFocusedOrGazed((e as CustomEvent).detail);
      } else {
        toggleIfInputFocusedOrGazed(undefined);
      }
    };
    clickNames.forEach((n) => window.addEventListener(n, onEyeClick as EventListener));

    function onEyeEvent(e: Event) {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      if (d.type === "click") toggleIfInputFocusedOrGazed(d);
    }
    window.addEventListener("eye-event", onEyeEvent as EventListener);

    // Also listen for programmatic synthetic clicks (EyeTracker may call el.click())
    function onAnyClick(e: MouseEvent) {
      if (!e.isTrusted) {
        // treat synthetic click as "eye click" and check target
        const x = (e as any).clientX ?? Math.round(window.innerWidth / 2);
        const y = (e as any).clientY ?? Math.round(window.innerHeight / 2);
        toggleIfInputFocusedOrGazed({ x, y });
      }
    }
    window.addEventListener("click", onAnyClick as EventListener, true);

    return () => {
      clickNames.forEach((n) => window.removeEventListener(n, onEyeClick as EventListener));
      window.removeEventListener("eye-event", onEyeEvent as EventListener);
      window.removeEventListener("click", onAnyClick as EventListener, true);
    };
  }, []);

  if (!chat) return <div className="flex-1 flex items-center justify-center text-gray-500">Select a chat to start</div>;

  function handleSend() {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText("");
    inputRef.current?.focus();
    // close keyboard after sending
    setKeyboardVisible(false);
  }

  function handleVirtualKey(k: string) {
    if (k === "backspace") {
      setText((t) => t.slice(0, -1));
      inputRef.current?.focus();
      return;
    }
    if (k === " " || k === "Space") {
      setText((t) => t + " ");
      inputRef.current?.focus();
      return;
    }
    if (k === "send") {
      handleSend();
      return;
    }
    setText((t) => t + k);
    inputRef.current?.focus();
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="p-4 border-b flex items-center gap-3 bg-[#0f1b20]">
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-semibold">{chat.name.split(" ").map(s => s[0]).slice(0,2).join("")}</div>
        <div className="flex-1">
          <div className="font-semibold text-white">{chat.name}</div>
          <div className="text-xs text-gray-300">last seen recently</div>
        </div>
        <div className="flex items-center gap-3">
          {/* Back button top-right — blinkable / clickable */}
          <button
            aria-label="Back"
            className="px-3 py-1 rounded bg-white/5 text-gray-300 hover:bg-white/10"
            onClick={() => { window.location.href = "/"; }}
          >
            Back
          </button>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-auto p-4 space-y-3 bg-[#071014]">
        {chat.messages.map((m) => <MessageBubble key={m.id} m={m} />)}
      </div>

      <div className="p-3 border-t bg-[#071014]">
        <div className="flex items-center gap-3">
          <button aria-label="Attach" className="p-2 rounded-full bg-white/5 text-white" onClick={() => { /* demo */ }}>📎</button>

          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message"
            className="flex-1 px-3 py-2 rounded-full bg-[#0b2226] outline-none text-white"
            aria-label="Type a message"
          />

          <button aria-label="Send" className="px-4 py-2 rounded-full bg-green-500 text-white" onClick={handleSend}>Send</button>
        </div>
      </div>

      <VirtualKeyboard
        visible={keyboardVisible}
        onKey={handleVirtualKey}
        onClose={() => setKeyboardVisible(false)}
        currentText={text}
      />
    </div>
  );
}

/* ---------------------------
   Page (main)
   --------------------------- */
export default function WhatsAppPage(): React.JSX.Element {
  const [chats, setChats] = useState<Chat[]>(() => genChats());
  const [selectedId, setSelectedId] = useState<string | null>(() => genChats()[0]?.id ?? null);
  const [filtered, setFiltered] = useState<Chat[] | null>(null);

  // install eye integration
  useEyeToClickIntegration();

  function selectChat(id: string) {
    setSelectedId(id);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  }

  function sendMessage(text: string) {
    if (!selectedId) return;
    setChats((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? { ...c, messages: [...c.messages, { id: `m-${c.id}-${Date.now()}`, text, fromMe: true, ts: Date.now() }], last: text }
          : c
      )
    );
  }

  function onSearch(q: string) {
    const v = q.trim().toLowerCase();
    if (!v) { setFiltered(null); return; }
    setFiltered(chats.filter((c) => c.name.toLowerCase().includes(v) || c.messages.some(m => m.text.toLowerCase().includes(v))));
  }

  const displayChats = filtered ?? chats;
  const selectedChat = displayChats.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="w-screen h-screen flex bg-[#071014] text-white">
      {/* Eye cursor + tracker (mounted as before) */}
      <Cursor />
      <EyeTracker />

      <Sidebar chats={displayChats} selected={selectedId} onSelect={selectChat} onSearch={onSearch} />

      <main className="flex-1 flex flex-col">
        <ChatWindow chat={selectedChat} onSend={sendMessage} />
      </main>
    </div>
  );
}

"use client";

import React, { useEffect, useRef, useState } from "react";
import Cursor from "@/components/Cursor";
import EyeTracker from "@/components/EyeTracker";
import { useRouter } from "next/navigation";

/* -------------------------
   Helpers: thumbnails + mock data
   ------------------------- */
function makeThumbnailDataUrl(title: string, idx: number) {
  const colors = [
    ["#e43f5a", "#f6a100"],
    ["#5eead4", "#0284c7"],
    ["#7c3aed", "#f472b6"],
    ["#06b6d4", "#4ade80"],
    ["#fb7185", "#f59e0b"],
  ];
  const [a, b] = colors[idx % colors.length];
  const text = title.replace(/["'&<>]/g, "");
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1280' height='720'>
      <defs>
        <linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
          <stop offset='0' stop-color='${a}'/>
          <stop offset='1' stop-color='${b}'/>
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='url(#g)' />
      <g fill='white' font-family='Inter, Roboto, Arial' font-weight='700'>
        <text x='40' y='110' font-size='64'>${text}</text>
      </g>
      <g>
        <circle cx='1100' cy='620' r='60' fill='rgba(0,0,0,0.25)'/>
        <polygon points='1080,600 1080,640 1120,620' fill='white'/>
      </g>
    </svg>`
  );
  return `data:image/svg+xml;charset=utf-8,${svg}`;
}

type Video = {
  id: string;
  title: string;
  channel: string;
  views: string;
  duration: string;
  thumb: string;
  description?: string;
};

function buildMockVideos(): Video[] {
  const samples = [
    "Building an Eye-Control App",
    "How WebRTC Works (Simple)",
    "JavaScript Tricks in 10 minutes",
    "Next.js App Router Deep Dive",
    "Tailwind UI: From Zero to Hero",
    "Accessibility: Keyboard & Screen Reader",
    "Animating Cursor with CSS",
    "Designing Smooth UIs",
    "Performance Tips for React",
  ];
  return samples.map((t, i) => ({
    id: `v-${i + 1}`,
    title: t,
    channel: i % 2 === 0 ? "Both Innovations" : "DevChannel",
    views: `${(100 + i * 37).toLocaleString()} views`,
    duration: `${2 + (i % 7)}:${i % 60 < 10 ? "0" : ""}${i % 60}`,
    thumb: makeThumbnailDataUrl(t, i),
    description:
      "Demo playback — this is a client-side mock. The UI behaves like YouTube but uses no backend.",
  }));
}

/* -------------------------
   UI components (VideoCard, Modal, Sidebar, TopBar)
   ------------------------- */
function VideoCard({
  video,
  onOpen,
}: {
  video: Video;
  onOpen: (v: Video) => void;
}) {
  return (
    <article
      className="cursor-pointer group"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(video)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(video);
      }}
      aria-label={`Open video ${video.title}`}
    >
      <div className="relative w-full aspect-[16/9] bg-gray-200 overflow-hidden rounded">
        <img
          src={video.thumb}
          alt={video.title}
          className="w-full h-full object-cover"
          draggable={false}
        />
        <div className="absolute right-2 bottom-2 bg-black/75 text-white text-xs px-2 py-0.5 rounded">
          {video.duration}
        </div>
      </div>

      <div className="mt-3 flex gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-400 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white line-clamp-2">
            {video.title}
          </h3>
          <p className="text-xs text-gray-600">{video.channel}</p>
          <p className="text-xs text-gray-500">{video.views}</p>
        </div>
      </div>
    </article>
  );
}

function VideoPlayerModal({
  video,
  onClose,
}: {
  video: Video | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!video) return;
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    }
  }, [video]);

  if (!video) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/80 flex items-start md:items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[1100px] bg-white rounded-lg overflow-hidden shadow-2xl">
        <div className="relative bg-black">
          <video
            ref={videoRef}
            controls
            poster={video.thumb}
            className="w-full max-h-[65vh] bg-black"
          >
            <source
              src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
              type="video/mp4"
            />
          </video>

          <button
            aria-label="Close video"
            className="absolute right-3 top-3 bg-black/50 text-white p-2 rounded"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="p-4">
          <h2 className="text-lg font-semibold">{video.title}</h2>
          <p className="text-sm text-gray-600">
            {video.channel} • {video.views}
          </p>
          <p className="mt-3 text-sm text-gray-700">{video.description}</p>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: (k: string) => void }) {
  const items = [
    { key: "home", label: "Home" },
    { key: "explore", label: "Explore" },
    { key: "subscriptions", label: "Subscriptions" },
    { key: "library", label: "Library" },
  ];
  return (
    <nav className="w-[240px] min-w-[200px] border-r border-gray-200 bg-white h-full p-4">
      <div className="mb-6 text-2xl font-bold">YouTube</div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.key}>
            <button
              onClick={() => onNavigate?.(it.key)}
              className="w-full text-left px-3 py-2 rounded hover:bg-gray-100"
            >
              {it.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-6 text-xs text-gray-500">Demo UI — no backend</div>
    </nav>
  );
}

function TopBar({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (v: string) => void;
}) {
  return (
    <header className="w-full border-b border-gray-200 bg-white p-3 flex items-center gap-4">
      <div className="text-xl font-semibold">YouTube</div>
      <div className="flex-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search"
          className="w-full max-w-xl border rounded-full px-4 py-2 focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-3">
        <button className="p-2 rounded-full hover:bg-gray-100">◎</button>
        <div className="w-8 h-8 bg-gray-300 rounded-full" />
      </div>
    </header>
  );
}

/* -------------------------
   useEyeToClickIntegration (fixed)
   - No window access at top-level
   - initializes center only inside useEffect
   - toggle video play/pause when video element targeted
   ------------------------- */
function useEyeToClickIntegration() {
  const lastPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    // now it's safe to access window
    lastPos.current = {
      x: Math.round(window.innerWidth / 2),
      y: Math.round(window.innerHeight / 2),
    };

    function onResize() {
      // keep lastpos within bounds
      lastPos.current = {
        x: Math.min(Math.max(lastPos.current.x, 0), window.innerWidth),
        y: Math.min(Math.max(lastPos.current.y, 0), window.innerHeight),
      };
    }
    window.addEventListener("resize", onResize);

    function setPosFromDetail(detail: any) {
      if (!detail) return;
      let x = detail.x;
      let y = detail.y;
      // handle normalized coordinates
      if (
        typeof x === "number" &&
        typeof y === "number" &&
        x >= 0 &&
        x <= 1 &&
        y >= 0 &&
        y <= 1
      ) {
        x = x * window.innerWidth;
        y = y * window.innerHeight;
      }
      if (typeof x === "number" && typeof y === "number" && !isNaN(x) && !isNaN(y)) {
        lastPos.current = { x: Math.round(x), y: Math.round(y) };
      }
    }

    // fallback: mouse movement updates lastPos
    function onMouse(e: MouseEvent) {
      lastPos.current = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener("mousemove", onMouse);

    // listen for custom eye-move event
    function onEyeMove(e: Event) {
      const ev = e as CustomEvent;
      setPosFromDetail(ev.detail);
    }
    window.addEventListener("eye-move", onEyeMove as EventListener);

    // resilient names for blink/click events
    const clickNames = ["eye-click", "eye-blink", "eye-select", "blink", "select"];
    const dblNames = ["eye-dblclick", "eye-double", "eye-dbl", "doubleBlink"];

    function triggerClick(type: "click" | "dblclick") {
      const { x, y } = lastPos.current;
      // clamp coords
      const cx = Math.min(Math.max(0, x), window.innerWidth - 1);
      const cy = Math.min(Math.max(0, y), window.innerHeight - 1);

      let el = document.elementFromPoint(cx, cy) as HTMLElement | null;
      if (!el) return;

      // prefer a video ancestor if present (so we toggle play/pause)
      const videoAncestor = el.closest("video") as HTMLVideoElement | null;
      if (videoAncestor) {
        el = videoAncestor;
      }

      try {
        el.focus?.();
      } catch {}

      // If it's a video element, toggle play/pause (more reliable than synthetic click)
      if (el.tagName.toLowerCase() === "video") {
        const v = el as HTMLVideoElement;
        if (type === "click") {
          if (v.paused) {
            v.play().catch(() => {
              // fallback: dispatch click forcing UI handlers
              try {
                (v as any).click?.();
              } catch {}
            });
          } else {
            v.pause();
          }
        } else if (type === "dblclick") {
          // dblclick commonly toggles fullscreen on many players — try requestFullscreen if available
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          } else {
            try {
              v.requestFullscreen?.();
            } catch {}
          }
        }
        return;
      }

      // try native click
      try {
        (el as HTMLElement).click();
        return;
      } catch {}

      // fallback: dispatch mouse events (mousedown -> mouseup -> click)
      try {
        const down = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
        });
        const up = new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
        });
        const click = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
        });
        el.dispatchEvent(down);
        el.dispatchEvent(up);
        el.dispatchEvent(click);
      } catch {}
    }

    function onEyeClick() {
      triggerClick("click");
    }
    function onEyeDbl() {
      triggerClick("dblclick");
    }

    clickNames.forEach((n) => window.addEventListener(n, onEyeClick as EventListener));
    dblNames.forEach((n) => window.addEventListener(n, onEyeDbl as EventListener));

    // unified event with detail.type
    function onEyeEvent(e: Event) {
      const ev = e as CustomEvent;
      const d = ev.detail || {};
      setPosFromDetail(d);
      if (d.type === "click") triggerClick("click");
      if (d.type === "dblclick") triggerClick("dblclick");
    }
    window.addEventListener("eye-event", onEyeEvent as EventListener);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("eye-move", onEyeMove as EventListener);
      clickNames.forEach((n) =>
        window.removeEventListener(n, onEyeClick as EventListener)
      );
      dblNames.forEach((n) =>
        window.removeEventListener(n, onEyeDbl as EventListener)
      );
      window.removeEventListener("eye-event", onEyeEvent as EventListener);
    };
  }, []);
}

/* -------------------------
   Main page
   ------------------------- */
export default function YouTubePage(): React.JSX.Element {
  const router = useRouter();
  const [videos] = useState<Video[]>(() => buildMockVideos());
  const [query, setQuery] = useState("");
  const [openVideo, setOpenVideo] = useState<Video | null>(null);
  const [filtered, setFiltered] = useState(videos);

  useEyeToClickIntegration(); // install integration on client

  useEffect(() => {
    if (!query) {
      setFiltered(videos);
      return;
    }
    const q = query.toLowerCase();
    setFiltered(
      videos.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.channel.toLowerCase().includes(q)
      )
    );
  }, [query, videos]);

  function handleBack() {
    // navigate back to app root (app/page.tsx)
    router.push("/");
  }

  return (
    <div className="w-screen h-screen bg-slate-50 text-slate-900 flex">
      {/* Fixed overlay for cursor + eye-tracker so it visually sits above everything */}
      <div className="fixed inset-0 pointer-events-none z-[9999]">
        {/* Cursor/EyeTracker visuals should not block regular interactions (pointer-events-none)
            If you need the tracker to receive pointer events (for UI inside it), adjust accordingly.
        */}
        <Cursor />
        <EyeTracker />
      </div>

      {/* Back button: top-right corner, clickable (pointer-events-auto), above the cursor overlay */}
      <button
        aria-label="Back to home"
        onClick={handleBack}
        className="fixed top-4 right-4 z-[10000] pointer-events-auto bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg shadow hover:shadow-md"
      >
        ← Back
      </button>

      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar query={query} setQuery={setQuery} />

        <main className="p-6 overflow-auto">
          <section className="mb-4">
            <h1 className="text-2xl font-bold">Recommended</h1>
            <p className="text-sm text-gray-600">
              This is a client-side demo. Use your eye to move the cursor and blink/click to interact.
            </p>
          </section>

          <section>
            {filtered.length === 0 ? (
              <div className="py-20 text-center text-gray-500">
                No results for “{query}”
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {filtered.map((v) => (
                  <VideoCard key={v.id} video={v} onOpen={setOpenVideo} />
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      <aside className="w-[320px] border-l border-gray-200 p-4 hidden xl:block">
        <h3 className="font-semibold mb-3">Up next</h3>
        <div className="space-y-3">
          {videos.slice(0, 4).map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-3 cursor-pointer hover:bg-gray-100 p-2 rounded"
              onClick={() => setOpenVideo(v)}
            >
              <img src={v.thumb} alt={v.title} className="w-20 h-12 object-cover rounded" />
              <div>
                <div className="text-sm font-medium">{v.title}</div>
                <div className="text-xs text-gray-500">{v.channel}</div>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <VideoPlayerModal video={openVideo} onClose={() => setOpenVideo(null)} />
    </div>
  );
}

"use client";

import { useEffect } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

/**
 * EyeTracker — blink-safe + single-blink click + stable-lock
 *
 * Key fix:
 * - Process EAR (blink) BEFORE computing gaze mapping.
 * - If eye is closed, skip movement calculation & buffer updates (freeze).
 * - On reopen, use pre-blink buffer MAD to decide whether to click.
 */

export default function EyeTracker(): React.JSX.Element | null {
  useEffect(() => {
    let video: HTMLVideoElement | null = null;
    let landmarker: FaceLandmarker | null = null;
    let running = true;

    // cursor state
    let smoothX = window.innerWidth / 2;
    let smoothY = window.innerHeight / 2;

    // monotonic timestamp
    let lastVideoTs = 0;

    // blink detection (single blink -> click)
    let eyeClosed = false;
    let closedAt = 0;
    const MIN_BLINK_MS = 60; // minimum intentional closure
    const MAX_BLINK_MS = 400; // ignore very long closures as look-away

    // click cooldown / freeze
    let lastClickAt = 0;
    const CLICK_COOLDOWN_MS = 600;
    let clickFreezeUntil = 0;
    const CLICK_FREEZE_MS = 280;

    // EAR calibration & indices
    const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
    const LEFT_IRIS_IDX = [468, 469, 470, 471];
    const RIGHT_IRIS_IDX = [473, 474, 475, 476];

    // left-eye socket fallback indices
    const LEFT_EYE_SOCKET = { left: 33, right: 133, top: 159, bottom: 145 };

    // EAR calibration collection
    const earSamples: number[] = [];
    let earBaseline = 0;
    const CALIBRATE_MS = 2000;
    let calibStart = 0;

    // calibration params
    let calibrated = false;
    let affineParams: number[] | null = null; // [ax,bx,cx,ay,by,cy]

    // overlay UI for calibration
    let overlayEl: HTMLDivElement | null = null;
    let infoEl: HTMLDivElement | null = null;
    let dotEl: HTMLDivElement | null = null;

    // calibration grid
    const CAL_POINTS = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.1, y: 0.5 },
      { x: 0.5, y: 0.5 },
      { x: 0.9, y: 0.5 },
      { x: 0.1, y: 0.9 },
      { x: 0.5, y: 0.9 },
      { x: 0.9, y: 0.9 },
    ];

    let calIndex = 0;
    let collecting = false;
    const samplesForCurrent: Array<{ u: number; v: number }>[] = CAL_POINTS.map(
      () => []
    );

    // pos buffer for stabilization (pre-blink buffer is preserved during blink)
    const POS_BUF_SIZE = 11;
    const posBuf: Array<{ x: number; y: number }> = [];

    // helpers
    function safeGet(arr: any[], idx: number) {
      return arr && arr[idx] ? arr[idx] : { x: 0.5, y: 0.5 };
    }

    function center(points: any[]) {
      return {
        x: points.reduce((s, p) => s + p.x, 0) / points.length,
        y: points.reduce((s, p) => s + p.y, 0) / points.length,
      };
    }

    function dist(a: any, b: any) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function eyeAspectRatio(eye: any[]) {
      const A = dist(eye[1], eye[5]);
      const B = dist(eye[2], eye[4]);
      const C = dist(eye[0], eye[3]) || 1e-6;
      return (A + B) / (2 * C);
    }

    function clamp(v: number, min: number, max: number) {
      return Math.min(Math.max(v, min), max);
    }

    // small linear algebra for affine solve
    function invert3x3(m: number[]): number[] | null {
      const a = m[0],
        b = m[1],
        c = m[2];
      const d = m[3],
        e = m[4],
        f = m[5];
      const g = m[6],
        h = m[7],
        i = m[8];
      const A = e * i - f * h;
      const B = -(d * i - f * g);
      const C = d * h - e * g;
      const D = -(b * i - c * h);
      const E = a * i - c * g;
      const F = -(a * h - b * g);
      const G = b * f - c * e;
      const H = -(a * f - c * d);
      const I = a * e - b * d;
      const det = a * A + b * B + c * C;
      if (Math.abs(det) < 1e-9) return null;
      const invDet = 1 / det;
      return [
        A * invDet,
        D * invDet,
        G * invDet,
        B * invDet,
        E * invDet,
        H * invDet,
        C * invDet,
        F * invDet,
        I * invDet,
      ];
    }

    function solveAffineFromSamples(
      inputs: Array<{ u: number; v: number }>,
      outputsX: number[],
      outputsY: number[]
    ): number[] | null {
      const n = inputs.length;
      if (n < 3) return null;
      let U00 = 0,
        U01 = 0,
        U02 = 0,
        U11 = 0,
        U12 = 0,
        U22 = 0;
      let UX0 = 0,
        UX1 = 0,
        UX2 = 0;
      let UY0 = 0,
        UY1 = 0,
        UY2 = 0;
      for (let i = 0; i < n; i++) {
        const u = inputs[i].u;
        const v = inputs[i].v;
        const x = outputsX[i];
        const y = outputsY[i];
        U00 += u * u;
        U01 += u * v;
        U02 += u * 1;
        U11 += v * v;
        U12 += v * 1;
        U22 += 1 * 1;
        UX0 += u * x;
        UX1 += v * x;
        UX2 += 1 * x;
        UY0 += u * y;
        UY1 += v * y;
        UY2 += 1 * y;
      }
      const ATA = [
        U00, U01, U02, //
        U01, U11, U12, //
        U02, U12, U22, //
      ];
      const inv = invert3x3(ATA);
      if (!inv) return null;
      const pX0 = inv[0] * UX0 + inv[1] * UX1 + inv[2] * UX2;
      const pX1 = inv[3] * UX0 + inv[4] * UX1 + inv[5] * UX2;
      const pX2 = inv[6] * UX0 + inv[7] * UX1 + inv[8] * UX2;
      const pY0 = inv[0] * UY0 + inv[1] * UY1 + inv[2] * UY2;
      const pY1 = inv[3] * UY0 + inv[4] * UY1 + inv[5] * UY2;
      const pY2 = inv[6] * UY0 + inv[7] * UY1 + inv[8] * UY2;
      return [pX0, pX1, pX2, pY0, pY1, pY2];
    }

    // overlay UI
    function createOverlay() {
      overlayEl = document.createElement("div");
      overlayEl.style.position = "fixed";
      overlayEl.style.left = "0";
      overlayEl.style.top = "0";
      overlayEl.style.width = "100vw";
      overlayEl.style.height = "100vh";
      overlayEl.style.zIndex = "99999";
      overlayEl.style.pointerEvents = "none";
      document.body.appendChild(overlayEl);

      infoEl = document.createElement("div");
      infoEl.style.position = "fixed";
      infoEl.style.left = "50%";
      infoEl.style.top = "6%";
      infoEl.style.transform = "translateX(-50%)";
      infoEl.style.padding = "10px 14px";
      infoEl.style.background = "rgba(0,0,0,0.6)";
      infoEl.style.color = "white";
      infoEl.style.fontFamily = "sans-serif";
      infoEl.style.fontSize = "14px";
      infoEl.style.borderRadius = "8px";
      infoEl.style.pointerEvents = "none";
      overlayEl.appendChild(infoEl);

      dotEl = document.createElement("div");
      dotEl.style.position = "fixed";
      dotEl.style.width = "18px";
      dotEl.style.height = "18px";
      dotEl.style.borderRadius = "50%";
      dotEl.style.background = "white";
      dotEl.style.boxShadow = "0 0 8px rgba(0,0,0,0.4)";
      dotEl.style.transform = "translate(-50%,-50%)";
      dotEl.style.pointerEvents = "none";
      dotEl.style.display = "none";
      overlayEl.appendChild(dotEl);
    }

    function removeOverlay() {
      try {
        overlayEl?.remove();
      } catch {}
      overlayEl = null;
      infoEl = null;
      dotEl = null;
    }

    // median / MAD helpers
    function median(arr: number[]) {
      if (!arr.length) return 0;
      const s = arr.slice().sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
    }

    function madPx(buf: Array<{ x: number; y: number }>) {
      if (!buf.length) return Infinity;
      const xs = buf.map((p) => p.x);
      const ys = buf.map((p) => p.y);
      const medX = median(xs);
      const medY = median(ys);
      const devs = buf.map((p) => Math.hypot(p.x - medX, p.y - medY));
      return median(devs);
    }

    // calibration routine
    async function runCalibration() {
      if (!overlayEl || !dotEl || !infoEl) return;
      infoEl.textContent =
        "Calibration starting — keep your head steady and look at each dot.";
      await new Promise((r) => setTimeout(r, 900));

      for (let i = 0; i < CAL_POINTS.length && running; i++) {
        calIndex = i;
        samplesForCurrent[i] = [];
        collecting = true;
        const px = CAL_POINTS[i].x * window.innerWidth;
        const py = CAL_POINTS[i].y * window.innerHeight;
        dotEl.style.left = `${px}px`;
        dotEl.style.top = `${py}px`;
        dotEl.style.display = "block";
        infoEl.textContent = `Look at the dot (${i + 1}/${CAL_POINTS.length}) — hold for 900ms`;
        await new Promise((res) => setTimeout(res, 900));
        collecting = false;
        dotEl.style.display = "none";
        await new Promise((r) => setTimeout(r, 250));
      }

      // require >=5 valid points
      const inputs: Array<{ u: number; v: number }> = [];
      const outX: number[] = [];
      const outY: number[] = [];
      for (let i = 0; i < CAL_POINTS.length; i++) {
        const s = samplesForCurrent[i];
        if (!s || s.length < 3) continue;
        const us = s.map((z) => z.u);
        const vs = s.map((z) => z.v);
        const mu = median(us);
        const mv = median(vs);
        inputs.push({ u: mu, v: mv });
        outX.push(CAL_POINTS[i].x * window.innerWidth);
        outY.push(CAL_POINTS[i].y * window.innerHeight);
      }

      infoEl.textContent = "Computing calibration...";
      await new Promise((r) => setTimeout(r, 300));

      if (inputs.length >= 5) {
        const params = solveAffineFromSamples(inputs, outX, outY);
        if (params) {
          affineParams = params;
          calibrated = true;
          infoEl.textContent = "Calibration complete ✅";
          await new Promise((r) => setTimeout(r, 600));
          removeOverlay();
          return;
        }
      }

      calibrated = false;
      affineParams = null;
      infoEl.textContent =
        "Calibration unreliable — using relative eye movement fallback.";
      await new Promise((r) => setTimeout(r, 900));
      removeOverlay();
    }

    async function init() {
      try {
        createOverlay();

        video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        video.srcObject = stream;

        await new Promise<void>((resolve) => {
          const v = video as HTMLVideoElement;
          const onLoaded = async () => {
            try {
              await v.play();
            } catch {}
            resolve();
          };
          if (v.readyState >= 2) onLoaded();
          else {
            v.onloadedmetadata = onLoaded;
            setTimeout(resolve, 1500);
          }
        });

        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        );

        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        calibStart = performance.now();

        // start calibration (non-blocking)
        runCalibration().catch((e) => console.warn("Calibration failed:", e));

        requestAnimationFrame(loop);
      } catch (e) {
        console.error("EyeTracker init failed:", e);
      }
    }

    function getMedianFromBuffer(buf: Array<{ x: number; y: number }>) {
      if (buf.length === 0) return null;
      const xs = buf.map((p) => p.x).slice().sort((a, b) => a - b);
      const ys = buf.map((p) => p.y).slice().sort((a, b) => a - b);
      const mid = Math.floor(xs.length / 2);
      if (xs.length % 2 === 1) {
        return { x: xs[mid], y: ys[mid] };
      } else {
        return { x: (xs[mid - 1] + xs[mid]) / 2, y: (ys[mid - 1] + ys[mid]) / 2 };
      }
    }

    function loop() {
      if (!running) return;

      try {
        if (!video || !landmarker || video.readyState < 2) {
          requestAnimationFrame(loop);
          return;
        }

        let ts = Math.floor(video.currentTime * 1000);
        if (ts <= lastVideoTs) ts = lastVideoTs + 1;
        lastVideoTs = ts;

        const res = landmarker.detectForVideo(video, ts);

        if (res.faceLandmarks?.length) {
          const face = res.faceLandmarks[0];

          // EAR computation BEFORE movement logic
          const leftEyeForEar = LEFT_EYE_IDX.map((i) => safeGet(face, i));
          const ear = eyeAspectRatio(leftEyeForEar);
          const perfNow = performance.now();

          // calibration of ear baseline
          if (perfNow - calibStart < CALIBRATE_MS) {
            earSamples.push(ear);
          } else if (!earBaseline && earSamples.length) {
            earSamples.sort((a, b) => a - b);
            earBaseline = earSamples[Math.floor(earSamples.length / 2)] || 0.22;
          }

          const BLINK_THRESHOLD = earBaseline ? earBaseline * 0.65 : 0;

          // handle eye closed/open transitions
          if (BLINK_THRESHOLD && ear < BLINK_THRESHOLD && !eyeClosed) {
            // eye just closed
            eyeClosed = true;
            closedAt = Date.now();
            // do NOT clear posBuf here — keep pre-blink buffer for click decision
          }

          if (BLINK_THRESHOLD && ear >= BLINK_THRESHOLD && eyeClosed) {
            // eye just opened => evaluate blink
            const closedDur = Date.now() - closedAt;
            eyeClosed = false;

            // qualify as blink if duration in range
            if (closedDur >= MIN_BLINK_MS && closedDur <= MAX_BLINK_MS) {
              const sinceLastClick = Date.now() - lastClickAt;
              // require cooldown
              if (sinceLastClick > CLICK_COOLDOWN_MS) {
                // require pre-blink stability (use MAD of posBuf)
                const stableBeforeClick = madPx(posBuf) <= 12; // 12 px relaxed
                if (stableBeforeClick) {
                  // perform single-click at current stable smoothX/Y
                  lastClickAt = Date.now();
                  const clickX = Math.round(smoothX);
                  const clickY = Math.round(smoothY);
                  const el = document.elementFromPoint(clickX, clickY) as HTMLElement | null;
                  try {
                    el?.click();
                    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                  } catch (err) {
                    console.warn("Click dispatch error:", err);
                  }
                  // freeze cursor briefly and clear buffer
                  clickFreezeUntil = Date.now() + CLICK_FREEZE_MS;
                  posBuf.length = 0;
                } else {
                  // not stable enough — ignore this blink as click
                }
              }
            }
          }

          // If eye is currently closed, skip movement updates entirely (freeze cursor)
          if (eyeClosed) {
            // just re-dispatch current stable position so UI doesn't think cursor disappeared
            window.dispatchEvent(
              new CustomEvent("eye-move", { detail: { x: smoothX, y: smoothY, calibrated } })
            );
            requestAnimationFrame(loop);
            return;
          }

          // ---------- GAZE / MAPPING (only when eye is open) ----------
          const leftIris = LEFT_IRIS_IDX.map((i) => safeGet(face, i));
          const rightIris = RIGHT_IRIS_IDX.map((i) => safeGet(face, i));
          const leftCenter = center(leftIris);
          const rightCenter = center(rightIris);
          const irisCenter = {
            x: (leftCenter.x + rightCenter.x) / 2,
            y: (leftCenter.y + rightCenter.y) / 2,
          };

          // collect during calibration
          if (collecting && typeof calIndex === "number" && calIndex >= 0) {
            samplesForCurrent[calIndex].push({ u: irisCenter.x, v: irisCenter.y });
          }

          // compute candidate screen coordinates
          let candidateX = smoothX;
          let candidateY = smoothY;
          if (calibrated && affineParams) {
            const [ax, bx, cx, ay, by, cy] = affineParams;
            candidateX = ax * irisCenter.x + bx * irisCenter.y + cx;
            candidateY = ay * irisCenter.x + by * irisCenter.y + cy;
            candidateX = clamp(candidateX, 0, window.innerWidth);
            candidateY = clamp(candidateY, 0, window.innerHeight);
          } else {
            // fallback relative method using left eye socket
            const socket = {
              left: safeGet(face, LEFT_EYE_SOCKET.left),
              right: safeGet(face, LEFT_EYE_SOCKET.right),
              top: safeGet(face, LEFT_EYE_SOCKET.top),
              bottom: safeGet(face, LEFT_EYE_SOCKET.bottom),
            };
            const socketCenter = {
              x: (socket.left.x + socket.right.x) / 2,
              y: (socket.top.y + socket.bottom.y) / 2,
            };
            const dx = leftCenter.x - socketCenter.x;
            const dy = leftCenter.y - socketCenter.y;
            const SENSITIVITY = 2200;
            candidateX = clamp(smoothX + dx * SENSITIVITY, 0, window.innerWidth);
            candidateY = clamp(smoothY + dy * SENSITIVITY, 0, window.innerHeight);
          }

          // push candidate into buffer
          posBuf.push({ x: candidateX, y: candidateY });
          if (posBuf.length > POS_BUF_SIZE) posBuf.shift();

          // median and MAD
          const medianPos = getMedianFromBuffer(posBuf) ?? { x: candidateX, y: candidateY };
          const currentMad = madPx(posBuf);

          // stability thresholds
          const STABLE_MAD_PX = 7;
          const SNAP_LOCK = currentMad <= STABLE_MAD_PX;

          // max jump clamp
          const maxJumpPx = Math.max(window.innerWidth, window.innerHeight) * 0.15;
          const delta = Math.hypot(medianPos.x - smoothX, medianPos.y - smoothY);
          let mappedX = medianPos.x;
          let mappedY = medianPos.y;
          if (delta > maxJumpPx) {
            const ratio = maxJumpPx / delta;
            mappedX = smoothX + (medianPos.x - smoothX) * ratio;
            mappedY = smoothY + (medianPos.y - smoothY) * ratio;
          }

          // click freeze handling
          const now = Date.now();
          if (now < clickFreezeUntil) {
            // hold
          } else {
            if (SNAP_LOCK) {
              // snap when stable
              smoothX = mappedX;
              smoothY = mappedY;
            } else {
              // adaptive smoothing
              const SMOOTHING_CAL = 0.22;
              const SMOOTHING_FALLBACK = 0.12;
              const smoothing = calibrated ? SMOOTHING_CAL : SMOOTHING_FALLBACK;
              smoothX += (mappedX - smoothX) * smoothing;
              smoothY += (mappedY - smoothY) * smoothing;
            }
          }

          // dispatch eye-move
          window.dispatchEvent(
            new CustomEvent("eye-move", { detail: { x: smoothX, y: smoothY, calibrated } })
          );
        }
      } catch (err: any) {
        console.error("EyeTracker loop error:", err?.message ?? err);
      }

      requestAnimationFrame(loop);
    }

    init();

    return () => {
      running = false;
      try {
        (video?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        landmarker?.close();
      } catch {}
      removeOverlay();
    };
  }, []);

  return null;
}

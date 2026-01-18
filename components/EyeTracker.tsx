"use client";

import { useEffect } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

/**
 * Final production-ready EyeTracker (TypeScript-safe)
 * - monotonic timestamp for MediaPipe
 * - waits for video.play()
 * - EMA smoothing for cursor
 * - auto-calibration for EAR (first 2s)
 * - reliable double-blink -> element.click()
 * - avoids "possibly null" TS errors by narrowing before use
 */

export default function EyeTracker(): React.JSX.Element | null {
  useEffect(() => {
    let video: HTMLVideoElement | null = null;
    let landmarker: FaceLandmarker | null = null;
    let running = true;

    // smoothing
    let smoothX = window.innerWidth / 2;
    let smoothY = window.innerHeight / 2;
    const SMOOTHING = 0.15;

    // monotonic timestamp (ms)
    let lastVideoTs = 0;

    // blink detection
    let eyeClosed = false;
    let blinkTimes: number[] = [];
    const BLINK_WINDOW_MS = 600;

    // auto-calibration for EAR baseline
    const earSamples: number[] = [];
    let earBaseline = 0; // 0 => calibrate during first CALIBRATE_MS
    const CALIBRATE_MS = 2000;
    let calibStart = 0;

    // landmark indices
    const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144]; // for EAR
    const IRIS_IDX = [468, 469, 470, 471]; // iris points

    function dist(a: any, b: any) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function eyeAspectRatio(eye: any[]) {
      if (!eye || eye.length < 6) return 0;
      const A = dist(eye[1], eye[5]);
      const B = dist(eye[2], eye[4]);
      const C = dist(eye[0], eye[3]) || 1e-6;
      return (A + B) / (2 * C);
    }

    async function init() {
      try {
        // create video element
        video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true; // avoid autoplay blocks

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        video.srcObject = stream;

        // wait until metadata loaded and playback starts (safe)
        await new Promise<void>((resolve) => {
          const v = video as HTMLVideoElement;
          const onLoaded = async () => {
            try {
              await v.play();
              resolve();
            } catch (err) {
              // resolve anyway after a short delay if play() blocked
              setTimeout(() => resolve(), 500);
            }
          };
          if (v.readyState >= 2) onLoaded();
          else {
            v.onloadedmetadata = onLoaded;
            // safety timeout
            setTimeout(() => resolve(), 1500);
          }
        });

        // load MediaPipe Tasks WASM fileset
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
        requestAnimationFrame(loop);
      } catch (e) {
        console.error("EyeTracker init failed:", e);
      }
    }

    function safeGet(arr: any[], idx: number) {
      return arr && arr[idx] ? arr[idx] : { x: 0.5, y: 0.5 };
    }

    function loop() {
      if (!running) return;

      try {
        // Narrow video & landmarker for TypeScript (after guards)
        if (!video || !landmarker || video.readyState < 2) {
          requestAnimationFrame(loop);
          return;
        }
        const v = video as HTMLVideoElement;
        const lm = landmarker as FaceLandmarker;

        // ensure monotonic timestamp (ms)
        let ts = Math.floor(v.currentTime * 1000);
        if (ts <= lastVideoTs) ts = lastVideoTs + 1;
        lastVideoTs = ts;

        // detect
        const res = lm.detectForVideo(v, ts);

        if (res && res.faceLandmarks && res.faceLandmarks.length > 0) {
          const face = res.faceLandmarks[0];

          // --- gaze / cursor ---
          const irisPts = IRIS_IDX.map((i) => safeGet(face, i));
          const cx = irisPts.reduce((s, p) => s + p.x, 0) / irisPts.length;
          const cy = irisPts.reduce((s, p) => s + p.y, 0) / irisPts.length;

          const targetX = Math.min(Math.max(cx * window.innerWidth, 0), window.innerWidth);
          const targetY = Math.min(Math.max(cy * window.innerHeight, 0), window.innerHeight);

          smoothX += (targetX - smoothX) * SMOOTHING;
          smoothY += (targetY - smoothY) * SMOOTHING;

          window.dispatchEvent(new CustomEvent("eye-move", {
            detail: { x: smoothX, y: smoothY }
          }));

          // --- EAR / blink detection ---
          const leftEye = LEFT_EYE_IDX.map((i) => safeGet(face, i));
          const ear = eyeAspectRatio(leftEye);

          const nowPerf = performance.now();

          // calibration period
          if (nowPerf - calibStart < CALIBRATE_MS) {
            earSamples.push(ear);
          } else if (earBaseline === 0 && earSamples.length > 0) {
            // compute median baseline
            earSamples.sort((a, b) => a - b);
            const mid = Math.floor(earSamples.length / 2);
            earBaseline = earSamples.length % 2 === 1
              ? earSamples[mid]
              : (earSamples[mid - 1] + earSamples[mid]) / 2;
            if (!earBaseline || earBaseline < 0.12 || earBaseline > 0.35) {
              earBaseline = 0.22; // fallback
            }
            console.debug("EAR baseline:", earBaseline);
          } else if (earBaseline !== 0) {
            const BLINK_THRESHOLD = earBaseline * 0.65;

            if (ear < BLINK_THRESHOLD && !eyeClosed) {
              eyeClosed = true;
            }

            if (ear >= BLINK_THRESHOLD && eyeClosed) {
              eyeClosed = false;

              const t = Date.now();
              blinkTimes.push(t);
              blinkTimes = blinkTimes.filter((bt) => t - bt <= BLINK_WINDOW_MS);

              if (blinkTimes.length >= 2) {
                blinkTimes = [];

                const x = Math.round(smoothX);
                const y = Math.round(smoothY);

                const el = document.elementFromPoint(x, y) as HTMLElement | null;
                try {
                  // prefer .click() to trigger React handlers
                  el?.click();
                  el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                } catch (err) {
                  console.warn("Click dispatch error:", err);
                }
              }
            }
          }
        }
      } catch (err: any) {
        // Log but keep loop running
        console.error("EyeTracker loop error:", err?.message ?? err);
      }

      requestAnimationFrame(loop);
    }

    init();

    return () => {
      running = false;
      try {
        if (video?.srcObject) {
          (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        }
        landmarker?.close();
      } catch (e) {
        // ignore cleanup errors
      }
    };
  }, []);

  return null;
}

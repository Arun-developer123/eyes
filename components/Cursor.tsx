"use client";
import { useEffect, useState } from "react";

export default function Cursor() {
  const [pos, setPos] = useState({ x: 500, y: 300 });

  useEffect(() => {
    window.addEventListener("eye-move", ((e: any) => {
      setPos({ x: e.detail.x, y: e.detail.y });
    }) as EventListener);
  }, []);

  return (
    <div
      style={{
        left: pos.x,
        top: pos.y,
      }}
      className="w-6 h-6 bg-white rounded-full fixed z-50 pointer-events-none"
    />
  );
}

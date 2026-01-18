"use client";

import EyeTracker from "@/components/EyeTracker";
import Cursor from "@/components/Cursor";
import AppIcon from "@/components/AppIcon";

export default function Home() {
  return (
    <div className="w-screen h-screen bg-black flex items-center justify-center gap-32 relative overflow-hidden">
      <Cursor />
      <EyeTracker />

      <AppIcon
        img="/whatsapp.png"
        url="https://web.whatsapp.com"
      />
      <AppIcon
        img="/youtube.png"
        url="https://youtube.com"
      />
      <AppIcon
        img="/google.png"
        url="https://google.com"
      />
    </div>
  );
}

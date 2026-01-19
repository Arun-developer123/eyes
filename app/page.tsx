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
        url="/whatsapp"
      />
      <AppIcon
        img="/youtube.png"
        url="/youtube"
      />
      <AppIcon
        img="/google.png"
        url="/google"
      />
    </div>
  );
}

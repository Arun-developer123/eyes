"use client";

export default function AppIcon({ img, url }: { img: string; url: string }) {
  const openApp = () => {
    window.location.href = url;
  };

  return (
    <img
      src={img}
      onClick={openApp}
      className="w-32 h-32 cursor-pointer hover:scale-110 transition"
    />
  );
}

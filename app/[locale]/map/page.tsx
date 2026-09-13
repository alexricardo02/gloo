"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import Navigation from "@/app/components/Navigation";

// Dynamic component for MapDisplay to prevent SSR issues with Leaflet
const MapDisplay = dynamic(() => import("@/app/components/MapDisplay"), {
  ssr: false,
  loading: () => <div className="flex-1 flex items-center justify-center bg-black text-gray-500">Loading map...</div>
});


export default function MapPage() {
  const t = useTranslations("Map");

  return (
    <div className="flex flex-col h-screen bg-background text-foreground font-sans">
      <div className="p-4 bg-card/90 backdrop-blur-md border-b border-border">
        <h1 className="text-xs font-black tracking-widest uppercase text-muted-foreground">
          {t("title")}
        </h1>
      </div>

      <div className="flex-1 relative">
        <MapDisplay />
      </div>

      <Navigation />
    </div>
  );
}
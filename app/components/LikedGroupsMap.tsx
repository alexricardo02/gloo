"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Circle, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { MessageCircle, Heart } from "lucide-react";
import type { LikedMeGroupDTO } from "@/lib/apiTypes";

type LikedGroup = LikedMeGroupDTO;

interface LikedGroupsMapProps {
  groups: LikedGroup[];
}

/** Leaflet draws SVG with inline colors, so read the design token once. */
function readSecondaryColor(): string {
  if (typeof window === "undefined") return "#FF8F7E";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-secondary").trim();
  return value || "#FF8F7E";
}

function GroupPopup({ group, locale }: { group: LikedGroup; locale: string }) {
  const router = useRouter();

  const displayName =
    group.user?.username || group.user?.name || "Group";

  const chatId = group.chatId;

  return (
    <div className="w-56 p-2 text-foreground font-sans flex flex-col">
      <div className="w-full h-24 rounded-xl overflow-hidden bg-muted mb-2 border border-border">
        <img
          src={group.photos?.[0] || "/images/bg-fallback.jpg"}
          alt={displayName}
          className="w-full h-full object-cover"
        />
      </div>

      <h3 className="font-black text-sm tracking-tight text-foreground">
        {displayName}
      </h3>

      <div className="flex flex-wrap gap-1 mt-1 mb-2">
        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-secondary text-on-secondary">
          {group.gender}
        </span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
          {group.membersCount} Members
        </span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
          {group.ageMin}–{group.ageMax}
        </span>
      </div>

      {group.description && (
        <p className="text-[10px] text-muted-foreground line-clamp-2 mb-2">
          {group.description}
        </p>
      )}

      {group.likedByCurrentUser && (
        <div className="flex items-center gap-1 mb-2 bg-secondary/15 border border-secondary/25 p-1.5 rounded-lg">
          <Heart size={12} className="text-secondary" fill="var(--color-secondary)" />
          <span className="text-[10px] font-black text-secondary uppercase">
            Match!
          </span>
        </div>
      )}

      {chatId && (
        <button
          onClick={() => router.push(`/${locale}/messages/${chatId}`)}
          className="w-full mt-1 bg-accent hover:opacity-90 text-on-accent text-xs font-black uppercase tracking-widest py-3 rounded-xl flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-50 cursor-pointer min-h-[44px]"
        >
          <MessageCircle size={14} />
          Open Chat
        </button>
      )}
    </div>
  );
}

/**
 * LIKED_ME_MAP = approximate-circles (S4): each group is a ~1 km circle
 * around its coarsened point, computed by the server (LikedMeGroupDTO.area).
 * The API never sends exact coordinates and there is no pin at the center.
 */
export default function LikedGroupsMap({ groups }: LikedGroupsMapProps) {
  const locale = useLocale();
  const [color] = useState(readSecondaryColor);

  const groupsWithLocation = groups.filter(
    (g): g is LikedGroup & { area: NonNullable<LikedGroup["area"]> } => g.area !== null
  );

  const center: [number, number] =
    groupsWithLocation.length > 0
      ? [
        groupsWithLocation.reduce((sum, g) => sum + g.area.center[0], 0) /
        groupsWithLocation.length,
        groupsWithLocation.reduce((sum, g) => sum + g.area.center[1], 0) /
        groupsWithLocation.length,
      ]
      : [49.9929, 8.2473];

  return (
    <MapContainer
      center={center}
      zoom={13}
      className="w-full h-full z-0"
      zoomControl={false}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; CARTO'
      />

      {groupsWithLocation.map((group) => (
        <Circle
          key={group.id}
          center={group.area.center}
          radius={group.area.radiusM}
          pathOptions={{
            className: "liked-group-area",
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.25,
          }}
        >
          <Popup>
            <GroupPopup group={group} locale={locale} />
          </Popup>
        </Circle>
      ))}

      {/* Show message if no groups have location */}
      {groupsWithLocation.length === 0 && groups.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-background/80 backdrop-blur-sm">
          <p className="text-foreground text-sm font-bold px-4 text-center">
            No location data available for these groups
          </p>
        </div>
      )}
    </MapContainer>
  );
}

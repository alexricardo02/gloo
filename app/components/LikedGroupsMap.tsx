"use client";

import { useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { MessageCircle, Heart, Loader2 } from "lucide-react";
import { getOrCreateChat } from "@/app/actions/chat";

interface LikedGroup {
  id: string;
  userId: string;
  user: {
    id: string;
    name: string;
    image: string | null;
    username: string | null;
  };
  photos: string[];
  description: string | null;
  membersCount: number;
  gender: string;
  ageMin: number;
  ageMax: number;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  likedByCurrentUser: boolean;
  isMutualLike: boolean;
}

interface LikedGroupsMapProps {
  groups: LikedGroup[];
}

function createLikeMarkerIcon() {
  return L.divIcon({
    className: "custom-leaflet-marker",
    html: `<div class="w-6 h-6 rounded-full bg-[#FF725E] border-2 border-white shadow-[0_0_15px_rgba(255,114,94,0.7)] flex items-center justify-center">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function GroupPopup({ group, locale }: { group: LikedGroup; locale: string }) {
  const router = useRouter();
  const [isOpeningChat, setIsOpeningChat] = useState(false);

  const displayName =
    group.user?.username || group.user?.name || "Group";

  const handleOpenChat = async () => {
    if (isOpeningChat) return;
    setIsOpeningChat(true);
    try {
      const result = await getOrCreateChat(group.userId);
      if (result.success && result.chatId) {
        router.push(`/${locale}/messages/${result.chatId}`);
      }
    } catch (err) {
      console.error("Failed to open chat from map:", err);
    } finally {
      setIsOpeningChat(false);
    }
  };

  return (
    <div className="w-56 p-2 text-black font-sans flex flex-col">
      <div className="w-full h-24 rounded-xl overflow-hidden bg-gray-200 mb-2">
        <img
          src={group.photos?.[0] || "/images/bg-fallback.jpg"}
          alt={displayName}
          className="w-full h-full object-cover"
        />
      </div>

      <h3 className="font-black text-sm tracking-tight text-gray-900">
        {displayName}
      </h3>

      <div className="flex flex-wrap gap-1 mt-1 mb-2">
        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#FF725E] text-white">
          {group.gender}
        </span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
          {group.membersCount} Members
        </span>
        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
          {group.ageMin}–{group.ageMax}
        </span>
      </div>

      {group.description && (
        <p className="text-[10px] text-gray-500 line-clamp-2 mb-2">
          {group.description}
        </p>
      )}

      {group.likedByCurrentUser && (
        <div className="flex items-center gap-1 mb-2 bg-[#FF725E]/10 p-1.5 rounded-lg">
          <Heart size={12} className="text-[#FF725E]" fill="#FF725E" />
          <span className="text-[10px] font-black text-[#FF725E] uppercase">
            Match!
          </span>
        </div>
      )}

      <button
        onClick={handleOpenChat}
        disabled={isOpeningChat}
        className="w-full mt-1 bg-black text-white text-xs font-black uppercase tracking-widest py-2.5 rounded-xl flex items-center justify-center gap-1.5 hover:bg-gray-900 transition-colors disabled:opacity-50"
      >
        {isOpeningChat ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <>
            <MessageCircle size={14} />
            Open Chat
          </>
        )}
      </button>
    </div>
  );
}

export default function LikedGroupsMap({ groups }: LikedGroupsMapProps) {
  const locale = useLocale();

  const groupsWithLocation = groups.filter(
    (g) => g.latitude != null && g.longitude != null
  );

  const center: [number, number] =
    groupsWithLocation.length > 0
      ? [
        groupsWithLocation.reduce((sum, g) => sum + (g.latitude ?? 0), 0) /
        groupsWithLocation.length,
        groupsWithLocation.reduce((sum, g) => sum + (g.longitude ?? 0), 0) /
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
        <Marker
          key={group.id}
          position={[group.latitude!, group.longitude!]}
          icon={createLikeMarkerIcon()}
        >
          <Popup>
            <GroupPopup group={group} locale={locale} />
          </Popup>
        </Marker>
      ))}

      {/* Show message if no groups have location */}
      {groupsWithLocation.length === 0 && groups.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] bg-black/60">
          <p className="text-white text-sm font-bold px-4 text-center">
            No location data available for these groups
          </p>
        </div>
      )}
    </MapContainer>
  );
}

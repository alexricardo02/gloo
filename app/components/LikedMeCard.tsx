"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Heart, MessageCircle, Loader2, MapPin } from "lucide-react";
import { toggleLike } from "@/app/actions/discoverGroups";
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

interface LikedMeCardProps {
  group: LikedGroup;
}

export default function LikedMeCard({ group }: LikedMeCardProps) {
  const router = useRouter();
  const locale = useLocale();
  const [liked, setLiked] = useState(Boolean(group.likedByCurrentUser));
  const [isAnimating, setIsAnimating] = useState(false);
  const [isOpeningChat, setIsOpeningChat] = useState(false);

  const photo: string =
    group.photos && group.photos.length > 0
      ? group.photos[0]
      : "/images/bg-fallback.jpg";

  const displayName =
    group.user?.username || group.user?.name || "Group";

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextLiked = !liked;
    setLiked(nextLiked);
    setIsAnimating(true);

    try {
      await toggleLike(group.id);
    } catch (error) {
      console.error("Error liking group:", error);
      setLiked(!nextLiked);
    } finally {
      window.setTimeout(() => setIsAnimating(false), 180);
    }
  };

  const handleOpenChat = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpeningChat) return;
    setIsOpeningChat(true);
    try {
      const targetUserId = group.userId;
      if (!targetUserId) return;
      const result = await getOrCreateChat(targetUserId);
      if (result.success && result.chatId) {
        router.push(`/${locale}/messages/${result.chatId}`);
      }
    } catch (err) {
      console.error("Failed to open chat:", err);
    } finally {
      setIsOpeningChat(false);
    }
  };

  return (
    <div className="w-full bg-[#111111] border border-white/10 rounded-2xl p-4 flex items-center gap-4 hover:border-[#FF725E]/30 transition-all">
      <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 bg-[#1A1A1A]">
        <img
          src={photo}
          alt={displayName}
          className="w-full h-full object-cover"
        />
        {group.isMutualLike && (
          <div className="absolute -top-1 -right-1 bg-[#FF725E] text-black text-[8px] font-black px-1.5 py-0.5 rounded-full">
            MATCH
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-extrabold text-white text-sm truncate">
          {displayName}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className="text-[10px] text-[#FF725E] bg-[#FF725E]/10 px-2 py-0.5 rounded-full font-bold uppercase">
            {group.gender}
          </span>
          <span className="text-[10px] text-gray-400 font-bold">
            {group.membersCount} Members
          </span>
          <span className="text-[10px] text-gray-400 font-bold">
            {group.ageMin}–{group.ageMax}
          </span>
        </div>
        {group.description && (
          <p className="text-xs text-gray-500 line-clamp-1 mt-1">
            {group.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleLike}
          aria-pressed={liked}
          className={`p-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-all duration-200 ${isAnimating ? "scale-95" : ""
            }`}
        >
          <Heart
            size={18}
            fill={liked ? "#FF725E" : "none"}
            className={liked ? "text-[#FF725E]" : "text-gray-400"}
          />
        </button>
        <button
          type="button"
          onClick={handleOpenChat}
          disabled={isOpeningChat}
          className="p-2.5 bg-[#FF725E] rounded-full shadow-[0_0_15px_rgba(255,114,94,0.3)] hover:scale-110 transition-all disabled:opacity-70 disabled:scale-100"
        >
          {isOpeningChat ? (
            <Loader2 className="text-black animate-spin" size={18} />
          ) : (
            <MessageCircle className="text-black" fill="black" size={18} />
          )}
        </button>
      </div>
    </div>
  );
}

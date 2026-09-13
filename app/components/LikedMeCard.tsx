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
    <div className="w-full bg-card border border-border rounded-2xl p-4 flex items-center gap-4 hover:border-secondary/40 transition-all">
      <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-border flex-shrink-0 bg-muted">
        <img
          src={photo}
          alt={displayName}
          className="w-full h-full object-cover"
        />
        {group.isMutualLike && (
          <div className="absolute -top-1 -right-1 bg-secondary text-on-secondary text-[8px] font-black px-1.5 py-0.5 rounded-full">
            MATCH
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-extrabold text-foreground text-sm truncate">
          {displayName}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className="text-[10px] text-secondary bg-secondary/15 px-2 py-0.5 rounded-full font-bold uppercase">
            {group.gender}
          </span>
          <span className="text-[10px] text-muted-foreground font-bold">
            {group.membersCount} Members
          </span>
          <span className="text-[10px] text-muted-foreground font-bold">
            {group.ageMin}–{group.ageMax}
          </span>
        </div>
        {group.description && (
          <p className="text-xs text-muted-foreground line-clamp-1 mt-1">
            {group.description}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleLike}
          aria-pressed={liked}
          aria-label={liked ? "Unlike group" : "Like group"}
          className={`min-w-[44px] min-h-[44px] rounded-full border border-border bg-muted/50 hover:bg-muted flex items-center justify-center transition-all duration-200 cursor-pointer ${isAnimating ? "scale-95" : ""
            }`}
        >
          <Heart
            size={18}
            fill={liked ? "var(--color-secondary)" : "none"}
            className={liked ? "text-secondary" : "text-muted-foreground"}
          />
        </button>
        <button
          type="button"
          onClick={handleOpenChat}
          disabled={isOpeningChat}
          aria-label="Open chat"
          className="min-w-[44px] min-h-[44px] bg-accent text-on-accent rounded-full shadow-[0_0_15px_rgba(37,99,235,0.4)] hover:scale-105 active:scale-95 flex items-center justify-center transition-all cursor-pointer disabled:opacity-70 disabled:scale-100"
        >
          {isOpeningChat ? (
            <Loader2 className="text-on-accent animate-spin" size={18} />
          ) : (
            <MessageCircle className="text-on-accent" fill="currentColor" size={18} />
          )}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Navigation from "@/app/components/Navigation";
import { Gamepad2, Sparkles, Trophy, Flame } from "lucide-react";
import Link from "next/link";

export default function GamesPage() {
  const t = useTranslations("Games");
  const locale = useLocale();
  const router = useRouter();
  
  // State to track if the current user session is a guest session
  const [isGuest, setIsGuest] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  // Check for guest cookie status on component mount
  useEffect(() => {
    const checkGuestStatus = () => {
      const isGuestCookie = document.cookie
        .split("; ")
        .find((row) => row.startsWith("gloo_is_guest="));
      if (isGuestCookie && isGuestCookie.split("=")[1] === "true") {
        setIsGuest(true);
      }
    };
    checkGuestStatus();
  }, []);

  // Curated list of games styled for the app's premium dark identity
  const gamesList = [
    {
      id: "never-have-i-ever",
      title: "Never Have I Ever",
      emoji: "🍺",
      description: "The ultimate classic to break the ice and trigger laughs with your group.",
      tag: "Popular",
      icon: Flame,
    },
    {
      id: "truth-or-dare",
      title: "Truth or Dare",
      emoji: "🌶️",
      description: "Spice up the pre-party with wild challenges and revelations.",
      tag: "Hot",
      icon: Sparkles,
    },
    {
      id: "most-likely-to",
      title: "Most Likely To",
      emoji: "👉",
      description: "Find out what your friends really think about each other.",
      tag: "Party",
      icon: Trophy,
    },
    {
      id: "busdriver",
      title: "Busdriver",
      emoji: "🃏",
      description: "A fast-paced card game where strategy matters, and losers drink up.",
      tag: "Classic",
      icon: Gamepad2,
    }
  ];

  return (
    <div className="min-h-screen bg-black text-white font-sans pb-32">
      
      <header className="fixed top-0 left-0 right-0 bg-black/90 backdrop-blur-md z-30 pt-12 pb-6 px-6 border-b border-white/5 text-center">
        <h1 className="text-3xl font-black italic uppercase tracking-tight text-white mb-1">
          {t("title") || "Gloo Games"}
        </h1>
        <p className="text-gray-400 text-xs tracking-wide">
          {t("subtitle") || "Choose a game to jumpstart your pre-party"}
        </p>
      </header>

      <main className="pt-36 px-4 max-w-md mx-auto">
        <div className="flex flex-col gap-3">
          {gamesList.map((game) => {
            return (
              <Link
                href={`/${locale}/games/${game.id}`}
                key={game.id}
                className="relative w-full bg-[#111111] rounded-2xl overflow-hidden border border-white/5 hover:border-[#FF725E]/30 transition-all duration-300 p-5 text-left flex items-start gap-4 group hover:scale-[1.01] block" // Añadí 'block'
              >
                <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center text-3xl shrink-0 group-hover:bg-[#FF725E]/10 transition-colors duration-300">
                  {game.emoji}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h2 className="text-lg font-bold text-white group-hover:text-[#FF725E] transition-colors duration-300 truncate">
                      {game.title}
                    </h2>
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-gray-400 border border-white/10 shrink-0">
                      {game.tag}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 line-clamp-2 leading-relaxed">
                    {game.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </main>

      {/* Paywall / Registration Modal for Restricted Navigation Tabs */}
      {showPaywall && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#111111] border border-white/10 rounded-3xl p-6 max-w-sm w-full text-center animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-[#FF725E]/10 text-[#FF725E] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#FF725E]/20">
              <Gamepad2 size={32} />
            </div>
            <h3 className="text-xl font-black uppercase italic tracking-tight mb-2">
              Create an Account
            </h3>
            <p className="text-sm text-gray-400 mb-6 leading-relaxed">
              To unlock group matching, instant direct messages, and customized profile features, you need a full profile.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => router.push(`/${locale}/register`)}
                className="w-full bg-[#FF725E] text-black font-black uppercase tracking-wider py-3 rounded-xl hover:bg-[#ff8573] transition-colors text-sm"
              >
                Sign Up Now
              </button>
              <button
                onClick={() => setShowPaywall(false)}
                className="w-full bg-transparent text-gray-400 font-bold hover:text-white transition-colors py-2 text-xs"
              >
                Continue Playing
              </button>
            </div>
          </div>
        </div>
      )}

      <Navigation 
        isGuest={isGuest} 
        onSecureClick={() => setShowPaywall(true)} 
      />
    </div>
  );
}
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, Beer, Trophy, RotateCcw } from "lucide-react";

type Suit = "♥" | "♦" | "♠" | "♣";
type Card = { suit: Suit; value: number; display: string };

export default function BusDriverPage() {
  const router = useRouter();
  const t = useTranslations("BusDriver");

  const locale = useLocale();

  const [step, setStep] = useState(1);
  const [cards, setCards] = useState<Card[]>([]);
  const [gameStatus, setGameStatus] = useState<"playing" | "won" | "lost">("playing");
  const [isAnimating, setIsAnimating] = useState(false);

  const drawCard = (): Card => {
    const suits: Suit[] = ["♥", "♦", "♠", "♣"];
    const values = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    const displayMap: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
    
    const suit = suits[Math.floor(Math.random() * suits.length)];
    const value = values[Math.floor(Math.random() * values.length)];
    return { suit, value, display: displayMap[value] || value.toString() };
  };

  const handleChoice = (choice: string) => {
    if (isAnimating || gameStatus !== "playing") return;
    setIsAnimating(true);

    setTimeout(() => {
      const newCard = drawCard();
      const newCards = [...cards, newCard];
      let wonPhase = false;

      if (step === 1) {
        const isRed = newCard.suit === "♥" || newCard.suit === "♦";
        wonPhase = (choice === "red" && isRed) || (choice === "black" && !isRed);
      } 
      else if (step === 2) {
        const prevValue = cards[0].value;
        wonPhase = (choice === "higher" && newCard.value > prevValue) || 
                   (choice === "lower" && newCard.value < prevValue);
      } 
      else if (step === 3) {
        const min = Math.min(cards[0].value, cards[1].value);
        const max = Math.max(cards[0].value, cards[1].value);
        wonPhase = (choice === "inside" && newCard.value > min && newCard.value < max) || 
                   (choice === "outside" && (newCard.value < min || newCard.value > max));
      } 
      else if (step === 4) {
        wonPhase = choice === newCard.suit;
      }

      setCards(newCards);

      if (wonPhase) {
        if (step === 4) {
          setGameStatus("won");
        } else {
          setStep(step + 1);
        }
      } else {
        setGameStatus("lost");
      }

      setIsAnimating(false);
    }, 300); 
  };

  const restartGame = () => {
    setCards([]);
    setStep(1);
    setGameStatus("playing");
  };

  const renderCard = (card: Card, index: number) => {
    const isRed = card.suit === "♥" || card.suit === "♦";
    return (
      <div 
        key={index} 
        className="w-16 h-24 sm:w-20 sm:h-28 bg-white rounded-lg flex flex-col items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.2)] animate-in zoom-in spin-in-12 duration-300"
      >
        <span className={`text-2xl sm:text-3xl font-black ${isRed ? "text-red-600" : "text-black"}`}>
          {card.display}
        </span>
        <span className={`text-xl sm:text-2xl ${isRed ? "text-red-600" : "text-black"}`}>
          {card.suit}
        </span>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans selection:bg-[#FF725E] selection:text-black overflow-hidden">
      
      <div className="relative z-50 px-6 pt-10 pb-4 flex items-center">
        <button 
          onClick={() => router.push(`/${locale}/games`)}
          className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors text-white"
        >
          <ChevronLeft size={28} />
        </button>
        <h1 className="text-sm font-black uppercase tracking-[0.2em] ml-2 text-gray-400">
          {t("title")}
        </h1>
      </div>

      <div className="flex-1 flex flex-col items-center p-6 relative">
        

        <div 
          className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 blur-[120px] pointer-events-none transition-colors duration-500 ${
            gameStatus === "lost" ? "bg-red-600/30" : gameStatus === "won" ? "bg-yellow-500/30" : "bg-emerald-500/20"
          }`} 
        />


        <div className="relative z-10 w-full max-w-sm h-32 flex justify-center items-center gap-2 mb-8 mt-4">
          {cards.map((card, idx) => renderCard(card, idx))}
          {gameStatus === "playing" && Array.from({ length: 4 - cards.length }).map((_, idx) => (
            <div key={`empty-${idx}`} className="w-16 h-24 sm:w-20 sm:h-28 border-2 border-dashed border-white/20 rounded-lg opacity-50" />
          ))}
        </div>

        <div className={`relative z-10 w-full max-w-sm flex flex-col items-center transition-all duration-300 ${isAnimating ? "scale-95 opacity-50" : "scale-100 opacity-100"}`}>
          
          {gameStatus === "playing" && (
            <>
              <h2 className="text-2xl font-black uppercase tracking-widest text-emerald-400 mb-8 text-center">
                {step === 1 && t("step1")}
                {step === 2 && t("step2")}
                {step === 3 && t("step3")}
                {step === 4 && t("step4")}
              </h2>

              <div className="w-full grid grid-cols-2 gap-4">
                {step === 1 && (
                  <>
                    <button onClick={() => handleChoice("red")} className="bg-red-600 hover:bg-red-500 text-white font-black py-4 rounded-2xl uppercase shadow-lg shadow-red-600/20 active:scale-95 transition-all">
                      {t("btnRed")}
                    </button>
                    <button onClick={() => handleChoice("black")} className="bg-[#1a1a1a] border border-white/10 hover:bg-[#222] text-white font-black py-4 rounded-2xl uppercase shadow-lg active:scale-95 transition-all">
                      {t("btnBlack")}
                    </button>
                  </>
                )}

                {step === 2 && (
                  <>
                    <button onClick={() => handleChoice("higher")} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl uppercase shadow-lg shadow-emerald-600/20 active:scale-95 transition-all">
                      ↑ {t("btnHigher")}
                    </button>
                    <button onClick={() => handleChoice("lower")} className="bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-2xl uppercase shadow-lg shadow-emerald-600/20 active:scale-95 transition-all">
                      ↓ {t("btnLower")}
                    </button>
                  </>
                )}

                {step === 3 && (
                  <>
                    <button onClick={() => handleChoice("inside")} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl uppercase shadow-lg shadow-blue-600/20 active:scale-95 transition-all">
                      {t("btnInside")}
                    </button>
                    <button onClick={() => handleChoice("outside")} className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl uppercase shadow-lg shadow-blue-600/20 active:scale-95 transition-all">
                      {t("btnOutside")}
                    </button>
                  </>
                )}
              </div>

              {step === 4 && (
                <div className="w-full grid grid-cols-4 gap-3">
                  {["♥", "♦", "♠", "♣"].map((suit) => (
                    <button 
                      key={suit} 
                      onClick={() => handleChoice(suit)} 
                      className="bg-white hover:bg-gray-200 text-black text-3xl py-4 rounded-2xl shadow-lg active:scale-95 transition-all flex justify-center items-center"
                    >
                      <span className={suit === "♥" || suit === "♦" ? "text-red-600" : "text-black"}>{suit}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {gameStatus !== "playing" && (
            <div className="flex flex-col items-center mt-4 animate-in slide-in-from-bottom-4">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-2xl ${gameStatus === "won" ? "bg-yellow-500/20 text-yellow-500" : "bg-red-600/20 text-red-500"}`}>
                {gameStatus === "won" ? <Trophy size={40} /> : <Beer size={40} />}
              </div>
              <h2 className="text-3xl font-black uppercase tracking-widest text-center mb-8">
                {gameStatus === "won" ? t("won") : t("lost")}
              </h2>
              <button
                onClick={restartGame}
                className="flex items-center gap-2 bg-white text-black font-black uppercase tracking-wider py-4 px-8 rounded-full hover:scale-105 active:scale-95 transition-all"
              >
                <RotateCcw size={20} />
                {t("restart")}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
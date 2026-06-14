"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { ChevronLeft } from "lucide-react";

type Prompt = { type: "truth" | "dare"; text: string };

const gameData: Record<string, Prompt[]> = {
  en: [
    { type: "truth", text: "What is your biggest regret from a past relationship?" },
    { type: "truth", text: "Who in this room do you think is the most attractive?" },
    { type: "truth", text: "What's the most embarrassing thing you've ever done drunk?" },
    { type: "truth", text: "Have you ever lied to get out of a date?" },
    { type: "dare", text: "Let the group look through your phone's photo gallery for 1 minute." },
    { type: "dare", text: "Send a risky text to the 5th person in your contacts." },
    { type: "dare", text: "Do your best imitation of someone in this room." },
    { type: "dare", text: "Take a shot or finish your drink right now." }
  ],
  es: [
    { type: "truth", text: "¿De qué te arrepientes más en tu última relación?" },
    { type: "truth", text: "¿Quién de esta habitación te parece más atractivo/a?" },
    { type: "truth", text: "¿Qué es lo más vergonzoso que has hecho estando borracho/a?" },
    { type: "truth", text: "¿Alguna vez has mentido para cancelar una cita?" },
    { type: "dare", text: "Deja que el grupo mire la galería de tu móvil durante 1 minuto." },
    { type: "dare", text: "Envía un mensaje arriesgado a la quinta persona en tus contactos." },
    { type: "dare", text: "Haz tu mejor imitación de alguien de esta habitación." },
    { type: "dare", text: "Tómate un chupito o termínate la bebida ahora mismo." }
  ],
  de: [
    { type: "truth", text: "Was bereust du aus deiner letzten Beziehung am meisten?" },
    { type: "truth", text: "Wen in diesem Raum findest du am attraktivsten?" },
    { type: "truth", text: "Was ist das Peinlichste, das du je betrunken gemacht hast?" },
    { type: "truth", text: "Hast du schon mal gelogen, um einem Date zu entgehen?" },
    { type: "dare", text: "Lass die Gruppe für 1 Minute durch die Fotogalerie deines Handys schauen." },
    { type: "dare", text: "Sende eine riskante Nachricht an die 5. Person in deinen Kontakten." },
    { type: "dare", text: "Mache deine beste Imitation von jemandem in diesem Raum." },
    { type: "dare", text: "Trinke einen Shot oder trinke dein Getränk jetzt sofort aus." }
  ]
};

export default function TruthOrDarePage() {
  const router = useRouter();
  const locale = useLocale();
  
  const prompts = gameData[locale] || gameData["en"];
  
  const [currentPrompt, setCurrentPrompt] = useState<Prompt | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const randomType = Math.random() > 0.5 ? "truth" : "dare";
    pickPrompt(randomType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPrompt = (requestedType: "truth" | "dare") => {
    if (isAnimating) return;
    setIsAnimating(true);

    setTimeout(() => {
      const filteredPrompts = prompts.filter(p => p.type === requestedType);
      let nextPrompt = currentPrompt;
      
      while (!nextPrompt || nextPrompt.text === currentPrompt?.text) {
        const randomIndex = Math.floor(Math.random() * filteredPrompts.length);
        nextPrompt = filteredPrompts[randomIndex];
      }
      
      setCurrentPrompt(nextPrompt);
      setIsAnimating(false);
    }, 200); 
  };

  if (!currentPrompt) return null;

  const getLabel = () => {
    if (currentPrompt.type === "truth") {
      return locale === "es" ? "VERDAD" : locale === "de" ? "WAHRHEIT" : "TRUTH";
    } else {
      return locale === "es" ? "RETO" : locale === "de" ? "PFLICHT" : "DARE";
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans selection:bg-[#FF725E] selection:text-black">
      
      <div className="relative z-50 px-6 pt-10 pb-4 flex items-center">
        <button 
          onClick={() => router.push(`/${locale}/games`)}
          className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors text-white"
        >
          <ChevronLeft size={28} />
        </button>
        <h1 className="text-sm font-black uppercase tracking-[0.2em] ml-2 text-gray-400">
          Truth or Dare
        </h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        
        <div 
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 blur-[100px] pointer-events-none transition-colors duration-500 ${
            currentPrompt.type === 'truth' ? 'bg-blue-500/20' : 'bg-[#FF725E]/20'
          }`} 
        />

        <div
          className={`relative z-10 w-full max-w-sm aspect-[3/4] bg-[#121212] border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col items-center justify-center p-8 text-center transition-all duration-200 ${
            isAnimating ? "scale-95 opacity-0 rotate-y-12" : "scale-100 opacity-100 rotate-y-0"
          }`}
        >
          <span className={`absolute top-8 font-black uppercase tracking-widest text-[12px] ${currentPrompt.type === "truth" ? "text-blue-400" : "text-[#FF725E]"}`}>
            {getLabel()}
          </span>
          
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
            {currentPrompt.text}
          </h2>
        </div>

        <div className="relative z-10 flex gap-4 mt-8 w-full max-w-sm">
          <button
            onClick={() => pickPrompt("truth")}
            className="flex-1 bg-[#121212] border border-blue-500/30 text-blue-400 py-4 rounded-2xl font-black uppercase tracking-widest shadow-[0_0_15px_rgba(59,130,246,0.15)] hover:bg-blue-500/10 hover:scale-105 active:scale-95 transition-all"
          >
            {locale === "es" ? "Verdad" : locale === "de" ? "Wahrheit" : "Truth"}
          </button>

          <button
            onClick={() => pickPrompt("dare")}
            className="flex-1 bg-[#121212] border border-[#FF725E]/30 text-[#FF725E] py-4 rounded-2xl font-black uppercase tracking-widest shadow-[0_0_15px_rgba(255,114,94,0.15)] hover:bg-[#FF725E]/10 hover:scale-105 active:scale-95 transition-all"
          >
            {locale === "es" ? "Reto" : locale === "de" ? "Pflicht" : "Dare"}
          </button>
        </div>

      </div>
    </div>
  );
}
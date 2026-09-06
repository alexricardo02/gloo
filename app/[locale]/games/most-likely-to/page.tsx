"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";

export default function MostLikelyToPage() {
  const router = useRouter();
  const t = useTranslations("MostLikelyTo");
  const questions = t.raw("questions") as string[];
  const locale = useLocale();
  
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    pickRandomQuestion();
  }, []);

  const pickRandomQuestion = () => {
    if (isAnimating) return;
    setIsAnimating(true);

    setTimeout(() => {
      let nextQuestion = currentQuestion;
      while (!nextQuestion || nextQuestion === currentQuestion) {
        const randomIndex = Math.floor(Math.random() * questions.length);
        nextQuestion = questions[randomIndex];
      }
      setCurrentQuestion(nextQuestion);
      setIsAnimating(false);
    }, 200);
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
          {t("title")}
        </h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-purple-500/20 blur-[100px] pointer-events-none" />

        <div
          className={`relative z-10 w-full max-w-sm aspect-[3/4] bg-[#121212] border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col items-center justify-center p-8 text-center transition-all duration-200 ${
            isAnimating ? "scale-95 opacity-0 rotate-y-12" : "scale-100 opacity-100 rotate-y-0"
          }`}
        >
          <span className="absolute top-8 text-purple-400 font-black uppercase tracking-widest text-[11px] text-center w-full px-4">
            {t("header")}
          </span>
          
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight mt-4">
            {currentQuestion}
          </h2>
        </div>

        <div className="relative z-10 flex mt-8 w-full max-w-sm">
          <button
            onClick={pickRandomQuestion}
            className="w-full bg-[#121212] border border-purple-500/30 text-purple-400 py-4 rounded-2xl font-black uppercase tracking-widest shadow-[0_0_15px_rgba(168,85,247,0.15)] hover:bg-purple-500/10 hover:scale-105 active:scale-95 transition-all"
          >
            {t("nextQuestion")}
          </button>
        </div>

      </div>
    </div>
  );
}
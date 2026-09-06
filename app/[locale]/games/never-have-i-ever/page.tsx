"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, RefreshCw } from "lucide-react";

export default function NeverHaveIEverPage() {
  const router = useRouter();
  const t = useTranslations("NeverHaveIEver");
  const questions = t.raw("questions") as string[];
  const locale = useLocale();
  
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    pickRandomQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickRandomQuestion = () => {
    if (isAnimating) return;

    setIsAnimating(true);

    setTimeout(() => {
      let nextQuestion = currentQuestion;
      while (nextQuestion === currentQuestion) {
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
          Never Have I Ever
        </h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        
        {/* Background glow effect for premium feel */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-[#FF725E]/20 blur-[100px] pointer-events-none" />

        <button
          onClick={pickRandomQuestion}
          className={`relative z-10 w-full max-w-sm aspect-[3/4] bg-[#121212] border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col items-center justify-center p-8 text-center transition-all duration-200 active:scale-95 ${
            isAnimating ? "scale-95 opacity-0" : "scale-100 opacity-100"
          }`}
        >
          <span className="absolute top-8 text-[#FF725E] font-black uppercase tracking-widest text-[10px]">
            {t("prefix")}
          </span>
          
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight">
            {currentQuestion}
          </h2>

          <div className="absolute bottom-8 flex flex-col items-center gap-2 text-gray-500">
            <RefreshCw size={16} className="animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {t("tapForNext")}
            </span>
          </div>
        </button>

      </div>
    </div>
  );
}
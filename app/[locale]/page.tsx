"use client";

import Image from "next/image";
import { useState, useRef, useEffect, useTransition } from 'react';
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { loginAsGuest } from "@/app/actions/guest";
import SocialLinks from "@/app/components/SocialLinks";

const languages = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
];

function LoadingOverlay({ visible }: { visible: boolean }) {
  return (
    <div
      className={`fixed inset-0 z-[999] flex flex-col items-center justify-center bg-black transition-opacity duration-300 ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
    >
      <div className="relative w-48 h-24 mb-10 flex items-center justify-center">
        <Image
          src="/images/logo2.png"
          alt="GLOO"
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-contain"
          priority
        />
      </div>

      <div className="relative w-20 h-20 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-[#FF5733] animate-[spin_1.4s_linear_infinite]" />
        <span className="absolute inset-[6px] rounded-full border-[3px] border-transparent border-t-[#FF5733]/60 animate-[spin_1s_linear_infinite_reverse]" />
        <span className="absolute inset-[13px] rounded-full border-[2px] border-transparent border-t-white/40 animate-[spin_0.7s_linear_infinite]" />
      </div>

      <p className="mt-10 text-[11px] font-black uppercase tracking-[0.3em] text-white/40 animate-pulse">
        Loading
      </p>
    </div>
  );
}

export default function Home() {
  const t = useTranslations("WelcomePage");
  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [isOpen, setIsOpen] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const activeLanguage = languages.find(lang => lang.code === currentLocale) || languages[0];

  const handleGuestEntry = () => {
    startTransition(async () => {
      await loginAsGuest(currentLocale);
    });
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // if video was already in cache it will be ready immediately, otherwise we wait for it to load
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState >= 3) {
      setVideoReady(true);
    }
  }, []);


  const handleLanguageChange = (lang: { code: string; label: string; flag: string }) => {
    setIsOpen(false);

    document.cookie = `NEXT_LOCALE=${lang.code}; path=/; max-age=31536000`;

    const newPath = pathname.replace(`/${currentLocale}`, `/${lang.code}`);

    router.replace(newPath);
    router.refresh();
  };

  return (
    <>
      <LoadingOverlay visible={isPending} />

      <main className="relative flex flex-col items-center justify-between min-h-screen text-[#FDFEFE] p-8 font-sans overflow-hidden">

        <div className="absolute inset-0 bg-black -z-30" />

        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          onCanPlay={() => setVideoReady(true)}
          className={`absolute inset-0 w-full h-full object-cover -z-20 transition-opacity duration-700 ${videoReady ? "opacity-100" : "opacity-0"
            }`}
        >
          <source src="/videos/video1.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm -z-10" />
        <div className="flex-1 w-full relative z-10" />

        <div className="flex flex-col items-center justify-center flex-2 space-y-6 relative z-10">
          <div className="relative w-56 h-28 mb-10 flex items-center justify-center">
            <Image
              src="/images/logo2.png"
              alt="GLOO"
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-contain"
              priority
            />
          </div>

          <div className="text-center space-y-3">
            <h1 className="text-3xl font-extrabold tracking-tight drop-shadow-lg">
              {t("titleStart")}
              <span className="text-[#FF5733] font-medium"> {t("titleHighlight")} </span>
              {t("titleEnd")}
            </h1>
          </div>
        </div>

        <div className="flex flex-col w-full max-w-sm space-y-4 flex-1 justify-end pb-12 relative z-10">

          <div className="relative w-full" ref={dropdownRef} data-testid="language-dropdown">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="w-full bg-[#1A1A1A]/80 backdrop-blur-md border-2 border-[#8E44AD] text-white font-sans font-semibold py-4 px-4 rounded-2xl flex items-center justify-center space-x-2 focus:outline-none focus:ring-2 focus:ring-[#8E44AD] transition-all shadow-lg"
            >
              <span>{activeLanguage.flag} {activeLanguage.label}</span>
              <svg
                className={`fill-current h-5 w-5 absolute right-6 transition-transform ${isOpen ? "rotate-180" : ""}`}
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
              >
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
              </svg>
            </button>

            {isOpen && (
              <ul className="absolute z-10 w-full mt-2 bg-[#1A1A1A]/90 backdrop-blur-lg border-2 border-[#8E44AD] rounded-2xl shadow-2xl overflow-hidden bottom-full mb-2">
                {languages.map((lang) => (
                  <li key={lang.code}>
                    <button
                      onClick={() => handleLanguageChange(lang)}
                      data-testid={`language-option-${lang.code}`}
                      className="w-full text-center px-4 py-3 hover:bg-[#8E44AD] text-white font-sans font-medium transition-colors"
                    >
                      {lang.flag} {lang.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={handleGuestEntry}
            disabled={isPending}
            data-testid="party-start-btn"
            className="w-full bg-[#FF5733] hover:bg-[#e64d2e] text-white font-bold py-4 rounded-2xl text-center transition-all transform active:scale-95 shadow-[0_0_20px_rgba(255,87,51,0.3)] disabled:opacity-60"
          >
            {t("buttonStart")}
          </button>

          <div className="pt-4">
            <SocialLinks variant="dark" />
          </div>

        </div>
      </main>
    </>
  );
}
"use client";

import { useTranslations } from "next-intl";

interface SocialLinksProps {
  variant?: "dark" | "light";
  handles?: string[];
}

export default function SocialLinks({ variant = "dark", handles }: SocialLinksProps) {
  const t = useTranslations("Common");
  const isDark = variant === "dark";

  const baseClasses = "inline-flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-200 font-semibold";
  const themeClasses = isDark
    ? "border border-white/20 bg-white/10 text-white hover:bg-white/15"
    : "border border-gray-200 bg-[#F7F7F7] text-gray-900 hover:bg-gray-200";

  if (handles && handles.length > 0) {
    return (
      <div className="flex flex-wrap justify-center gap-3">
        {handles.map((handle) => (
          <a
            key={handle}
            href={`https://www.instagram.com/${handle}`}
            target="_blank"
            rel="noreferrer"
            className={`${baseClasses} ${themeClasses} border-pink-500/30`}
          >
            <InstagramIcon />
            <span>@{handle}</span>
          </a>
        ))}
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <a
        href="https://www.instagram.com/gloo_app"
        target="_blank"
        rel="noreferrer"
        className={`${baseClasses} ${themeClasses}`}
      >
        <InstagramIcon />
        <span>{t("followInstagram")}</span>
      </a>
    </div>
  );
}

function InstagramIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5 text-pink-500"
    >
      <path d="M7.75 2A5.75 5.75 0 0 0 2 7.75v8.5A5.75 5.75 0 0 0 7.75 22h8.5A5.75 5.75 0 0 0 22 16.25v-8.5A5.75 5.75 0 0 0 16.25 2h-8.5ZM12 7.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm5.75-.75a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
      <path d="M12 9.25a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Z" fill="currentColor" />
    </svg>
  );
}
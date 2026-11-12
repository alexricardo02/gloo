"use client";

import { useTranslations } from "next-intl";
import { Heart, MapPin, Users } from "lucide-react";
import type { DiscoveryTeaserCardDTO } from "@/lib/apiTypes";

/**
 * D5 / GUEST_TEASER = static-placeholders: a discovery card made of invented
 * data only (name from SearchGroups.teaserNames, neutral gradient, no photo).
 * Shown blurred to guests and users without a group, behind the paywall or
 * the "group required" modal.
 */
const TONES = [
  "from-primary/50 via-card to-secondary/40",
  "from-secondary/50 via-card to-accent/40",
  "from-accent/40 via-card to-primary/50",
  "from-muted via-card to-secondary/50",
];

export default function TeaserCard({ card }: { card: DiscoveryTeaserCardDTO }) {
  const t = useTranslations("Profile");
  const tSearch = useTranslations("SearchGroups");

  return (
    <div
      data-testid="teaser-card"
      className={`relative h-full w-full rounded-[2.5rem] overflow-hidden shadow-2xl bg-card bg-gradient-to-br ${TONES[card.tone % TONES.length]}`}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <Users size={96} className="text-foreground/10" aria-hidden="true" />
      </div>

      <div className="absolute top-0 left-0 p-6 pt-8 flex flex-col items-start text-left max-w-[85%] space-y-2">
        <h2 className="text-3xl font-extrabold text-white tracking-tighter drop-shadow-lg">
          {tSearch(`teaserNames.${card.nameKey}`)}
        </h2>
        <div className="flex flex-wrap gap-2">
          <span className="bg-secondary/20 backdrop-blur-md border border-secondary/30 text-secondary px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest">
            {t(card.gender)}
          </span>
          <span className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white">
            {card.membersCount} {t("members")}
          </span>
          <span className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white">
            {card.ageMin}-{card.ageMax}
          </span>
          <span className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest text-white inline-flex items-center gap-1">
            <MapPin size={10} aria-hidden="true" />
            {card.distanceKm < 1 ? tSearch("distanceUnder1") : tSearch("distanceKm", { km: card.distanceKm })}
          </span>
        </div>
      </div>

      <div className="absolute bottom-0 right-0 p-4 pb-6">
        <div className="w-14 h-14 rounded-full border border-white/20 bg-card/80 backdrop-blur-md shadow-lg flex items-center justify-center">
          <Heart size={26} className="text-white" />
        </div>
      </div>
    </div>
  );
}

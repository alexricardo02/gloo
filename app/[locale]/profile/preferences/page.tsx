"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { getGroupByUser, createGroupAction } from "@/app/actions/group";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

export default function PreferencesPage() {
  const router = useRouter();
  const t = useTranslations("Preferences");
  const locale = useLocale();

  const [searchGender, setSearchGender] = useState("MIXED");
  const [searchAgeMin, setSearchAgeMin] = useState(18);
  const [searchAgeMax, setSearchAgeMax] = useState(35);
  const [maxDistance, setMaxDistance] = useState(10);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function loadPreferences() {
      const group = await getGroupByUser();
      if (group) {
        setSearchGender((group.searchGender as string) || "MIXED");
        setSearchAgeMin((group.searchAgeMin as number) ?? 18);
        setSearchAgeMax((group.searchAgeMax as number) ?? 35);
        setMaxDistance((group.maxDistance as number) ?? 10);
      }
    }
    loadPreferences();
  }, []);

  async function handleSave() {
    if (loading) return;
    setLoading(true);

    const existingGroup = await getGroupByUser();
    if (!existingGroup) {
      alert(t("noGroupAlert"))
      setLoading(false);
      router.push(`/${locale}/profile/create-group`);
      return;
    }

    const formData = new FormData();

    formData.append("membersCount", String((existingGroup.membersCount as number) ?? 1));
    formData.append("groupGender", (existingGroup.gender as string) ?? "MIXED");
    formData.append("ageMin", String((existingGroup.ageMin as number) ?? 18));
    formData.append("ageMax", String((existingGroup.ageMax as number) ?? 30));
    formData.append("description", (existingGroup.description as string) ?? "");
    formData.append("publicProfile", (existingGroup.publicProfile as boolean) ? "true" : "false");

    const photos = (existingGroup.photos as string[]) ?? [];
    photos.forEach((url) => formData.append("existingPhotos", url));

    const instagram = (existingGroup.instagram as string[]) ?? [];
    instagram.forEach((handle, i) => formData.append(`instagram[${i}]`, handle));

    formData.append("searchGender", searchGender);
    formData.append("searchAgeMin", String(searchAgeMin));
    formData.append("searchAgeMax", String(searchAgeMax));
    formData.append("maxDistance", String(maxDistance));

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            formData.append("latitude", String(position.coords.latitude));
            formData.append("longitude", String(position.coords.longitude));
            await createGroupAction(formData, locale);
          } catch (err: unknown) {
            const e = err as Error;
            if (e?.message === "NEXT_REDIRECT") {
              setSaved(true);
              setTimeout(() => router.push(`/${locale}/search-groups`), 800);
              return;
            }
            console.error(err);
            alert(t("saveError"))
          } finally {
            setLoading(false);
          }
        },
        () => {
          formData.append("latitude", String((existingGroup.latitude as number) ?? ""));
          formData.append("longitude", String((existingGroup.longitude as number) ?? ""));
          createGroupAction(formData, locale)
            .catch((err: unknown) => {
              const e = err as Error;
              if (e?.message !== "NEXT_REDIRECT") console.error(err);
            })
            .finally(() => {
              setSaved(true);
              setTimeout(() => router.push(`/${locale}/search-groups`), 800);
              setLoading(false);
            });
        }
      );
    } else {
      setLoading(false);
      alert(t("geolocationError"));
    }
  }

  const genderOptions = [
    { value: "MIXED", label: t("genderMixed") },
    { value: "MALE", label: t("genderMale") },
    { value: "FEMALE", label: t("genderFemale") },
    { value: "DIVERSE", label: t("genderDiverse") },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-24">
      <div className="px-6 pt-12 pb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="w-11 h-11 flex items-center justify-center rounded-full bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal size={20} className="text-primary" />
          <h1 className="text-xl font-black uppercase tracking-tight text-foreground">{t("title")}</h1>
        </div>
      </div>

      <div className="px-6 space-y-6">
        <div className="bg-primary/10 border border-primary/20 rounded-3xl px-5 py-4">
          <p className="text-xs text-primary font-black uppercase tracking-wider mb-1">{t("howItWorksTitle")}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("howItWorksDesc")}
          </p>
        </div>

        <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-4 bg-primary rounded-full" />
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">{t("lookingFor")}</h3>
          </div>

          <div className="flex bg-muted/60 border border-border p-1 rounded-2xl gap-1">
            {genderOptions.map((g) => (
              <label
                key={g.value}
                data-checked={searchGender === g.value}
                className="flex-1 min-h-[44px] flex items-center justify-center text-center py-2.5 rounded-xl cursor-pointer text-muted-foreground transition-all
                           data-[checked=true]:bg-primary data-[checked=true]:text-on-primary font-bold"
              >
                <input
                  type="radio"
                  name="searchGender"
                  value={g.value}
                  className="hidden"
                  checked={searchGender === g.value}
                  onChange={() => setSearchGender(g.value)}
                />
                <span className="text-xs tracking-wide">{g.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-3xl p-6 space-y-6 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-amber-400 rounded-full" />
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">{t("ageRange")}</h3>
            <span className="ml-auto text-foreground bg-muted px-3 py-1 rounded-full border border-border text-xs font-bold">
              {searchAgeMin} — {searchAgeMax}
            </span>
          </div>

          <div className="relative h-8 flex items-center pt-2">
            <div className="absolute w-full h-1 bg-muted rounded-lg"></div>
            <div
              className="absolute h-1 bg-primary rounded-lg"
              style={{
                left: `${((searchAgeMin - 18) / 32) * 100}%`,
                right: `${100 - ((searchAgeMax - 18) / 32) * 100}%`
              }}
            ></div>

            <input
              type="range"
              min="18"
              max="50"
              value={searchAgeMin}
              onChange={(e) => setSearchAgeMin(Math.min(Number(e.target.value), searchAgeMax - 1))}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-none cursor-pointer"
            />

            <input
              type="range"
              min="18"
              max="50"
              value={searchAgeMax}
              onChange={(e) => setSearchAgeMax(Math.max(Number(e.target.value), searchAgeMin + 1))}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-none cursor-pointer"
            />
          </div>
        </div>

        <div className="bg-card border border-border rounded-3xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-sky-400 rounded-full" />
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">{t("maxDistance")}</h3>
            <span className="ml-auto text-foreground bg-muted px-3 py-1 rounded-full border border-border text-xs font-bold">
              {maxDistance} km
            </span>
          </div>

          <input
            type="range"
            data-testid="preferences-radius"
            min="1"
            max="50"
            value={maxDistance}
            onChange={(e) => setMaxDistance(Number(e.target.value))}
            className="w-full accent-primary h-1 bg-muted rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[11px] font-semibold text-muted-foreground">
            <span>1 km</span>
            <span>50 km</span>
          </div>
        </div>

        <button
          type="button"
          data-testid="preferences-save"
          onClick={handleSave}
          disabled={loading || saved}
          className={`w-full min-h-[52px] font-black py-4 rounded-full text-xs uppercase tracking-widest transition-all cursor-pointer ${saved
              ? "bg-green-500 text-black shadow-md"
              : loading
                ? "bg-muted text-muted-foreground cursor-not-allowed opacity-50"
                : "bg-primary text-on-primary hover:opacity-90 shadow-[0_0_20px_rgba(255,114,94,0.4)] active:scale-95"
            }`}
        >
          {saved ? t("saved") : loading ? t("saving") : t("apply")}
        </button>
      </div>
    </div>
  );
}

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
    <div className="min-h-screen bg-black text-white font-sans pb-24">
      <div className="px-6 pt-12 pb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={20} className="text-[#FF725E]" />
          <h1 className="text-xl font-black uppercase tracking-tight">{t("title")}</h1>
        </div>
      </div>

      <div className="px-6 space-y-6">

        <div className="bg-[#FF725E]/10 border border-[#FF725E]/20 rounded-2xl px-5 py-4">
          <p className="text-[11px] text-[#FF725E] font-bold uppercase tracking-widest mb-1">{t("howItWorksTitle")}</p>
          <p className="text-xs text-gray-400 leading-relaxed">
            {t("howItWorksDesc")}
          </p>
        </div>

        <div className="bg-[#121212] rounded-[2rem] p-6 space-y-4 shadow-[0_0_20px_rgba(0,0,0,0.4)]">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-4 bg-[#FF725E]/40 rounded-full" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">{t("lookingFor")}</h3>
          </div>

          <div className="flex bg-black/40 p-1 rounded-xl gap-1">
            {genderOptions.map((g) => (
              <label
                key={g.value}
                data-checked={searchGender === g.value}
                className="flex-1 text-center py-2.5 rounded-lg cursor-pointer text-gray-500 transition-all
                           data-[checked=true]:bg-[#FF725E] data-[checked=true]:text-black"
              >
                <input
                  type="radio"
                  name="searchGender"
                  value={g.value}
                  className="hidden"
                  checked={searchGender === g.value}
                  onChange={() => setSearchGender(g.value)}
                />
                <span className="text-[11px] font-semibold tracking-wide">{g.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="bg-[#121212] rounded-[2rem] p-6 space-y-6 shadow-[0_0_20px_rgba(0,0,0,0.4)]">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-[#FFD54F] rounded-full" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">{t("ageRange")}</h3>
            <span className="ml-auto text-white bg-[#222] px-3 py-1 rounded-full border border-[#333] text-[11px] font-bold">
              {searchAgeMin} — {searchAgeMax}
            </span>
          </div>

          <div className="relative h-8 flex items-center pt-2">
            <div className="absolute w-full h-1 bg-[#333] rounded-lg"></div>
            <div
              className="absolute h-1 bg-[#FF725E] rounded-lg"
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
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#FF725E] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#FF725E] [&::-moz-range-thumb]:border-none"
            />

            <input
              type="range"
              min="18"
              max="50"
              value={searchAgeMax}
              onChange={(e) => setSearchAgeMax(Math.max(Number(e.target.value), searchAgeMin + 1))}
              className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#FF725E] [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#FF725E] [&::-moz-range-thumb]:border-none"
            />
          </div>
        </div>

        <div className="bg-[#121212] rounded-[2rem] p-6 space-y-4 shadow-[0_0_20px_rgba(0,0,0,0.4)]">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-[#4FC3F7] rounded-full" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white">{t("maxDistance")}</h3>
            <span className="ml-auto text-white bg-[#222] px-3 py-1 rounded-full border border-[#333] text-[11px] font-bold">
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
            className="w-full accent-[#FF725E] h-1 bg-[#333] rounded-lg appearance-none"
          />
          <div className="flex justify-between text-[10px] text-gray-600">
            <span>1 km</span>
            <span>50 km</span>
          </div>
        </div>

        <button
          type="button"
          data-testid="preferences-save"
          onClick={handleSave}
          disabled={loading || saved}
          className={`w-full font-black py-5 rounded-[1.5rem] text-sm uppercase tracking-[0.2em] transition-all ${saved
              ? "bg-green-500 text-black"
              : loading
                ? "bg-[#333] text-gray-500"
                : "bg-[#FF725E] text-black hover:bg-[#ff8575]"
            }`}
        >
          {saved ? t("saved") : loading ? t("saving") : t("apply")}
        </button>
      </div>
    </div>
  );
}

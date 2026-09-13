"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { createGroupAction, getGroupByUser } from "@/app/actions/group";
import { Plus, X, Lock } from "lucide-react";

export default function CreateGroupPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("CreateGroup");
  const searchParams = useSearchParams();

  const [membersCount, setMembersCount] = useState(4);
  const [loading, setLoading] = useState(false);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(30);

  const [groupGender, setGroupGender] = useState("MIXED");
  const [searchGender, setSearchGender] = useState("MIXED");
  const [searchAgeMin, setSearchAgeMin] = useState(18);
  const [searchAgeMax, setSearchAgeMax] = useState(35);
  const [maxDistance, setMaxDistance] = useState(10);

  const [description, setDescription] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [instagramLinks, setInstagramLinks] = useState<string[]>([""]);
  const [photos, setPhotos] = useState<File[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  const [showPhotoAlert, setShowPhotoAlert] = useState(false);

  const handleBack = () => {
    // Check if the user arrived here immediately after registration
    const fromRegister = searchParams.get("from") === "register";

    // --- FIX: Redirect to the new core feed instead of the legacy dashboard ---
    if (fromRegister) {
      router.push(`/${locale}/search-groups`);
    } else {
      router.push(`/${locale}/profile`);
    }
  };

  // ---------------------------------------------------------------------------
  // Image compression
  // ---------------------------------------------------------------------------
  // Pure helper: resize + re-encode a File via an off-screen canvas.
  // Returns a new File (JPEG, quality 0.8, max-width 1600px).
  // Falls back to the original File if the canvas API is unavailable or throws.
  const compressImage = (file: File, maxWidth = 1600, quality = 0.8): Promise<File> =>
    new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file); // canvas unsupported — use original
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file); // encoding failed — use original
              return;
            }
            const compressedName = file.name.replace(/\.[^.]+$/, ".jpg");
            resolve(new File([blob], compressedName, { type: "image/jpeg" }));
          },
          "image/jpeg",
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file); // load failed — use original
      };

      img.src = objectUrl;
    });

  // ---------------------------------------------------------------------------
  // File selection handler
  // ---------------------------------------------------------------------------
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const selectedFiles = Array.from(e.target.files);
    const availableSlots = 6 - (existingPhotos.length + photos.length);
    if (availableSlots <= 0) return;

    const filesToProcess = selectedFiles.slice(0, availableSlots);

    // Compress each file in parallel; fall back to original on any per-file error.
    const compressedFiles = await Promise.all(
      filesToProcess.map((file) => compressImage(file).catch(() => file))
    );

    setPhotos((prev) => [...prev, ...compressedFiles]);
  };

  // Load existing data if the user already has a group
  useEffect(() => {
    async function loadData() {
      type SavedGroupData = {
        membersCount?: number;
        ageMin?: number;
        ageMax?: number;
        gender?: string;
        searchGender?: string;
        searchAgeMin?: number;
        searchAgeMax?: number;
        maxDistance?: number;
        description?: string;
        instagram?: string[];
        photos?: string[];
      } | null;

      const existingGroup = (await getGroupByUser()) as SavedGroupData;
      if (existingGroup) {
        setIsEditing(true);
        setMembersCount(existingGroup.membersCount ?? 4);
        setAgeMin(existingGroup.ageMin ?? 18);
        setAgeMax(existingGroup.ageMax ?? 30);
        setGroupGender(existingGroup.gender || "MIXED");
        setSearchGender(existingGroup.searchGender || "MIXED");
        setSearchAgeMin(existingGroup.searchAgeMin ?? 18);
        setSearchAgeMax(existingGroup.searchAgeMax ?? 35);
        setMaxDistance(existingGroup.maxDistance ?? 10);
        setDescription(existingGroup.description || "");
        if (existingGroup.instagram && existingGroup.instagram.length > 0) {
          setInstagramLinks(existingGroup.instagram);
        }
        if (existingGroup.photos && existingGroup.photos.length > 0) {
          setExistingPhotos(existingGroup.photos);
        }
        setAgreed(true); // Since they already agreed before
      }
    }
    loadData();
  }, []);



  const removePhoto = (index: number) => {
    if (index < existingPhotos.length) {
      setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
    } else {
      const fileIndex = index - existingPhotos.length;
      setPhotos((prev) => prev.filter((_, i) => i !== fileIndex));
    }
  };

  const addInstagram = () => setInstagramLinks([...instagramLinks, ""]);
  const updateInstagram = (i: number, v: string) => {
    const arr = [...instagramLinks];
    arr[i] = v;
    setInstagramLinks(arr);
  };
  const removeInstagram = (i: number) =>
    setInstagramLinks(instagramLinks.filter((_, idx) => idx !== i));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    if (photos.length === 0 && existingPhotos.length === 0) {
      setShowPhotoAlert(true);
      return;
    }

    setLoading(true);

    const form = event.currentTarget;
    const formData = new FormData(form);

    formData.delete("photos");
    photos.forEach((photoFile) => {
      formData.append("photos", photoFile);
    });

    formData.delete("existingPhotos");
    existingPhotos.forEach((url) => {
      formData.append("existingPhotos", url);
    });

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            formData.append("latitude", position.coords.latitude.toString());
            formData.append("longitude", position.coords.longitude.toString());

            formData.append("membersCount", membersCount.toString());
            formData.append("ageMin", ageMin.toString());
            formData.append("ageMax", ageMax.toString());
            formData.append("searchGender", searchGender);
            formData.append("searchAgeMin", searchAgeMin.toString());
            formData.append("searchAgeMax", searchAgeMax.toString());
            formData.append("maxDistance", maxDistance.toString());
            formData.append(
              "publicProfile",
              formData.get("publicProfile") ? "true" : "false"
            );

            formData.append("description", description.trim());
            formData.append("agreedToTerms", agreed ? "true" : "false");


            await createGroupAction(formData, locale);
            router.push(`/${locale}/profile`);

          } catch (unknownError: unknown) {
            const err = unknownError as Error;
            if (err?.message === "NEXT_REDIRECT") {
              return;
            }
            console.error("Error processing group:", err);
            alert(t("error"));
          } finally {
            setLoading(false);
          }
        },
        () => {
          setLoading(false);
          alert("Location required to update group.");
        }
      );
    }
  }

  const localPhotoUrls = photos.map((file) => URL.createObjectURL(file));
  const displayPhotos = [...existingPhotos, ...localPhotoUrls];

  return (
    <div className="min-h-screen bg-black text-white font-sans pb-20">
      <div className="px-6 pt-12 pb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 bg-white/5 rounded-full text-gray-400 hover:text-white transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
            className="w-6 h-6"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5L8.25 12l7.5-7.5"
            />
          </svg>
        </button>

        <h1 className="text-xl font-black uppercase tracking-tight">
          {isEditing ? t("editGroupTitle") : t("title")}
        </h1>

        <div className="w-10 h-10 flex items-center justify-center text-gray-500">
          ⓘ
        </div>
      </div>

      <form onSubmit={onSubmit} className="px-6 space-y-8" data-testid="create-group-form">


        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="block text-sm font-bold uppercase tracking-wider text-gray-500">
              {t("galleryLabel", { count: displayPhotos.length })}
            </label>
          </div>

          <input
            type="file"
            id="gallery-upload"
            data-testid="group-photo-upload"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
            disabled={displayPhotos.length >= 6}
          />

          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, index) => {
              const currentPhoto = displayPhotos[index];

              if (currentPhoto) {
                return (
                  <div key={index} className="relative aspect-square w-full rounded-2xl overflow-hidden border border-white/10 bg-[#141414] animate-in fade-in duration-200">
                    <img
                      src={currentPhoto}
                      alt={`Upload index ${index}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      className="absolute top-1.5 right-1.5 bg-black/80 text-white p-1 rounded-full hover:bg-black transition-colors border border-white/10"
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              }

              if (index === displayPhotos.length) {
                return (
                  <label
                    key={index}
                    htmlFor="gallery-upload"
                    className="flex flex-col items-center justify-center aspect-square w-full rounded-2xl border-2 border-dashed border-primary bg-primary/5 cursor-pointer hover:bg-primary/10 transition-all group shadow-inner"
                  >
                    <Plus size={24} className="text-primary group-hover:scale-110 transition-transform duration-200" />
                    <span className="text-[10px] font-black uppercase text-primary mt-1 tracking-wider">{t("addPhoto")}</span>
                  </label>
                );
              }

              return (
                <div
                  key={index}
                  className="flex items-center justify-center aspect-square w-full rounded-2xl border border-border bg-card text-muted-foreground"
                >
                  <Plus size={20} className="opacity-20" />
                </div>
              );
            })}
          </div>
          <p className="text-[9px] text-center text-primary font-bold uppercase tracking-widest mt-2">
            {displayPhotos.length === 0 ? t("uploadHint") : t("uploadHintMore")}
          </p>
        </div>

        <div className="bg-card border border-border rounded-[2rem] p-6 space-y-8 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-primary rounded-full"></div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground">
              {t("groupDetails")}
            </h3>
          </div>

          <div className="flex justify-between items-center">
            <span className="font-bold text-sm text-foreground">{t("members")}</span>

            <div className="flex items-center gap-3 bg-background border border-border p-1.5 rounded-full">
              <button
                type="button"
                onClick={() => setMembersCount(Math.max(1, membersCount - 1))}
                aria-label="Decrease members"
                className="w-11 h-11 bg-primary/15 text-primary rounded-full 
                           flex items-center justify-center font-black hover:bg-primary/25 text-lg cursor-pointer transition-colors"
              >
                –
              </button>

              <span className="text-base font-bold w-6 text-center text-foreground">
                {membersCount}
              </span>

              <button
                type="button"
                onClick={() => setMembersCount(membersCount + 1)}
                aria-label="Increase members"
                className="w-11 h-11 bg-primary text-on-primary rounded-full 
                           flex items-center justify-center font-black 
                           shadow-md hover:opacity-90 text-lg cursor-pointer transition-opacity"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
              {t("memberGender")}
            </span>

            <div className="flex bg-background border border-border p-1 rounded-xl gap-1">
              {["MIXED", "MALE", "FEMALE", "DIVERSE"].map((g) => (
                <label
                  key={g}
                  data-checked={groupGender === g}
                  className="flex-1 text-center py-2.5 rounded-lg cursor-pointer 
                             text-muted-foreground transition-all hover:scale-105
                             data-[checked=true]:bg-primary data-[checked=true]:text-on-primary font-bold"
                >
                  <input
                    type="radio"
                    name="groupGender"
                    value={g}
                    className="hidden peer"
                    checked={groupGender === g}
                    onChange={() => setGroupGender(g)}
                  />
                  <span className="text-[11px] font-semibold tracking-wide">
                    {t(g)}
                  </span>
                </label>
              ))}
            </div>
          </div>


          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-gray-500">
              <span>{t("ageRange")}</span>
              <span className="text-white bg-[#222] px-3 py-1 rounded-full border border-[#333]">
                {ageMin} — {ageMax}
              </span>
            </div>

            <div className="relative h-8 flex items-center pt-2">
              <div className="absolute w-full h-1 bg-muted rounded-lg"></div>
              <div
                className="absolute h-1 bg-primary rounded-lg"
                style={{
                  left: `${((ageMin - 18) / 32) * 100}%`,
                  right: `${100 - ((ageMax - 18) / 32) * 100}%`
                }}
              ></div>

              <input
                type="range"
                name="ageMin"
                min="18"
                max="50"
                value={ageMin}
                onChange={(e) => setAgeMin(Math.min(Number(e.target.value), ageMax - 1))}
                className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-none"
              />

              <input
                type="range"
                name="ageMax"
                min="18"
                max="50"
                value={ageMax}
                onChange={(e) => setAgeMax(Math.max(Number(e.target.value), ageMin + 1))}
                className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-none"
              />
            </div>
          </div>
        </div>


        <div className="bg-card border border-border rounded-[2rem] p-6 space-y-8 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-secondary rounded-full"></div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground">
              {t("searchPreferences")}
            </h3>
          </div>


          <div className="space-y-3">
            <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">
              {t("searchGender")}
            </span>

            <div className="flex bg-background border border-border p-1 rounded-xl gap-1">
              {["MIXED", "MALE", "FEMALE", "DIVERSE"].map((g) => (
                <label
                  key={g}
                  data-checked={searchGender === g}
                  className="flex-1 text-center py-2.5 rounded-lg cursor-pointer 
                             text-muted-foreground transition-all hover:scale-105
                             data-[checked=true]:bg-secondary data-[checked=true]:text-on-secondary font-bold"
                >
                  <input
                    type="radio"
                    name="searchGender"
                    value={g}
                    className="hidden peer"
                    checked={searchGender === g}
                    onChange={() => setSearchGender(g)}
                  />
                  <span className="text-[11px] font-semibold tracking-wide">
                    {t(g)}
                  </span>
                </label>
              ))}
            </div>
          </div>


          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>{t("preferredAgeRange")}</span>
              <span className="text-foreground bg-muted px-3 py-1 rounded-full border border-border">
                {searchAgeMin} — {searchAgeMax}
              </span>
            </div>


            <div className="relative h-8 flex items-center pt-2">

              <div className="absolute w-full h-1 bg-muted rounded-lg"></div>

              <div
                className="absolute h-1 bg-secondary rounded-lg"
                style={{
                  left: `${((searchAgeMin - 18) / 32) * 100}%`,
                  right: `${100 - ((searchAgeMax - 18) / 32) * 100}%`
                }}
              ></div>

              <input
                type="range"
                name="searchAgeMin"
                min="18"
                max="50"
                value={searchAgeMin}
                onChange={(e) => setSearchAgeMin(Math.min(Number(e.target.value), searchAgeMax - 1))}
                className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-secondary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-secondary [&::-moz-range-thumb]:border-none"
              />

              <input
                type="range"
                name="searchAgeMax"
                min="18"
                max="50"
                value={searchAgeMax}
                onChange={(e) => setSearchAgeMax(Math.max(Number(e.target.value), searchAgeMin + 1))}
                className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-secondary [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-secondary [&::-moz-range-thumb]:border-none"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <span>{t("maxDistance")}</span>
              <span className="text-foreground bg-muted px-3 py-1 rounded-full border border-border">
                {maxDistance} km
              </span>
            </div>

            <input
              type="range"
              name="maxDistance"
              min="1"
              max="50"
              value={maxDistance}
              onChange={(e) => setMaxDistance(Number(e.target.value))}
              className="w-full accent-secondary h-1 bg-muted rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="flex justify-between items-center bg-background p-4 rounded-2xl border border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Lock size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{t("publicProfile")}</p>
                <p className="text-[10px] text-muted-foreground">{t("visibleToAll")}</p>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                name="publicProfile"
                className="sr-only peer"
                defaultChecked
              />
              <div
                className="w-10 h-5 bg-muted rounded-full peer-checked:bg-primary 
                              after:content-[''] after:absolute after:top-[2px] after:left-[2px] 
                              after:bg-foreground after:h-4 after:w-4 after:rounded-full after:transition-all 
                              peer-checked:after:translate-x-5 cursor-pointer"
              ></div>
            </label>
          </div>
        </div>

        <div className="bg-card border border-border rounded-[2rem] p-6 space-y-6 shadow-xl">
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 bg-secondary rounded-full"></div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground">
              {t("instagramProfiles")}
            </h3>
          </div>

          <p className="text-gray-500 text-[11px] leading-relaxed">
            {t("instagramInfo")}
          </p>

          {instagramLinks.map((value, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type="text"
                name={`instagram_${index}`}
                value={value}
                onChange={(e) => updateInstagram(index, e.target.value)}
                placeholder="@username"
                className="flex-1 bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-[#FF55A5]"
              />

              <button
                type="button"
                onClick={() => removeInstagram(index)}
                className="w-10 h-10 bg-red-500/10 text-red-400 rounded-xl flex items-center justify-center hover:bg-red-500/20 transition"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={addInstagram}
            className="w-full bg-[#FF55A5]/20 text-[#FF55A5] font-bold py-3 rounded-xl hover:bg-[#FF55A5]/30 transition"
          >
            {t("addInstagram")}
          </button>
        </div>

        <div className="space-y-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">
            {t("shortDescription")}
          </h3>

          <div className="relative">
            <textarea
              name="description"
              maxLength={200}
              placeholder={t("descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-card border border-border rounded-[1.5rem] p-5 text-sm text-foreground placeholder:text-muted-foreground/50 h-32 focus:outline-none focus:border-primary transition-all"
            />
            <span className="absolute bottom-3 right-5 text-[10px] text-muted-foreground">
              {description.length}/200
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3 px-2">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 accent-primary cursor-pointer"
            />

            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {t.rich("termsText", {
                terms: (chunks) => (
                  <a
                    href="https://gloo.app/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {chunks}
                  </a>
                ),
                guidelines: (chunks) => (
                  <a
                    href="https://gloo.app/guidelines"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </div>

          <button
            type="submit"
            data-testid="create-group-submit"
            disabled={!agreed || loading}
            className={`w-full font-black py-5 rounded-[1.5rem] text-sm uppercase tracking-[0.2em] transition-all min-h-[48px] ${agreed
                ? "bg-accent text-on-accent hover:opacity-90 active:scale-[0.99] shadow-lg shadow-accent/20 cursor-pointer"
                : "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
              }`}
          >
            {loading
              ? t("saving")
              : isEditing
                ? t("updateProfile")
                : t("createGroupButton")}
          </button>
        </div>
      </form>

      {showPhotoAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-[2rem] p-6 w-full max-w-sm shadow-2xl flex flex-col items-center text-center space-y-4">

            <div className="w-16 h-16 bg-secondary/10 rounded-full flex items-center justify-center text-secondary mb-2 border border-secondary/20">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <h2 className="text-lg font-black uppercase tracking-wider text-foreground">
              {t("photoRequired")}
            </h2>

            <p className="text-sm text-muted-foreground">
              {t("photoRequiredDesc")}
            </p>

            <button
              type="button"
              onClick={() => setShowPhotoAlert(false)}
              className="w-full mt-4 bg-muted hover:bg-muted/80 text-foreground font-bold py-4 rounded-[1.5rem] uppercase tracking-[0.2em] text-xs transition-colors cursor-pointer min-h-[44px]"
            >
              {t("gotIt")}
            </button>

          </div>
        </div>
      )}
    </div>
  );
}
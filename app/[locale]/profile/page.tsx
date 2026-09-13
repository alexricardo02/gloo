"use client";

import { useState, useEffect } from "react";
import { checkIsGuest } from "@/app/actions/guest";
import { getGroupByUser, deleteGroupAction } from "@/app/actions/group";
import { getCurrentUser, logOutAction, updateProfileImage } from "@/app/actions/auth";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Navigation from "@/app/components/Navigation";
import GroupCard from "@/app/components/GroupCard";
import Image from "next/image";
import Link from "next/link";
import PageHeader from "@/app/components/PageHeader";

import { Settings, Users, LogOut, ChevronRight, Plus, User, X, Camera, Upload, MoreVertical, Trash2 } from "lucide-react";

export default function ProfilePage() {
  const [isGuest, setIsGuest] = useState(false);
  const [group, setGroup] = useState<any | null>(null);
  const [user, setUser] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Profile");

  useEffect(() => {
    if (!isMenuOpen) return;
    const closeMenu = () => setIsMenuOpen(false);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [isMenuOpen]);

  // Load guest status + group
  useEffect(() => {
    const init = async () => {
      const status = await checkIsGuest();
      setIsGuest(status);

      const g = await getGroupByUser();
      setGroup(g);

      const userData = await getCurrentUser();
      setUser(userData)
    };
    init();
  }, []);

  const settingsOptions = [
    { name: t("accountSection"), icon: <Users size={16} />, path: `/${locale}/profile/account` },
  ];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleDeleteGroup = async () => {
    setIsDeleting(true);
    const result = await deleteGroupAction();
    setIsDeleting(false);

    if (result.success) {
      setGroup(null); // Revert UI back to host-less / spectator view
      setShowDeleteConfirm(false);
      setIsMenuOpen(false);
    } else {
      alert(result.error || "Failed to delete group");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError(null);
    const formData = new FormData();
    formData.append("image", selectedFile);

    const result = await updateProfileImage(formData);

    if (result?.success && result.image) {
      // Update local user state immediately so UI reflects the new image
      setUser((prev: any) => ({ ...prev, image: result.image }));

      // Clean up and close modal
      setSelectedFile(null);
      setPreviewUrl(null);
      setIsModalOpen(false);
    } else {
      setUploadError(result?.error || "Upload failed. Please try again.");
    }

    setIsUploading(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans pb-32">
      <PageHeader title={t("title")} />

      <div className="px-6 space-y-8 pt-28">
        <div className="flex flex-col items-center text-center gap-3 py-2">
          <div className="relative">
            <div className="w-[110px] h-[110px] rounded-full border-2 border-primary overflow-hidden bg-muted flex items-center justify-center shadow-xl">
              {user?.image ? (
                <img src={user.image} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <User className="w-12 h-12 text-muted-foreground" />
              )}
            </div>

            <button
              onClick={() => setIsModalOpen(true)}
              aria-label="Upload profile picture"
              className="w-11 h-11 rounded-full flex items-center justify-center absolute bottom-0 right-0 bg-primary text-on-primary border-2 border-background hover:scale-105 transition-transform shadow-md z-10 cursor-pointer"
            >
              <Plus size={20} strokeWidth={3} />
            </button>
          </div>

          <div className="mt-1">
            <h2 className="text-2xl font-black uppercase tracking-tight text-foreground">
              {user?.name || t("loading")}
            </h2>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
              {t("groupsSection")}
            </h3>
          </div>

          {!group ? (
            // Empty State
            <Link href={`/${locale}/profile/create-group`} className="block">
              <div className="border border-border bg-card rounded-3xl p-6 flex flex-col items-center justify-center text-center gap-4 hover:border-primary/50 transition-all cursor-pointer">
                <div className="p-3 bg-muted rounded-2xl border border-border text-primary">
                  <Users size={24} />
                </div>
                <h4 className="font-extrabold text-foreground text-lg">
                  {t("noGroupTitle")}
                </h4>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  {t("noGroupDesc")}
                </p>
                <span className="mt-2 min-h-[44px] px-6 py-2.5 rounded-full bg-primary text-on-primary font-black uppercase tracking-wider text-xs flex items-center justify-center">
                  {t("createGroupButton")}
                </span>
              </div>
            </Link>
          ) : (
            <div className="relative block">
              <div className="absolute top-1/2 -translate-y-1/2 right-4 z-20">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsMenuOpen(!isMenuOpen);
                  }}
                  aria-label="Group options"
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-background/80 backdrop-blur-md hover:bg-muted text-foreground transition-all border border-border active:scale-95 cursor-pointer"
                >
                  <MoreVertical size={18} />
                </button>

                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-2xl shadow-2xl py-1 z-30 animate-in fade-in slide-in-from-top-2 duration-100">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShowDeleteConfirm(true);
                        setIsMenuOpen(false);
                      }}
                      className="w-full min-h-[44px] flex items-center gap-2.5 px-4 py-3 text-sm text-destructive hover:bg-muted transition-colors font-black uppercase tracking-wider text-left cursor-pointer"
                    >
                      <Trash2 size={16} />
                      {t("deleteGroup")}
                    </button>
                  </div>
                )}
              </div>

              <Link href={`/${locale}/profile/create-group`} className="block">
                <div className="border border-border bg-card rounded-3xl p-5 pr-16 flex items-center gap-4 hover:border-primary/50 hover:bg-card/90 transition-all relative cursor-pointer">
                  <div className="relative w-20 h-20 rounded-2xl overflow-hidden border border-border flex-shrink-0 bg-muted">
                    <img
                      src={group.photos?.[0] || "/images/vorgluehen.jpg"}
                      alt="Group"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-extrabold text-lg text-foreground truncate">
                        {t("yourGroup")}
                      </h4>
                      <span className="text-[10px] text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded uppercase font-black shrink-0">
                        {t(group.gender)}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1.5 font-bold">
                        <Users size={16} className="text-primary" />
                        {group.membersCount}
                      </span>
                      <span className="font-bold flex items-center gap-1.5">
                        <Settings size={14} className="text-primary" />
                        {group.ageMin}–{group.ageMax}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h3 className="text-xs font-black uppercase tracking-wider text-muted-foreground">
            {t("settings")}
          </h3>
          <div className="space-y-3">
            {settingsOptions.map((option, i) => (
              <Link key={i} href={option.path} className="block">
                <div className="border border-border bg-card rounded-3xl p-4 min-h-[64px] flex justify-between items-center hover:bg-muted/40 transition-colors cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-muted rounded-2xl text-primary border border-border">
                      {option.icon}
                    </div>
                    <span className="font-bold text-sm text-foreground">{option.name}</span>
                  </div>
                  <ChevronRight size={18} className="text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="flex justify-center pt-4 pb-8">
          <button
            onClick={async () => {
              await logOutAction(locale);
            }}
            className="min-h-[48px] flex items-center gap-2.5 font-bold text-base bg-card text-primary border border-border px-8 py-3.5 rounded-full hover:bg-muted transition-colors cursor-pointer"
          >
            <LogOut size={20} />
            {t("logoutButton")}
          </button>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={() => setIsModalOpen(false)}
          />

          <div className="relative bg-card border border-border w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl flex flex-col items-center animate-in zoom-in-95 duration-300">
            <button
              onClick={() => setIsModalOpen(false)}
              aria-label="Close"
              className="w-11 h-11 rounded-full flex items-center justify-center absolute top-5 right-5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>

            <h3 className="text-xl font-black uppercase mb-6 text-center tracking-tight text-foreground">
              {t("updatePhoto")}
            </h3>

            {uploadError && (
              <div className="w-full mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-2xl text-sm text-destructive text-center">
                {uploadError}
              </div>
            )}

            <label
              htmlFor="profile-upload"
              className="w-36 h-36 rounded-full border-2 border-dashed border-primary flex flex-col items-center justify-center bg-muted/40 mb-6 cursor-pointer hover:bg-primary/5 transition-colors group overflow-hidden relative"
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <>
                  <Camera size={36} className="text-primary mb-2 group-hover:scale-110 transition-transform" />
                  <span className="text-[10px] font-bold uppercase text-muted-foreground">{t("tapToSelect")}</span>
                </>
              )}

              <input
                type="file"
                id="profile-upload"
                className="hidden"
                accept="image/*"
                onChange={handleFileSelect}
              />
            </label>

            <button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className={`w-full min-h-[48px] font-black py-3.5 rounded-full uppercase tracking-wider text-xs transition-transform flex items-center justify-center gap-2 cursor-pointer ${!selectedFile || isUploading
                  ? "bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
                  : "bg-primary text-on-primary hover:scale-[1.02]"
                }`}
            >
              <Upload size={18} />
              {isUploading ? "Uploading..." : t("uploadNow")}
            </button>
          </div>
        </div>
      )}

      <Navigation />

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl p-6 w-full max-w-sm text-center shadow-2xl">
            <h3 className="text-lg font-black text-foreground uppercase tracking-wide mb-2">{t("deleteGroupTitle")}</h3>
            <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
              {t("deleteGroupDesc")}
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleDeleteGroup}
                disabled={isDeleting}
                className="w-full min-h-[44px] bg-destructive text-white font-black py-3.5 rounded-full uppercase tracking-wider text-xs transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
              >
                {isDeleting ? t("deleting") : t("deleteGroupConfirm")}
              </button>

              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="w-full min-h-[44px] bg-card border border-border text-foreground font-bold py-3.5 rounded-full uppercase tracking-wider text-xs transition-colors hover:bg-muted disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
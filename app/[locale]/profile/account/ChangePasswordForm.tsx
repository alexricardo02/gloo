"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle, Loader2 } from "lucide-react";
import { changePassword } from "@/app/actions/auth";
import { getPasswordCriteria, meetsPasswordStrength } from "@/lib/password";

const KNOWN_ERRORS = [
  "currentPasswordIncorrect",
  "passwordMismatch",
  "passwordSameAsCurrent",
  "passwordWeakError",
  "passwordTooLongError",
  "tooManyAttemptsError",
  "sessionExpiredError",
  "changePasswordGenericError",
];

const inputBox =
  "relative flex items-center bg-background border border-border rounded-2xl px-4 py-3 focus-within:ring-2 focus-within:ring-primary focus-within:border-primary transition-all";
const inputField =
  "bg-transparent outline-none w-full text-foreground placeholder:text-muted-foreground/50 font-medium";

/** Change password while signed in (works with or without email flows). */
export default function ChangePasswordForm() {
  const t = useTranslations("AccountSettings");
  const tRegister = useTranslations("Register");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const criteria = getPasswordCriteria(newPassword);
  const canSubmit = !isSaving && currentPassword.length > 0 && newPassword.length > 0 && confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("passwordMismatch");
      return;
    }
    if (!meetsPasswordStrength(criteria)) {
      setError("passwordWeakError");
      return;
    }

    setIsSaving(true);
    try {
      const result = await changePassword(currentPassword, newPassword, confirmPassword);
      if (result.ok) {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const key = result.messageKey;
        setError(key && KNOWN_ERRORS.includes(key) ? key : "changePasswordGenericError");
      }
    } catch {
      setError("changePasswordGenericError");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3" data-testid="change-password-form">
      <div className={inputBox}>
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          data-testid="change-password-current-input"
          aria-label={t("currentPasswordLabel")}
          placeholder={t("currentPasswordLabel")}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputField}
        />
      </div>

      <div className={inputBox}>
        <input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          data-testid="change-password-new-input"
          aria-label={t("newPasswordLabel")}
          placeholder={t("newPasswordLabel")}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputField}
        />
      </div>

      {newPassword.length > 0 && (
        <div className="grid grid-cols-2 gap-1 px-3 text-[11px] text-muted-foreground font-semibold">
          <span className={criteria.length ? "text-green-500" : ""}>{criteria.length ? "✓" : "○"} {tRegister("pwdMinChars")}</span>
          <span className={criteria.uppercase ? "text-green-500" : ""}>{criteria.uppercase ? "✓" : "○"} {tRegister("pwdUppercase")}</span>
          <span className={criteria.number ? "text-green-500" : ""}>{criteria.number ? "✓" : "○"} {tRegister("pwdNumber")}</span>
          <span className={criteria.special ? "text-green-500" : ""}>{criteria.special ? "✓" : "○"} {tRegister("pwdSpecial")}</span>
        </div>
      )}

      <div className={inputBox}>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          data-testid="change-password-confirm-input"
          aria-label={t("confirmNewPasswordLabel")}
          placeholder={t("confirmNewPasswordLabel")}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputField}
        />
      </div>

      {error && (
        <div
          data-testid="change-password-error-msg"
          className="p-3 bg-destructive/10 border border-destructive/30 rounded-2xl text-xs text-destructive font-medium"
        >
          {t(error)}
        </div>
      )}

      {success && (
        <div
          data-testid="change-password-success"
          className="flex items-start gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-2xl"
        >
          <CheckCircle size={20} className="text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-green-400">{t("passwordChangedTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1">{t("passwordChangedDesc")}</p>
          </div>
        </div>
      )}

      <div>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="change-password-submit-btn"
          className="min-h-[44px] font-black text-xs uppercase tracking-wider bg-accent text-on-accent px-6 py-3 rounded-full hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
        >
          {isSaving && <Loader2 size={16} className="animate-spin" />}
          {isSaving ? t("updatingPassword") : t("updatePasswordButton")}
        </button>
      </div>
    </form>
  );
}

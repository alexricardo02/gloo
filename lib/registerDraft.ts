// Persists the in-progress register form across reloads in sessionStorage.
// SECURITY: only the allowlisted, non-secret fields below are ever written or
// read back. The password must never reach client storage (readable by any
// injected script and visible in devtools).

export const REGISTER_DRAFT_KEY = "gloo_register_data";

export type RegisterDraft = {
  name: string;
  email: string;
  dob: string;
  username: string;
  agreed: boolean;
};

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STRING_FIELDS = ["name", "email", "dob", "username"] as const;

function toStoredDraft(draft: Partial<RegisterDraft>): Partial<RegisterDraft> {
  // Built field by field so extra runtime properties (e.g. a password) are dropped.
  const out: Partial<RegisterDraft> = {};
  for (const key of STRING_FIELDS) {
    if (typeof draft[key] === "string") out[key] = draft[key];
  }
  if (typeof draft.agreed === "boolean") out.agreed = draft.agreed;
  return out;
}

/**
 * Reads the saved draft, returning only allowlisted fields. If the stored
 * object carries any other key (e.g. `password` written by an older version
 * of the page), it is rewritten without it; unparseable data is removed.
 */
export function loadRegisterDraft(storage: DraftStorage): Partial<RegisterDraft> {
  const raw = storage.getItem(REGISTER_DRAFT_KEY);
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    storage.removeItem(REGISTER_DRAFT_KEY);
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    storage.removeItem(REGISTER_DRAFT_KEY);
    return {};
  }

  const draft = toStoredDraft(parsed as Partial<RegisterDraft>);
  // Rewrite when anything was dropped: unknown keys or wrongly typed values.
  if (Object.keys(parsed).length !== Object.keys(draft).length) {
    storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(draft));
  }
  return draft;
}

export function saveRegisterDraft(storage: DraftStorage, draft: RegisterDraft): void {
  storage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(toStoredDraft(draft)));
}

export function clearRegisterDraft(storage: DraftStorage): void {
  storage.removeItem(REGISTER_DRAFT_KEY);
}

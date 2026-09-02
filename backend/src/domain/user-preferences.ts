import type { YoubanDatabase } from "./database.ts";

export type UserSkin = "default" | "google";
export type UserLocale = "zh-CN" | "en-US" | "fr-FR";

export interface UserPreferencesView {
  skin: UserSkin;
  locale: UserLocale;
  initialized: boolean;
  updated_at: string | null;
}

export interface UserPreferencesPatch {
  skin?: UserSkin;
  locale?: UserLocale;
}

const DEFAULT_PREFERENCES: UserPreferencesView = {
  skin: "default",
  locale: "zh-CN",
  initialized: false,
  updated_at: null,
};

interface PreferenceRow {
  skin: UserSkin;
  locale: UserLocale;
  updated_at: string;
}

export class UserPreferencesRepository {
  constructor(
    readonly database: YoubanDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  get(userId: string): UserPreferencesView {
    const row = this.database.raw.query(`
      SELECT skin, locale, updated_at FROM user_preferences WHERE user_id = ?
    `).get(userId) as PreferenceRow | null;
    return row ? { ...row, initialized: true } : { ...DEFAULT_PREFERENCES };
  }

  patch(userId: string, patch: UserPreferencesPatch): UserPreferencesView {
    if (patch.skin === undefined && patch.locale === undefined) {
      throw new Error("至少需要更新一项偏好");
    }
    const current = this.get(userId);
    const skin = patch.skin ?? current.skin;
    const locale = patch.locale ?? current.locale;
    const updatedAt = this.now();
    this.database.raw.query(`
      INSERT INTO user_preferences (user_id, skin, locale, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        skin = excluded.skin,
        locale = excluded.locale,
        updated_at = excluded.updated_at
    `).run(userId, skin, locale, updatedAt);
    return { skin, locale, initialized: true, updated_at: updatedAt };
  }
}

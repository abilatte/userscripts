export const COVER_PAGER_ENABLED_KEY = "qidian_cover_pager_enabled";
export const PAGER_SETTINGS_KEY = "qidian_pager_settings";

export const DEFAULT_PAGER_SETTINGS = {
    delayMs: 400,
    rateLimitRetrySec: 0,
    autoTargetPages: 0,
    autoStart: false
};

function clampInt(value, min, max, fallback) {
    if (value === "" || value === null || value === undefined || typeof value === "boolean") return fallback;
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(num)));
}

export function normalizePagerSettings(raw) {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    return {
        delayMs: clampInt(src.delayMs, 0, 60000, DEFAULT_PAGER_SETTINGS.delayMs),
        rateLimitRetrySec: clampInt(src.rateLimitRetrySec, 0, 600, DEFAULT_PAGER_SETTINGS.rateLimitRetrySec),
        autoTargetPages: clampInt(src.autoTargetPages, 0, 999, DEFAULT_PAGER_SETTINGS.autoTargetPages),
        autoStart: Boolean(src.autoStart)
    };
}

export const Settings = {
    getCoverPagerEnabled: () => Boolean(GM_getValue(COVER_PAGER_ENABLED_KEY, true)),
    setCoverPagerEnabled: (enabled) => GM_setValue(COVER_PAGER_ENABLED_KEY, Boolean(enabled)),
    getPagerSettings: () => normalizePagerSettings(GM_getValue(PAGER_SETTINGS_KEY, null)),
    savePagerSettings: (patch) => {
        const next = normalizePagerSettings({ ...Settings.getPagerSettings(), ...patch });
        GM_setValue(PAGER_SETTINGS_KEY, next);
        return next;
    }
};

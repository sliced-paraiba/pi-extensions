/**
 * noctalia-sync — PiClaw extension for live Noctalia theme sync.
 *
 * What it does:
 *   - Registers /noctalia-sync command (auto-complete, manual re-sync)
 *   - Registers /noctalia-off command (revert to default theme)
 *   - Auto-applies Noctalia theme on session start
 *   - Watches ~/.config/noctalia/colors.json for live updates
 *   - Dynamically generates the palette at runtime (no hardcoded colors)
 *
 * Requires the piclaw-noctalia patches applied to the piclaw installation.
 * Run: scripts/patch-piclaw.py
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, watchFile, unwatchFile, existsSync } from "node:fs";
import { resolve } from "node:path";

const HOME = process.env.HOME || "/home/quartz";
const COLORS_PATH = resolve(HOME, ".config/noctalia/colors.json");

interface NoctaliaColors {
    mPrimary: string;
    mOnPrimary: string;
    mSecondary: string;
    mOnSecondary: string;
    mTertiary: string;
    mOnTertiary: string;
    mError: string;
    mOnError: string;
    mSurface: string;
    mOnSurface: string;
    mSurfaceVariant: string;
    mOnSurfaceVariant: string;
    mOutline: string;
    mShadow: string;
    mHover: string;
    mOnHover: string;
}

interface PiclawPalette {
    bgPrimary: string;
    bgSecondary: string;
    bgHover: string;
    textPrimary: string;
    textSecondary: string;
    borderColor: string;
    accent: string;
    accentHover: string;
    danger: string;
    success: string;
}

function mapColors(c: NoctaliaColors): PiclawPalette {
    return {
        bgPrimary: c.mSurface,
        bgSecondary: c.mSurfaceVariant,
        bgHover: c.mOutline,
        textPrimary: c.mOnSurface,
        textSecondary: c.mOnSurfaceVariant,
        borderColor: c.mOutline,
        accent: c.mPrimary,
        accentHover: c.mTertiary,
        danger: c.mError,
        success: c.mTertiary,
    };
}

function readColors(): PiclawPalette | null {
    try {
        const raw = readFileSync(COLORS_PATH, "utf-8");
        return mapColors(JSON.parse(raw));
    } catch {
        return null;
    }
}

export default function (pi: ExtensionAPI) {
    let watcherActive = false;

    function applyNoctalia(ctx: { ui: any }, notify = false): boolean {
        const palette = readColors();
        if (!palette) {
            if (notify) ctx.ui.notify("Noctalia colors not found at " + COLORS_PATH, "error");
            return false;
        }

        // setTheme broadcasts ui_theme SSE event. With our client patch,
        // the client-side LV handler checks for the palette field and applies
        // CSS custom properties directly — fully dynamic, no hardcoded colors.
        const result = ctx.ui.setTheme({ theme: "noctalia" } as any);
        if (notify) {
            const ok = result && typeof result === "object" && (result as any).success !== false;
            ctx.ui.notify(
                ok ? "🎨 Noctalia theme applied!" : "⚠️ Theme set but may need palette patch",
                ok ? "success" : "warning"
            );
        }
        return true;
    }

    pi.on("session_start", async (_event, ctx) => {
        if (!existsSync(COLORS_PATH)) return;

        // Apply after short delay to let the web client SSE connection establish
        setTimeout(() => {
            try { applyNoctalia(ctx, false); } catch { /* client not ready */ }
        }, 2500);

        // Watch for live updates (Noctalia writes new colors on wallpaper change etc.)
        if (!watcherActive) {
            watcherActive = true;
            watchFile(COLORS_PATH, { interval: 3000 }, () => {
                try { applyNoctalia(ctx, false); } catch { /* ignore */ }
            });
        }
    });

    pi.on("session_shutdown", async () => {
        if (watcherActive) {
            try { unwatchFile(COLORS_PATH); } catch { /* ignore */ }
            watcherActive = false;
        }
    });

    pi.registerCommand("noctalia-sync", {
        description: "Sync web theme with current Noctalia colors",
        handler: async (_args, ctx) => {
            applyNoctalia(ctx, true);
        },
    });

    pi.registerCommand("noctalia-off", {
        description: "Revert to default piclaw web theme",
        handler: async (_args, ctx) => {
            ctx.ui.setTheme({ theme: "default" });
            ctx.ui.notify("Reverted to default theme.", "info");
        },
    });
}

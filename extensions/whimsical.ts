/**
 * Whimsical Loading Messages - Dynamic LLM-generated
 *
 * Uses glm-4.7-flash via the non-coding Z.ai endpoint to generate
 * unique, creative loading messages on each turn. Falls back to a
 * static list if the API call fails or is too slow.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// --- Config ---
const ZAI_API_BASE = "https://api.z.ai/api/paas/v4";
const MODEL = "glm-4.7-flash";
const MAX_TOKENS = 30;
const TEMPERATURE = 1.3;
const TIMEOUT_MS = 3000;

// --- Static fallbacks (used when API fails or on first call) ---
const fallbacks = [
  "Reticulating splines...",
  "Consulting the rubber duck...",
  "Herding cats in memory...",
  "Defenestrating bugs...",
  "Teaching electrons new tricks...",
  "Bribing the compiler...",
  "Negotiating with entropy...",
  "Discombobulating...",
  "Communing with the machine spirit...",
  "Schrödinger's code — compiling and not compiling...",
  "Wrangling wild pointers...",
  "Performing arcane rituals...",
  "Transmuting coffee into code...",
  "Untangling spaghetti code...",
  "Conjuring semicolons from the void...",
  "Massaging the heap...",
  "Tickling the stack...",
  "Appeasing the garbage collector...",
  "Calibrating the flux capacitor...",
  "Whispering to the bits...",
];

let fallbackIndex = 0;
let cachedApiKey: string | undefined;

function pickFallback(): string {
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

function buildPrompt(): string {
  const styles = [
    "absurd and surreal",
    "punny and nerdy",
    "dramatically over-the-top",
    "cozy and wholesome",
    "mysteriously cryptic",
    "chaotically creative",
    "delightfully weird",
    "philosophically absurd",
  ];
  const style = styles[Math.floor(Math.random() * styles.length)];
  return `Generate ONE short ${style} loading message for a coding AI assistant. End with ... Just the message. No quotes, no explanation, no prefix. Examples: "Reticulating splines...", "Teaching old code new tricks...", "Negotiating with cosmic rays..."`;
}

async function generateMessage(apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ZAI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: buildPrompt() }],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    let msg = data.choices[0]?.message?.content?.trim();
    if (!msg) throw new Error("Empty response");

    // Ensure it ends with ...
    if (!msg.endsWith("...")) {
      msg = msg.replace(/[.!?]*$/, "...");
    }

    // Keep it short — truncate if the model got wordy
    if (msg.length > 80) {
      msg = msg.substring(0, 77) + "...";
    }

    return msg;
  } finally {
    clearTimeout(timeout);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    // Set a fallback immediately so there's something to show
    ctx.ui.setWorkingMessage(pickFallback());

    // Try to generate a dynamic message in the background
    try {
      if (!cachedApiKey) {
        cachedApiKey = await ctx.modelRegistry.getApiKeyForProvider("zai");
      }
      if (!cachedApiKey) return;

      const msg = await generateMessage(cachedApiKey);
      ctx.ui.setWorkingMessage(msg);
    } catch {
      // Keep the fallback — no one will know
    }
  });

  pi.on("turn_end", async (_event, _ctx) => {
    // Reset for next turn (setWorkingMessage() with no arg restores default)
  });
}

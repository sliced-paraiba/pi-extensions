/**
 * Model Changed extension — injects an agent-facing message when the model
 * actually changes on a prompt, without cluttering the UI.
 *
 * Key behavior:
 *  - Only injects when a prompt is actually sent (not on every model_select)
 *  - Switching A → B → A before sending a prompt injects nothing
 *  - The message has display: false so it's invisible in the TUI
 *    but reaches the LLM through the session context
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let lastPromptModel: string | undefined;
  let currentModel: string | undefined;

  // Track model selections as they happen
  pi.on("model_select", async (event, _ctx) => {
    currentModel = `${event.model.provider}/${event.model.id}`;

    // First selection (e.g. session restore) — seed the baseline
    // so the first real prompt doesn't look like a change.
    if (lastPromptModel === undefined) {
      lastPromptModel = currentModel;
    }
  });

  // Inject a message only when a prompt is actually sent and the model differs
  // from the last model that was used for a prompt.
  pi.on("before_agent_start", async (event, _ctx) => {
    const result: { message?: { customType: string; content: string; display: boolean }; systemPrompt?: string } = {};

    // Always append the current model to the system prompt
    if (currentModel) {
      result.systemPrompt = `${event.systemPrompt}\n\nCurrent model: ${currentModel}`;
    }

    // Inject a model-changed message if this prompt uses a different model
    if (
      currentModel !== undefined &&
      lastPromptModel !== undefined &&
      currentModel !== lastPromptModel
    ) {
      const previous = lastPromptModel;
      result.message = {
        customType: "model-changed",
        content: `[System] Model changed: \`${previous}\` → \`${currentModel}\``,
        display: false,
      };
    }

    lastPromptModel = currentModel;
    return Object.keys(result).length > 0 ? result : undefined;
  });
}

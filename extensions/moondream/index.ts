/**
 * Moondream Image Read Extension
 *
 * Provides an `image_read` tool that uses the Moondream vision API
 * for visual question answering, object detection, pointing,
 * captioning, and segmentation.
 *
 * Set MOONDREAM_API_KEY in your environment or register it
 * via pi's credential system under the "moondream" provider.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";

// --- Config ---
const API_BASE = "https://api.moondream.ai/v1";
const TIMEOUT_MS = 60_000;

// --- Helpers ---

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

function imageToDataUrl(imagePath: string, cwd: string): string {
  const resolved = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(cwd, imagePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Image not found: ${resolved}`);
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    throw new Error(
      `Unsupported image format: ${ext}. Supported: ${Object.keys(MIME_TYPES).join(", ")}`,
    );
  }

  const buffer = fs.readFileSync(resolved);
  const base64 = buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

async function getApiKey(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  // Try pi's credential system first, then env var
  try {
    const key = await ctx.modelRegistry.getApiKeyForProvider("moondream");
    if (key) return key;
  } catch {
    // Fall through to env var
  }
  return process.env.MOONDREAM_API_KEY;
}

async function callMoondream(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Wire up external signal if provided
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const response = await fetch(`${API_BASE}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Moondream-Auth": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `Moondream API error ${response.status}: ${errorText}`,
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Format results for each mode
function formatQueryResult(data: any): string {
  return data.answer ?? JSON.stringify(data);
}

function formatDetectResult(data: any): string {
  const objects: any[] = data.objects ?? [];
  if (objects.length === 0) return "No objects detected.";
  return objects
    .map(
      (obj: any, i: number) =>
        `${i + 1}. bbox=[${obj.x_min?.toFixed(3)}, ${obj.y_min?.toFixed(3)}, ${obj.x_max?.toFixed(3)}, ${obj.y_max?.toFixed(3)}]`,
    )
    .join("\n");
}

function formatPointResult(data: any): string {
  const points: any[] = data.points ?? [];
  if (points.length === 0) return "No points found.";
  return points
    .map(
      (p: any, i: number) =>
        `${i + 1}. (${p.x?.toFixed(3)}, ${p.y?.toFixed(3)})`,
    )
    .join("\n");
}

function formatCaptionResult(data: any): string {
  return data.caption ?? JSON.stringify(data);
}

function formatSegmentResult(data: any): string {
  const parts: string[] = [];
  if (data.path) {
    parts.push(`SVG Path: \`${data.path}\``);
  }
  if (data.bbox) {
    parts.push(
      `BBox: [${data.bbox.x_min?.toFixed(3)}, ${data.bbox.y_min?.toFixed(3)}, ${data.bbox.x_max?.toFixed(3)}, ${data.bbox.y_max?.toFixed(3)}]`,
    );
  }
  return parts.join("\n") || JSON.stringify(data);
}

// --- Tool Schema ---
const ImageReadSchema = Type.Object({
  image_path: Type.String({
    description:
      "Path to the image file to analyze (jpg, jpeg, png, webp, gif, bmp)",
  }),
  mode: Type.String({
    description:
      'Moondream operation: "query" (VQA), "detect" (object detection), "point" (center coords), "caption" (describe), "segment" (SVG mask)',
    default: "caption",
  }),
  question: Type.Optional(
    Type.String({
      description: "Question to ask about the image (for mode=query)",
    }),
  ),
  object: Type.Optional(
    Type.String({
      description: "Object to detect/point/segment (for mode=detect/point/segment)",
    }),
  ),
  length: Type.Optional(
    Type.String({
      description: 'Caption length: "short", "normal", or "long" (for mode=caption)',
      default: "normal",
    }),
  ),
});

// --- Extension ---
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "image_read",
    label: "Image Read",
    description:
      "Analyze an image using Moondream: ask questions, detect objects, find points, generate captions, or segment objects. Supports jpg, png, webp, gif, bmp.",
    promptSnippet: "Ask questions or analyze images with Moondream vision",
    promptGuidelines: [
      "Use image_read with mode=caption to describe what's in an image.",
      "Use image_read with mode=query to ask specific questions about image content.",
      "Use image_read with mode=detect to locate objects with bounding boxes.",
      "Use image_read with mode=point to get center coordinates of objects.",
      "Use image_read with mode=segment to get SVG path masks for objects.",
    ],
    parameters: ImageReadSchema,

    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      // Get API key
      const apiKey = await getApiKey(ctx);
      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: "Moondream API key not found. Set MOONDREAM_API_KEY environment variable or register it via pi's credential system under provider 'moondream'.",
            },
          ],
          isError: true,
        };
      }

      // Read and encode image
      let imageUrl: string;
      try {
        imageUrl = imageToDataUrl(params.image_path, ctx.cwd);
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading image: ${err.message}` }],
          isError: true,
        };
      }

      // Build request based on mode
      const mode = params.mode ?? "caption";
      let endpoint: string;
      let body: Record<string, unknown>;

      switch (mode) {
        case "query": {
          if (!params.question) {
            return {
              content: [
                { type: "text", text: "question is required for mode=query" },
              ],
              isError: true,
            };
          }
          endpoint = "query";
          body = { image_url: imageUrl, question: params.question };
          break;
        }
        case "detect": {
          if (!params.object) {
            return {
              content: [
                { type: "text", text: "object is required for mode=detect" },
              ],
              isError: true,
            };
          }
          endpoint = "detect";
          body = { image_url: imageUrl, object: params.object };
          break;
        }
        case "point": {
          if (!params.object) {
            return {
              content: [
                { type: "text", text: "object is required for mode=point" },
              ],
              isError: true,
            };
          }
          endpoint = "point";
          body = { image_url: imageUrl, object: params.object };
          break;
        }
        case "caption": {
          endpoint = "caption";
          body = {
            image_url: imageUrl,
            length: params.length ?? "normal",
            stream: false,
          };
          break;
        }
        case "segment": {
          if (!params.object) {
            return {
              content: [
                { type: "text", text: "object is required for mode=segment" },
              ],
              isError: true,
            };
          }
          endpoint = "segment";
          body = { image_url: imageUrl, object: params.object };
          break;
        }
        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown mode: ${mode}. Valid modes: query, detect, point, caption, segment`,
              },
            ],
            isError: true,
          };
      }

      // Call API
      let data: any;
      try {
        data = await callMoondream(endpoint, body, apiKey, signal);
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Moondream API error: ${err.message}`,
            },
          ],
          isError: true,
          details: { endpoint, mode },
        };
      }

      // Format result
      let result: string;
      switch (mode) {
        case "query":
          result = formatQueryResult(data);
          break;
        case "detect":
          result = formatDetectResult(data);
          break;
        case "point":
          result = formatPointResult(data);
          break;
        case "caption":
          result = formatCaptionResult(data);
          break;
        case "segment":
          result = formatSegmentResult(data);
          break;
        default:
          result = JSON.stringify(data, null, 2);
      }

      return {
        content: [{ type: "text", text: result }],
        details: {
          mode,
          endpoint,
          path: params.image_path,
          ...data,
        },
      };
    },
  });
}

/**
 * Moondream Image Read Extension
 *
 * Provides an `image_read` tool using the official Moondream Node.js
 * client for visual question answering, object detection, pointing,
 * captioning, and segmentation.
 *
 * Set MOONDREAM_API_KEY in your environment or register it
 * via pi's credential system under the "moondream" provider.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  vl,
  type CaptionOutput,
  type QueryOutput,
  type DetectOutput,
  type PointOutput,
  type SegmentOutput,
} from "moondream";
import fs from "node:fs";
import path from "node:path";

// --- Helpers ---

function readImage(imagePath: string, cwd: string): Buffer {
  const resolved = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(cwd, imagePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Image not found: ${resolved}`);
  }

  return fs.readFileSync(resolved);
}

async function getApiKey(
  ctx: ExtensionContext,
): Promise<string | undefined> {
  try {
    const key = await ctx.modelRegistry.getApiKeyForProvider("moondream");
    if (key) return key;
  } catch {
    // Fall through to env var
  }
  return process.env.MOONDREAM_API_KEY;
}

function formatCaption(data: CaptionOutput): string {
  if (typeof data.caption === "string") return data.caption;
  return JSON.stringify(data);
}

function formatQuery(data: QueryOutput): string {
  const parts: string[] = [];
  if (typeof data.answer === "string") {
    parts.push(data.answer);
  } else {
    parts.push(JSON.stringify(data.answer));
  }
  if (data.reasoning) {
    parts.push(`\n--- Reasoning ---\n${data.reasoning.text}`);
  }
  return parts.join("\n");
}

function formatDetect(data: DetectOutput): string {
  if (data.objects.length === 0) return "No objects detected.";
  return data.objects
    .map(
      (obj, i) =>
        `${i + 1}. bbox=[${obj.x_min.toFixed(3)}, ${obj.y_min.toFixed(3)}, ${obj.x_max.toFixed(3)}, ${obj.y_max.toFixed(3)}]`,
    )
    .join("\n");
}

function formatPoint(data: PointOutput): string {
  if (data.points.length === 0) return "No points found.";
  return data.points
    .map((p, i) => `${i + 1}. (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`)
    .join("\n");
}

function formatSegment(data: SegmentOutput): string {
  const parts: string[] = [];
  if (data.path) {
    parts.push(`SVG Path: \`${data.path}\``);
  }
  if (data.bbox) {
    parts.push(
      `BBox: [${data.bbox.x_min.toFixed(3)}, ${data.bbox.y_min.toFixed(3)}, ${data.bbox.x_max.toFixed(3)}, ${data.bbox.y_max.toFixed(3)}]`,
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
      description:
        "Object to detect/point/segment (for mode=detect/point/segment)",
    }),
  ),
  length: Type.Optional(
    Type.String({
      description:
        'Caption length: "short", "normal", or "long" (for mode=caption)',
      default: "normal",
    }),
  ),
  reasoning: Type.Optional(
    Type.Boolean({
      description:
        "Enable reasoning for more accurate answers at the cost of latency (for mode=query)",
      default: false,
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
      "Use image_read with mode=query to ask specific questions about image content. Enable reasoning=true for complex or nuanced questions.",
      "Use image_read with mode=detect to locate objects with bounding boxes.",
      "Use image_read with mode=point to get center coordinates of objects.",
      "Use image_read with mode=segment to get SVG path masks for objects.",
    ],
    parameters: ImageReadSchema,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

      // Initialize client
      const model = new vl({ apiKey });

      // Read image
      let image: Buffer;
      try {
        image = readImage(params.image_path, ctx.cwd);
      } catch (err: any) {
        return {
          content: [
            { type: "text", text: `Error reading image: ${err.message}` },
          ],
          isError: true,
        };
      }

      // Dispatch by mode
      const mode = params.mode ?? "caption";

      try {
        switch (mode) {
          case "caption": {
            const result = await model.caption({
              image,
              length: (params.length as "short" | "normal" | "long") ?? "normal",
            });
            return {
              content: [{ type: "text", text: formatCaption(result) }],
              details: { mode, path: params.image_path, length: params.length },
            };
          }

          case "query": {
            if (!params.question) {
              return {
                content: [
                  { type: "text", text: "question is required for mode=query" },
                ],
                isError: true,
              };
            }
            const result = await model.query({
              image,
              question: params.question,
              reasoning: params.reasoning ?? false,
            });
            return {
              content: [{ type: "text", text: formatQuery(result) }],
              details: {
                mode,
                path: params.image_path,
                question: params.question,
                reasoning: params.reasoning ?? false,
              },
            };
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
            const result = await model.detect({
              image,
              object: params.object,
            });
            return {
              content: [{ type: "text", text: formatDetect(result) }],
              details: {
                mode,
                path: params.image_path,
                object: params.object,
                count: result.objects.length,
              },
            };
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
            const result = await model.point({
              image,
              object: params.object,
            });
            return {
              content: [{ type: "text", text: formatPoint(result) }],
              details: {
                mode,
                path: params.image_path,
                object: params.object,
                count: result.points.length,
              },
            };
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
            const result = (await model.segment({
              image,
              object: params.object,
            })) as SegmentOutput;
            return {
              content: [{ type: "text", text: formatSegment(result) }],
              details: {
                mode,
                path: params.image_path,
                object: params.object,
              },
            };
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
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Moondream API error: ${err.message}`,
            },
          ],
          isError: true,
          details: { mode, path: params.image_path },
        };
      }
    },
  });
}

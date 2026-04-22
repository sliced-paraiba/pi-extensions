import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import TurndownService from "turndown";
import { parseHTML } from "linkedom";

const DEFAULT_SEARX_URL = "http://127.0.0.1:8081/search";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.remove(["script", "style", "noscript", "iframe"]);
turndown.addRule("stripEmptyLinks", {
  filter: (node: any) => node.nodeName === "A" && !node.textContent?.trim(),
  replacement: () => "",
});

function selectMain(document: any) {
  return (
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.querySelector("[role='main']") ||
    document.body ||
    document.documentElement
  );
}

function htmlToMarkdown(html: string): string {
  const { document } = parseHTML(html);
  const main = selectMain(document);
  return turndown.turndown(main);
}

function truncate(text: string, max = 8000): string {
  if (text.length <= max) return text;
  return text.substring(0, max) + `\n\n[Truncated at ${max} chars]`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via a local SearXNG instance. Returns URLs, titles, and snippets.",
    promptSnippet: "Search the web via SearXNG",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 5)", default: 5 })
      ),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const searxUrl = process.env.SEARX_URL ?? DEFAULT_SEARX_URL;
      const limit = params.limit ?? 5;

      const searchParams = new URLSearchParams({
        q: params.query,
        format: "json",
      });
      const url = `${searxUrl}?${searchParams.toString()}`;

      const resp = await fetch(url, { signal });
      if (!resp.ok) throw new Error(`SearXNG returned HTTP ${resp.status}`);
      const data: any = await resp.json();

      const results: Array<{ url: string; title: string; content?: string }> =
        (data.results || [])
          .slice(0, limit)
          .map((item: any) => ({
            url: item.url,
            title: item.title,
            content: item.content,
          }));

      const output = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   ${r.url}${r.content ? `\n   ${r.content}` : ""}`
        )
        .join("\n\n");

      return {
        content: [{ type: "text", text: output || "No results found." }],
        details: { query: params.query, resultCount: results.length },
      };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and convert its content to markdown. Useful for reading web pages found via web_search.",
    promptSnippet: "Fetch a URL and return it as markdown",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch" }),
      max_length: Type.Optional(
        Type.Number({
          description: "Max characters to return (default 8000)",
          default: 8000,
        })
      ),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      try {
        const resp = await fetch(params.url, {
          signal,
          redirect: "follow",
        });
        if (!resp.ok) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to fetch: HTTP ${resp.status} ${resp.statusText}`,
              },
            ],
            isError: true,
            details: { url: params.url, status: resp.status },
          };
        }

        const html = await resp.text();
        const md = htmlToMarkdown(html);
        const text = truncate(md.trim(), params.max_length ?? 8000);

        return {
          content: [{ type: "text", text }],
          details: { url: params.url, length: text.length },
        };
      } catch (err: any) {
        if (err.name === "AbortError") throw err;
        return {
          content: [
            { type: "text", text: `Failed to fetch: ${err.message}` },
          ],
          isError: true,
          details: { url: params.url, error: err.message },
        };
      }
    },
  });
}

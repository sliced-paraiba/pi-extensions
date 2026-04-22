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
      "Search the web via a local SearXNG instance. Returns URLs, titles, and snippets. " +
      "Optionally fetches result pages and converts them to markdown for full content.",
    promptSnippet: "Search the web and optionally fetch page content via SearXNG",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 5)", default: 5 })),
      fetch: Type.Optional(Type.Boolean({ description: "Fetch and convert top results to markdown (default false)", default: false })),
      fetch_limit: Type.Optional(Type.Number({ description: "How many results to fetch when fetch=true (default 2)", default: 2 })),
    }),
    async execute(_id, params, signal, _onUpdate, _ctx) {
      const searxUrl = process.env.SEARX_URL ?? DEFAULT_SEARX_URL;
      const limit = params.limit ?? 5;
      const shouldFetch = params.fetch ?? false;
      const fetchLimit = params.fetch_limit ?? 2;

      const searchParams = new URLSearchParams({ q: params.query, format: "json" });
      const url = `${searxUrl}?${searchParams.toString()}`;

      const resp = await fetch(url, { signal });
      if (!resp.ok) throw new Error(`SearXNG returned HTTP ${resp.status}`);
      const data: any = await resp.json();

      const results: Array<{
        url: string;
        title: string;
        content?: string;
        markdown?: string;
      }> = (data.results || [])
        .slice(0, limit)
        .map((item: any) => ({
          url: item.url,
          title: item.title,
          content: item.content,
        }));

      if (shouldFetch && results.length > 0) {
        const targets = results.slice(0, fetchLimit);
        for (const item of targets) {
          try {
            const pageResp = await fetch(item.url, {
              signal,
              redirect: "follow",
            });
            if (!pageResp.ok) {
              item.markdown = `Failed to fetch: HTTP ${pageResp.status}`;
              continue;
            }
            const html = await pageResp.text();
            const md = htmlToMarkdown(html);
            item.markdown = truncate(md.trim());
          } catch (err: any) {
            if (err.name === "AbortError") throw err;
            item.markdown = `Failed to fetch: ${err.message}`;
          }
        }
      }

      const output = results
        .map((r, i) => {
          let line = `${i + 1}. **${r.title}**\n   ${r.url}`;
          if (r.content && !r.markdown) line += `\n   ${r.content}`;
          if (r.markdown) line += `\n\n${r.markdown}`;
          return line;
        })
        .join("\n\n");

      return {
        content: [{ type: "text", text: output || "No results found." }],
        details: { query: params.query, resultCount: results.length },
      };
    },
  });
}

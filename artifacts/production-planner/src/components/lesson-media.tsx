/**
 * Shared lesson media renderers — the meeting deck and the weekly lesson
 * review module render the same markdown blocks and YouTube embeds, so
 * they live here rather than inside the (large) meeting page module.
 */
import type React from "react";
import { Play } from "lucide-react";
import { youtubeIdFromUrl, youtubeEmbedSrc, currentOrigin } from "@/lib/youtube-embed";

function renderInlineMd(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>,
  );
}

export function MarkdownBlock({ content }: { content: string }) {
  const blocks = content.split(/\n\n+/);
  return (
    <div className="space-y-4 text-lg leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        if (lines.every(l => l.startsWith("- "))) {
          return (
            <ul key={bi} className="list-disc list-inside space-y-1.5 pl-2">
              {lines.map((l, li) => <li key={li}>{renderInlineMd(l.slice(2))}</li>)}
            </ul>
          );
        }
        if (lines.length >= 2 && lines[0].startsWith("|") && lines[1].includes("---")) {
          const headerCells = lines[0].split("|").map(s => s.trim()).filter(Boolean);
          const rows = lines.slice(2).map(r => r.split("|").map(s => s.trim()).filter(Boolean));
          return (
            <table key={bi} className="w-full text-base border border-border rounded-lg overflow-hidden">
              <thead className="bg-secondary/40"><tr>{headerCells.map((h, hi) => <th key={hi} className="px-3 py-2 text-left font-semibold">{renderInlineMd(h)}</th>)}</tr></thead>
              <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-border">{r.map((c, ci) => <td key={ci} className="px-3 py-2">{renderInlineMd(c)}</td>)}</tr>)}</tbody>
            </table>
          );
        }
        return <p key={bi}>{renderInlineMd(block)}</p>;
      })}
    </div>
  );
}

export function YouTubeEmbed({ url }: { url: string }) {
  const id = youtubeIdFromUrl(url);
  if (!id) {
    return (
      <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
        <Play className="w-4 h-4" /> Open video in new tab
      </a>
    );
  }
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: "16 / 9" }}>
      <iframe
        src={youtubeEmbedSrc(id, currentOrigin())}
        title="Video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="w-full h-full border-0"
      />
    </div>
  );
}

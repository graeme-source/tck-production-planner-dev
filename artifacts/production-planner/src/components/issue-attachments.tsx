// Attachment strip for an issue in the Issue Log: photos, screenshots and
// short clips people attach when reporting (Graeme, 2026-08-28).
//
// Self-contained on purpose — pages/reports.tsx is frozen by the charter, so
// all logic lives here and the page contributes exactly one mounting line.
// Renders nothing at all for issues without attachments, which keeps the
// (very common) bare rows clean and costs one metadata fetch per issue row.

import { useQuery } from "@tanstack/react-query";
import { Camera, Film } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AttachmentMeta = { id: number; kind: "image" | "video"; mime: string; fileName: string | null };

export function IssueAttachments({ issueId }: { issueId: number }) {
  const { data } = useQuery<AttachmentMeta[]>({
    queryKey: ["andon-attachments", issueId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/andon/${issueId}/attachments`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {data.map((a) =>
        a.kind === "image" ? (
          <a
            key={a.id}
            href={`${BASE}/api/andon/attachments/${a.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="block w-16 h-16 rounded-lg overflow-hidden border border-border hover:ring-2 hover:ring-primary/40"
            title={a.fileName ?? "Photo"}
          >
            <img
              src={`${BASE}/api/andon/attachments/${a.id}/file`}
              alt={a.fileName ?? "Issue photo"}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={a.id}
            href={`${BASE}/api/andon/attachments/${a.id}/file`}
            target="_blank"
            rel="noreferrer"
            className="w-16 h-16 rounded-lg border border-border bg-secondary flex flex-col items-center justify-center gap-1 text-muted-foreground hover:ring-2 hover:ring-primary/40"
            title={a.fileName ?? "Video"}
          >
            <Film className="w-5 h-5" />
            <span className="text-[10px] font-semibold">video</span>
          </a>
        )
      )}
      <span className="sr-only"><Camera className="w-3 h-3" />{data.length} attachments</span>
    </div>
  );
}

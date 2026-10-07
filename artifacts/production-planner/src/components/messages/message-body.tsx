/** A message body with its @mentions shown as chips (stored as <@id>). */
import { splitMentions } from "@workspace/messages";
import { cn } from "@/lib/utils";

export function MessageBody({ body, nameOf, onDark, className }: {
  body: string;
  nameOf: (id: number) => string | undefined;
  /** Inside my own (green) bubble — chips go light-on-green. */
  onDark?: boolean;
  className?: string;
}) {
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {splitMentions(body).map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span
            key={i}
            className={cn(
              "inline-flex items-center rounded-md px-1.5 mx-0.5 font-semibold",
              onDark ? "bg-white/25 text-white" : "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
            )}
          >
            @{nameOf(seg.userId) ?? "someone"}
          </span>
        ),
      )}
    </p>
  );
}

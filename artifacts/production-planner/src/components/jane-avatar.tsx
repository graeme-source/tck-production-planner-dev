/**
 * AI Jane's avatar — the app assistant is named after Jane, who answers
 * everyone's questions on the floor, while she's on maternity leave (Graeme,
 * 28 Oct 2026). A friendly face with her blonde ponytail. Drop-in for a
 * lucide icon (same component type, so it fits any `icon:` slot): size it
 * with className (w-/h-).
 */
import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

export const JaneAvatar = forwardRef<SVGSVGElement, Omit<LucideProps, "ref">>(function JaneAvatar({ className }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 64 64" className={className} role="img" aria-label="AI Jane" xmlns="http://www.w3.org/2000/svg">
      {/* Background disc so it reads on any colour */}
      <circle cx="32" cy="32" r="32" fill="#FDF3E3" />
      {/* Ponytail, swinging out behind the head on the right */}
      <path d="M44 20c9 1 14 9 13 19-1 7-5 12-9 14 2-5 2-10 0-15-1-4-3-7-6-9z" fill="#E9C46A" />
      <path d="M48 26c4 3 6 8 5 14" stroke="#C9973A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* Hair tie */}
      <rect x="40.5" y="17.5" width="6" height="5" rx="2" transform="rotate(25 43.5 20)" fill="#EC4899" />
      {/* Neck and shoulders */}
      <path d="M14 64c1-10 8-15 18-15s17 5 18 15z" fill="#7CB342" />
      <rect x="28" y="42" width="8" height="9" rx="3" fill="#F2C9A8" />
      {/* Face */}
      <ellipse cx="32" cy="32" rx="13" ry="14.5" fill="#F7D6BC" />
      {/* Hair pulled back, with a soft side-swept fringe */}
      <path d="M18.5 31c-1-11 6-19 14-19s14.5 6 14 17c-3-5-7-8-12-9-4 3-10 5-16 11z" fill="#E9C46A" />
      <path d="M24 19c3-3 8-4 12-3" stroke="#C9973A" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* Eyes */}
      <circle cx="27" cy="33" r="1.7" fill="#3B2F2F" />
      <circle cx="37" cy="33" r="1.7" fill="#3B2F2F" />
      {/* Cheeks */}
      <circle cx="24" cy="38" r="2.2" fill="#F4A3A3" opacity="0.7" />
      <circle cx="40" cy="38" r="2.2" fill="#F4A3A3" opacity="0.7" />
      {/* Smile */}
      <path d="M28 39.5c2 2.2 6 2.2 8 0" stroke="#9B4A3C" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
});

import { useState } from "react";
import { cn } from "@/lib/utils";

const AVATAR_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-fuchsia-500",
  "bg-pink-500",
  "bg-rose-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface UserAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeClasses = {
  sm: "w-7 h-7 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-14 h-14 text-lg",
  xl: "w-20 h-20 text-2xl",
};

export function UserAvatar({ name, avatarUrl, size = "md", className }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const initial = name?.[0]?.toUpperCase() ?? "?";
  const colorClass = getAvatarColor(name ?? "");
  const sizeClass = sizeClasses[size];

  if (avatarUrl && !imgError) {
    const src = avatarUrl.startsWith("/objects/")
      ? `/api/storage${avatarUrl}`
      : avatarUrl;

    return (
      <img
        src={src}
        alt={name}
        className={cn("rounded-full object-cover flex-shrink-0", sizeClass, className)}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0",
        colorClass,
        sizeClass,
        className
      )}
    >
      {initial}
    </div>
  );
}

import { useAuth } from "@/contexts/auth-context";
import { UserAvatar } from "@/components/user-avatar";

/**
 * Prominent "who is signed in" pill for the top bars — solid brand green,
 * big bold first name, always visible on shared devices so a report or
 * checklist tick is never silently filed under the wrong person.
 *
 * Tapping it locks the station: the PIN overlay that appears doubles as the
 * quick user-switcher ("Sign in as a different user"), so noticing you're on
 * someone else's login and fixing it is one tap + a PIN.
 */
export function CurrentUserBadge() {
  const { state, lockStation } = useAuth();
  if (state.status !== "authenticated") return null;
  const user = state.user;
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <button
      onClick={() => lockStation()}
      title={`Signed in as ${user.name} — tap to lock / switch user`}
      className="flex items-center gap-2 pl-1.5 pr-3.5 py-1 rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors active:scale-[0.97] flex-shrink-0 max-w-[180px]"
    >
      <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
      <span className="font-display font-bold text-lg leading-none truncate">{firstName}</span>
    </button>
  );
}

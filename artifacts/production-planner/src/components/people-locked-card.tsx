import { Link } from "wouter";
import { KeyRound } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import type { PeopleLockedError } from "@/hooks/use-people-gate";

/** What to show when the server says the People lock is shut. The button is
 *  a deliberate tap — never an effect — so it can't loop the prompt. */
export function PeopleLockedCard({ error }: { error: PeopleLockedError }) {
  const { requireSensitivePin } = useAuth();
  return (
    <div className="max-w-lg mx-auto text-center py-12 space-y-4">
      <KeyRound className="w-8 h-8 mx-auto text-primary" />
      <p className="text-2xl font-bold">{error.status === 428 ? "Set your private PIN to open People" : "People is locked"}</p>
      <p className="text-base text-muted-foreground">
        {error.status === 428 ? "People needs your own private PIN before anything opens." : "Enter your private People PIN to carry on."}
      </p>
      {error.status === 428 ? (
        <Link href="/account/people-pin" className="inline-flex items-center justify-center h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold">
          Set my private PIN
        </Link>
      ) : (
        <button
          onClick={() => requireSensitivePin({ includeAdmins: true, fresh: true, scope: "people" })}
          className="h-14 px-6 rounded-2xl bg-primary text-primary-foreground text-lg font-bold"
        >
          Unlock People
        </button>
      )}
    </div>
  );
}


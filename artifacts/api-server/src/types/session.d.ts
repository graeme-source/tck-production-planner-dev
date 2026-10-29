import "express-session";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userRole?: "admin" | "manager" | "viewer";
    pinVerifiedAt?: string;
    /** People section unlocked with the private PIN — sliding window
     *  (lib/people-unlock.ts). Only consulted for users with a private PIN. */
    peopleUnlockedAt?: string;
    /** A PIN (or password) typed recently — opens your OWN HR records in the
     *  Employee Hub, sliding window (lib/hub-unlock.ts). */
    hubUnlockedAt?: string;
  }
}

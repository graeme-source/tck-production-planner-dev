/**
 * "Are you sure?" before anything is marked posted (Graeme, 17 Nov 2026: he
 * marked a Shell receipt posted while trying to save its note, then
 * couldn't find it). One extra tap, every place that marks posted.
 */
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ConfirmPostedDialog({ open, onOpenChange, what, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What's being marked, e.g. "Shell Milton Keynes South · £151.60". */
  what: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[92dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure this is posted?</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            <span className="font-semibold text-foreground">{what}</span>
            <br />
            Only mark it once it's posted in QuickBooks. It then leaves the Inbox and moves to Completed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-[48px]">No, go back</AlertDialogCancel>
          <AlertDialogAction className="min-h-[48px]" onClick={onConfirm}>Yes, it's posted</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

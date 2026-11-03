// Supplier card Edit/Delete buttons (issue #356). They used to fade in only
// on mouse hover, which left them invisible on the iPads — touch has no
// hover. Keep them always visible and at least 44px so a finger can hit them;
// on desktop they stay subtle (muted colour) rather than hidden.
export const SUPPLIER_CARD_ACTIONS_ROW = "flex gap-1";

const TOUCH_TARGET = "min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors text-muted-foreground";

export const SUPPLIER_CARD_EDIT_BUTTON = `${TOUCH_TARGET} hover:text-foreground hover:bg-secondary/50`;
export const SUPPLIER_CARD_DELETE_BUTTON = `${TOUCH_TARGET} hover:text-destructive hover:bg-destructive/10`;

// The Finance Inbox (Graeme, 17 Nov 2026): every invoice uploaded but not
// yet marked posted in QuickBooks. A zip is history (the 3–4 Nov import of
// years of invoices), so its files go to the library only.

/** Does an uploaded file wait in the Inbox? `path` is where it came from —
 *  the page unzips before sending, so a zip's files arrive as "x.zip/…". */
export function goesToInbox(path: string, sentAsZip: boolean): boolean {
  return !sentAsZip && !/\.zip\//i.test(path);
}

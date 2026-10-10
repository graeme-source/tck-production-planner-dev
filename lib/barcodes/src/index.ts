/**
 * Barcodes — the pure rules shared by the API server and the browser:
 * GTIN validation, which variants are linked to which recipe, setting a
 * barcode (who else has it — move with confirmation), product identity
 * (one code = one product at scan time), comparing with Shopify (read-only), and the
 * packing scanner's match. No database, no network.
 */
export * from "./gtin";
export * from "./links";
export * from "./set";
export * from "./identity";
export * from "./copies";
export * from "./reconcile";
export * from "./scan";

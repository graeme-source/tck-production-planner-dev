/**
 * Guard between the two writers of the lean curriculum tables.
 *
 * The boot seeder (seed-lean-lessons.ts) owns lean_principles/lean_examples
 * on a FRESH install only. Once a curriculum has been installed by a library
 * script (scripts/rebuild-lean-library.ts or a successor), that script owns
 * the tables and the seeder must stand down: before this guard existed,
 * every boot re-applied the starter curriculum's UPDATEs on top of the
 * installed library — retitling week 3, deactivating weeks 4–5 and
 * re-inserting retired principles — which is what made the morning
 * meeting's lean topic jump between unrelated subjects (Aug 2026).
 *
 * Installed libraries are recognised by the 'lean_library_version' marker
 * they stamp in app_settings, or — for installs that predate the marker —
 * by their archived principles parked at week_position >= 1000.
 *
 * Kept free of database imports so the guard is testable as pure logic.
 */
export function curriculumIsExternallyManaged(
  libraryVersionMarker: string | null | undefined,
  archivedPrincipleCount: number,
): boolean {
  return Boolean(libraryVersionMarker) || archivedPrincipleCount > 0;
}

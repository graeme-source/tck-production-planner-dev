-- The founder's handwritten signature goes onto the employer signature line
-- (Graeme, 2026-09-07). The dotted line under "Managing Director (on behalf
-- of The Calzone Kitchen)" becomes a [[founder_signature]] marker; the app
-- renders Graeme's signature image there (on screen and in print), and the
-- image itself is served only to signed-in users via the API — it is not a
-- public asset. Double-bracket syntax so the {{placeholder}} validator
-- ignores it; bodies without the marker still render as plain text.
--
-- Best-effort REPLACE: if the founder already reworded that block in the
-- template editor, nothing matches and nothing changes — the marker can be
-- typed into the editor by hand instead.
UPDATE contract_templates
SET body = REPLACE(
  body,
  E'Managing Director (on behalf of The Calzone Kitchen)\n\n.......................................................',
  E'Managing Director (on behalf of The Calzone Kitchen)\n\n[[founder_signature]]'
);

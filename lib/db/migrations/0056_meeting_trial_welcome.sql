-- Trial-shift welcome on the morning meeting's opening slide (Objective E:
-- new people feel looked after from minute one). Free text set by the
-- presenter on the setup screen ("Sam and Alex"); empty/null = the slide
-- shows nothing at all.
ALTER TABLE morning_meetings ADD COLUMN IF NOT EXISTS trial_welcome TEXT;

/**
 * How a week's video coverage reads at a glance.
 *
 * A week doesn't want a clip every day — two or three is the shape we teach
 * to. So the useful signal isn't "how many videos are there", it's "how many
 * of the days that were judged worth a clip actually have one". A week the
 * writer said needed three and that carries one is unfinished; a week that
 * wanted none and has none is complete.
 */
export interface VideoCoverage {
  /** Days the lesson writer judged worth a video. */
  wanted: number;
  /** Days that actually carry a video URL. */
  present: number;
}

export type VideoCoverageState = "complete" | "missing";

export interface VideoCoverageSummary {
  state: VideoCoverageState;
  /** Short label for the week card. */
  label: string;
}

export function describeVideoCoverage({ wanted, present }: VideoCoverage): VideoCoverageSummary {
  if (present < wanted) {
    return { state: "missing", label: `${present} of ${wanted} videos` };
  }
  if (present === 0) {
    return { state: "complete", label: "no video needed" };
  }
  return { state: "complete", label: `${present} video${present === 1 ? "" : "s"}` };
}

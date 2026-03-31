import { Lightbulb, BookOpen, Play, ExternalLink, ArrowRight, TrendingUp } from "lucide-react";
import { Link } from "wouter";

const glossaryTerms = [
  {
    term: "Kaizen",
    definition: "Continuous improvement — making small, daily changes that add up to big results over time. Everyone on the team looks for ways to do things better.",
    videoId: "rGgOsgLRPKI",
  },
  {
    term: "Gemba",
    definition: "\"The real place\" — going to where the work actually happens (the kitchen, the production line) to observe, learn, and understand problems first-hand instead of guessing from a desk.",
    videoId: "oMGH14eSjss",
  },
  {
    term: "Muda",
    definition: "Waste — any activity that uses resources but doesn't add value for the customer. The goal is to spot waste and eliminate it.",
  },
  {
    term: "5S / 3S",
    definition: "A system for organising your workspace: Sort (remove what you don't need), Set in order (a place for everything), Shine (keep it clean), Standardise, and Sustain. 3S focuses on the first three.",
    videoId: "sLnKNG5FXMM",
  },
  {
    term: "Kanban",
    definition: "A visual signalling system that controls the flow of work or materials. Think of it as a \"pull\" system — you only produce or restock when the next step needs it.",
  },
  {
    term: "Poka-Yoke",
    definition: "Mistake-proofing — designing processes so that errors are impossible or immediately obvious. A simple example: colour-coded labels that prevent mixing up ingredients.",
  },
  {
    term: "Andon",
    definition: "A signal (light, alarm, or message) that alerts the team when something goes wrong so the problem is fixed immediately, not later.",
  },
  {
    term: "Takt Time",
    definition: "The pace at which you need to produce to meet customer demand. It keeps production rhythmic and balanced — not too fast, not too slow.",
  },
  {
    term: "Value Stream",
    definition: "The complete sequence of steps — from raw ingredients to the finished product in the customer's hands. Mapping it shows you where time and effort are wasted.",
  },
  {
    term: "Standard Work",
    definition: "The current best-known way to do a task, documented clearly so everyone does it the same way. It's the baseline for improvement — you can't improve what isn't defined.",
  },
  {
    term: "Jidoka",
    definition: "\"Automation with a human touch\" — building quality checks into the process so defects are caught the moment they happen, rather than at the end.",
  },
  {
    term: "Heijunka",
    definition: "Production levelling — smoothing out the workload so you're not scrambling during peaks and idle during lulls. It creates a steady, predictable rhythm.",
  },
];

const videos = [
  {
    id: "rGgOsgLRPKI",
    title: "What is Lean? — Lean Made Simple",
    description: "A quick introduction to Lean thinking and why it matters for every team.",
  },
  {
    id: "oMGH14eSjss",
    title: "Gemba Walk — Go and See",
    description: "Learn why going to where the work happens is the most powerful thing a leader can do.",
  },
  {
    id: "sLnKNG5FXMM",
    title: "3S / 5S — Workplace Organisation",
    description: "How to organise your workspace so everything has a place and nothing is wasted.",
  },
  {
    id: "GIb8HhBEpHE",
    title: "The 8 Wastes of Lean",
    description: "Understand the eight types of waste and how to spot them in your daily work.",
  },
  {
    id: "Owf9gNPMj_k",
    title: "Standard Work — The Foundation",
    description: "Why documenting the best way to do a task is the starting point for all improvement.",
  },
  {
    id: "wfsRAZUL1CE",
    title: "Continuous Improvement Culture",
    description: "How to build a culture where everyone feels empowered to fix what bugs them.",
  },
];

export default function LeanCave() {
  return (
    <div className="space-y-10 max-w-4xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-amber-500/10 rounded-xl">
            <Lightbulb className="w-6 h-6 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold">Lean Cave</h1>
        </div>
        <p className="text-muted-foreground mt-1">
          Your daily dose of Lean thinking. Browse key concepts, watch short videos, and build the mindset that drives continuous improvement.
        </p>
      </div>

      <Link href="/reports?tab=improvements">
        <div className="bg-gradient-to-r from-primary/10 to-amber-500/10 border border-primary/20 rounded-2xl p-6 cursor-pointer hover:from-primary/15 hover:to-amber-500/15 transition-all group">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <TrendingUp className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-lg">Improvements & Struggles Report</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  View all team improvement ideas, track their progress, and take action on Kaizen submissions.
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </div>
        </div>
      </Link>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Lean Glossary</h2>
        </div>
        <div className="grid gap-3">
          {glossaryTerms.map((item) => (
            <div
              key={item.term}
              className="bg-card border border-border rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-sm">{item.term}</h3>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                    {item.definition}
                  </p>
                </div>
                {item.videoId && (
                  <a
                    href={`#video-${item.videoId}`}
                    className="shrink-0 mt-0.5 text-xs text-primary hover:underline flex items-center gap-1"
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`video-${item.videoId}`)?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    <Play className="w-3 h-3" />
                    Watch
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Play className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">Video Learning</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Short, practical videos from Lean Made Simple. Each one covers a core concept in a few minutes.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {videos.map((video) => (
            <div
              key={video.id}
              id={`video-${video.id}`}
              className="bg-card border border-border rounded-xl overflow-hidden scroll-mt-4"
            >
              <div className="aspect-video bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${video.id}`}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full"
                />
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-sm">{video.title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{video.description}</p>
                <a
                  href={`https://www.youtube.com/watch?v=${video.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open on YouTube
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

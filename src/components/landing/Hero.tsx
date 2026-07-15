"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { HeroPrompt } from "./HeroPrompt";

export function Hero() {
  function scrollToDirectory() {
    document
      .getElementById("community-quizzes")
      ?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-6">
      {/* Confetti decor — flat bordered shapes in palette colors (DESIGN.md §13) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[8%] top-[18%] size-10 rotate-12 rounded-lg border-2 border-border bg-primary" />
        <div className="absolute right-[10%] top-[22%] size-12 -rotate-6 rounded-lg border-2 border-border bg-accent" />
        <div className="absolute left-[14%] bottom-[16%] size-8 rotate-45 border-2 border-border bg-highlight" />
        <div className="absolute right-[14%] bottom-[20%] size-9 -rotate-12 rounded-full border-2 border-border bg-secondary" />
        <div className="absolute left-[46%] top-[8%] size-6 rotate-12 rounded-lg border-2 border-border bg-destructive" />
      </div>

      {/* Floating decorative cards */}
      <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 hidden lg:block -rotate-6 opacity-40">
        <MockQuizCard
          emoji="🧬"
          title="Cell Division"
          topic="Biology"
          count={12}
        />
      </div>
      <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 hidden lg:block rotate-6 opacity-40">
        <MockQuizCard
          emoji="🔢"
          title="Linear Algebra"
          topic="Math"
          count={8}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-4xl text-center">
        {/* Logo */}
        <div className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border-2 border-border bg-card text-sm font-medium text-foreground shadow-brutal-sm">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          AI-Powered Quiz Builder
        </div>

        <h1
          className="font-display font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[1.2] tracking-tight animate-fade-up"
          style={{ animationDelay: "0ms" }}
        >
          Build something{' '}
          <span className="text-primary">QuEZ</span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-up animate-fade-up-delay-1">
          QuEZ is the AI-powered quiz builder for educators, trainers, and
          curious minds. Describe your quiz in plain language — our AI builds it
          in seconds.
        </p>

        <div className="mt-10 max-w-2xl mx-auto animate-fade-up animate-fade-up-delay-2">
          <HeroPrompt />
          <button
            onClick={scrollToDirectory}
            className="mt-4 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            or browse Community Quizzes
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="mt-16 flex gap-8 justify-center animate-fade-up animate-fade-up-delay-3">
          {[
            { label: "Quizzes created", value: "2,400+" },
            { label: "Questions generated", value: "48k+" },
            { label: "Active educators", value: "1,200+" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-display font-bold text-2xl text-foreground">
                {s.value}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <button
        onClick={scrollToDirectory}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground hover:text-foreground transition-colors animate-bounce"
        aria-label="Scroll down"
      >
        <ChevronDown className="w-6 h-6" />
      </button>
    </section>
  );
}

function MockQuizCard({
  emoji,
  title,
  topic,
  count,
}: {
  emoji: string;
  title: string;
  topic: string;
  count: number;
}) {
  return (
    <div className="w-56 rounded-2xl border-2 border-border bg-card p-4 shadow-brutal">
      <div className="w-full h-20 rounded-xl bg-muted flex items-center justify-center text-3xl mb-3">
        {emoji}
      </div>
      <div className="text-xs font-bold text-accent mb-1">{topic}</div>
      <div className="font-display font-semibold text-sm text-foreground leading-tight">
        {title}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {count} questions
      </div>
    </div>
  );
}

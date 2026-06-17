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
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden dot-grid px-6">
      {/* Ambient glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent-lime/8 blur-3xl" />
        <div className="absolute top-1/3 -left-20 w-80 h-80 rounded-full bg-accent-lime/10 blur-3xl" />
        <div className="absolute top-1/3 -right-20 w-80 h-80 rounded-full bg-accent-lime/10 blur-3xl" />
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
        <div className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-border bg-card text-sm text-muted-foreground">
          <Sparkles className="w-3.5 h-3.5 text-accent-lime" />
          AI-Powered Quiz Builder
        </div>

        <h1
          className="font-[family-name:var(--font-syne)] font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[1.2] tracking-tight animate-fade-up"
          style={{ animationDelay: "0ms" }}
        >
          Build knowledge <span className="text-accent-lime">QuEZ</span>
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
              <div className="font-[family-name:var(--font-syne)] font-bold text-2xl text-foreground">
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
    <div className="w-56 rounded-2xl border border-border bg-card p-4 shadow-2xl">
      <div className="w-full h-20 rounded-xl bg-secondary flex items-center justify-center text-3xl mb-3">
        {emoji}
      </div>
      <div className="text-xs font-medium text-accent-lime mb-1">{topic}</div>
      <div className="font-[family-name:var(--font-syne)] font-semibold text-sm text-foreground leading-tight">
        {title}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {count} questions
      </div>
    </div>
  );
}

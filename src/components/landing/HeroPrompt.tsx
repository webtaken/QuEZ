"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { signIn, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp } from "lucide-react";

const EXAMPLES = [
  "10 questions on the French Revolution for high schoolers",
  "A 15-question JavaScript fundamentals quiz",
  "Quiz on the human circulatory system, 8 questions",
  "20 multiple-choice questions about World War II",
  "Beginner Spanish vocabulary, 12 questions",
  "A tricky quiz on black holes and relativity",
  "5 questions covering the basics of machine learning",
  "Trivia about the Roman Empire, 10 questions",
];

export function HeroPrompt() {
  const { data: session } = useSession();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [typed, setTyped] = useState("");

  // Animate example prompts only while the box is empty and unfocused.
  const animate = !value && !focused;

  useEffect(() => {
    if (!animate) return;
    let exampleIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const full = EXAMPLES[exampleIdx];
      if (!deleting) {
        charIdx += 1;
        setTyped(full.slice(0, charIdx));
        if (charIdx === full.length) {
          deleting = true;
          timer = setTimeout(tick, 2000); // hold the full line
          return;
        }
        timer = setTimeout(tick, 45);
      } else {
        charIdx -= 1;
        setTyped(full.slice(0, charIdx));
        if (charIdx === 0) {
          deleting = false;
          exampleIdx = (exampleIdx + 1) % EXAMPLES.length;
          timer = setTimeout(tick, 350); // pause before next line
          return;
        }
        timer = setTimeout(tick, 25);
      }
    };

    timer = setTimeout(tick, 350);
    return () => clearTimeout(timer);
  }, [animate]);

  function launch() {
    const text = value.trim();
    if (!text) return;
    const target = `/dashboard/quizzes/new?prompt=${encodeURIComponent(text)}`;
    if (session) {
      router.push(target);
    } else {
      signIn.social({ provider: "google", callbackURL: target });
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      launch();
    }
  }

  return (
    <div className="rounded-2xl border-2 border-border bg-card p-3 shadow-brutal transition-shadow text-left focus-within:border-accent focus-within:shadow-brutal-lg">
      <div className="relative">
        {animate && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-2 right-2 top-2 select-none text-base text-muted-foreground md:text-sm"
          >
            <span>Describe your quiz… </span>
            <span className="text-foreground/70">{typed}</span>
            <span className="ml-px inline-block h-[1.1em] w-px translate-y-[2px] animate-pulse bg-accent" />
          </div>
        )}
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          rows={2}
          aria-label="Describe your quiz"
          placeholder=""
          className="min-h-[60px] max-h-40 resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
        />
      </div>
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-xs text-muted-foreground">Press Enter to build</span>
        <Button
          onClick={launch}
          size="icon"
          disabled={!value.trim()}
          aria-label="Build quiz"
          className="w-10 h-10 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

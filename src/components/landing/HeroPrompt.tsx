"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import { signIn, useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowUp } from "lucide-react";

export function HeroPrompt() {
  const { data: session } = useSession();
  const router = useRouter();
  const [value, setValue] = useState("");

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
    <div className="rounded-2xl border border-border bg-card p-3 shadow-2xl transition-colors focus-within:border-accent-lime/50 text-left">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={'Describe your quiz… e.g. "10 questions on the French Revolution for high schoolers"'}
        className="min-h-[60px] max-h-40 resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-xs text-muted-foreground">Press Enter to build</span>
        <Button
          onClick={launch}
          size="icon"
          disabled={!value.trim()}
          aria-label="Build quiz"
          className="w-10 h-10 shrink-0 rounded-full bg-accent-lime text-accent-lime-foreground shadow-lg shadow-accent-lime/20 hover:bg-accent-lime/90"
        >
          <ArrowUp className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

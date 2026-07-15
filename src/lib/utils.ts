import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge about the custom neo-brutalism utilities so that
// `cn("shadow-brutal", "shadow-none")` resolves correctly. Without this,
// tailwind-merge doesn't recognize `shadow-brutal-*` as shadow utilities and
// leaves both conflicting classes in the output, letting the wrong one win.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Group the custom hard-offset shadows with Tailwind's built-in `shadow`
      // group so they conflict with each other and with `shadow-none`.
      shadow: ["shadow-brutal", "shadow-brutal-sm", "shadow-brutal-lg"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 w-fit rounded-2xl rounded-tl-sm bg-secondary">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

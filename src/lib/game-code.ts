function randomSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Room codes are not DB-unique (a finished game's code can be recycled), so
// uniqueness is checked against currently-active games via the injected
// codeExists callback rather than a DB constraint. Collisions are rare
// (1-in-900000) but retried a few times just in case.
export async function generateUniqueGameCode(
  codeExists: (code: string) => Promise<boolean>,
  maxAttempts = 10
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = randomSixDigitCode()
    if (!(await codeExists(code))) return code
  }
  throw new Error('Could not generate a unique game code')
}

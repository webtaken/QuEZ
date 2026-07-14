import { createAuthClient } from 'better-auth/react'

// baseURL omitted on purpose: better-auth defaults to the current browser
// origin, so the built JS bundle stays environment-agnostic (no NEXT_PUBLIC_
// var baked in at build time).
export const authClient = createAuthClient({})

export const { signIn, signOut, useSession } = authClient

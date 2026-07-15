import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Logo } from '@/components/marketing/Logo'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

export const metadata: Metadata = {
  title: 'Log in — QuEZ',
  description: 'Log in to QuEZ to build and share AI-powered quizzes.',
}

export default function LoginPage() {
  return (
    <main className="relative min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border-2 border-border bg-card p-8 shadow-brutal-lg">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        <h1 className="font-display font-bold text-2xl text-center text-foreground">
          Welcome back
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Log in to build and share quizzes with AI.
        </p>
        <div className="mt-8">
          <GoogleSignInButton />
        </div>
        <Link
          href="/"
          className="mt-6 inline-flex w-full items-center justify-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to home
        </Link>
      </div>
    </main>
  )
}

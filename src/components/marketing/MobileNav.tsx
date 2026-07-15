'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { NAV_LINKS } from './nav-links'

export function MobileNav({ authSlot }: { authSlot: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Open menu" />
        }
      >
        <Menu />
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle className="font-display">
            Menu
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4">
          {NAV_LINKS.map((l) => (
            <SheetClose
              key={l.href}
              render={
                <Link
                  href={l.href}
                  className="rounded-lg px-3 py-2 text-base text-foreground transition-colors hover:bg-muted"
                />
              }
            >
              {l.label}
            </SheetClose>
          ))}
        </nav>
        <div className="mt-auto border-t border-border p-4">{authSlot}</div>
      </SheetContent>
    </Sheet>
  )
}

import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { AppSidebar } from '@/components/dashboard/Sidebar'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect('/')

  const cookieStore = await cookies()
  const defaultOpen = cookieStore.get('sidebar_state')?.value !== 'false'

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b-2 border-border bg-background px-4 md:hidden">
          <SidebarTrigger className="size-9" />
          <span className="font-display font-bold text-lg text-foreground">
            <span className="text-primary">Q</span>uE<span className="inline-block -rotate-6 text-primary">Z</span>
          </span>
        </div>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

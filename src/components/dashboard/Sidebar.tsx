"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  BookOpen,
  Sparkles,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/quizzes", icon: BookOpen, label: "My Quizzes" },
  {
    href: "/dashboard/quizzes/new",
    icon: Sparkles,
    label: "Create with AI",
    accent: true,
  },
  {
    href: "/dashboard/analytics",
    icon: BarChart3,
    label: "Analytics",
    disabled: true,
  },
  {
    href: "/dashboard/settings",
    icon: Settings,
    label: "Settings",
    disabled: true,
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();

  const user = session?.user;
  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  return (
    <Sidebar collapsible="icon" className="h-svh border-r border-sidebar-border">
      {/* Logo + collapse toggle */}
      <SidebarHeader className="px-3 py-3 group-data-[collapsible=icon]:px-2">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="inline-flex items-baseline group-data-[collapsible=icon]:hidden"
          >
            <span className="font-[family-name:var(--font-syne)] font-bold text-2xl text-sidebar-foreground">
              <span className="text-[oklch(0.93_0.22_127)] text-3xl">Q</span>uE
              <span className="inline-block -rotate-6 text-[oklch(0.93_0.22_127)]">
                Z
              </span>
            </span>
          </Link>
          <SidebarTrigger className="ml-auto" />
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      {/* User */}
      <div className="flex items-center gap-3 px-4 py-3 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:justify-center">
        <Avatar className="w-9 h-9 shrink-0 group-data-[collapsible=icon]:w-7 group-data-[collapsible=icon]:h-7">
          <AvatarImage src={user?.image ?? undefined} />
          <AvatarFallback className="bg-purple-600 text-white text-sm">
            {initials ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 group-data-[collapsible=icon]:hidden">
          <p className="text-sm font-medium text-sidebar-foreground truncate">
            {user?.name}
          </p>
          <p className="text-xs text-sidebar-foreground/60 truncate">
            {user?.email}
          </p>
        </div>
      </div>

      <SidebarSeparator />

      {/* Nav */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton
                      isActive={isActive}
                      aria-disabled={item.disabled}
                      tooltip={item.label}
                      className={
                        item.disabled
                          ? "opacity-40 pointer-events-none"
                          : item.accent
                            ? "text-[oklch(0.93_0.22_127)] hover:text-[oklch(0.93_0.22_127)] hover:bg-[oklch(0.93_0.22_127/10%)] data-active:bg-[oklch(0.93_0.22_127/15%)] data-active:text-[oklch(0.93_0.22_127)]"
                            : ""
                      }
                      render={
                        item.disabled ? undefined : <Link href={item.href} />
                      }
                    >
                      <Icon />
                      <span>{item.label}</span>
                      {item.disabled && (
                        <SidebarMenuBadge>Soon</SidebarMenuBadge>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      {/* Sign out */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign Out"
              className="text-sidebar-foreground/60 hover:text-destructive hover:bg-destructive/10"
              onClick={handleSignOut}
            >
              <LogOut />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

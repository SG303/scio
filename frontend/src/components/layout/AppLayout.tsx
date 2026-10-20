import { useEffect, useRef, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  FileText,
  Settings,
  Home,
  ClipboardList,
  Layers,
  FolderOpen,
  Sparkles,
  BarChart3,
  Sun,
  Moon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/subjects', icon: FolderOpen, label: 'Subjects' },
  { to: '/documents', icon: FileText, label: 'Documents' },
  { to: '/tests', icon: ClipboardList, label: 'Tests' },
  { to: '/templates', icon: Sparkles, label: 'Templates' },
  { to: '/stats', icon: BarChart3, label: 'Stats' },
  { to: '/flashcards', icon: Layers, label: 'Flashcards' },
  { to: '/settings', icon: Settings, label: 'AI Models' },
]

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
    >
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </Button>
  )
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const mobileNavRef = useRef<HTMLDivElement>(null)

  // Keep the active destination visible in the horizontally scrollable
  // mobile nav (e.g. after a reload on "AI Models").
  useEffect(() => {
    const active = mobileNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="container mx-auto flex h-14 items-center gap-6 px-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img src="/scio_logo.png" alt="" className="h-7 w-auto" />
            <span className="text-[15px] font-semibold tracking-tight">Scio</span>
          </Link>

          <nav aria-label="Main" className="hidden flex-1 items-center gap-0.5 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'bg-secondary font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  )
                }
              >
                <item.icon className="hidden h-4 w-4 xl:block" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background lg:hidden"
      >
        <div
          ref={mobileNavRef}
          className="scrollbar-none flex overflow-x-auto px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'group flex min-w-[4.5rem] flex-1 shrink-0 flex-col items-center gap-1 rounded-md px-1 py-1 text-[11px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                      isActive ? 'bg-secondary' : 'group-hover:bg-secondary/60'
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8 pb-28 lg:pb-12">{children}</main>
    </div>
  )
}

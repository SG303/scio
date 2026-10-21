import { type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Settings,
  Home,
  ClipboardList,
  Layers,
  FolderOpen,
  Plus,
  Sun,
  Moon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * Four main areas. `match` lists the path prefixes that belong to an area,
 * so detail pages (taking a test, results, creating) keep it highlighted.
 */
const navItems = [
  { to: '/', icon: Home, label: 'Dashboard', match: ['/stats'] },
  { to: '/subjects', icon: FolderOpen, label: 'Subjects', match: ['/subjects', '/documents'] },
  { to: '/flashcards', icon: Layers, label: 'Flashcards', match: ['/flashcards'] },
  { to: '/tests', icon: ClipboardList, label: 'Tests', match: ['/tests', '/test/', '/results/', '/create'] },
]

function isItemActive(pathname: string, item: (typeof navItems)[number]) {
  if (item.to === '/' && pathname === '/') return true
  return item.match.some((prefix) => pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`))
}

const iconButtonClass = 'h-9 w-9 text-muted-foreground hover:text-foreground'

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
      className={iconButtonClass}
    >
      {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </Button>
  )
}

function NewMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9 px-2.5 sm:px-3" aria-label="Create new">
          <Plus className="h-4 w-4 sm:mr-1.5" />
          <span className="hidden sm:inline">New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem asChild>
          <Link to="/create">
            <ClipboardList className="h-4 w-4 mr-2" />
            New practice test
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/flashcards/create">
            <Layers className="h-4 w-4 mr-2" />
            New flashcard deck
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/')

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
            {navItems.map((item) => {
              const active = isItemActive(pathname, item)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'bg-secondary font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <NewMenu />
            <Button
              variant="ghost"
              size="icon"
              asChild
              className={cn(iconButtonClass, settingsActive && 'bg-secondary text-foreground')}
            >
              <Link
                to="/settings"
                aria-label="Settings"
                title="Settings"
                aria-current={settingsActive ? 'page' : undefined}
              >
                <Settings className="h-[18px] w-[18px]" />
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background lg:hidden"
      >
        <div className="grid grid-cols-4 px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]">
          {navItems.map((item) => {
            const active = isItemActive(pathname, item)
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex flex-col items-center gap-1 rounded-md px-1 py-1 text-[11px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    active ? 'bg-secondary' : 'group-hover:bg-secondary/60'
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                </span>
                {item.label}
              </Link>
            )
          })}
        </div>
      </nav>

      <main className="container mx-auto px-4 py-8 pb-28 lg:pb-12">{children}</main>
    </div>
  )
}

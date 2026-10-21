import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'

type SectionTab = { to: string; label: string }

/**
 * Sub-navigation between sibling pages of one menu section
 * (Subjects | All documents, AI models | Test templates).
 * Plain links — every tab keeps its own route.
 */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-md',
              isActive
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  )
}

export const subjectTabs: SectionTab[] = [
  { to: '/subjects', label: 'Subjects' },
  { to: '/documents', label: 'All documents' },
]

export const settingsTabs: SectionTab[] = [
  { to: '/settings', label: 'AI models' },
  { to: '/settings/templates', label: 'Test templates' },
]

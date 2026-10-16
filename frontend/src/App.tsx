import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, NavLink, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { FileText, Settings, Home, ClipboardList, Layers, FolderOpen, Sparkles, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { flushOfflineReviews } from '@/lib/offlineQueue'
import { queryKeys } from '@/lib/constants'
import Dashboard from '@/pages/Dashboard'
import Documents from '@/pages/Documents'
import CreateTest from '@/pages/CreateTest'
import TakeTest from '@/pages/TakeTest'
import Results from '@/pages/Results'
import ModelsSettings from '@/pages/ModelsSettings'
import TestTemplates from '@/pages/TestTemplates'
import TestHistory from '@/pages/TestHistory'
import Stats from '@/pages/Stats'
import FlashcardDecks from '@/pages/flashcards/FlashcardDecks'
import CreateFlashcards from '@/pages/flashcards/CreateFlashcards'
import DeckDetail from '@/pages/flashcards/DeckDetail'
import StudySession from '@/pages/flashcards/StudySession'
import SessionComplete from '@/pages/flashcards/SessionComplete'
import SubjectsPage from '@/pages/subjects/SubjectsPage'
import SubjectDetail from '@/pages/subjects/SubjectDetail'

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

function App() {
  const queryClient = useQueryClient()

  // P6.4 fix: replay offline-queued reviews app-wide, not only while a study
  // session is open — otherwise ratings queued offline are never synced when
  // connectivity returns outside a session and due counts, dashboard and
  // streak stay stale. The singleton guard in flushOfflineReviews makes this
  // coexist with the mount flush inside StudySession.
  useEffect(() => {
    const flush = async () => {
      const synced = await flushOfflineReviews()
      if (synced > 0) {
        // fresh due counts everywhere they are displayed
        queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
        queryClient.invalidateQueries({ queryKey: queryKeys.flashcardStats })
        queryClient.invalidateQueries({ queryKey: queryKeys.streak })
        queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
        // prefix-matches every queryKeys.subject(id) detail query
        queryClient.invalidateQueries({ queryKey: ['subject'] })
      }
    }
    void flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [queryClient])

  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen gradient-bg">
        {/* Header */}
        <header className="sticky top-0 z-40 glass border-b">
          <div className="container mx-auto px-4">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center gap-3">
                <img 
                  src="/scio_logo.png" 
                  alt="Scio Logo" 
                  className="h-16 w-16 object-contain"
                />
                <div>
                  <h1 className="text-lg font-bold tracking-tight">Scio</h1>
                  <p className="text-xs text-muted-foreground">Learn • Practice • Master</p>
                </div>
              </div>
              
              {/* Navigation */}
              <nav className="hidden md:flex items-center gap-1">
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </div>
          </div>
        </header>

        {/* Mobile Navigation */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t overflow-x-auto">
          <div className="flex items-center justify-around min-w-max py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 px-3 py-2 shrink-0 rounded-lg text-xs font-medium transition-all duration-200',
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground'
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-8 pb-24 md:pb-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/tests" element={<TestHistory />} />
            <Route path="/templates" element={<TestTemplates />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/create" element={<CreateTest />} />
            <Route path="/test/:testId" element={<TakeTest />} />
            <Route path="/results/:testId" element={<Results />} />
            <Route path="/settings" element={<ModelsSettings />} />
            {/* Subject Routes */}
            <Route path="/subjects" element={<SubjectsPage />} />
            <Route path="/subjects/:subjectId" element={<SubjectDetail />} />
            {/* Flashcard Routes */}
            <Route path="/flashcards" element={<FlashcardDecks />} />
            <Route path="/flashcards/create" element={<CreateFlashcards />} />
            <Route path="/flashcards/:deckId" element={<DeckDetail />} />
            <Route path="/flashcards/:deckId/study" element={<StudySession />} />
            <Route path="/flashcards/session-complete" element={<SessionComplete />} />
            {/* P3.2: catch-all for unknown URLs instead of a blank page */}
            <Route
              path="*"
              element={
                <div className="text-center py-16 space-y-3">
                  <h2 className="text-2xl font-bold">Page not found</h2>
                  <p className="text-muted-foreground">The page you are looking for does not exist.</p>
                  <Link to="/" className="text-primary underline underline-offset-4">
                    Back to Dashboard
                  </Link>
                </div>
              }
            />
          </Routes>
        </main>
        </div>
      </Router>
    </ErrorBoundary>
  )
}

export default App


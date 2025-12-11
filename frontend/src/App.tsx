import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom'
import { BookOpen, FileText, Settings, Home, ClipboardList, Layers, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import Dashboard from '@/pages/Dashboard'
import Documents from '@/pages/Documents'
import CreateTest from '@/pages/CreateTest'
import TakeTest from '@/pages/TakeTest'
import Results from '@/pages/Results'
import ModelsSettings from '@/pages/ModelsSettings'
import TestTemplates from '@/pages/TestTemplates'
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
  { to: '/flashcards', icon: Layers, label: 'Flashcards' },
  { to: '/settings', icon: Settings, label: 'AI Models' },
]

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen gradient-bg">
        {/* Header */}
        <header className="sticky top-0 z-40 glass border-b">
          <div className="container mx-auto px-4">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/25">
                  <BookOpen className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-tight">AI Practice Test</h1>
                  <p className="text-xs text-muted-foreground">Generate • Practice • Excel</p>
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
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t">
          <div className="flex items-center justify-around py-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-1 px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200',
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
            <Route path="/tests" element={<TestTemplates />} />
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
          </Routes>
        </main>
        </div>
      </Router>
    </ErrorBoundary>
  )
}

export default App


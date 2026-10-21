import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AppLayout } from '@/components/layout/AppLayout'
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
        <AppLayout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/tests" element={<TestHistory />} />
            {/* Templates are managed in Settings; old links keep working */}
            <Route path="/templates" element={<Navigate to="/settings/templates" replace />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/create" element={<CreateTest />} />
            <Route path="/test/:testId" element={<TakeTest />} />
            <Route path="/results/:testId" element={<Results />} />
            <Route path="/settings" element={<ModelsSettings />} />
            <Route path="/settings/templates" element={<TestTemplates />} />
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
        </AppLayout>
      </Router>
    </ErrorBoundary>
  )
}

export default App


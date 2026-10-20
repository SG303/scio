import { useParams, useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, XCircle, ArrowLeft, RotateCcw, Loader2, Search, AlertTriangle, Check, Layers, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/Toaster'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { testsApi, flashcardsApi } from '@/services/api'
import { cn, formatDate, formatScore, getScoreColor } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'

interface VerificationResult {
  status: 'likely_ok' | 'potential_issue'
  confidence: 'high' | 'medium' | 'low'
  analysis: string
}

export default function Results() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [verificationResults, setVerificationResults] = useState<Record<number, VerificationResult>>({})
  const [verifying, setVerifying] = useState<Record<number, boolean>>({})
  const [showFlashcardDialog, setShowFlashcardDialog] = useState(false)
  const [selectedDeckId, setSelectedDeckId] = useState<string>('new')
  const [newDeckTitle, setNewDeckTitle] = useState('')

  // Fetch existing decks for the dropdown
  const { data: existingDecks = [] } = useQuery({
    queryKey: queryKeys.flashcardDecks,
    queryFn: flashcardsApi.listDecks,
    enabled: showFlashcardDialog,
  })

  // Mutation to create flashcards from test
  const createFlashcardsMutation = useMutation({
    mutationFn: () =>
      flashcardsApi.createFromTest(parseInt(testId!), {
        deck_id: selectedDeckId !== 'new' ? parseInt(selectedDeckId) : undefined,
        deck_title: selectedDeckId === 'new' ? newDeckTitle : undefined,
        wrong_only: true,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      // P3.2: cards were added to an existing deck — its card list must be
      // fresh when the user opens it right after
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardCards(data.deck_id) })
      setShowFlashcardDialog(false)
      navigate(`/flashcards/${data.deck_id}`)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create flashcards')
    },
  })

  const handleCreateFlashcards = () => {
    if (selectedDeckId === 'new' && !newDeckTitle.trim()) return
    createFlashcardsMutation.mutate()
  }

  const handleVerify = async (questionId: number) => {
    if (verifying[questionId]) return

    setVerifying(prev => ({ ...prev, [questionId]: true }))
    try {
      const result = await testsApi.verifyQuestion(parseInt(testId!), questionId)
      setVerificationResults(prev => ({ ...prev, [questionId]: result }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verification failed')
    } finally {
      setVerifying(prev => ({ ...prev, [questionId]: false }))
    }
  }

  const { data: test, isLoading } = useQuery({
    queryKey: queryKeys.test(testId),
    queryFn: () => testsApi.get(parseInt(testId!)),
    enabled: !!testId,
    staleTime: 0, // Always fetch fresh data for results
  })

  if (isLoading) {
    return <QueryState loading />
  }

  if (!test || test.status !== 'completed') {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={SearchX}
          title="Results not available"
          action={<Button onClick={() => navigate('/')}>Go Home</Button>}
        />
      </div>
    )
  }

  const score = test.score || 0
  const correctCount = test.correct_answers || 0
  const totalQuestions = test.total_questions

  const incorrectCount = totalQuestions - correctCount

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={test.config_title || 'Practice Test'}
        description={
          test.completed_at ? `Completed ${formatDate(test.completed_at)}` : 'Test completed'
        }
        actions={
          <>
            {incorrectCount > 0 && (
              <Button variant="outline" onClick={() => setShowFlashcardDialog(true)}>
                <Layers className="h-4 w-4 mr-2" />
                Create Flashcards from Mistakes
              </Button>
            )}
            <Button asChild>
              <Link to="/create">
                <RotateCcw className="h-4 w-4 mr-2" />
                Create New Test
              </Link>
            </Button>
          </>
        }
      />

      {/* Score summary */}
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
          <div>
            <div className={cn('text-5xl font-semibold tabular-nums tracking-tight', getScoreColor(score))}>
              {score}%
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{formatScore(score)}</p>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="tabular-nums font-medium">{correctCount}</span>
                <span className="text-muted-foreground">correct</span>
              </span>
              <span className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="tabular-nums font-medium">{incorrectCount}</span>
                <span className="text-muted-foreground">incorrect</span>
              </span>
              <span className="text-muted-foreground">
                <span className="tabular-nums">{totalQuestions}</span> questions
              </span>
            </div>
            <div
              className="flex h-1.5 overflow-hidden rounded-full bg-secondary"
              role="img"
              aria-label={`${correctCount} of ${totalQuestions} correct`}
            >
              <div className="bg-success" style={{ width: `${totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0}%` }} />
              <div className="bg-destructive/70" style={{ width: `${totalQuestions > 0 ? (incorrectCount / totalQuestions) * 100 : 0}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Questions Review */}
      <section className="space-y-3">
        <SectionHeader title="Question review" meta={`${correctCount}/${totalQuestions}`} />
        <div className="space-y-4">
          {test.questions.map((question, index) => {
            const verification = verificationResults[question.id]
            return (
              <article key={question.id} className="rounded-xl border bg-card p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  {question.is_correct ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-label="Correct" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-label="Incorrect" />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      Question {index + 1} ·{' '}
                      <span className={question.is_correct ? 'text-success' : 'text-destructive'}>
                        {question.is_correct ? 'Correct' : 'Incorrect'}
                      </span>
                    </p>
                    <p className="font-medium leading-relaxed">{question.question_text}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 sm:ml-8">
                  {question.choices.map((choice) => {
                    const isCorrect = choice.index === question.correct_answer
                    const isUserAnswer = choice.index === question.user_answer

                    return (
                      <div
                        key={choice.index}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
                          isCorrect && 'border-success/40 bg-success/5',
                          isUserAnswer && !isCorrect && 'border-destructive/40 bg-destructive/5',
                          !isCorrect && !isUserAnswer && 'border-transparent text-muted-foreground'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold',
                            isCorrect ? 'bg-success text-success-foreground' :
                            isUserAnswer ? 'bg-destructive text-destructive-foreground' :
                            'border bg-background'
                          )}
                        >
                          {String.fromCharCode(65 + choice.index)}
                        </span>
                        <span className="flex-1">{choice.text}</span>
                        {(isCorrect || isUserAnswer) && (
                          <span
                            className={cn(
                              'shrink-0 text-xs font-medium',
                              isCorrect ? 'text-success' : 'text-destructive'
                            )}
                          >
                            {isUserAnswer && isCorrect
                              ? 'Your answer'
                              : isCorrect
                              ? 'Correct answer'
                              : 'Your answer'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {question.user_answer === null && (
                    <p className="text-sm italic text-muted-foreground">
                      You did not answer this question
                    </p>
                  )}
                </div>

                <div className="mt-4 space-y-3 sm:ml-8">
                  <div className="rounded-lg bg-muted/60 p-3 text-sm">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Explanation</p>
                    {question.explanation ? (
                      <p className="leading-relaxed">{question.explanation}</p>
                    ) : (
                      <p className="leading-relaxed">
                        The correct answer is <strong>{String.fromCharCode(65 + (question.correct_answer || 0))}</strong>: {question.choices.find(c => c.index === question.correct_answer)?.text}
                      </p>
                    )}
                  </div>

                  {/* AI Verification */}
                  {!verification ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 text-muted-foreground hover:text-foreground"
                      onClick={() => handleVerify(question.id)}
                      disabled={verifying[question.id]}
                    >
                      {verifying[question.id] ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          <Search className="h-3.5 w-3.5 mr-2" />
                          Verify with AI
                        </>
                      )}
                    </Button>
                  ) : (
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-lg border p-3 text-sm',
                        verification.status === 'likely_ok'
                          ? 'border-success/30 bg-success/5'
                          : 'border-warning/30 bg-warning/5'
                      )}
                    >
                      {verification.status === 'likely_ok' ? (
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      )}
                      <div>
                        <span
                          className={cn(
                            'font-medium',
                            verification.status === 'likely_ok' ? 'text-success' : 'text-warning'
                          )}
                        >
                          {verification.status === 'likely_ok'
                            ? 'AI Verification: Likely OK'
                            : 'AI Verification: Potential Issue'}
                        </span>
                        <p className="mt-1 text-muted-foreground">{verification.analysis}</p>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* Bottom Navigation */}
      <div className="flex justify-center pb-4">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>

      {/* Create Flashcards Dialog */}
      <Dialog open={showFlashcardDialog} onOpenChange={setShowFlashcardDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Flashcards from Mistakes</DialogTitle>
            <DialogDescription>
              Create flashcards from the {totalQuestions - correctCount} questions you got wrong.
              These cards will help you learn the concepts you missed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Add to deck</Label>
              <Select value={selectedDeckId} onValueChange={setSelectedDeckId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a deck" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create new deck</SelectItem>
                  {existingDecks.map((deck) => (
                    <SelectItem key={deck.id} value={String(deck.id)}>
                      {deck.title} ({deck.total_cards} cards)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedDeckId === 'new' && (
              <div className="space-y-2">
                <Label htmlFor="deck-title">New deck title</Label>
                <Input
                  id="deck-title"
                  value={newDeckTitle}
                  onChange={(e) => setNewDeckTitle(e.target.value)}
                  placeholder={`Mistakes from ${test.config_title || 'Practice Test'}`}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFlashcardDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateFlashcards}
              disabled={
                createFlashcardsMutation.isPending ||
                (selectedDeckId === 'new' && !newDeckTitle.trim())
              }
            >
              {createFlashcardsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Layers className="h-4 w-4 mr-2" />
                  Create {totalQuestions - correctCount} Flashcards
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


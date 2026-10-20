import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Flag, Loader2, Check, AlertTriangle, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { testsApi } from '@/services/api'
import { toast } from '@/components/Toaster'
import { QueryState } from '@/components/QueryState'
import { EmptyState } from '@/components/EmptyState'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'

export default function TakeTest() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  // P3.1 (M2): answers are kept locally — if a save fails, the selection
  // survives and is re-sent with the next answer or on submit
  const [localAnswers, setLocalAnswers] = useState<Record<number, number>>({})
  
  // Track if we've already attempted to start the test to prevent multiple calls
  const hasAttemptedStart = useRef(false)
  // P3.1: cap automatic start retries so a down backend can't loop forever
  const startAttempts = useRef(0)

  const { data: test, isLoading, error } = useQuery({
    queryKey: queryKeys.test(testId),
    queryFn: () => testsApi.get(parseInt(testId!)),
    enabled: !!testId,
    refetchInterval: false,
  })

  // TanStack Query v5: mutate is referentially stable — the destructured
  // function is what the start effect can depend on
  const { mutate: startTest, isPending: startPending } = useMutation({
    mutationFn: () => testsApi.start(parseInt(testId!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.test(testId) })
    },
  })

  const answerMutation = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: number; answer: number }) =>
      testsApi.submitAnswer(parseInt(testId!), questionId, answer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.test(testId) })
    },
    onError: () => {
      // M2: the answer stays selected locally and is re-sent later
      toast.error('Could not save your answer. It will be sent again automatically.')
    },
  })

  const submitMutation = useMutation({
    mutationFn: () => testsApi.submit(parseInt(testId!)),
    onSuccess: async () => {
      // Invalidate and wait for cache to clear before navigating
      await queryClient.invalidateQueries({ queryKey: queryKeys.test(testId) })
      await queryClient.invalidateQueries({ queryKey: queryKeys.tests })
      navigate(`/results/${testId}`, { replace: true })
    },
    onError: () => {
      toast.error('Could not submit the test. Please try again.')
    },
  })

  // Start test if it's generated - with proper guards against multiple calls
  useEffect(() => {
    if (
      test?.status === 'generated' &&
      !startPending &&
      !hasAttemptedStart.current
    ) {
      hasAttemptedStart.current = true
      startAttempts.current += 1
      startTest(undefined, {
        onError: (error) => {
          console.error('Failed to start test:', error)
          if (startAttempts.current < 3) {
            hasAttemptedStart.current = false // Allow retry on error
          } else {
            toast.error('Could not start the test. Please reload the page.')
          }
        }
      })
    }
  }, [test?.status, startPending, startTest])

  // P2.2: navigate away as soon as the test reads as completed — a side
  // effect, so it belongs in an effect, not in the render body. The ref
  // guard keeps StrictMode's double effect invocation from pushing the
  // same route twice.
  const testCompleted = test?.status === 'completed'
  const completedRedirected = useRef(false)
  useEffect(() => {
    if (testCompleted && !completedRedirected.current) {
      completedRedirected.current = true
      navigate(`/results/${testId}`)
    }
  }, [testCompleted, navigate, testId])

  // P4.1: keyboard shortcuts — 1-4 select an answer, Enter goes to the next
  // question (or opens submit on the last one). Active while the test is
  // in progress; re-subscribed each render for a fresh closure.
  useEffect(() => {
    if (showSubmitDialog || !test || test.status !== 'in_progress') return
    const onKey = (e: KeyboardEvent) => {
      const questions = test.questions
      const question = questions[currentQuestion]
      if (!question) return
      if (e.key >= '1' && e.key <= '4') {
        const idx = Number(e.key) - 1
        if (idx < question.choices.length && !answerMutation.isPending) {
          e.preventDefault()
          setLocalAnswers((prev) => ({ ...prev, [question.id]: idx }))
          answerMutation.mutate({ questionId: question.id, answer: idx })
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (currentQuestion < questions.length - 1) {
          setCurrentQuestion((prev) => prev + 1)
        } else {
          setShowSubmitDialog(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (isLoading) {
    return <QueryState loading />
  }

  if (error || !test) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={SearchX}
          title="Test not found"
          action={<Button onClick={() => navigate('/')}>Go Home</Button>}
        />
      </div>
    )
  }

  if (test.status === 'completed') {
    // P2.2: navigation moved into the effect above
    return null
  }

  const questions = test.questions
  const question = questions[currentQuestion]
  // M2: local answer takes precedence — it is the user's latest selection
  const answeredCount = questions.filter(
    (q) => localAnswers[q.id] !== undefined || q.user_answer !== null
  ).length
  const progress = (answeredCount / questions.length) * 100
  const currentAnswer = question ? localAnswers[question.id] ?? question.user_answer : null

  const handleAnswer = (choiceIndex: number) => {
    if (!question) return
    // M2: keep the answer locally so it survives a failed save
    setLocalAnswers((prev) => ({ ...prev, [question.id]: choiceIndex }))
    answerMutation.mutate({ questionId: question.id, answer: choiceIndex })
  }

  const handleSubmitClick = () => {
    setShowSubmitDialog(true)
  }

  const handleConfirmSubmit = async () => {
    setShowSubmitDialog(false)
    // M2: re-send answers whose save failed earlier before submitting
    const unsaved = questions.filter(
      (q) => localAnswers[q.id] !== undefined && q.user_answer !== localAnswers[q.id]
    )
    try {
      for (const q of unsaved) {
        await answerMutation.mutateAsync({ questionId: q.id, answer: localAnswers[q.id] })
      }
    } catch {
      toast.error('Some answers could not be saved. Please try submitting again.')
      return
    }
    submitMutation.mutate()
  }

  const isLastQuestion = currentQuestion === questions.length - 1

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {test.config_title || `Test #${test.id}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="tabular-nums">{answeredCount} of {questions.length}</span> answered
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={handleSubmitClick}
          disabled={submitMutation.isPending}
          aria-label="Submit Test"
        >
          {submitMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
          ) : (
            <Flag className="h-4 w-4 sm:mr-2" />
          )}
          <span className="hidden sm:inline">Submit Test</span>
        </Button>
      </div>

      {/* Progress + question navigation */}
      <div className="space-y-4">
        <Progress value={progress} className="h-1.5" aria-label="Answered questions" />
        <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
          {questions.map((q, i) => {
            const answered = localAnswers[q.id] !== undefined || q.user_answer !== null
            return (
              <button
                key={q.id}
                onClick={() => setCurrentQuestion(i)}
                aria-current={i === currentQuestion ? 'step' : undefined}
                aria-label={`Question ${i + 1}${answered ? ', answered' : ''}`}
                className={cn(
                  'h-9 w-9 rounded-md border text-sm font-medium tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  i === currentQuestion
                    ? 'border-primary bg-primary text-primary-foreground'
                    : answered
                    ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15'
                    : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                )}
              >
                {i + 1}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Question */}
      {question && (
        <div className="rounded-xl border bg-card">
          <div className="space-y-5 p-5 sm:p-6">
            <div className="space-y-2">
              <p className="text-xs font-medium tabular-nums text-muted-foreground">
                Question {currentQuestion + 1} of {questions.length}
              </p>
              <p className="text-lg font-medium leading-relaxed">{question.question_text}</p>
            </div>

            <div className="space-y-2" role="radiogroup" aria-label="Answer choices">
              {question.choices.map((choice) => {
                const selected = currentAnswer === choice.index
                return (
                  <button
                    key={choice.index}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleAnswer(choice.index)}
                    disabled={answerMutation.isPending}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors sm:p-4',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-accent/60'
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold transition-colors',
                        selected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground'
                      )}
                    >
                      {String.fromCharCode(65 + choice.index)}
                    </span>
                    <span className="flex-1 text-sm sm:text-base">{choice.text}</span>
                    {question.user_answer === choice.index && (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-label="Saved" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3 border-t px-5 py-4 sm:px-6">
            <Button
              variant="outline"
              onClick={() => setCurrentQuestion((prev) => Math.max(0, prev - 1))}
              disabled={currentQuestion === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <p className="hidden text-xs text-muted-foreground md:block">
              Press <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">1</kbd>–<kbd className="rounded border bg-muted px-1 font-mono text-[11px]">4</kbd> to answer,{' '}
              <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">Enter</kbd> for next
            </p>
            {isLastQuestion ? (
              <Button onClick={handleSubmitClick} disabled={submitMutation.isPending}>
                <Flag className="h-4 w-4 mr-2" />
                Submit Test
              </Button>
            ) : (
              <Button
                onClick={() =>
                  setCurrentQuestion((prev) => Math.min(questions.length - 1, prev + 1))
                }
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Submit Confirmation Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Submit Test?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to submit your test? You have answered {answeredCount} of {questions.length} questions.
              {answeredCount < questions.length && (
                <span className="block mt-2 text-warning font-medium">
                  Warning: You have {questions.length - answeredCount} unanswered question{questions.length - answeredCount > 1 ? 's' : ''}.
                </span>
              )}
              <span className="block mt-2">
                You cannot change your answers after submission.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)}>
              Continue Test
            </Button>
            <Button onClick={handleConfirmSubmit}>
              Submit Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


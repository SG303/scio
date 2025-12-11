import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Flag, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'

export default function TakeTest() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [currentQuestion, setCurrentQuestion] = useState(0)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  
  // Track if we've already attempted to start the test to prevent multiple calls
  const hasAttemptedStart = useRef(false)

  const { data: test, isLoading, error } = useQuery({
    queryKey: ['test', testId],
    queryFn: () => testsApi.get(parseInt(testId!)),
    enabled: !!testId,
    refetchInterval: false,
  })

  const startMutation = useMutation({
    mutationFn: () => testsApi.start(parseInt(testId!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test', testId] })
    },
  })

  const answerMutation = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: number; answer: number }) =>
      testsApi.submitAnswer(parseInt(testId!), questionId, answer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test', testId] })
    },
  })

  const submitMutation = useMutation({
    mutationFn: () => testsApi.submit(parseInt(testId!)),
    onSuccess: async () => {
      // Invalidate and wait for cache to clear before navigating
      await queryClient.invalidateQueries({ queryKey: ['test', testId] })
      await queryClient.invalidateQueries({ queryKey: ['tests'] })
      navigate(`/results/${testId}`, { replace: true })
    },
  })

  // Start test if it's generated - with proper guards against multiple calls
  useEffect(() => {
    if (
      test?.status === 'generated' && 
      !startMutation.isPending && 
      !hasAttemptedStart.current
    ) {
      hasAttemptedStart.current = true
      startMutation.mutate(undefined, {
        onError: (error) => {
          console.error('Failed to start test:', error)
          hasAttemptedStart.current = false // Allow retry on error
        }
      })
    }
  }, [test?.status, startMutation.isPending])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !test) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Test not found</h2>
        <Button onClick={() => navigate('/')}>Go Home</Button>
      </div>
    )
  }

  if (test.status === 'completed') {
    navigate(`/results/${testId}`)
    return null
  }

  const questions = test.questions
  const question = questions[currentQuestion]
  const answeredCount = questions.filter((q) => q.user_answer !== null).length
  const progress = (answeredCount / questions.length) * 100

  const handleAnswer = (choiceIndex: number) => {
    if (!question) return
    answerMutation.mutate({ questionId: question.id, answer: choiceIndex })
  }

  const handleSubmitClick = () => {
    setShowSubmitDialog(true)
  }

  const handleConfirmSubmit = () => {
    setShowSubmitDialog(false)
    submitMutation.mutate()
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{test.config_title || `Test #${test.id}`}</h1>
          <p className="text-sm text-muted-foreground">
            Question {currentQuestion + 1} of {questions.length}
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={handleSubmitClick}
          disabled={submitMutation.isPending}
        >
          {submitMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Flag className="h-4 w-4 mr-2" />
          )}
          Submit Test
        </Button>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">{answeredCount} / {questions.length} answered</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Question Navigation */}
      <div className="flex flex-wrap gap-2">
        {questions.map((q, i) => (
          <button
            key={q.id}
            onClick={() => setCurrentQuestion(i)}
            className={cn(
              'w-10 h-10 rounded-lg text-sm font-medium transition-all',
              i === currentQuestion
                ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background'
                : q.user_answer !== null
                ? 'bg-success/20 text-success border border-success/30'
                : 'bg-muted hover:bg-muted/80'
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Question Card */}
      {question && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-muted/30">
            <CardTitle className="text-lg">
              Question {question.question_number}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">
            <p className="text-lg leading-relaxed">{question.question_text}</p>

            <div className="space-y-3">
              {question.choices.map((choice) => (
                <button
                  key={choice.index}
                  onClick={() => handleAnswer(choice.index)}
                  disabled={answerMutation.isPending}
                  className={cn(
                    'w-full flex items-center gap-4 p-4 rounded-lg border text-left transition-all',
                    question.user_answer === choice.index
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'hover:bg-muted/50 hover:border-muted-foreground/30'
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-colors',
                      question.user_answer === choice.index
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {String.fromCharCode(65 + choice.index)}
                  </div>
                  <span className="flex-1">{choice.text}</span>
                  {question.user_answer === choice.index && (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  )}
                </button>
              ))}
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-4">
              <Button
                variant="outline"
                onClick={() => setCurrentQuestion((prev) => Math.max(0, prev - 1))}
                disabled={currentQuestion === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-2" />
                Previous
              </Button>
              <Button
                onClick={() =>
                  setCurrentQuestion((prev) => Math.min(questions.length - 1, prev + 1))
                }
                disabled={currentQuestion === questions.length - 1}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit Confirmation Dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Submit Test?
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to submit your test? You have answered {answeredCount} of {questions.length} questions.
              {answeredCount < questions.length && (
                <span className="block mt-2 text-destructive font-medium">
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
            <Button variant="destructive" onClick={handleConfirmSubmit}>
              Submit Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


import { useParams, useNavigate, Link } from 'react-router-dom'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trophy, CheckCircle2, XCircle, ArrowLeft, RotateCcw, Home, Loader2, Search, AlertTriangle, Check, Layers } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
import { testsApi, flashcardsApi } from '@/services/api'
import { cn, formatScore, getScoreColor } from '@/lib/utils'

export default function Results() {
  const { testId } = useParams<{ testId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [verificationResults, setVerificationResults] = useState<Record<number, any>>({})
  const [verifying, setVerifying] = useState<Record<number, boolean>>({})
  const [showFlashcardDialog, setShowFlashcardDialog] = useState(false)
  const [selectedDeckId, setSelectedDeckId] = useState<string>('new')
  const [newDeckTitle, setNewDeckTitle] = useState('')

  // Fetch existing decks for the dropdown
  const { data: existingDecks = [] } = useQuery({
    queryKey: ['flashcard-decks'],
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
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] })
      setShowFlashcardDialog(false)
      navigate(`/flashcards/${data.deck_id}`)
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
      console.error('Verification failed', error)
    } finally {
      setVerifying(prev => ({ ...prev, [questionId]: false }))
    }
  }

  const { data: test, isLoading } = useQuery({
    queryKey: ['test', testId],
    queryFn: () => testsApi.get(parseInt(testId!)),
    enabled: !!testId,
    staleTime: 0, // Always fetch fresh data for results
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-pulse text-muted-foreground">Loading results...</div>
      </div>
    )
  }

  if (!test || test.status !== 'completed') {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Results not available</h2>
        <Button onClick={() => navigate('/')}>Go Home</Button>
      </div>
    )
  }

  const score = test.score || 0
  const correctCount = test.correct_answers || 0
  const totalQuestions = test.total_questions

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Score Card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/20 via-accent/10 to-background p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-background/80 backdrop-blur mb-4">
            <Trophy className={cn('h-10 w-10', getScoreColor(score))} />
          </div>
          <h1 className="text-3xl font-bold mb-2">{test.config_title || 'Practice Test'}</h1>
          <p className="text-muted-foreground mb-6">Test Completed!</p>
          
          <div className={cn('text-6xl font-bold mb-2', getScoreColor(score))}>
            {score}%
          </div>
          <p className="text-lg text-muted-foreground mb-4">{formatScore(score)}</p>
          
          <div className="flex items-center justify-center gap-8 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <span>{correctCount} correct</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              <span>{totalQuestions - correctCount} incorrect</span>
            </div>
          </div>
        </div>
        
        <CardContent className="p-6">
          <Progress value={score} className="h-3" />
          <div className="flex justify-between mt-2 text-sm text-muted-foreground">
            <span>0%</span>
            <span>100%</span>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-4 justify-center">
        <Button variant="outline" asChild>
          <Link to="/">
            <Home className="h-4 w-4 mr-2" />
            Dashboard
          </Link>
        </Button>
        {totalQuestions - correctCount > 0 && (
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
      </div>

      {/* Questions Review */}
      <Card>
        <CardHeader>
          <CardTitle>Question Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {test.questions.map((question, index) => (
            <div
              key={question.id}
              className={cn(
                'p-6 rounded-lg border',
                question.is_correct ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'
              )}
            >
              <div className="flex items-start gap-4 mb-4">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                    question.is_correct ? 'bg-success/20' : 'bg-destructive/20'
                  )}
                >
                  {question.is_correct ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>
                <div>
                  <h4 className="font-medium mb-1">Question {index + 1}</h4>
                  <p className="text-muted-foreground">{question.question_text}</p>
                </div>
              </div>

              <div className="space-y-2 ml-12">
                {question.choices.map((choice) => {
                  const isCorrect = choice.index === question.correct_answer
                  const isUserAnswer = choice.index === question.user_answer
                  
                  return (
                    <div
                      key={choice.index}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg text-sm',
                        isCorrect && 'bg-success/10 border border-success/30',
                        isUserAnswer && !isCorrect && 'bg-destructive/10 border border-destructive/30',
                        !isCorrect && !isUserAnswer && 'bg-muted/30'
                      )}
                    >
                      <span
                        className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium',
                          isCorrect ? 'bg-success text-success-foreground' :
                          isUserAnswer ? 'bg-destructive text-destructive-foreground' :
                          'bg-muted-foreground/20'
                        )}
                      >
                        {String.fromCharCode(65 + choice.index)}
                      </span>
                      <span className="flex-1">{choice.text}</span>
                      {isCorrect && (
                        <span className="text-xs text-success font-medium">✓ Correct answer</span>
                      )}
                      {isUserAnswer && !isCorrect && (
                        <span className="text-xs text-destructive font-medium">✗ Your answer</span>
                      )}
                      {isUserAnswer && isCorrect && (
                        <span className="text-xs text-success font-medium">✓ Your answer</span>
                      )}
                    </div>
                  )
                })}
                {question.user_answer === null && (
                  <div className="text-sm text-muted-foreground italic mt-2">
                    You did not answer this question
                  </div>
                )}
              </div>

              {question.explanation ? (
                <div className="mt-4 ml-12 p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <h5 className="text-sm font-medium mb-1 text-primary">💡 Explanation</h5>
                  <p className="text-sm text-muted-foreground">{question.explanation}</p>
                </div>
              ) : (
                <div className="mt-4 ml-12 p-4 rounded-lg bg-muted/30 border">
                  <h5 className="text-sm font-medium mb-1">💡 Explanation</h5>
                  <p className="text-sm text-muted-foreground">
                    The correct answer is <strong>{String.fromCharCode(65 + (question.correct_answer || 0))}</strong>: {question.choices.find(c => c.index === question.correct_answer)?.text}
                  </p>
                </div>
              )}

              {/* AI Verification */}
              <div className="mt-4 ml-12">
                {!verificationResults[question.id] ? (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleVerify(question.id)}
                    disabled={verifying[question.id]}
                  >
                    {verifying[question.id] ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      <>
                        <Search className="h-3 w-3 mr-2" />
                        Verify with AI
                      </>
                    )}
                  </Button>
                ) : (
                  <div className={cn(
                    "p-4 rounded-lg border text-sm",
                    verificationResults[question.id].status === 'likely_ok' 
                      ? "bg-success/10 border-success/30" 
                      : "bg-amber-500/10 border-amber-500/30"
                  )}>
                    <div className="flex items-start gap-2">
                      {verificationResults[question.id].status === 'likely_ok' ? (
                        <Check className="h-4 w-4 text-success mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                      )}
                      <div>
                        <span className={cn(
                          "font-medium",
                          verificationResults[question.id].status === 'likely_ok' 
                            ? "text-success" 
                            : "text-amber-500"
                        )}>
                          {verificationResults[question.id].status === 'likely_ok' 
                            ? "AI Verification: Likely OK" 
                            : "AI Verification: Potential Issue"}
                        </span>
                        <p className="mt-1 text-muted-foreground">
                          {verificationResults[question.id].analysis}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Bottom Navigation */}
      <div className="flex justify-center pb-8">
        <Button variant="outline" onClick={() => navigate('/')}>
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


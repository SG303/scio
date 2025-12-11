import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Plus,
  Sparkles,
  ClipboardList,
  Layers,
  MoreVertical,
  Trash2,
  Loader2,
  BookOpen,
  TrendingUp,
  FileText,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { subjectsApi, testsApi, flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import type { TestConfigInSubject, FlashcardDeckInSubject } from '@/types'
import GenerateMaterialDialog from './GenerateMaterialDialog'
import AddToExistingDialog from './AddToExistingDialog'

export default function SubjectDetail() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [addToExisting, setAddToExisting] = useState<{
    type: 'test' | 'deck'
    item: TestConfigInSubject | FlashcardDeckInSubject
  } | null>(null)
  const [deletingTest, setDeletingTest] = useState<TestConfigInSubject | null>(null)
  const [deletingDeck, setDeletingDeck] = useState<FlashcardDeckInSubject | null>(null)

  const { data: subject, isLoading } = useQuery({
    queryKey: ['subject', subjectId],
    queryFn: () => subjectsApi.get(parseInt(subjectId!)),
    enabled: !!subjectId,
  })

  const deleteTestMutation = useMutation({
    mutationFn: (configId: number) => testsApi.deleteTemplate(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subject', subjectId] })
      setDeletingTest(null)
    },
  })

  const deleteDeckMutation = useMutation({
    mutationFn: (deckId: number) => flashcardsApi.deleteDeck(deckId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subject', subjectId] })
      setDeletingDeck(null)
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!subject) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Subject not found</h2>
        <Button onClick={() => navigate('/subjects')}>Go to Subjects</Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/subjects')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{subject.title}</h1>
              {subject.description && (
                <p className="text-muted-foreground">{subject.description}</p>
              )}
            </div>
          </div>
        </div>
        <Button onClick={() => setShowGenerateDialog(true)}>
          <Sparkles className="h-4 w-4 mr-2" />
          Create Learning Material
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <ClipboardList className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{subject.test_configs.length}</div>
                <div className="text-sm text-muted-foreground">Tests</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Layers className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{subject.flashcard_decks.length}</div>
                <div className="text-sm text-muted-foreground">Decks</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <div
                  className={cn(
                    'text-2xl font-bold',
                    subject.average_score !== null
                      ? subject.average_score >= 70
                        ? 'text-emerald-500'
                        : subject.average_score >= 50
                        ? 'text-amber-500'
                        : 'text-red-500'
                      : ''
                  )}
                >
                  {subject.average_score !== null ? `${Math.round(subject.average_score)}%` : '—'}
                </div>
                <div className="text-sm text-muted-foreground">Avg. Score</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <BookOpen className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {subject.total_cards > 0
                    ? `${Math.round((subject.mastered_cards / subject.total_cards) * 100)}%`
                    : '—'}
                </div>
                <div className="text-sm text-muted-foreground">Cards Mastered</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Subject Info */}
      {(subject.ai_model_name || subject.document_count > 0) && (
        <div className="flex flex-wrap gap-3">
          {subject.ai_model_name && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <span>{subject.ai_model_name}</span>
            </div>
          )}
          {subject.document_count > 0 && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span>
                {subject.document_count} document{subject.document_count !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Tests Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Practice Tests
                </CardTitle>
                <CardDescription>Tests created in this subject</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {subject.test_configs.length === 0 ? (
              <div className="text-center py-8">
                <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No tests yet</p>
                <Button variant="outline" onClick={() => setShowGenerateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Test
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {subject.test_configs.map((config) => (
                  <div
                    key={config.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{config.title}</h4>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span>{config.num_questions} questions</span>
                        {config.tests_taken > 0 && (
                          <>
                            <span>•</span>
                            <span>{config.tests_taken} taken</span>
                          </>
                        )}
                        {config.best_score !== null && (
                          <>
                            <span>•</span>
                            <span
                              className={cn(
                                'font-medium',
                                config.best_score >= 70
                                  ? 'text-emerald-500'
                                  : config.best_score >= 50
                                  ? 'text-amber-500'
                                  : 'text-red-500'
                              )}
                            >
                              Best: {config.best_score}%
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setAddToExisting({ type: 'test', item: config })}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add Questions
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingTest(config)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Flashcard Decks Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  Flashcard Decks
                </CardTitle>
                <CardDescription>Flashcard decks in this subject</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {subject.flashcard_decks.length === 0 ? (
              <div className="text-center py-8">
                <Layers className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">No decks yet</p>
                <Button variant="outline" onClick={() => setShowGenerateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Deck
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {subject.flashcard_decks.map((deck) => (
                  <div
                    key={deck.id}
                    className="flex items-center justify-between p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors"
                  >
                    <Link to={`/flashcards/${deck.id}`} className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{deck.title}</h4>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span>{deck.total_cards} cards</span>
                        {deck.due_cards > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-amber-500">{deck.due_cards} due</span>
                          </>
                        )}
                        {deck.new_cards > 0 && (
                          <>
                            <span>•</span>
                            <span className="text-blue-500">{deck.new_cards} new</span>
                          </>
                        )}
                      </div>
                    </Link>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/flashcards/${deck.id}/study`}>
                          <BookOpen className="h-4 w-4 mr-1" />
                          Study
                        </Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setAddToExisting({ type: 'deck', item: deck })}
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Add Cards
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeletingDeck(deck)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Generate Material Dialog */}
      <GenerateMaterialDialog
        open={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        subjectId={parseInt(subjectId!)}
        defaultAiModelId={subject.ai_model_id}
        defaultDocumentIds={subject.document_ids}
      />

      {/* Add to Existing Dialog */}
      {addToExisting && (
        <AddToExistingDialog
          open={true}
          onClose={() => setAddToExisting(null)}
          subjectId={parseInt(subjectId!)}
          type={addToExisting.type}
          item={addToExisting.item}
          defaultAiModelId={subject.ai_model_id}
        />
      )}

      {/* Delete Test Confirmation */}
      <Dialog open={deletingTest !== null} onOpenChange={() => setDeletingTest(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingTest?.title}"? All associated test results
              will also be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTest(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingTest && deleteTestMutation.mutate(deletingTest.id)}
              disabled={deleteTestMutation.isPending}
            >
              {deleteTestMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Deck Confirmation */}
      <Dialog open={deletingDeck !== null} onOpenChange={() => setDeletingDeck(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Deck</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingDeck?.title}"? All flashcards in this deck
              will also be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingDeck(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingDeck && deleteDeckMutation.mutate(deletingDeck.id)}
              disabled={deleteDeckMutation.isPending}
            >
              {deleteDeckMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


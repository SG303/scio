import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Plus,
  Sparkles,
  ClipboardList,
  Layers,
  Trash2,
  BookOpen,
  FileText,
  SearchX,
  ChevronDown,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListRow, ListIcon, RowActions, rowLinkClass } from '@/components/List'
import { deckIsStudiable } from '@/lib/decks'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { toast } from '@/components/Toaster'
import { subjectsApi, testsApi, flashcardsApi, documentsApi } from '@/services/api'
import { cn, getScoreColor } from '@/lib/utils'
import type { TestConfigInSubject, FlashcardDeckInSubject } from '@/types'
import AddToExistingDialog from './AddToExistingDialog'
import { queryKeys } from '@/lib/constants'
import { docTypeConfig } from '@/components/AddDocumentDialog'

export default function SubjectDetail() {
  const { subjectId } = useParams<{ subjectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [addToExisting, setAddToExisting] = useState<{
    type: 'test' | 'deck'
    item: TestConfigInSubject | FlashcardDeckInSubject
  } | null>(null)
  const [deletingTest, setDeletingTest] = useState<TestConfigInSubject | null>(null)
  const [deletingDeck, setDeletingDeck] = useState<FlashcardDeckInSubject | null>(null)

  const { data: subject, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.subject(subjectId),
    queryFn: () => subjectsApi.get(parseInt(subjectId!)),
    enabled: !!subjectId,
  })

  const { data: documents = [] } = useQuery({
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })

  const deleteTestMutation = useMutation({
    mutationFn: (configId: number) => testsApi.deleteConfig(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subject(subjectId) })
      // P3.2: the deleted tests also live in the tests and subjects lists
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
      queryClient.invalidateQueries({ queryKey: queryKeys.tests })
      setDeletingTest(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete test')
    },
  })

  const deleteDeckMutation = useMutation({
    mutationFn: (deckId: number) => flashcardsApi.deleteDeck(deckId),
    onSuccess: (_result, deckId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subject(subjectId) })
      // P3.2: deck lists and a possibly cached deck detail must refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(deckId) })
      setDeletingDeck(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete deck')
    },
  })

  if (isLoading) {
    return <QueryState loading />
  }

  // P3.3: distinguish a failed query from a subject that doesn't exist
  if (error) {
    return <QueryState error={error} onRetry={() => refetch()} />
  }

  if (!subject) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          icon={SearchX}
          title="Subject not found"
          description="This subject may have been deleted."
          action={
            <Button variant="outline" onClick={() => navigate('/subjects')}>
              Go to Subjects
            </Button>
          }
        />
      </div>
    )
  }

  // Material is created in the regular wizards with this subject pre-selected
  const createTestHref = `/create?subject=${subject.id}`
  const createDeckHref = `/flashcards/create?subject=${subject.id}`
  const defaultDocuments = documents.filter((d) => subject.document_ids?.includes(d.id))

  const kpis = [
    { label: 'Tests', value: subject.test_configs.length, className: undefined },
    { label: 'Decks', value: subject.flashcard_decks.length, className: undefined },
    {
      label: 'Avg. score',
      value: subject.average_score !== null ? `${Math.round(subject.average_score)}%` : '—',
      className: subject.average_score !== null ? getScoreColor(subject.average_score) : undefined,
    },
    {
      label: 'Cards mastered',
      value: subject.total_cards > 0
        ? `${Math.round((subject.mastered_cards / subject.total_cards) * 100)}%`
        : '—',
      className: undefined,
    },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" asChild>
          <Link to="/subjects">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Subjects
          </Link>
        </Button>
        <PageHeader
          title={<span className="break-words">{subject.title}</span>}
          description={subject.description || undefined}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create Learning Material
                  <ChevronDown className="h-4 w-4 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem asChild>
                  <Link to={createTestHref}>
                    <ClipboardList className="h-4 w-4 mr-2" />
                    Practice test
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={createDeckHref}>
                    <Layers className="h-4 w-4 mr-2" />
                    Flashcard deck
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {/* Subject defaults */}
        {subject.ai_model_name && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {subject.ai_model_name}
            </span>
          </div>
        )}
      </div>

      {/* Stats Overview */}
      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-4">
        {kpis.map((kpi, i) => (
          <div
            key={kpi.label}
            className={cn(
              'p-5',
              i % 2 === 1 && 'border-l',
              i >= 2 && 'border-t md:border-t-0',
              i === 2 && 'md:border-l'
            )}
          >
            <dt className="text-sm text-muted-foreground">{kpi.label}</dt>
            <dd className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight', kpi.className)}>
              {kpi.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Tests Section */}
        <section className="min-w-0 space-y-3">
          <SectionHeader title="Practice tests" meta={subject.test_configs.length} />
          {subject.test_configs.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No tests yet"
              action={
                <Button variant="outline" asChild>
                  <Link to={createTestHref}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Test
                  </Link>
                </Button>
              }
            />
          ) : (
            <List>
              {subject.test_configs.map((config) => (
                <ListRow key={config.id}>
                  <ListIcon>
                    <ClipboardList />
                  </ListIcon>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{config.title}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {config.num_questions} questions
                      {config.tests_taken > 0 && <> · {config.tests_taken} taken</>}
                      {config.best_score !== null && (
                        <>
                          {' · '}
                          <span className={cn('font-medium', getScoreColor(config.best_score))}>
                            Best {config.best_score}%
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <RowActions label={`Actions for ${config.title}`}>
                    <DropdownMenuItem
                      onClick={() => setAddToExisting({ type: 'test', item: config })}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Questions
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeletingTest(config)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </RowActions>
                </ListRow>
              ))}
            </List>
          )}
        </section>

        {/* Flashcard Decks Section */}
        <section className="min-w-0 space-y-3">
          <SectionHeader title="Flashcard decks" meta={subject.flashcard_decks.length} />
          {subject.flashcard_decks.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No decks yet"
              action={
                <Button variant="outline" asChild>
                  <Link to={createDeckHref}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Deck
                  </Link>
                </Button>
              }
            />
          ) : (
            <List>
              {subject.flashcard_decks.map((deck) => (
                <ListRow key={deck.id} interactive>
                  <ListIcon>
                    <Layers />
                  </ListIcon>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/flashcards/${deck.id}`}
                      className={cn('block truncate text-sm font-medium', rowLinkClass)}
                    >
                      {deck.title}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {deck.total_cards} cards
                      {deck.due_cards > 0 && (
                        <> · <span className="font-medium text-primary">{deck.due_cards} due</span></>
                      )}
                      {deck.new_cards > 0 && <> · {deck.new_cards} new</>}
                    </p>
                  </div>
                  {/* P4.3: disabled when today's quota is actually empty */}
                  {deckIsStudiable(deck) ? (
                    <Button variant="outline" size="sm" className="relative z-10 shrink-0" asChild>
                      <Link to={`/flashcards/${deck.id}/study`}>
                        <BookOpen className="h-4 w-4 sm:mr-1.5" />
                        <span className="sr-only sm:not-sr-only">Study</span>
                      </Link>
                    </Button>
                  ) : (
                    // pointer-events stay on so the click does not fall through to the row link
                    <Button
                      variant="outline"
                      size="sm"
                      className="relative z-10 shrink-0 disabled:pointer-events-auto"
                      disabled
                    >
                      <BookOpen className="h-4 w-4 sm:mr-1.5" />
                      <span className="sr-only sm:not-sr-only">Study</span>
                    </Button>
                  )}
                  <RowActions label={`Actions for ${deck.title}`}>
                    <DropdownMenuItem
                      onClick={() => setAddToExisting({ type: 'deck', item: deck })}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Cards
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeletingDeck(deck)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </RowActions>
                </ListRow>
              ))}
            </List>
          )}
        </section>
      </div>

      {/* Default documents — pre-selected when creating material here */}
      <section className="space-y-3">
        <SectionHeader
          title="Default documents"
          meta={defaultDocuments.length}
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/documents">
                All documents
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          }
        />
        {defaultDocuments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No default documents. Edit the subject to pick documents that are pre-selected
            whenever you create material for it — any other document stays available.
          </p>
        ) : (
          <List>
            {defaultDocuments.map((doc) => {
              const Icon = docTypeConfig[doc.doc_type]?.icon ?? FileText
              return (
                <ListRow key={doc.id}>
                  <ListIcon>
                    <Icon />
                  </ListIcon>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{doc.title}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {docTypeConfig[doc.doc_type]?.label ?? doc.doc_type}
                    </p>
                  </div>
                </ListRow>
              )
            })}
          </List>
        )}
      </section>

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


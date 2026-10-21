import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Layers, Trash2, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListRow, ListIcon, RowActions, rowLinkClass } from '@/components/List'
import { deckIsStudiable, deckStudyCount } from '@/lib/decks'
import { cardStates } from '@/lib/studyColors'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/Toaster'
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { queryKeys } from '@/lib/constants'

export default function FlashcardDecks() {
  const queryClient = useQueryClient()
  const [deletingDeckId, setDeletingDeckId] = useState<number | null>(null)

  const { data: decks = [], isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.flashcardDecks,
    queryFn: flashcardsApi.listDecks,
  })

  const deleteMutation = useMutation({
    mutationFn: flashcardsApi.deleteDeck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      setDeletingDeckId(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete deck')
    },
  })

  const handleDelete = () => {
    if (deletingDeckId) {
      deleteMutation.mutate(deletingDeckId)
    }
  }

  if (isLoading) {
    return <QueryState loading />
  }

  // P3.3: a failed query is an error, not an empty deck list
  if (error) {
    return <QueryState error={error} onRetry={() => refetch()} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Flashcard Decks"
        description="Create and study flashcard decks with spaced repetition."
        actions={
          <Button asChild>
            <Link to="/flashcards/create">
              <Plus className="h-4 w-4 mr-2" />
              Create Deck
            </Link>
          </Button>
        }
      />

      {decks.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No flashcard decks yet"
          description="Create your first flashcard deck to start learning with AI-powered spaced repetition."
          action={
            <Button asChild>
              <Link to="/flashcards/create">
                <Plus className="h-4 w-4 mr-2" />
                Create Your First Deck
              </Link>
            </Button>
          }
        />
      ) : (
        <section className="space-y-3">
          <SectionHeader title="Decks" meta={decks.length} />
          <List>
            {decks.map((deck) => {
              const masteryPercent = deck.total_cards > 0
                ? Math.round(((deck.total_cards - deck.new_cards) / deck.total_cards) * 100)
                : 0
              const studiable = deckIsStudiable(deck)
              const stateCounts = {
                new: deck.new_cards,
                learning: deck.learning_cards,
                review: deck.review_cards,
              }

              return (
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
                      {/* P4.3: honest count — what a fresh queue would deliver now */}
                      {studiable && (
                        <span className="font-medium text-primary sm:hidden">
                          {deckStudyCount(deck)} due ·{' '}
                        </span>
                      )}
                      {deck.total_cards} card{deck.total_cards !== 1 ? 's' : ''} · {masteryPercent}% studied
                      {deck.description && <> · {deck.description}</>}
                    </p>
                  </div>

                  {/* Card states in the shared Stats palette */}
                  <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground md:flex">
                    {cardStates.map((state) => (
                      <span key={state.key} className="flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', state.className)} aria-hidden />
                        <span className="tabular-nums text-foreground">{stateCounts[state.key]}</span>
                        {state.label.toLowerCase()}
                      </span>
                    ))}
                  </div>

                  <div className="hidden w-24 shrink-0 justify-end sm:flex">
                    {studiable ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium tabular-nums text-primary">
                        {deckStudyCount(deck)} due
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">All caught up</span>
                    )}
                  </div>

                  {studiable ? (
                    <Button size="sm" className="relative z-10 shrink-0" asChild>
                      <Link to={`/flashcards/${deck.id}/study`}>
                        Study
                      </Link>
                    </Button>
                  ) : (
                    // pointer-events stay on so the click does not fall through to the row link
                    <Button
                      size="sm"
                      variant="outline"
                      className="relative z-10 shrink-0 disabled:pointer-events-auto"
                      disabled
                    >
                      Study
                    </Button>
                  )}
                  <RowActions label={`Actions for ${deck.title}`}>
                    <DropdownMenuItem asChild>
                      <Link to={`/flashcards/${deck.id}`}>
                        <BookOpen className="h-4 w-4 mr-2" />
                        Browse Cards
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeletingDeckId(deck.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </RowActions>
                </ListRow>
              )
            })}
          </List>
        </section>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingDeckId !== null} onOpenChange={() => setDeletingDeckId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Deck</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this deck? This will permanently remove all
              flashcards and study progress. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingDeckId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

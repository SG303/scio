import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Layers, Trash2, BookOpen, Sparkles, MoreVertical } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { useState } from 'react'

export default function FlashcardDecks() {
  const queryClient = useQueryClient()
  const [deletingDeckId, setDeletingDeckId] = useState<number | null>(null)

  const { data: decks = [], isLoading } = useQuery({
    queryKey: ['flashcard-decks'],
    queryFn: flashcardsApi.listDecks,
  })

  const deleteMutation = useMutation({
    mutationFn: flashcardsApi.deleteDeck,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-decks'] })
      setDeletingDeckId(null)
    },
  })

  const handleDelete = () => {
    if (deletingDeckId) {
      deleteMutation.mutate(deletingDeckId)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Flashcard Decks</h1>
          <p className="text-muted-foreground">
            Create and study flashcard decks with spaced repetition
          </p>
        </div>
        <Button asChild>
          <Link to="/flashcards/create">
            <Plus className="h-4 w-4 mr-2" />
            Create Deck
          </Link>
        </Button>
      </div>

      {/* Decks Grid */}
      {decks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Layers className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No flashcard decks yet</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Create your first flashcard deck to start learning with AI-powered spaced repetition.
            </p>
            <Button asChild>
              <Link to="/flashcards/create">
                <Sparkles className="h-4 w-4 mr-2" />
                Create Your First Deck
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck, index) => {
            const masteryPercent = deck.total_cards > 0
              ? Math.round(((deck.total_cards - deck.new_cards) / deck.total_cards) * 100)
              : 0

            return (
              <Card
                key={deck.id}
                className={cn(
                  "opacity-0 animate-fade-in relative group",
                  `stagger-${Math.min(index + 1, 5)}`
                )}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate">{deck.title}</CardTitle>
                      {deck.description && (
                        <CardDescription className="line-clamp-2 mt-1">
                          {deck.description}
                        </CardDescription>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/flashcards/${deck.id}`}>
                            <BookOpen className="h-4 w-4 mr-2" />
                            Browse Cards
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingDeckId(deck.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Stats */}
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className="text-muted-foreground">{deck.new_cards} new</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-orange-500"></div>
                      <span className="text-muted-foreground">{deck.learning_cards} learning</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-muted-foreground">{deck.review_cards} review</span>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{deck.total_cards} cards</span>
                      <span className="text-muted-foreground">{masteryPercent}% studied</span>
                    </div>
                    <Progress value={masteryPercent} className="h-1.5" />
                  </div>

                  {/* Due Badge & Study Button */}
                  <div className="flex items-center justify-between pt-2">
                    {deck.due_cards > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          {deck.due_cards} due
                        </span>
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">All caught up!</span>
                    )}
                    <Button
                      size="sm"
                      disabled={deck.due_cards === 0 && deck.new_cards === 0}
                      asChild
                    >
                      <Link to={`/flashcards/${deck.id}/study`}>
                        Study Now
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
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


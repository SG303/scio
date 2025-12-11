import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  BookOpen,
  MoreVertical,
  Loader2,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import type { Flashcard } from '@/types'

export default function DeckDetail() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [isAddingCard, setIsAddingCard] = useState(false)
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null)
  const [deletingCardId, setDeletingCardId] = useState<number | null>(null)
  const [newCard, setNewCard] = useState({ front: '', back: '' })

  // Fetch deck
  const { data: deck, isLoading: deckLoading } = useQuery({
    queryKey: ['flashcard-deck', deckId],
    queryFn: () => flashcardsApi.getDeck(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // Fetch cards
  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['flashcard-cards', deckId],
    queryFn: () => flashcardsApi.listCards(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // Create card mutation
  const createCardMutation = useMutation({
    mutationFn: ({ front, back }: { front: string; back: string }) =>
      flashcardsApi.createCard(parseInt(deckId!), { front, back }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-cards', deckId] })
      queryClient.invalidateQueries({ queryKey: ['flashcard-deck', deckId] })
      setIsAddingCard(false)
      setNewCard({ front: '', back: '' })
    },
  })

  // Update card mutation
  const updateCardMutation = useMutation({
    mutationFn: ({ cardId, front, back }: { cardId: number; front: string; back: string }) =>
      flashcardsApi.updateCard(cardId, { front, back }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-cards', deckId] })
      setEditingCard(null)
    },
  })

  // Delete card mutation
  const deleteCardMutation = useMutation({
    mutationFn: flashcardsApi.deleteCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-cards', deckId] })
      queryClient.invalidateQueries({ queryKey: ['flashcard-deck', deckId] })
      setDeletingCardId(null)
    },
  })

  const handleCreateCard = () => {
    if (newCard.front.trim() && newCard.back.trim()) {
      createCardMutation.mutate(newCard)
    }
  }

  const handleUpdateCard = () => {
    if (editingCard && editingCard.front.trim() && editingCard.back.trim()) {
      updateCardMutation.mutate({
        cardId: editingCard.id,
        front: editingCard.front,
        back: editingCard.back,
      })
    }
  }

  const handleDeleteCard = () => {
    if (deletingCardId) {
      deleteCardMutation.mutate(deletingCardId)
    }
  }

  const getStateColor = (state: string) => {
    switch (state) {
      case 'new':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      case 'learning':
      case 'relearning':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20'
      case 'review':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  if (deckLoading || cardsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!deck) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Deck not found</h2>
        <Button onClick={() => navigate('/flashcards')}>Go to Flashcards</Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/flashcards')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">{deck.title}</h1>
          </div>
          {deck.description && (
            <p className="text-muted-foreground ml-12">{deck.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setIsAddingCard(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Card
          </Button>
          <Button asChild disabled={deck.due_cards === 0 && deck.new_cards === 0}>
            <Link to={`/flashcards/${deckId}/study`}>
              <BookOpen className="h-4 w-4 mr-2" />
              Study ({deck.due_cards + Math.min(deck.new_cards, deck.new_cards_per_day)})
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{deck.total_cards}</div>
            <div className="text-sm text-muted-foreground">Total Cards</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-400">{deck.new_cards}</div>
            <div className="text-sm text-muted-foreground">New</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-400">{deck.learning_cards}</div>
            <div className="text-sm text-muted-foreground">Learning</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-emerald-400">{deck.review_cards}</div>
            <div className="text-sm text-muted-foreground">Review</div>
          </CardContent>
        </Card>
      </div>

      {/* Cards List */}
      <Card>
        <CardHeader>
          <CardTitle>Cards ({cards.length})</CardTitle>
          <CardDescription>All flashcards in this deck</CardDescription>
        </CardHeader>
        <CardContent>
          {cards.length === 0 ? (
            <div className="text-center py-8">
              <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No cards yet</h3>
              <p className="text-muted-foreground mb-4">
                Add cards manually or generate them with AI
              </p>
              <Button onClick={() => setIsAddingCard(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Card
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {cards.map((card) => (
                <div
                  key={card.id}
                  className="flex items-start gap-4 p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{card.front}</p>
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border shrink-0',
                          getStateColor(card.state)
                        )}
                      >
                        {card.state}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">{card.back}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditingCard(card)}>
                        <Edit2 className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeletingCardId(card.id)}
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

      {/* Add Card Dialog */}
      <Dialog open={isAddingCard} onOpenChange={setIsAddingCard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Card</DialogTitle>
            <DialogDescription>Create a new flashcard for this deck</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="front">Front (Question)</Label>
              <Textarea
                id="front"
                value={newCard.front}
                onChange={(e) => setNewCard({ ...newCard, front: e.target.value })}
                placeholder="Enter the question or prompt..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="back">Back (Answer)</Label>
              <Textarea
                id="back"
                value={newCard.back}
                onChange={(e) => setNewCard({ ...newCard, back: e.target.value })}
                placeholder="Enter the answer..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingCard(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCard}
              disabled={!newCard.front.trim() || !newCard.back.trim() || createCardMutation.isPending}
            >
              {createCardMutation.isPending ? 'Adding...' : 'Add Card'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Card Dialog */}
      <Dialog open={editingCard !== null} onOpenChange={() => setEditingCard(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Card</DialogTitle>
            <DialogDescription>Update the flashcard content</DialogDescription>
          </DialogHeader>
          {editingCard && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-front">Front (Question)</Label>
                <Textarea
                  id="edit-front"
                  value={editingCard.front}
                  onChange={(e) => setEditingCard({ ...editingCard, front: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-back">Back (Answer)</Label>
                <Textarea
                  id="edit-back"
                  value={editingCard.back}
                  onChange={(e) => setEditingCard({ ...editingCard, back: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCard(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCard} disabled={updateCardMutation.isPending}>
              {updateCardMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Card Dialog */}
      <Dialog open={deletingCardId !== null} onOpenChange={() => setDeletingCardId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Card</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this card? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCardId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCard}
              disabled={deleteCardMutation.isPending}
            >
              {deleteCardMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


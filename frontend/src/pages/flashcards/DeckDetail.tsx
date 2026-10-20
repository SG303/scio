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
  MoreHorizontal,
  Download,
  Upload,
  SearchX,
} from 'lucide-react'
import { toast } from '@/components/Toaster'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListRow, RowActions } from '@/components/List'
import { deckIsStudiable, deckStudyCount } from '@/lib/decks'
import { cardStates, cardStateClass } from '@/lib/studyColors'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { flashcardsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import type { Flashcard } from '@/types'
import { queryKeys } from '@/lib/constants'

export default function DeckDetail() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [isAddingCard, setIsAddingCard] = useState(false)
  // P4.3: deck settings (title, description, new_cards_per_day)
  const [isEditingDeck, setIsEditingDeck] = useState(false)
  const [deckForm, setDeckForm] = useState({ title: '', description: '', new_cards_per_day: 20 })
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null)
  const [deletingCardId, setDeletingCardId] = useState<number | null>(null)
  const [newCard, setNewCard] = useState({ front: '', back: '' })
  // P6.1: CSV import dialog
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)

  // Fetch deck
  const {
    data: deck,
    isLoading: deckLoading,
    error: deckError,
    refetch: refetchDeck,
  } = useQuery({
    queryKey: queryKeys.flashcardDeck(deckId),
    queryFn: () => flashcardsApi.getDeck(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // Fetch cards
  const {
    data: cards = [],
    isLoading: cardsLoading,
    error: cardsError,
    refetch: refetchCards,
  } = useQuery({
    queryKey: queryKeys.flashcardCards(deckId),
    queryFn: () => flashcardsApi.listCards(parseInt(deckId!)),
    enabled: !!deckId,
  })

  // P6.1: export/import
  const exportMutation = useMutation({
    mutationFn: ({ format }: { format: 'apkg' | 'csv' }) =>
      flashcardsApi.exportDeck(parseInt(deckId!), format, deck!.title),
    onSuccess: () => toast.success('Export downloaded'),
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Export failed'),
  })

  const importMutation = useMutation({
    mutationFn: (file: File) => flashcardsApi.importCards(parseInt(deckId!), file),
    onSuccess: (result) => {
      toast.success(`Imported ${result.cards_imported} cards${result.rows_skipped ? `, ${result.rows_skipped} rows skipped` : ''}`)
      setShowImportDialog(false)
      setImportFile(null)
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(deckId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardCards(deckId) })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Import failed'),
  })

  // Create card mutation
  const createCardMutation = useMutation({
    mutationFn: ({ front, back }: { front: string; back: string }) =>
      flashcardsApi.createCard(parseInt(deckId!), { front, back }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardCards(deckId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(deckId) })
      setIsAddingCard(false)
      setNewCard({ front: '', back: '' })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add card')
    },
  })

  // Update card mutation
  const updateCardMutation = useMutation({
    mutationFn: ({ cardId, front, back }: { cardId: number; front: string; back: string }) =>
      flashcardsApi.updateCard(cardId, { front, back }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardCards(deckId) })
      setEditingCard(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save card')
    },
  })

  // Delete card mutation
  const deleteCardMutation = useMutation({
    mutationFn: flashcardsApi.deleteCard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardCards(deckId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(deckId) })
      // P3.2: the deck list shows card counts — refresh it as well
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      setDeletingCardId(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete card')
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

  // P4.3: save deck settings — invalidates the deck and the deck list
  const updateDeckMutation = useMutation({
    mutationFn: (data: { title: string; description: string; new_cards_per_day: number }) =>
      flashcardsApi.updateDeck(parseInt(deckId!), data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(deckId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      setIsEditingDeck(false)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save deck settings')
    },
  })

  const handleOpenEditDeck = () => {
    setDeckForm({
      title: deck?.title ?? '',
      description: deck?.description ?? '',
      new_cards_per_day: deck?.new_cards_per_day ?? 20,
    })
    setIsEditingDeck(true)
  }

  if (deckLoading || cardsLoading) {
    return <QueryState loading />
  }

  // P3.3: a failed query is an error, not an empty deck
  if (deckError || cardsError) {
    return (
      <QueryState
        error={deckError || cardsError}
        onRetry={() => {
          refetchDeck()
          refetchCards()
        }}
      />
    )
  }

  if (!deck) {
    return (
      <div className="mx-auto max-w-5xl">
        <EmptyState
          icon={SearchX}
          title="Deck not found"
          description="This deck may have been deleted."
          action={
            <Button variant="outline" onClick={() => navigate('/flashcards')}>
              Go to Flashcards
            </Button>
          }
        />
      </div>
    )
  }

  const stateCounts = {
    new: deck.new_cards,
    learning: deck.learning_cards,
    review: deck.review_cards,
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-foreground" asChild>
          <Link to="/flashcards">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Flashcard Decks
          </Link>
        </Button>
        <PageHeader
          title={<span className="break-words">{deck.title}</span>}
          description={deck.description || undefined}
          actions={
            <>
              {/* P6.1 export/import and P4.3 deck settings live in one menu so
                  the header fits on phones */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More deck actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[12rem]">
                  <DropdownMenuItem onClick={handleOpenEditDeck}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit Deck
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowImportDialog(true)}>
                    <Upload className="h-4 w-4 mr-2" />
                    Import CSV
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={exportMutation.isPending}
                    onClick={() => exportMutation.mutate({ format: 'apkg' })}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export Anki deck (.apkg)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={exportMutation.isPending}
                    onClick={() => exportMutation.mutate({ format: 'csv' })}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV (.csv)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" onClick={() => setIsAddingCard(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Card
              </Button>
              {/* P4.3: honest count — remaining new cards respect today's deck-wide quota */}
              <Button asChild disabled={!deckIsStudiable(deck)}>
                <Link to={`/flashcards/${deckId}/study`}>
                  <BookOpen className="h-4 w-4 mr-2" />
                  Study ({deckStudyCount(deck)})
                </Link>
              </Button>
            </>
          }
        />
      </div>

      {/* Stats in the shared card-state palette */}
      <dl className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card md:grid-cols-4">
        <div className="p-5">
          <dt className="text-sm text-muted-foreground">Total cards</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{deck.total_cards}</dd>
        </div>
        {cardStates.map((state, i) => (
          <div
            key={state.key}
            className={cn(
              'border-l p-5',
              i === 1 && 'border-l-0 border-t md:border-l md:border-t-0',
              i === 2 && 'border-t md:border-t-0'
            )}
          >
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn('h-2 w-2 rounded-full', state.className)} aria-hidden />
              {state.label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
              {stateCounts[state.key]}
            </dd>
          </div>
        ))}
      </dl>

      {/* Cards List */}
      <section className="space-y-3">
        <SectionHeader title="Cards" meta={cards.length} />
        {cards.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No cards yet"
            description="Add cards manually or generate them with AI."
            action={
              <Button onClick={() => setIsAddingCard(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Card
              </Button>
            }
          />
        ) : (
          <List>
            {cards.map((card) => (
              <ListRow key={card.id} className="items-start">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium break-words">{card.front}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground break-words">{card.back}</p>
                </div>
                <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-xs capitalize text-muted-foreground">
                  <span className={cn('h-2 w-2 rounded-full', cardStateClass(card.state))} aria-hidden />
                  {card.state}
                </span>
                <RowActions label="Card actions">
                  <DropdownMenuItem onClick={() => setEditingCard(card)}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeletingCardId(card.id)}
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

      {/* P4.3: Edit Deck Dialog — title, description, daily new-card limit */}
      <Dialog open={isEditingDeck} onOpenChange={setIsEditingDeck}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Deck</DialogTitle>
            <DialogDescription>
              Change the deck's title, description and how many new cards are
              introduced per day.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="deck-title">Title</Label>
              <Input
                id="deck-title"
                value={deckForm.title}
                onChange={(e) => setDeckForm((prev) => ({ ...prev, title: e.target.value }))}
                maxLength={255}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deck-description">Description</Label>
              <Textarea
                id="deck-description"
                value={deckForm.description}
                onChange={(e) =>
                  setDeckForm((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deck-new-cards">New cards per day</Label>
              <Input
                id="deck-new-cards"
                type="number"
                min={1}
                max={100}
                value={deckForm.new_cards_per_day}
                onChange={(e) =>
                  setDeckForm((prev) => ({
                    ...prev,
                    new_cards_per_day: Math.max(1, Math.min(100, Number(e.target.value) || 1)),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                How many unseen cards a day of studying may introduce (1–100).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditingDeck(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateDeckMutation.mutate(deckForm)}
              disabled={updateDeckMutation.isPending || !deckForm.title.trim()}
            >
              {updateDeckMutation.isPending ? 'Saving...' : 'Save Changes'}
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

      {/* P6.1: CSV Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Cards from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV with the columns <code>front</code>, <code>back</code> and{' '}
              <code>state</code> (state is ignored — imported cards start as new). Rows without
              front and back are skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            {importFile && (
              <p className="text-sm text-muted-foreground">
                {importFile.name} ({(importFile.size / 1024).toFixed(1)} kB)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => importFile && importMutation.mutate(importFile)}
              disabled={!importFile || importMutation.isPending}
            >
              {importMutation.isPending ? 'Importing...' : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


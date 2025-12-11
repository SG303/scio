import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { modelsApi, subjectsApi } from '@/services/api'
import { cn, formatPricePerMillion } from '@/lib/utils'
import { QUESTION_COUNT_OPTIONS } from '@/lib/constants'
import type { TestConfigInSubject, FlashcardDeckInSubject } from '@/types'

const CARD_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30]

interface AddToExistingDialogProps {
  open: boolean
  onClose: () => void
  subjectId: number
  type: 'test' | 'deck'
  item: TestConfigInSubject | FlashcardDeckInSubject
  defaultAiModelId: number | null
}

export default function AddToExistingDialog({
  open,
  onClose,
  subjectId,
  type,
  item,
  defaultAiModelId,
}: AddToExistingDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const [count, setCount] = useState(type === 'test' ? 10 : 10)
  const [aiModelId, setAiModelId] = useState(defaultAiModelId)
  const [customPrompt, setCustomPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: models = [] } = useQuery({
    queryKey: ['models', true],
    queryFn: () => modelsApi.list(true),
  })

  const addQuestionsMutation = useMutation({
    mutationFn: () => subjectsApi.addQuestions(subjectId, item.id, {
      num_questions: count,
      ai_model_id: aiModelId,
      custom_prompt: customPrompt || undefined,
    }),
    onSuccess: (test) => {
      queryClient.invalidateQueries({ queryKey: ['subject', subjectId.toString()] })
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      handleClose()
      navigate(`/test/${test.id}`)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to add questions')
      setIsGenerating(false)
    },
  })

  const addCardsMutation = useMutation({
    mutationFn: () => subjectsApi.addCards(subjectId, item.id, {
      num_cards: count,
      ai_model_id: aiModelId,
      custom_prompt: customPrompt || undefined,
    }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['subject', subjectId.toString()] })
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      queryClient.invalidateQueries({ queryKey: ['flashcard-cards', item.id.toString()] })
      queryClient.invalidateQueries({ queryKey: ['flashcard-deck', item.id.toString()] })
      handleClose()
      navigate(`/flashcards/${response.deck_id}`)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to add cards')
      setIsGenerating(false)
    },
  })

  const handleClose = () => {
    setCount(type === 'test' ? 10 : 10)
    setAiModelId(defaultAiModelId)
    setCustomPrompt('')
    setError(null)
    setIsGenerating(false)
    onClose()
  }

  const handleGenerate = () => {
    setError(null)
    setIsGenerating(true)
    
    if (type === 'test') {
      addQuestionsMutation.mutate()
    } else {
      addCardsMutation.mutate()
    }
  }

  const canGenerate = aiModelId !== null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Add {type === 'test' ? 'Questions' : 'Cards'} to "{item.title}"
          </DialogTitle>
          <DialogDescription>
            Generate new {type === 'test' ? 'questions' : 'cards'} that are different from existing ones.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Count Selection */}
          <div className="space-y-2">
            <Label>Number of {type === 'test' ? 'Questions' : 'Cards'}</Label>
            <Select value={String(count)} onValueChange={(v) => setCount(parseInt(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(type === 'test' ? QUESTION_COUNT_OPTIONS.slice(0, -2) : CARD_COUNT_OPTIONS).map(
                  (n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {type === 'test' ? 'questions' : 'cards'}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>

          {/* AI Model */}
          <div className="space-y-2">
            <Label>AI Model</Label>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setAiModelId(model.id)}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border text-left transition-all text-sm',
                    aiModelId === model.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors',
                      aiModelId === model.id
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {aiModelId === model.id && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <h4 className="font-medium">{model.name}</h4>
                      {model.context_length && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {Math.round(model.context_length / 1000)}k ctx
                        </span>
                      )}
                    </div>
                    {model.pricing && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatPricePerMillion(model.pricing.prompt)} /{' '}
                        {formatPricePerMillion(model.pricing.completion)} per 1M tokens
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Prompt */}
          <div className="space-y-2">
            <Label htmlFor="custom_prompt">Custom Instructions (Optional)</Label>
            <Textarea
              id="custom_prompt"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={
                type === 'test'
                  ? 'e.g., Focus on advanced topics, include scenario-based questions...'
                  : 'e.g., Focus on practical applications, include code examples...'
              }
              rows={2}
            />
          </div>

          {/* Info about duplicate prevention */}
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            The AI will be informed about existing {type === 'test' ? 'questions' : 'cards'} to
            avoid generating duplicates.
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={!canGenerate || isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Add {type === 'test' ? 'Questions' : 'Cards'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


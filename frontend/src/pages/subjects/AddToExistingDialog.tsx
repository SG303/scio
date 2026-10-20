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
import { GenerationStatus } from '@/components/GenerationStatus'
import { OptionCard, ModelOptionLabel } from '@/components/OptionCard'
import { QUESTION_COUNT_OPTIONS, queryKeys } from '@/lib/constants'
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
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
  })

  const addQuestionsMutation = useMutation({
    mutationFn: () => subjectsApi.addQuestions(subjectId, item.id, {
      num_questions: count,
      ai_model_id: aiModelId,
      custom_prompt: customPrompt || undefined,
    }),
    onSuccess: (test) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subject(subjectId.toString()) })
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.subject(subjectId.toString()) })
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardCards(item.id.toString()) })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(item.id.toString()) })
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
            <div className="grid max-h-56 gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="AI Model">
              {models.map((model) => (
                <OptionCard
                  key={model.id}
                  indicator="radio"
                  selected={aiModelId === model.id}
                  onClick={() => setAiModelId(model.id)}
                >
                  <ModelOptionLabel model={model} />
                </OptionCard>
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
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            The AI will be informed about existing {type === 'test' ? 'questions' : 'cards'} to
            avoid generating duplicates.
          </p>

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {isGenerating && <GenerationStatus progress={null} />}
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


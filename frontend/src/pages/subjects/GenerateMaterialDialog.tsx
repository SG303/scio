import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Layers, Sparkles, Loader2, CheckCircle2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { documentsApi, modelsApi, subjectsApi } from '@/services/api'
import { cn, formatPricePerMillion } from '@/lib/utils'
import { QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES } from '@/lib/constants'

const CARD_COUNT_OPTIONS = [10, 15, 20, 25, 30, 40, 50]

interface GenerateMaterialDialogProps {
  open: boolean
  onClose: () => void
  subjectId: number
  defaultAiModelId: number | null
  defaultDocumentIds: number[] | null
}

type MaterialType = 'test' | 'flashcards'

export default function GenerateMaterialDialog({
  open,
  onClose,
  subjectId,
  defaultAiModelId,
  defaultDocumentIds,
}: GenerateMaterialDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const [step, setStep] = useState<'choose' | 'configure'>('choose')
  const [materialType, setMaterialType] = useState<MaterialType | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Test form data
  const [testForm, setTestForm] = useState({
    title: '',
    num_questions: DEFAULT_NUM_QUESTIONS,
    num_choices: DEFAULT_NUM_CHOICES,
    ai_model_id: defaultAiModelId,
    document_ids: defaultDocumentIds || [],
    custom_prompt: '',
  })
  
  // Flashcard form data
  const [flashcardForm, setFlashcardForm] = useState({
    title: '',
    description: '',
    num_cards: 20,
    ai_model_id: defaultAiModelId,
    document_ids: defaultDocumentIds || [],
    custom_prompt: '',
  })

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  })

  const { data: models = [] } = useQuery({
    queryKey: ['models', true],
    queryFn: () => modelsApi.list(true),
  })

  const generateTestMutation = useMutation({
    mutationFn: () => subjectsApi.generateTest(subjectId, {
      title: testForm.title,
      num_questions: testForm.num_questions,
      num_choices: testForm.num_choices,
      ai_model_id: testForm.ai_model_id,
      document_ids: testForm.document_ids.length > 0 ? testForm.document_ids : undefined,
      custom_prompt: testForm.custom_prompt || undefined,
    }),
    onSuccess: (test) => {
      queryClient.invalidateQueries({ queryKey: ['subject', subjectId.toString()] })
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      handleClose()
      navigate(`/test/${test.id}`)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to generate test')
      setIsGenerating(false)
    },
  })

  const generateFlashcardsMutation = useMutation({
    mutationFn: () => subjectsApi.generateFlashcards(subjectId, {
      title: flashcardForm.title,
      description: flashcardForm.description || undefined,
      num_cards: flashcardForm.num_cards,
      ai_model_id: flashcardForm.ai_model_id,
      document_ids: flashcardForm.document_ids.length > 0 ? flashcardForm.document_ids : undefined,
      custom_prompt: flashcardForm.custom_prompt || undefined,
    }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['subject', subjectId.toString()] })
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      handleClose()
      navigate(`/flashcards/${response.deck_id}`)
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to generate flashcards')
      setIsGenerating(false)
    },
  })

  const handleClose = () => {
    setStep('choose')
    setMaterialType(null)
    setError(null)
    setIsGenerating(false)
    setTestForm({
      title: '',
      num_questions: DEFAULT_NUM_QUESTIONS,
      num_choices: DEFAULT_NUM_CHOICES,
      ai_model_id: defaultAiModelId,
      document_ids: defaultDocumentIds || [],
      custom_prompt: '',
    })
    setFlashcardForm({
      title: '',
      description: '',
      num_cards: 20,
      ai_model_id: defaultAiModelId,
      document_ids: defaultDocumentIds || [],
      custom_prompt: '',
    })
    onClose()
  }

  const handleChooseMaterial = (type: MaterialType) => {
    setMaterialType(type)
    setStep('configure')
  }

  const handleDocumentToggle = (docId: number) => {
    if (materialType === 'test') {
      setTestForm((prev) => ({
        ...prev,
        document_ids: prev.document_ids.includes(docId)
          ? prev.document_ids.filter((id) => id !== docId)
          : [...prev.document_ids, docId],
      }))
    } else {
      setFlashcardForm((prev) => ({
        ...prev,
        document_ids: prev.document_ids.includes(docId)
          ? prev.document_ids.filter((id) => id !== docId)
          : [...prev.document_ids, docId],
      }))
    }
  }

  const handleGenerate = async () => {
    setError(null)
    setIsGenerating(true)
    
    if (materialType === 'test') {
      generateTestMutation.mutate()
    } else {
      generateFlashcardsMutation.mutate()
    }
  }

  const currentForm = materialType === 'test' ? testForm : flashcardForm
  const canGenerate = currentForm.title.trim() !== '' && currentForm.ai_model_id !== null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'choose'
              ? 'Create Learning Material'
              : materialType === 'test'
              ? 'Create Practice Test'
              : 'Create Flashcard Deck'}
          </DialogTitle>
          <DialogDescription>
            {step === 'choose'
              ? 'Choose the type of learning material to generate'
              : materialType === 'test'
              ? 'Configure and generate a practice test'
              : 'Configure and generate flashcards'}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Choose Material Type */}
        {step === 'choose' && (
          <div className="grid gap-4 py-4 md:grid-cols-2">
            <button
              onClick={() => handleChooseMaterial('test')}
              className="flex flex-col items-center gap-4 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-all text-center"
            >
              <div className="p-4 rounded-full bg-blue-500/10">
                <ClipboardList className="h-8 w-8 text-blue-500" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Practice Test</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Multiple choice questions to test your knowledge
                </p>
              </div>
            </button>
            <button
              onClick={() => handleChooseMaterial('flashcards')}
              className="flex flex-col items-center gap-4 p-6 rounded-lg border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-all text-center"
            >
              <div className="p-4 rounded-full bg-purple-500/10">
                <Layers className="h-8 w-8 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">Flashcards</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Question & answer cards for spaced repetition
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="space-y-6 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">
                {materialType === 'test' ? 'Test Title' : 'Deck Title'}
              </Label>
              <Input
                id="title"
                value={currentForm.title}
                onChange={(e) =>
                  materialType === 'test'
                    ? setTestForm({ ...testForm, title: e.target.value })
                    : setFlashcardForm({ ...flashcardForm, title: e.target.value })
                }
                placeholder={
                  materialType === 'test'
                    ? 'e.g., Fundamentals Quiz'
                    : 'e.g., Key Concepts'
                }
              />
            </div>

            {/* Description (flashcards only) */}
            {materialType === 'flashcards' && (
              <div className="space-y-2">
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={flashcardForm.description}
                  onChange={(e) =>
                    setFlashcardForm({ ...flashcardForm, description: e.target.value })
                  }
                  placeholder="Brief description of this deck..."
                  rows={2}
                />
              </div>
            )}

            {/* Count Selection */}
            <div className={cn('grid gap-4', materialType === 'test' ? 'md:grid-cols-2' : '')}>
              <div className="space-y-2">
                <Label>
                  {materialType === 'test' ? 'Number of Questions' : 'Number of Cards'}
                </Label>
                <Select
                  value={String(
                    materialType === 'test' ? testForm.num_questions : flashcardForm.num_cards
                  )}
                  onValueChange={(v) =>
                    materialType === 'test'
                      ? setTestForm({ ...testForm, num_questions: parseInt(v) })
                      : setFlashcardForm({ ...flashcardForm, num_cards: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(materialType === 'test' ? QUESTION_COUNT_OPTIONS : CARD_COUNT_OPTIONS).map(
                      (n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} {materialType === 'test' ? 'questions' : 'cards'}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {materialType === 'test' && (
                <div className="space-y-2">
                  <Label>Choices per Question</Label>
                  <Select
                    value={String(testForm.num_choices)}
                    onValueChange={(v) =>
                      setTestForm({ ...testForm, num_choices: parseInt(v) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHOICES_COUNT_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} choices
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* AI Model */}
            <div className="space-y-2">
              <Label>AI Model</Label>
              <div className="grid gap-2 max-h-40 overflow-y-auto">
                {models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() =>
                      materialType === 'test'
                        ? setTestForm({ ...testForm, ai_model_id: model.id })
                        : setFlashcardForm({ ...flashcardForm, ai_model_id: model.id })
                    }
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg border text-left transition-all text-sm',
                      currentForm.ai_model_id === model.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div
                      className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors',
                        currentForm.ai_model_id === model.id
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground/30'
                      )}
                    >
                      {currentForm.ai_model_id === model.id && (
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

            {/* Documents (collapsible) */}
            <details className="group">
              <summary className="cursor-pointer flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                Documents ({currentForm.document_ids.length} selected)
              </summary>
              <div className="mt-3 space-y-2">
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents available</p>
                ) : (
                  <div className="grid gap-2 max-h-40 overflow-y-auto">
                    {documents.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleDocumentToggle(doc.id)}
                        className={cn(
                          'flex items-center gap-3 p-2 rounded-lg border text-left transition-all text-sm',
                          currentForm.document_ids.includes(doc.id)
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <div
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                            currentForm.document_ids.includes(doc.id)
                              ? 'border-primary bg-primary'
                              : 'border-muted-foreground/30'
                          )}
                        >
                          {currentForm.document_ids.includes(doc.id) && (
                            <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                        <span className="truncate">{doc.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>

            {/* Custom Prompt */}
            <div className="space-y-2">
              <Label htmlFor="custom_prompt">Custom Instructions (Optional)</Label>
              <Textarea
                id="custom_prompt"
                value={
                  materialType === 'test' ? testForm.custom_prompt : flashcardForm.custom_prompt
                }
                onChange={(e) =>
                  materialType === 'test'
                    ? setTestForm({ ...testForm, custom_prompt: e.target.value })
                    : setFlashcardForm({ ...flashcardForm, custom_prompt: e.target.value })
                }
                placeholder="e.g., Focus on practical concepts, include code examples..."
                rows={2}
              />
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 'configure' && (
            <Button
              variant="outline"
              onClick={() => setStep('choose')}
              disabled={isGenerating}
            >
              Back
            </Button>
          )}
          {step === 'configure' && (
            <Button onClick={handleGenerate} disabled={!canGenerate || isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate {materialType === 'test' ? 'Test' : 'Flashcards'}
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


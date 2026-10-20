import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Layers, Sparkles, Loader2, FileText, ChevronDown } from 'lucide-react'
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
import {
  calculateEstimatedCost,
  calculateFlashcardGenerationTokens,
  calculateTestGenerationTokens,
  cn,
} from '@/lib/utils'
import { ListIcon } from '@/components/List'
import { StepIndicator } from '@/components/StepIndicator'
import { CostEstimate } from '@/components/CostEstimate'
import { GenerationStatus } from '@/components/GenerationStatus'
import { OptionCard, ModelOptionLabel, DocumentOptionLabel } from '@/components/OptionCard'
import { QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES, queryKeys } from '@/lib/constants'

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
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })

  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
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
      queryClient.invalidateQueries({ queryKey: queryKeys.subject(subjectId.toString()) })
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
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
      queryClient.invalidateQueries({ queryKey: queryKeys.subject(subjectId.toString()) })
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
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

  // Cost estimate with the same token helpers as the standalone wizards
  const estimates = (() => {
    const selectedModel = models.find((m) => m.id === currentForm.ai_model_id)
    if (!materialType || !selectedModel) return null

    const documentContents = currentForm.document_ids.map(
      (id) => documents.find((d) => d.id === id)?.content || ''
    )
    const { inputTokens, outputTokens, numBatches } =
      materialType === 'test'
        ? calculateTestGenerationTokens(documentContents, testForm.num_questions, !!testForm.custom_prompt)
        : calculateFlashcardGenerationTokens(documentContents, flashcardForm.num_cards)

    // Context usage is per batch (each call must fit in the window)
    const contextLimit = selectedModel.context_length || 128000
    const contextUsage = ((inputTokens + outputTokens) / numBatches / contextLimit) * 100
    const hasPricing = selectedModel.pricing?.prompt && selectedModel.pricing?.completion
    const { estimatedCost } = calculateEstimatedCost(inputTokens, outputTokens, selectedModel)

    return { inputTokens, outputTokens, estimatedCost, contextUsage, contextLimit, hasPricing, numBatches }
  })()

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

        <StepIndicator
          steps={['Choose Type', 'Configure']}
          current={step === 'choose' ? 1 : 2}
          className="py-2"
        />

        {/* Step 1: Choose Material Type */}
        {step === 'choose' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              {
                type: 'test',
                icon: ClipboardList,
                title: 'Practice Test',
                description: 'Multiple choice questions to test your knowledge',
              },
              {
                type: 'flashcards',
                icon: Layers,
                title: 'Flashcards',
                description: 'Question & answer cards for spaced repetition',
              },
            ] as const).map(({ type, icon: Icon, title, description }) => (
              <button
                key={type}
                type="button"
                onClick={() => handleChooseMaterial(type)}
                className="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ListIcon>
                  <Icon />
                </ListIcon>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">{title}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="space-y-6">
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
              <div className="grid max-h-56 gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="AI Model">
                {models.map((model) => (
                  <OptionCard
                    key={model.id}
                    indicator="radio"
                    selected={currentForm.ai_model_id === model.id}
                    onClick={() =>
                      materialType === 'test'
                        ? setTestForm({ ...testForm, ai_model_id: model.id })
                        : setFlashcardForm({ ...flashcardForm, ai_model_id: model.id })
                    }
                  >
                    <ModelOptionLabel model={model} />
                  </OptionCard>
                ))}
              </div>
            </div>

            {/* Documents (collapsible) */}
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Documents
                <span className="font-normal tabular-nums text-muted-foreground">
                  {currentForm.document_ids.length} selected
                </span>
                <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t p-3">
                {documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No documents available</p>
                ) : (
                  <div className="grid max-h-48 gap-2 overflow-y-auto p-0.5">
                    {documents.map((doc) => (
                      <OptionCard
                        key={doc.id}
                        indicator="checkbox"
                        selected={currentForm.document_ids.includes(doc.id)}
                        onClick={() => handleDocumentToggle(doc.id)}
                      >
                        <DocumentOptionLabel title={doc.title} docType={doc.doc_type} />
                      </OptionCard>
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

            {estimates && (
              <CostEstimate
                estimates={estimates}
                overLimitMessage="Warning: Context limit exceeded. Generation may fail."
              />
            )}

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {error}
              </div>
            )}

            {/* Subject generation reports no batch progress — static waiting panel */}
            {isGenerating && <GenerationStatus progress={null} />}
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

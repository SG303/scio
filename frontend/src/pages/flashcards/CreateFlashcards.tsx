import { useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { documentsApi, modelsApi, flashcardsApi, subjectsApi } from '@/services/api'
import { calculateEstimatedCost, calculateFlashcardGenerationTokens } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { QueryState } from '@/components/QueryState'
import { StepIndicator } from '@/components/StepIndicator'
import { CostEstimate } from '@/components/CostEstimate'
import { GenerationStatus } from '@/components/GenerationStatus'
import { MaterialsStep, withSubjectDefaults } from '@/components/MaterialsStep'
import { OptionCard, ModelOptionLabel } from '@/components/OptionCard'
import { queryKeys } from '@/lib/constants'
import type { SubjectListItem } from '@/types'

const CARD_COUNT_OPTIONS = [10, 15, 20, 25, 30, 40, 50]

/** Loads subjects first, so `?subject=` can pre-fill the wizard's initial state. */
export default function CreateFlashcards() {
  const [searchParams] = useSearchParams()

  const { data: subjects = [], isLoading } = useQuery({
    queryKey: queryKeys.subjects,
    queryFn: subjectsApi.list,
  })

  if (isLoading) {
    return <QueryState loading />
  }

  const initialSubject = subjects.find((s) => String(s.id) === searchParams.get('subject')) ?? null

  return <CreateFlashcardsWizard subjects={subjects} initialSubject={initialSubject} />
}

function CreateFlashcardsWizard({
  subjects,
  initialSubject,
}: {
  subjects: SubjectListItem[]
  initialSubject: SubjectListItem | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    num_cards: 20,
    ai_model_id: initialSubject?.ai_model_id ?? 0,
    document_ids: withSubjectDefaults([], null, initialSubject),
    custom_prompt: '',
    subject_id: initialSubject?.id ?? null,
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: documents = [] } = useQuery({
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })

  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
  })

  const selectedSubject = subjects.find((s) => s.id === formData.subject_id) ?? null

  const handleSubjectChange = (subject: SubjectListItem | null) => {
    setFormData((prev) => ({
      ...prev,
      subject_id: subject?.id ?? null,
      // the subject's default model only fills an empty choice
      ai_model_id: prev.ai_model_id || subject?.ai_model_id || 0,
    }))
  }

  const handleGenerate = async () => {
    setError(null)
    setIsGenerating(true)

    try {
      // P5.2: deck + cards in one call — a failed generation no longer
      // leaves an empty deck behind
      const result = await flashcardsApi.createAndGenerateDeck({
        title: formData.title,
        description: formData.description || undefined,
        ai_model_id: formData.ai_model_id,
        document_ids: formData.document_ids.length > 0 ? formData.document_ids : undefined,
        custom_prompt: formData.custom_prompt || undefined,
        num_cards: formData.num_cards,
        subject_id: formData.subject_id,
      })

      // Refresh the deck list so it shows the new deck when the user
      // navigates back (staleTime 5 min would otherwise serve stale data)
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardStats })
      if (formData.subject_id !== null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
        queryClient.invalidateQueries({ queryKey: queryKeys.subject(formData.subject_id) })
      }

      // Navigate to the deck
      navigate(`/flashcards/${result.deck.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create flashcard deck')
      setIsGenerating(false)
    }
  }

  const canProceedStep2 = formData.title && models.some((m) => m.id === formData.ai_model_id)

  // Calculate estimated cost
  const estimates = useMemo(() => {
    if (formData.ai_model_id === 0) return null

    const selectedModel = models.find(m => m.id === formData.ai_model_id)
    if (!selectedModel) return null

    const documentContents = formData.document_ids.map(
      (id) => documents.find((d) => d.id === id)?.content || ''
    )
    const { inputTokens, outputTokens, numBatches } = calculateFlashcardGenerationTokens(
      documentContents,
      formData.num_cards
    )

    // Context usage is per batch (each call must fit in the window)
    const contextLimit = selectedModel.context_length || 128000
    const contextUsage = ((inputTokens + outputTokens) / numBatches / contextLimit) * 100

    const hasPricing = selectedModel.pricing?.prompt && selectedModel.pricing?.completion
    // OpenRouter prices are per token — same calculation as CreateTest
    const { estimatedCost } = calculateEstimatedCost(inputTokens, outputTokens, selectedModel)

    return {
      inputTokens,
      outputTokens,
      estimatedCost,
      contextUsage,
      contextLimit,
      hasPricing,
      numBatches,
    }
  }, [formData.document_ids, formData.ai_model_id, formData.num_cards, documents, models])

  const selectedModelName = models.find((m) => m.id === formData.ai_model_id)?.name

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Create Flashcard Deck"
        description="Generate AI-powered flashcards from your study materials."
      />

      <StepIndicator steps={['Subject & Materials', 'Configure', 'Generate']} current={step} />

      {/* Step 1: Subject and documents */}
      {step === 1 && (
        <MaterialsStep
          subjects={subjects}
          subjectId={formData.subject_id}
          onSubjectChange={handleSubjectChange}
          documents={documents}
          documentIds={formData.document_ids}
          onDocumentIdsChange={(ids) => setFormData((prev) => ({ ...prev, document_ids: ids }))}
          generates="flashcards"
          onContinue={() => setStep(2)}
        />
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Configure Deck</CardTitle>
            <CardDescription>
              Set up your flashcard deck parameters and choose an AI model
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Deck Title / Topic</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder={
                  formData.document_ids.length === 0
                    ? 'e.g., Python Programming, AWS Cloud Fundamentals'
                    : 'e.g., AWS Solutions Architect Study Cards'
                }
              />
              {formData.document_ids.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Since no documents are selected, the AI will generate cards based on this topic
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this deck..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="num_cards">Number of Flashcards</Label>
              <Select
                value={String(formData.num_cards)}
                onValueChange={(v) => setFormData({ ...formData, num_cards: parseInt(v) })}
              >
                <SelectTrigger id="num_cards">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CARD_COUNT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} flashcards
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>AI Model</Label>
              <div className="grid gap-2" role="radiogroup" aria-label="AI Model">
                {models.map((model) => (
                  <OptionCard
                    key={model.id}
                    indicator="radio"
                    selected={formData.ai_model_id === model.id}
                    onClick={() => setFormData({ ...formData, ai_model_id: model.id })}
                  >
                    <ModelOptionLabel model={model} />
                  </OptionCard>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom_prompt">Custom Instructions (Optional)</Label>
              <Textarea
                id="custom_prompt"
                value={formData.custom_prompt}
                onChange={(e) => setFormData({ ...formData, custom_prompt: e.target.value })}
                placeholder="e.g., Focus on practical concepts, include code examples..."
                rows={3}
              />
            </div>

            <div className="flex justify-between border-t pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canProceedStep2}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Generate */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ready to Generate</CardTitle>
            <CardDescription>Review your settings and generate flashcards</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <dl className="divide-y rounded-lg border text-sm">
              {([
                ['Title', formData.title],
                ['Subject', selectedSubject?.title ?? 'No subject'],
                ['Documents', formData.document_ids.length > 0 ? `${formData.document_ids.length} selected` : 'None (topic-based)'],
                ['Flashcards', formData.num_cards],
                ['AI model', selectedModelName],
              ] as const).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {/* Cost Estimation */}
            {estimates && (
              <CostEstimate
                estimates={estimates}
                overLimitMessage="Warning: Your documents exceed this model's context window. The generation will likely fail. Please select fewer documents or a model with a larger context window."
              />
            )}

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
                {error}
              </div>
            )}

            {/* Flashcard generation reports no batch progress — static waiting panel */}
            {isGenerating && <GenerationStatus progress={null} />}

            <div className="flex justify-between border-t pt-4">
              <Button variant="outline" onClick={() => setStep(2)} disabled={isGenerating}>
                Back
              </Button>
              <Button onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Flashcards
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

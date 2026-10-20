import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Loader2, FileText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { documentsApi, modelsApi, flashcardsApi } from '@/services/api'
import { calculateEstimatedCost, calculateFlashcardGenerationTokens } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StepIndicator } from '@/components/StepIndicator'
import { CostEstimate } from '@/components/CostEstimate'
import { GenerationStatus } from '@/components/GenerationStatus'
import { OptionCard, ModelOptionLabel, DocumentOptionLabel } from '@/components/OptionCard'
import { queryKeys } from '@/lib/constants'

const CARD_COUNT_OPTIONS = [10, 15, 20, 25, 30, 40, 50]

export default function CreateFlashcards() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    num_cards: 20,
    ai_model_id: 0,
    document_ids: [] as number[],
    custom_prompt: '',
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

  const handleDocumentToggle = (docId: number) => {
    setFormData((prev) => ({
      ...prev,
      document_ids: prev.document_ids.includes(docId)
        ? prev.document_ids.filter((id) => id !== docId)
        : [...prev.document_ids, docId],
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
      })

      // Refresh the deck list so it shows the new deck when the user
      // navigates back (staleTime 5 min would otherwise serve stale data)
      queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })

      // Navigate to the deck
      navigate(`/flashcards/${result.deck.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create flashcard deck')
      setIsGenerating(false)
    }
  }

  const canProceedStep2 = formData.title && formData.ai_model_id > 0

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

      <StepIndicator steps={['Select Documents', 'Configure', 'Generate']} current={step} />

      {/* Step 1: Select Documents */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Study Materials (Optional)</CardTitle>
            <CardDescription>
              Choose documents to generate flashcards from, or skip to create cards on a topic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {documents.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents available"
                description="You can still create flashcards by specifying a topic."
                action={
                  <>
                    <Button variant="outline" onClick={() => navigate('/documents')}>
                      Add Documents
                    </Button>
                    <Button onClick={() => setStep(2)}>
                      Continue Without Documents
                    </Button>
                  </>
                }
              />
            ) : (
              <>
                {formData.document_ids.length === 0 && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                    No documents selected. The AI will generate flashcards based on your deck title/topic.
                  </p>
                )}
                <div className="grid gap-2">
                  {documents.map((doc) => (
                    <OptionCard
                      key={doc.id}
                      indicator="checkbox"
                      selected={formData.document_ids.includes(doc.id)}
                      onClick={() => handleDocumentToggle(doc.id)}
                    >
                      <DocumentOptionLabel title={doc.title} docType={doc.doc_type} />
                    </OptionCard>
                  ))}
                </div>
                <div className="flex justify-end border-t pt-4">
                  <Button onClick={() => setStep(2)}>Continue</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
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

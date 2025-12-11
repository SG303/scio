import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Sparkles, Loader2, FileText, CheckCircle2, Coins } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { documentsApi, modelsApi, flashcardsApi } from '@/services/api'
import { cn, formatPricePerMillion } from '@/lib/utils'

const CARD_COUNT_OPTIONS = [10, 15, 20, 25, 30, 40, 50]

export default function CreateFlashcards() {
  const navigate = useNavigate()
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
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  })

  const { data: models = [] } = useQuery({
    queryKey: ['models', true],
    queryFn: () => modelsApi.list(true),
  })

  const createDeckMutation = useMutation({
    mutationFn: flashcardsApi.createDeck,
  })

  const generateMutation = useMutation({
    mutationFn: ({ deckId, numCards }: { deckId: number; numCards: number }) =>
      flashcardsApi.generateCards(deckId, { num_cards: numCards }),
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
      // First create the deck
      const deck = await createDeckMutation.mutateAsync({
        title: formData.title,
        description: formData.description || undefined,
        ai_model_id: formData.ai_model_id,
        document_ids: formData.document_ids.length > 0 ? formData.document_ids : undefined,
        custom_prompt: formData.custom_prompt || undefined,
      })

      // Then generate the cards
      await generateMutation.mutateAsync({
        deckId: deck.id,
        numCards: formData.num_cards,
      })

      // Navigate to the deck
      navigate(`/flashcards/${deck.id}`)
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

    // Rough estimation: ~500 tokens per document + ~100 output tokens per card
    const documentTokens = formData.document_ids.reduce((acc, id) => {
      const doc = documents.find(d => d.id === id)
      return acc + (doc?.content?.length || 0) / 4 // ~4 chars per token
    }, 0)

    const inputTokens = Math.max(500, documentTokens + 500) // minimum 500 for prompt
    const outputTokens = formData.num_cards * 100 // ~100 tokens per card

    const hasPricing = selectedModel.pricing?.prompt && selectedModel.pricing?.completion
    let estimatedCost = 0

    if (hasPricing) {
      const promptPrice = parseFloat(selectedModel.pricing!.prompt)
      const completionPrice = parseFloat(selectedModel.pricing!.completion)
      estimatedCost = (inputTokens * promptPrice + outputTokens * completionPrice) / 1_000_000
    }

    return {
      inputTokens,
      outputTokens,
      estimatedCost,
      hasPricing,
    }
  }, [formData.document_ids, formData.ai_model_id, formData.num_cards, documents, models])

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Create Flashcard Deck</h1>
        <p className="text-muted-foreground">
          Generate AI-powered flashcards from your study materials
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-4">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                step >= s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {step > s ? <CheckCircle2 className="h-4 w-4" /> : s}
            </div>
            <span
              className={cn(
                'text-sm font-medium',
                step >= s ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {s === 1 ? 'Select Documents' : s === 2 ? 'Configure' : 'Generate'}
            </span>
            {s < 3 && <div className="w-12 h-px bg-muted ml-2" />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Documents */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Study Materials (Optional)</CardTitle>
            <CardDescription>
              Choose documents to generate flashcards from, or skip to create cards on a topic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {documents.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">
                  No documents available. You can still create flashcards by specifying a topic.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={() => navigate('/documents')}>
                    Add Documents
                  </Button>
                  <Button onClick={() => setStep(2)}>
                    Continue Without Documents
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {formData.document_ids.length === 0 && (
                  <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-4 text-center text-sm text-muted-foreground">
                    No documents selected. The AI will generate flashcards based on your deck title/topic.
                  </div>
                )}
                <div className="grid gap-3">
                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => handleDocumentToggle(doc.id)}
                      className={cn(
                        'flex items-center gap-4 p-4 rounded-lg border text-left transition-all',
                        formData.document_ids.includes(doc.id)
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'hover:bg-muted/50'
                      )}
                    >
                      <div
                        className={cn(
                          'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
                          formData.document_ids.includes(doc.id)
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {formData.document_ids.includes(doc.id) && (
                          <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium">{doc.title}</h4>
                        <p className="text-sm text-muted-foreground capitalize">
                          {doc.doc_type.replace('_', ' ')}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-end pt-4">
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
            <CardTitle>Configure Deck</CardTitle>
            <CardDescription>
              Set up your flashcard deck parameters
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
                <SelectTrigger>
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
              <div className="grid gap-3">
                {models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, ai_model_id: model.id })}
                    className={cn(
                      'flex items-start gap-4 p-4 rounded-lg border text-left transition-all',
                      formData.ai_model_id === model.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div
                      className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors',
                        formData.ai_model_id === model.id
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground/30'
                      )}
                    >
                      {formData.ai_model_id === model.id && (
                        <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <h4 className="font-medium">{model.name}</h4>
                        {model.context_length && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                            {Math.round(model.context_length / 1000)}k ctx
                          </span>
                        )}
                      </div>
                      {model.description && (
                        <p className="text-sm text-muted-foreground">{model.description}</p>
                      )}
                      {model.pricing && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatPricePerMillion(model.pricing.prompt)} / {formatPricePerMillion(model.pricing.completion)} per 1M tokens
                        </p>
                      )}
                    </div>
                  </button>
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

            <div className="flex justify-between pt-4">
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
            <CardTitle>Ready to Generate</CardTitle>
            <CardDescription>Review your settings and generate flashcards</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Title</span>
                <span className="font-medium">{formData.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Documents</span>
                <span className="font-medium">
                  {formData.document_ids.length > 0
                    ? `${formData.document_ids.length} selected`
                    : 'None (topic-based)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Flashcards</span>
                <span className="font-medium">{formData.num_cards}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AI Model</span>
                <span className="font-medium">
                  {models.find((m) => m.id === formData.ai_model_id)?.name}
                </span>
              </div>
            </div>

            {/* Cost Estimation */}
            {estimates && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Coins className="h-4 w-4 text-primary" />
                  <h4 className="font-medium text-sm">Estimated Cost</h4>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block mb-1">Estimated Cost</span>
                    {estimates.hasPricing ? (
                      <span className="font-semibold text-lg">
                        ${estimates.estimatedCost.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">Pricing unavailable</span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Est. Tokens</span>
                    <span className="font-medium">
                      ~{Math.round(estimates.inputTokens / 1000)}k in / ~{Math.round(estimates.outputTokens / 1000)}k out
                    </span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
                {error}
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(2)} disabled={isGenerating}>
                Back
              </Button>
              <Button onClick={handleGenerate} disabled={isGenerating} size="lg">
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

            {isGenerating && (
              <div className="text-center text-sm text-muted-foreground">
                <p>This may take a minute depending on the AI model...</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}


import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Sparkles, Loader2, FileText, CheckCircle2, Coins } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { documentsApi, modelsApi, testsApi } from '@/services/api'
import { cn, calculateEstimatedCost, formatPricePerMillion, calculateTestGenerationTokens } from '@/lib/utils'
import { QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES } from '@/lib/constants'

export default function CreateTest() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    title: '',
    num_questions: DEFAULT_NUM_QUESTIONS,
    num_choices: DEFAULT_NUM_CHOICES,
    ai_model_id: 0,
    document_ids: [] as number[],
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

  const createConfigMutation = useMutation({
    mutationFn: testsApi.createConfig,
  })

  const generateMutation = useMutation({
    mutationFn: async (configId: number) => {
      return testsApi.generate(configId)
    },
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
      // First create the config
      const config = await createConfigMutation.mutateAsync(formData)
      
      // Then generate the test
      const test = await generateMutation.mutateAsync(config.id)
      
      // Navigate to the test
      navigate(`/test/${test.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate test')
      setIsGenerating(false)
    }
  }

  const canProceedStep2 = formData.title && formData.ai_model_id > 0

  // Calculate estimated cost and tokens
  const estimates = useMemo(() => {
    if (formData.ai_model_id === 0) return null

    const selectedModel = models.find(m => m.id === formData.ai_model_id)
    if (!selectedModel) return null

    // Get document contents
    const documentContents = formData.document_ids.map(id => {
      const doc = documents.find(d => d.id === id)
      return doc?.content || ''
    })

    // Calculate tokens using improved estimation
    const { inputTokens, outputTokens, numBatches } = calculateTestGenerationTokens(
      documentContents,
      formData.num_questions,
      false // CreateTest doesn't have custom prompt
    )

    const contextLimit = selectedModel.context_length || 128000
    // Context usage is per-batch (each batch must fit in context)
    const perBatchInputTokens = inputTokens / numBatches
    const perBatchOutputTokens = outputTokens / numBatches
    const perBatchTotal = perBatchInputTokens + perBatchOutputTokens
    const contextUsage = (perBatchTotal / contextLimit) * 100

    // Check if pricing is available
    const hasPricing = selectedModel.pricing?.prompt && selectedModel.pricing?.completion

    const { estimatedCost } = calculateEstimatedCost(
      inputTokens,
      outputTokens,
      selectedModel
    )

    return {
      inputTokens,
      outputTokens,
      estimatedCost,
      contextUsage,
      contextLimit,
      hasPricing,
      numBatches
    }
  }, [formData.document_ids, formData.ai_model_id, formData.num_questions, documents, models])

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Create Practice Test</h1>
        <p className="text-muted-foreground">
          Generate a custom practice test from your study materials
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
              Choose documents to use as context, or skip to generate questions on a topic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {documents.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">
                  No documents available. You can still create a test by specifying a topic.
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
                    No documents selected. The AI will generate questions based on your test title/topic.
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
                  <Button onClick={() => setStep(2)}>
                    Continue
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Configure Test */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Configure Test</CardTitle>
            <CardDescription>
              Set up your test parameters and choose an AI model
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Test Title / Topic</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder={formData.document_ids.length === 0 
                  ? "e.g., Python Programming Basics, AWS Cloud Fundamentals" 
                  : "e.g., AWS Solutions Architect Practice Test"}
              />
              {formData.document_ids.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Since no documents are selected, the AI will generate questions based on this topic
                </p>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="questions">Number of Questions</Label>
                <Select
                  value={String(formData.num_questions)}
                  onValueChange={(v) => setFormData({ ...formData, num_questions: parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_COUNT_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} questions
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="choices">Choices per Question</Label>
                <Select
                  value={String(formData.num_choices)}
                  onValueChange={(v) => setFormData({ ...formData, num_choices: parseInt(v) })}
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
            <CardDescription>Review your settings and generate the test</CardDescription>
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
                <span className="text-muted-foreground">Questions</span>
                <span className="font-medium">{formData.num_questions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Choices per Question</span>
                <span className="font-medium">{formData.num_choices}</span>
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
              <div className={cn(
                "rounded-lg border p-4 space-y-3",
                estimates.contextUsage > 100 ? "border-destructive/50 bg-destructive/5" : "border-primary/20 bg-primary/5"
              )}>
                <div className="flex items-center gap-2 mb-2">
                  <Coins className="h-4 w-4 text-primary" />
                  <h4 className="font-medium text-sm">Estimated Cost & Usage</h4>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block mb-1">Estimated Cost</span>
                    {estimates.hasPricing ? (
                      <span className="font-semibold text-lg">
                        ${estimates.estimatedCost.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">
                        Pricing unavailable
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Context Usage</span>
                    <span className={cn(
                      "font-semibold text-lg",
                      estimates.contextUsage > 100 ? "text-destructive" : "text-foreground"
                    )}>
                      {estimates.contextUsage.toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({Math.round(estimates.inputTokens / 1000)}k / {Math.round(estimates.contextLimit / 1000)}k)
                    </span>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground">
                  ~{estimates.inputTokens.toLocaleString()} input + ~{estimates.outputTokens.toLocaleString()} output tokens
                  {estimates.numBatches > 1 && (
                    <span className="ml-1">({estimates.numBatches} API calls)</span>
                  )}
                </div>

                {estimates.contextUsage > 100 && (
                  <div className="text-xs text-destructive font-medium mt-2">
                    Warning: Your documents exceed this model's context window. The generation will likely fail. Please select fewer documents or a model with a larger context window.
                  </div>
                )}
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
                    Generate Test
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

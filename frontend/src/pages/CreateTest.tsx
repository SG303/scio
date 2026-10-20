import { useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Loader2, FileText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { documentsApi, modelsApi, testsApi } from '@/services/api'
import { useGenerationProgress } from '@/hooks/useGenerationProgress'
import { calculateEstimatedCost, calculateTestGenerationTokens } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StepIndicator } from '@/components/StepIndicator'
import { CostEstimate } from '@/components/CostEstimate'
import { GenerationStatus } from '@/components/GenerationStatus'
import { OptionCard, ModelOptionLabel, DocumentOptionLabel } from '@/components/OptionCard'
import { QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES, queryKeys } from '@/lib/constants'

export default function CreateTest() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    title: '',
    num_questions: DEFAULT_NUM_QUESTIONS,
    num_choices: DEFAULT_NUM_CHOICES,
    ai_model_id: 0,
    document_ids: [] as number[],
  })
  const [isGenerating, setIsGenerating] = useState(false)
  // P6.2: live progress instead of an endless spinner
  const { progress, start: startProgress, cancel: cancelProgress, reset: resetProgress } = useGenerationProgress()
  const generationAbortRef = useRef<AbortController | null>(null)
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

    // P6.2: token lets the backend report batch progress while we wait
    const progressToken = crypto.randomUUID()
    startProgress(progressToken)
    const abortController = new AbortController()
    generationAbortRef.current = abortController

    try {
      // P5.2: config + test in one call — a failed generation no longer
      // leaves an empty config behind
      const test = await testsApi.createAndGenerate(
        { ...formData },
        progressToken,
        abortController.signal,
      )

      // Refresh the tests list so it shows the new test when the user
      // navigates back (staleTime 5 min would otherwise serve stale data)
      queryClient.invalidateQueries({ queryKey: queryKeys.tests })

      // Navigate to the test
      navigate(`/test/${test.id}`)
    } catch (err) {
      if (abortController.signal.aborted) {
        setError('Generation cancelled.')
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to generate test')
      setIsGenerating(false)
    } finally {
      generationAbortRef.current = null
      setIsGenerating(false)
      resetProgress()
    }
  }

  // P6.2: stop waiting — the backend aborts at the next batch boundary
  // and discards the partial result
  const handleCancelGeneration = async () => {
    const accepted = await cancelProgress()
    if (accepted) {
      generationAbortRef.current?.abort()
      setError('Generation cancelled.')
    } else {
      setError('Generation has already finished and can no longer be cancelled.')
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

  const selectedModelName = models.find((m) => m.id === formData.ai_model_id)?.name

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Create Practice Test"
        description="Generate a custom practice test from your study materials."
      />

      <StepIndicator steps={['Select Documents', 'Configure', 'Generate']} current={step} />

      {/* Step 1: Select Documents */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select Study Materials (Optional)</CardTitle>
            <CardDescription>
              Choose documents to use as context, or skip to generate questions on a topic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {documents.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents available"
                description="You can still create a test by specifying a topic."
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
                    No documents selected. The AI will generate questions based on your test title/topic.
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
            <CardTitle className="text-base">Configure Test</CardTitle>
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

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="questions">Number of Questions</Label>
                <Select
                  value={String(formData.num_questions)}
                  onValueChange={(v) => setFormData({ ...formData, num_questions: parseInt(v) })}
                >
                  <SelectTrigger id="questions">
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
                  <SelectTrigger id="choices">
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
            <CardDescription>Review your settings and generate the test</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <dl className="divide-y rounded-lg border text-sm">
              {([
                ['Title', formData.title],
                ['Documents', formData.document_ids.length > 0 ? `${formData.document_ids.length} selected` : 'None (topic-based)'],
                ['Questions', formData.num_questions],
                ['Choices per question', formData.num_choices],
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

            {/* P6.2: real progress from the backend when available */}
            {isGenerating && (
              <GenerationStatus progress={progress} onCancel={handleCancelGeneration} />
            )}

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
                    Generate Test
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

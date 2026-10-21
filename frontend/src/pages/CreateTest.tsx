import { useState, useMemo, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { documentsApi, modelsApi, subjectsApi, testsApi } from '@/services/api'
import { useGenerationProgress } from '@/hooks/useGenerationProgress'
import { calculateEstimatedCost, calculateTestGenerationTokens } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { QueryState } from '@/components/QueryState'
import { StepIndicator } from '@/components/StepIndicator'
import { CostEstimate } from '@/components/CostEstimate'
import { GenerationStatus } from '@/components/GenerationStatus'
import { MaterialsStep, withSubjectDefaults } from '@/components/MaterialsStep'
import { OptionCard, ModelOptionLabel } from '@/components/OptionCard'
import { toast } from '@/components/Toaster'
import { QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES, queryKeys } from '@/lib/constants'
import type { SubjectListItem, TestConfig } from '@/types'

const NO_TEMPLATE = 'none'

/**
 * Loads subjects and templates first, so `?subject=` / `?template=` can
 * pre-fill the wizard's initial state (no state syncing in effects).
 */
export default function CreateTest() {
  const [searchParams] = useSearchParams()

  const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
    queryKey: queryKeys.subjects,
    queryFn: subjectsApi.list,
  })

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: queryKeys.templates,
    queryFn: testsApi.listTemplates,
  })

  if (subjectsLoading || templatesLoading) {
    return <QueryState loading />
  }

  const initialSubject = subjects.find((s) => String(s.id) === searchParams.get('subject')) ?? null
  const initialTemplate = templates.find((t) => String(t.id) === searchParams.get('template')) ?? null

  return (
    <CreateTestWizard
      subjects={subjects}
      templates={templates}
      initialSubject={initialSubject}
      initialTemplate={initialTemplate}
    />
  )
}

/** Form values a template provides — the template itself is never linked. */
function templateValues(template: TestConfig) {
  return {
    title: template.title,
    num_questions: template.num_questions,
    num_choices: template.num_choices,
    ai_model_id: template.ai_model_id,
    document_ids: template.document_ids,
    custom_prompt: template.custom_prompt ?? '',
  }
}

function CreateTestWizard({
  subjects,
  templates,
  initialSubject,
  initialTemplate,
}: {
  subjects: SubjectListItem[]
  templates: TestConfig[]
  initialSubject: SubjectListItem | null
  initialTemplate: TestConfig | null
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState(() => {
    const base = initialTemplate
      ? templateValues(initialTemplate)
      : {
          title: '',
          num_questions: DEFAULT_NUM_QUESTIONS,
          num_choices: DEFAULT_NUM_CHOICES,
          ai_model_id: 0,
          document_ids: [] as number[],
          custom_prompt: '',
        }
    return {
      ...base,
      ai_model_id: base.ai_model_id || initialSubject?.ai_model_id || 0,
      document_ids: withSubjectDefaults(base.document_ids, null, initialSubject),
      subject_id: initialSubject?.id ?? null,
    }
  })
  // Template used to pre-fill the form (values are copied, never linked)
  const [templateId, setTemplateId] = useState<number | null>(initialTemplate?.id ?? null)
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
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

  const selectedSubject = subjects.find((s) => s.id === formData.subject_id) ?? null

  const handleSubjectChange = (subject: SubjectListItem | null) => {
    setFormData((prev) => ({
      ...prev,
      subject_id: subject?.id ?? null,
      // the subject's default model only fills an empty choice
      ai_model_id: prev.ai_model_id || subject?.ai_model_id || 0,
    }))
  }

  const handleTemplateChange = (value: string) => {
    const template = templates.find((t) => String(t.id) === value)
    setTemplateId(template?.id ?? null)
    if (!template) return
    setSaveAsTemplate(false)
    setFormData((prev) => {
      const values = templateValues(template)
      return {
        ...prev,
        ...values,
        document_ids: withSubjectDefaults(values.document_ids, null, selectedSubject),
      }
    })
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
      const settings = {
        title: formData.title,
        num_questions: formData.num_questions,
        num_choices: formData.num_choices,
        ai_model_id: formData.ai_model_id,
        document_ids: formData.document_ids,
        custom_prompt: formData.custom_prompt || null,
      }
      const test = await testsApi.createAndGenerate(
        { ...settings, subject_id: formData.subject_id },
        progressToken,
        abortController.signal,
      )

      // Refresh the tests list so it shows the new test when the user
      // navigates back (staleTime 5 min would otherwise serve stale data)
      queryClient.invalidateQueries({ queryKey: queryKeys.tests })
      if (formData.subject_id !== null) {
        queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
        queryClient.invalidateQueries({ queryKey: queryKeys.subject(formData.subject_id) })
      }

      // A separate template record — the generated test never hangs on it,
      // so editing or deleting the template keeps this test. A failure here
      // must not hide the (already paid for) test.
      if (saveAsTemplate) {
        try {
          await testsApi.createTemplate(settings)
          queryClient.invalidateQueries({ queryKey: queryKeys.templates })
          toast.success('Template saved')
        } catch {
          toast.error('The test was created, but the template could not be saved.')
        }
      }

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

  const canProceedStep2 = formData.title && models.some((m) => m.id === formData.ai_model_id)

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
      !!formData.custom_prompt
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
  }, [formData.document_ids, formData.ai_model_id, formData.num_questions, formData.custom_prompt, documents, models])

  const selectedModelName = models.find((m) => m.id === formData.ai_model_id)?.name
  const selectedTemplateName = templates.find((t) => t.id === templateId)?.title

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Create Practice Test"
        description="Generate a custom practice test from your study materials."
      />

      <StepIndicator steps={['Subject & Materials', 'Configure', 'Generate']} current={step} />

      {/* Step 1: Subject, template and documents */}
      {step === 1 && (
        <MaterialsStep
          subjects={subjects}
          subjectId={formData.subject_id}
          onSubjectChange={handleSubjectChange}
          documents={documents}
          documentIds={formData.document_ids}
          onDocumentIdsChange={(ids) => setFormData((prev) => ({ ...prev, document_ids: ids }))}
          generates="questions"
          onContinue={() => setStep(2)}
        >
          {templates.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="template">Start from template (optional)</Label>
                <Link
                  to="/settings/templates"
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Manage templates
                </Link>
              </div>
              <Select
                value={templateId !== null ? String(templateId) : NO_TEMPLATE}
                onValueChange={handleTemplateChange}
              >
                <SelectTrigger id="template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Copies the template's settings into this test. You can still change everything.
              </p>
            </div>
          )}
        </MaterialsStep>
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

            <div className="space-y-2">
              <Label htmlFor="custom_prompt">Custom Instructions (Optional)</Label>
              <Textarea
                id="custom_prompt"
                value={formData.custom_prompt}
                onChange={(e) => setFormData({ ...formData, custom_prompt: e.target.value })}
                placeholder="e.g., Focus on scenario-based questions, make them progressively harder..."
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
            <CardDescription>Review your settings and generate the test</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <dl className="divide-y rounded-lg border text-sm">
              {([
                ['Title', formData.title],
                ['Subject', selectedSubject?.title ?? 'No subject'],
                ...(selectedTemplateName ? [['Template', selectedTemplateName] as const] : []),
                ['Documents', formData.document_ids.length > 0 ? `${formData.document_ids.length} selected` : 'None (topic-based)'],
                ['Questions', formData.num_questions],
                ['Choices per question', formData.num_choices],
                ['AI model', selectedModelName],
                ['Custom instructions', formData.custom_prompt ? 'Yes' : 'None'],
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

            {templateId === null && (
              <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  disabled={isGenerating}
                />
                <span>
                  <span className="font-medium">Save these settings as a template</span>
                  <span className="block text-xs text-muted-foreground">
                    Reuse them for future tests. Templates are managed in Settings.
                  </span>
                </span>
              </label>
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

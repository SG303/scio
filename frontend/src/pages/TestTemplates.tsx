import { useState, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/Toaster'
import {
  FileText,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Copy,
  ChevronDown,
  ChevronUp,
  Pencil,
  ArrowRight,
  ClipboardList,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
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
import { documentsApi, modelsApi, testsApi } from '@/services/api'
import { cn, calculateEstimatedCost, calculateTestGenerationTokens, getScoreColor } from '@/lib/utils'
import { TEMPLATE_QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, QUESTION_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES, queryKeys } from '@/lib/constants'
import { ScoreSparkline } from '@/components/ScoreSparkline'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListIcon, ListRow, RowActions } from '@/components/List'
import { TestRow } from '@/components/TestRow'
import { StepIndicator } from '@/components/StepIndicator'
import { CostEstimate } from '@/components/CostEstimate'
import { OptionCard, ModelOptionLabel, DocumentOptionLabel } from '@/components/OptionCard'
import { useGenerationProgress } from '@/hooks/useGenerationProgress'
import { GenerationStatus } from '@/components/GenerationStatus'
import type { TestConfig } from '@/types'

export default function TestTemplates() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  // State for create/edit template dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TestConfig | null>(null)
  const [createStep, setCreateStep] = useState(1)
  const [formData, setFormData] = useState({
    title: '',
    num_questions: DEFAULT_NUM_QUESTIONS,
    num_choices: DEFAULT_NUM_CHOICES,
    ai_model_id: 0,
    document_ids: [] as number[],
    custom_prompt: '',
  })
  
  // State for generate dialog
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<TestConfig | null>(null)
  const [generateNumQuestions, setGenerateNumQuestions] = useState(10)
  const [isGenerating, setIsGenerating] = useState(false)
  // P6.2: live progress instead of an endless spinner
  const { progress, start: startProgress, cancel: cancelProgress, reset: resetProgress } = useGenerationProgress()
  const generationAbortRef = useRef<AbortController | null>(null)
  
  // State for expanded templates (to show custom prompt)
  const [expandedTemplates, setExpandedTemplates] = useState<Set<number>>(new Set())
  
  // Track which template is being deleted
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null)
  
  // Queries
  const { data: templates = [], isLoading, error: templatesError, refetch: refetchTemplates } = useQuery({
    queryKey: queryKeys.templates,
    queryFn: testsApi.listTemplates,
  })
  
  const { data: documents = [] } = useQuery({
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })
  
  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
  })
  
  const { data: tests = [] } = useQuery({
    queryKey: queryKeys.tests,
    queryFn: testsApi.list,
  })

  // P5.1: score history per template for the sparkline cards.
  // With few templates a query per template is cheap and keeps the code simple.
  const { data: templatesWithTests = [] } = useQuery({
    queryKey: ['templates-with-scores', templates],
    queryFn: async () =>
      Promise.all(
        templates.map(async (tpl) => {
          const scores = await testsApi.getConfigScores(tpl.id)
          return { templateId: tpl.id, scores }
        })
      ),
    enabled: templates.length > 0,
    initialData: templates.map((tpl) => ({ templateId: tpl.id, scores: [] as number[] })),
  })
  const scoresByTemplate = new Map(templatesWithTests.map((t) => [t.templateId, t.scores]))
  
  // Mutations
  const createMutation = useMutation({
    mutationFn: testsApi.createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates })
      setShowCreateDialog(false)
      resetForm()
    },
  })
  
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof formData }) =>
      testsApi.updateTemplate(id, {
        ...data,
        custom_prompt: data.custom_prompt || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates })
      setShowCreateDialog(false)
      resetForm()
    },
  })
  
  const deleteMutation = useMutation({
    mutationFn: testsApi.deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates })
      setDeletingTemplateId(null)
    },
    onError: () => {
      setDeletingTemplateId(null)
      toast.error('Could not delete the template.')
    },
  })
  
  const generateMutation = useMutation({
    mutationFn: ({ templateId, numQuestions, progressToken, signal }: {
      templateId: number
      numQuestions: number
      progressToken?: string
      signal?: AbortSignal
    }) => testsApi.generateFromTemplate(templateId, numQuestions, progressToken, signal),
    onSuccess: (test) => {
      setShowGenerateDialog(false)
      setIsGenerating(false)
      navigate(`/test/${test.id}`)
    },
    onError: () => {
      setIsGenerating(false)
    },
  })
  
  const resetForm = () => {
    setFormData({
      title: '',
      num_questions: 10,
      num_choices: 4,
      ai_model_id: 0,
      document_ids: [],
      custom_prompt: '',
    })
    setCreateStep(1)
    setEditingTemplate(null)
  }
  
  const handleDocumentToggle = (docId: number) => {
    setFormData((prev) => ({
      ...prev,
      document_ids: prev.document_ids.includes(docId)
        ? prev.document_ids.filter((id) => id !== docId)
        : [...prev.document_ids, docId],
    }))
  }
  
  // P3.1 (M5): surface failures — previously these awaited mutations
  // rejected unhandled and the dialog just stayed open
  const handleCreateTemplate = async () => {
    try {
      await createMutation.mutateAsync({
        ...formData,
        custom_prompt: formData.custom_prompt || null,
      })
    } catch {
      toast.error('Could not create the template. Please try again.')
    }
  }
  
  const handleUpdateTemplate = async () => {
    if (!editingTemplate) return
    try {
      await updateMutation.mutateAsync({
        id: editingTemplate.id,
        data: formData,
      })
    } catch {
      toast.error('Could not save the template. Please try again.')
    }
  }
  
  const handleOpenEditDialog = (template: TestConfig) => {
    setEditingTemplate(template)
    setFormData({
      title: template.title,
      num_questions: template.num_questions,
      num_choices: template.num_choices,
      ai_model_id: template.ai_model_id,
      document_ids: template.document_ids,
      custom_prompt: template.custom_prompt || '',
    })
    setCreateStep(1)
    setShowCreateDialog(true)
  }
  
  const handleOpenGenerateDialog = (template: TestConfig) => {
    setSelectedTemplate(template)
    setGenerateNumQuestions(template.num_questions)
    setShowGenerateDialog(true)
  }
  
  const handleGenerate = async () => {
    if (!selectedTemplate) return
    setIsGenerating(true)
    // P6.2: token lets the backend report batch progress while we wait
    const progressToken = crypto.randomUUID()
    startProgress(progressToken)
    const abortController = new AbortController()
    generationAbortRef.current = abortController
    try {
      await generateMutation.mutateAsync({
        templateId: selectedTemplate.id,
        numQuestions: generateNumQuestions,
        progressToken,
        signal: abortController.signal,
      })
    } catch {
      if (!abortController.signal.aborted) {
        // generateMutation.onError already resets isGenerating
        toast.error('Could not generate the test. Please try again.')
      }
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
      toast.success('Cancellation requested.')
    } else {
      toast.error('Generation has already finished and can no longer be cancelled.')
    }
  }
  
  const toggleExpanded = (templateId: number) => {
    setExpandedTemplates((prev) => {
      const next = new Set(prev)
      if (next.has(templateId)) {
        next.delete(templateId)
      } else {
        next.add(templateId)
      }
      return next
    })
  }
  
  const getModelName = (modelId: number) => {
    const model = models.find((m) => m.id === modelId)
    return model?.name || 'Unknown Model'
  }
  
  // Calculate estimated cost and tokens for the Generate Dialog
  const generateEstimates = useMemo(() => {
    if (!selectedTemplate || !showGenerateDialog) return null

    const selectedModel = models.find(m => m.id === selectedTemplate.ai_model_id)
    if (!selectedModel) return null

    // Get document contents
    const documentContents = selectedTemplate.document_ids.map(id => {
      const doc = documents.find(d => d.id === id)
      return doc?.content || ''
    })

    // Calculate tokens using improved estimation
    const { inputTokens, outputTokens, numBatches } = calculateTestGenerationTokens(
      documentContents,
      generateNumQuestions,
      !!selectedTemplate.custom_prompt
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
  }, [selectedTemplate, generateNumQuestions, documents, models, showGenerateDialog])

  const canProceedStep2 = formData.ai_model_id > 0 && formData.title.trim() !== ''
  const recentTests = tests.slice(0, 5)
  
  // P3.3 pattern: a failed query is an error, not an empty template list
  if (isLoading || templatesError) {
    return <QueryState loading={isLoading} error={templatesError} onRetry={refetchTemplates} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Test Templates"
        description="Create reusable templates for daily practice tests."
        actions={
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={Copy}
          title="No templates yet"
          description="Create a template to quickly generate practice tests for daily learning."
          action={
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Template
            </Button>
          }
        />
      ) : (
        <section className="space-y-3">
          <SectionHeader title="Templates" meta={templates.length} />
          <List>
            {templates.map((template) => {
              // P5.1: score trend from completed tests of this template
              const scores = scoresByTemplate.get(template.id) ?? []
              const isExpanded = expandedTemplates.has(template.id)
              return (
                <div key={template.id}>
                  <ListRow>
                    <ListIcon>
                      <Copy />
                    </ListIcon>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium">{template.title}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {template.num_questions} questions · {template.num_choices} choices ·{' '}
                        {getModelName(template.ai_model_id)} ·{' '}
                        {template.document_ids.length > 0
                          ? `${template.document_ids.length} document${template.document_ids.length > 1 ? 's' : ''}`
                          : 'Topic-based'}
                      </p>
                    </div>
                    {scores.length >= 2 && (
                      <div
                        className="hidden shrink-0 items-center gap-3 text-muted-foreground md:flex"
                        title="Score trend (recent tests)"
                      >
                        <ScoreSparkline scores={scores} />
                        <span className="w-24 text-xs">
                          <span className={cn('font-semibold tabular-nums', getScoreColor(scores[scores.length - 1]))}>
                            {scores[scores.length - 1]}%
                          </span>{' '}
                          last
                        </span>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => handleOpenGenerateDialog(template)}
                    >
                      <Sparkles className="h-4 w-4 sm:mr-2" />
                      <span className="sr-only sm:not-sr-only">Generate Test</span>
                    </Button>
                    {deletingTemplateId === template.id ? (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <RowActions label={`Actions for ${template.title}`}>
                        <DropdownMenuItem onClick={() => handleOpenEditDialog(template)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {template.custom_prompt && (
                          <DropdownMenuItem onClick={() => toggleExpanded(template.id)}>
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 mr-2" />
                            ) : (
                              <ChevronDown className="h-4 w-4 mr-2" />
                            )}
                            {isExpanded ? 'Hide custom prompt' : 'Show custom prompt'}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setDeletingTemplateId(template.id)
                            deleteMutation.mutate(template.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </RowActions>
                    )}
                  </ListRow>
                  {template.custom_prompt && isExpanded && (
                    <div className="px-4 pb-4 sm:pl-16">
                      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Custom prompt</p>
                      <div className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">
                        {template.custom_prompt}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </List>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeader
          title="Recent tests"
          action={
            tests.length > 5 && (
              <Button variant="ghost" size="sm" asChild>
                {/* P5.1: points to the real test history instead of the dashboard */}
                <Link to="/tests">
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            )
          }
        />
        {recentTests.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No tests yet"
            description="Generate a test from your templates to get started."
          />
        ) : (
          <List>
            {recentTests.map((test) => (
              <TestRow key={test.id} test={test} />
            ))}
          </List>
        )}
      </section>

      {/* Create Template Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open)
        if (!open) resetForm()
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit Test Template' : 'Create Test Template'}</DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? 'Update your template settings'
                : 'Set up a reusable template for generating practice tests'}
            </DialogDescription>
          </DialogHeader>
          
          <StepIndicator
            steps={['Documents', 'Configure', 'Custom Prompt']}
            current={createStep}
            className="py-2"
          />
          
          {/* Step 1: Select Documents */}
          {createStep === 1 && (
            <div className="space-y-4">
              {documents.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No documents available"
                  description="The template will be topic-based."
                  className="py-8"
                />
              ) : (
                <>
                  {formData.document_ids.length === 0 && (
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                      No documents selected. Template will generate questions based on the title/topic.
                    </p>
                  )}
                  <div className="grid max-h-60 gap-2 overflow-y-auto p-0.5">
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
                </>
              )}
            </div>
          )}
          
          {/* Step 2: Configure */}
          {createStep === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Template Name / Topic</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., AWS Solutions Architect Daily Practice"
                />
              </div>
              
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Default Questions</Label>
                  <Select
                    value={String(formData.num_questions)}
                    onValueChange={(v) => setFormData({ ...formData, num_questions: parseInt(v) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_QUESTION_COUNT_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n} questions
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Choices per Question</Label>
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
                <div className="grid max-h-56 gap-2 overflow-y-auto p-0.5">
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
            </div>
          )}
          
          {/* Step 3: Custom Prompt */}
          {createStep === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="custom_prompt">Custom Prompt (Optional)</Label>
                <Textarea
                  id="custom_prompt"
                  value={formData.custom_prompt}
                  onChange={(e) => setFormData({ ...formData, custom_prompt: e.target.value })}
                  placeholder="Add custom instructions for the AI, e.g.:
- Focus on scenario-based questions
- Include questions about best practices
- Make questions progressively harder
- Focus on security and networking topics"
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Add specific instructions to customize how questions are generated. Leave empty to use default behavior.
                </p>
              </div>
              
              {/* Summary */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Template summary</h4>
                <dl className="divide-y rounded-lg border text-sm">
                  {([
                    ['Name', formData.title],
                    ['Documents', formData.document_ids.length > 0 ? `${formData.document_ids.length} selected` : 'Topic-based'],
                    ['Default questions', formData.num_questions],
                    ['AI model', getModelName(formData.ai_model_id)],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 px-3 py-2">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="truncate text-right font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2 sm:gap-0">
            {createStep > 1 && (
              <Button variant="outline" onClick={() => setCreateStep(createStep - 1)}>
                Back
              </Button>
            )}
            {createStep < 3 ? (
              <Button
                onClick={() => setCreateStep(createStep + 1)}
                disabled={createStep === 2 && !canProceedStep2}
              >
                Continue
              </Button>
            ) : (
              <Button
                onClick={editingTemplate ? handleUpdateTemplate : handleCreateTemplate}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {editingTemplate ? 'Saving...' : 'Creating...'}
                  </>
                ) : (
                  editingTemplate ? 'Save Changes' : 'Create Template'
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Generate Test Dialog */}
      <Dialog open={showGenerateDialog} onOpenChange={setShowGenerateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Test from Template</DialogTitle>
            <DialogDescription>
              {selectedTemplate?.title}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="num_questions">Number of Questions</Label>
              <Select
                value={String(generateNumQuestions)}
                onValueChange={(v) => setGenerateNumQuestions(parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_COUNT_OPTIONS.slice(0, -1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} questions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Template default: {selectedTemplate?.num_questions} questions
              </p>
            </div>

            {/* Cost Estimation */}
            {generateEstimates && (
              <CostEstimate
                estimates={generateEstimates}
                overLimitMessage="Warning: Context limit exceeded. Generation may fail."
              />
            )}

            {/* P6.2: real progress from the backend while waiting */}
            {isGenerating && <GenerationStatus progress={progress} />}
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={isGenerating ? handleCancelGeneration : () => setShowGenerateDialog(false)}
            >
              Cancel
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
                  Generate
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

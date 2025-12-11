import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText,
  Plus,
  Trash2,
  Sparkles,
  Loader2,
  Copy,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Coins,
  Clock,
  GraduationCap,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { documentsApi, modelsApi, testsApi } from '@/services/api'
import { cn, calculateEstimatedCost, formatPricePerMillion, calculateTestGenerationTokens, formatDate, getScoreColor } from '@/lib/utils'
import { TEMPLATE_QUESTION_COUNT_OPTIONS, CHOICES_COUNT_OPTIONS, QUESTION_COUNT_OPTIONS, DEFAULT_NUM_QUESTIONS, DEFAULT_NUM_CHOICES } from '@/lib/constants'
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
  
  // State for expanded templates (to show custom prompt)
  const [expandedTemplates, setExpandedTemplates] = useState<Set<number>>(new Set())
  
  // Track which template is being deleted
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null)
  
  // Queries
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: testsApi.listTemplates,
  })
  
  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  })
  
  const { data: models = [] } = useQuery({
    queryKey: ['models', true],
    queryFn: () => modelsApi.list(true),
  })
  
  const { data: tests = [] } = useQuery({
    queryKey: ['tests'],
    queryFn: testsApi.list,
  })
  
  // Mutations
  const createMutation = useMutation({
    mutationFn: testsApi.createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
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
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setShowCreateDialog(false)
      resetForm()
    },
  })
  
  const deleteMutation = useMutation({
    mutationFn: testsApi.deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] })
      setDeletingTemplateId(null)
    },
    onError: () => {
      setDeletingTemplateId(null)
    },
  })
  
  const generateMutation = useMutation({
    mutationFn: ({ templateId, numQuestions }: { templateId: number; numQuestions: number }) =>
      testsApi.generateFromTemplate(templateId, numQuestions),
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
  
  const handleCreateTemplate = async () => {
    await createMutation.mutateAsync({
      ...formData,
      custom_prompt: formData.custom_prompt || null,
    })
  }
  
  const handleUpdateTemplate = async () => {
    if (!editingTemplate) return
    await updateMutation.mutateAsync({
      id: editingTemplate.id,
      data: formData,
    })
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
    await generateMutation.mutateAsync({
      templateId: selectedTemplate.id,
      numQuestions: generateNumQuestions,
    })
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
  
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Test Templates</h1>
          <p className="text-muted-foreground">
            Create reusable templates for daily practice tests
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>
      
      {/* Templates List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Copy className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No templates yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Create a template to quickly generate practice tests for daily learning.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg">{template.title}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                      <span>{template.num_questions} questions</span>
                      <span>{template.num_choices} choices</span>
                      <span>{getModelName(template.ai_model_id)}</span>
                      <span>
                        {template.document_ids.length > 0
                          ? `${template.document_ids.length} document${template.document_ids.length > 1 ? 's' : ''}`
                          : 'Topic-based'}
                      </span>
                    </div>
                    
                    {template.custom_prompt && (
                      <div className="mt-3">
                        <button
                          onClick={() => toggleExpanded(template.id)}
                          className="flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          {expandedTemplates.has(template.id) ? (
                            <>
                              <ChevronUp className="h-4 w-4" />
                              Hide custom prompt
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-4 w-4" />
                              Show custom prompt
                            </>
                          )}
                        </button>
                        {expandedTemplates.has(template.id) && (
                          <div className="mt-2 p-3 rounded-lg bg-muted/50 text-sm whitespace-pre-wrap">
                            {template.custom_prompt}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenEditDialog(template)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDeletingTemplateId(template.id)
                        deleteMutation.mutate(template.id)
                      }}
                      disabled={deletingTemplateId === template.id}
                    >
                      {deletingTemplateId === template.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button onClick={() => handleOpenGenerateDialog(template)}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate Test
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Recent Tests */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Tests</CardTitle>
              <CardDescription>Your latest generated tests</CardDescription>
            </div>
            {tests.length > 5 && (
              <Button variant="ghost" size="sm" asChild>
                <Link to="/">
                  View all
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recentTests.length === 0 ? (
            <div className="text-center py-12">
              <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No tests yet</h3>
              <p className="text-muted-foreground mb-4">
                Generate a test from your templates to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTests.map((test) => (
                <Link
                  key={test.id}
                  to={test.status === 'completed' ? `/results/${test.id}` : `/test/${test.id}`}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card/50 hover:bg-card transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                      test.status === 'completed' ? 'bg-success/10' : 
                      test.status === 'in_progress' ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      {test.status === 'completed' ? (
                        <CheckCircle2 className="h-5 w-5 text-success" />
                      ) : test.status === 'in_progress' ? (
                        <Clock className="h-5 w-5 text-primary" />
                      ) : (
                        <GraduationCap className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-medium">{test.config_title || `Test #${test.id}`}</h4>
                      <p className="text-sm text-muted-foreground">
                        {test.total_questions} questions • {formatDate(test.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {test.status === 'completed' && test.score !== null && (
                      <span className={`text-lg font-bold ${getScoreColor(test.score)}`}>
                        {test.score}%
                      </span>
                    )}
                    {test.status === 'in_progress' && (
                      <span className="text-sm text-primary">Continue →</span>
                    )}
                    {test.status === 'generated' && (
                      <span className="text-sm text-muted-foreground">Start →</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
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
          
          {/* Progress Steps */}
          <div className="flex items-center gap-4 py-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
                    createStep >= s
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {createStep > s ? <CheckCircle2 className="h-3 w-3" /> : s}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium',
                    createStep >= s ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {s === 1 ? 'Documents' : s === 2 ? 'Configure' : 'Custom Prompt'}
                </span>
                {s < 3 && <div className="w-8 h-px bg-muted ml-2" />}
              </div>
            ))}
          </div>
          
          {/* Step 1: Select Documents */}
          {createStep === 1 && (
            <div className="space-y-4">
              {documents.length === 0 ? (
                <div className="text-center py-6">
                  <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">
                    No documents available. Template will be topic-based.
                  </p>
                </div>
              ) : (
                <>
                  {formData.document_ids.length === 0 && (
                    <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-center text-sm text-muted-foreground">
                      No documents selected. Template will generate questions based on the title/topic.
                    </div>
                  )}
                  <div className="grid gap-2 max-h-60 overflow-y-auto">
                    {documents.map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => handleDocumentToggle(doc.id)}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-lg border text-left transition-all text-sm',
                          formData.document_ids.includes(doc.id)
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'hover:bg-muted/50'
                        )}
                      >
                        <div
                          className={cn(
                            'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                            formData.document_ids.includes(doc.id)
                              ? 'border-primary bg-primary'
                              : 'border-muted-foreground/30'
                          )}
                        >
                          {formData.document_ids.includes(doc.id) && (
                            <CheckCircle2 className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium">{doc.title}</h4>
                          <p className="text-xs text-muted-foreground capitalize">
                            {doc.doc_type.replace('_', ' ')}
                          </p>
                        </div>
                      </button>
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
                <div className="grid gap-2 max-h-48 overflow-y-auto">
                  {models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setFormData({ ...formData, ai_model_id: model.id })}
                      className={cn(
                        'flex items-start gap-3 p-3 rounded-lg border text-left transition-all text-sm',
                        formData.ai_model_id === model.id
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'hover:bg-muted/50'
                      )}
                    >
                      <div
                        className={cn(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center mt-0.5 transition-colors',
                          formData.ai_model_id === model.id
                            ? 'border-primary bg-primary'
                            : 'border-muted-foreground/30'
                        )}
                      >
                        {formData.ai_model_id === model.id && (
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
                        {model.description && (
                          <p className="text-xs text-muted-foreground">{model.description}</p>
                        )}
                        {model.pricing && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {formatPricePerMillion(model.pricing.prompt)} / {formatPricePerMillion(model.pricing.completion)} per 1M tokens
                          </p>
                        )}
                      </div>
                    </button>
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
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <h4 className="font-medium text-sm">Template Summary</h4>
                <div className="grid gap-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span>{formData.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Documents</span>
                    <span>
                      {formData.document_ids.length > 0
                        ? `${formData.document_ids.length} selected`
                        : 'Topic-based'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Default Questions</span>
                    <span>{formData.num_questions}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">AI Model</span>
                    <span>{getModelName(formData.ai_model_id)}</span>
                  </div>
                </div>
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
              <div className={cn(
                "rounded-lg border p-3 space-y-2",
                generateEstimates.contextUsage > 100 ? "border-destructive/50 bg-destructive/5" : "border-primary/20 bg-primary/5"
              )}>
                <div className="flex items-center gap-2 mb-1">
                  <Coins className="h-3.5 w-3.5 text-primary" />
                  <h4 className="font-medium text-xs">Estimated Cost & Usage</h4>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block mb-0.5">Est. Cost</span>
                    {generateEstimates.hasPricing ? (
                      <span className="font-semibold">
                        ${generateEstimates.estimatedCost.toFixed(4)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">
                        Pricing unavailable
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-0.5">Context</span>
                    <span className={cn(
                      "font-semibold",
                      generateEstimates.contextUsage > 100 ? "text-destructive" : "text-foreground"
                    )}>
                      {generateEstimates.contextUsage.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-1">
                      ({Math.round(generateEstimates.inputTokens / 1000)}k/{Math.round(generateEstimates.contextLimit / 1000)}k)
                    </span>
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground">
                  ~{generateEstimates.inputTokens.toLocaleString()} input + ~{generateEstimates.outputTokens.toLocaleString()} output tokens
                  {generateEstimates.numBatches > 1 && (
                    <span className="ml-1">({generateEstimates.numBatches} API calls)</span>
                  )}
                </div>

                {generateEstimates.contextUsage > 100 && (
                  <div className="text-[10px] text-destructive font-medium mt-1">
                    Warning: Context limit exceeded. Generation may fail.
                  </div>
                )}
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenerateDialog(false)} disabled={isGenerating}>
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

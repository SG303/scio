import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import type { SubjectListItem } from '@/types'

interface CreateSubjectDialogProps {
  open: boolean
  onClose: () => void
  editingSubject?: SubjectListItem | null
}

export default function CreateSubjectDialog({
  open,
  onClose,
  editingSubject,
}: CreateSubjectDialogProps) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    ai_model_id: null as number | null,
    document_ids: [] as number[],
  })

  const { data: documents = [] } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  })

  const { data: models = [] } = useQuery({
    queryKey: ['models', true],
    queryFn: () => modelsApi.list(true),
  })

  const createMutation = useMutation({
    mutationFn: subjectsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      handleClose()
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { title: string; description: string | null; ai_model_id: number | null; document_ids: number[] | null } }) =>
      subjectsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      handleClose()
    },
  })

  useEffect(() => {
    if (editingSubject) {
      setFormData({
        title: editingSubject.title,
        description: editingSubject.description || '',
        ai_model_id: editingSubject.ai_model_id,
        document_ids: editingSubject.document_ids || [],
      })
    } else {
      setFormData({
        title: '',
        description: '',
        ai_model_id: null,
        document_ids: [],
      })
    }
    setStep(1)
  }, [editingSubject, open])

  const handleClose = () => {
    setFormData({
      title: '',
      description: '',
      ai_model_id: null,
      document_ids: [],
    })
    setStep(1)
    onClose()
  }

  const handleDocumentToggle = (docId: number) => {
    setFormData((prev) => ({
      ...prev,
      document_ids: prev.document_ids.includes(docId)
        ? prev.document_ids.filter((id) => id !== docId)
        : [...prev.document_ids, docId],
    }))
  }

  const handleSubmit = () => {
    const data = {
      title: formData.title,
      description: formData.description || null,
      ai_model_id: formData.ai_model_id,
      document_ids: formData.document_ids.length > 0 ? formData.document_ids : null,
    }

    if (editingSubject) {
      updateMutation.mutate({ id: editingSubject.id, data })
    } else {
      createMutation.mutate(data)
    }
  }

  const canProceedStep2 = formData.title.trim() !== ''
  const isSubmitting = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingSubject ? 'Edit Subject' : 'Create New Subject'}
          </DialogTitle>
          <DialogDescription>
            {editingSubject
              ? 'Update your subject settings'
              : 'Set up a subject to organize related learning materials'}
          </DialogDescription>
        </DialogHeader>

        {/* Progress Steps */}
        <div className="flex items-center gap-4 py-4">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors',
                  step >= s
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {step > s ? <CheckCircle2 className="h-3 w-3" /> : s}
              </div>
              <span
                className={cn(
                  'text-xs font-medium',
                  step >= s ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {s === 1 ? 'Details' : s === 2 ? 'Documents' : 'AI Model'}
              </span>
              {s < 3 && <div className="w-8 h-px bg-muted ml-2" />}
            </div>
          ))}
        </div>

        {/* Step 1: Details */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Subject Name</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., AWS Solutions Architect, Python Programming"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (Optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of what you're studying..."
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Step 2: Documents */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select documents to use as context for all materials in this subject (optional).
            </p>
            {documents.length === 0 ? (
              <div className="text-center py-6">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No documents available. You can add documents later or generate topic-based content.
                </p>
              </div>
            ) : (
              <>
                {formData.document_ids.length === 0 && (
                  <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-center text-sm text-muted-foreground">
                    No documents selected. Materials will be generated based on titles/topics.
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

        {/* Step 3: AI Model */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a default AI model for generating content in this subject (can be overridden per generation).
            </p>
            {formData.ai_model_id === null && (
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 p-3 text-center text-sm text-muted-foreground">
                No default model selected. You'll need to select a model when generating content.
              </div>
            )}
            <div className="grid gap-2 max-h-60 overflow-y-auto">
              {models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() =>
                    setFormData({
                      ...formData,
                      ai_model_id: formData.ai_model_id === model.id ? null : model.id,
                    })
                  }
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
                        {formatPricePerMillion(model.pricing.prompt)} /{' '}
                        {formatPricePerMillion(model.pricing.completion)} per 1M tokens
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2 mt-4">
              <h4 className="font-medium text-sm">Summary</h4>
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
                      : 'None'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Default Model</span>
                  <span>
                    {formData.ai_model_id
                      ? models.find((m) => m.id === formData.ai_model_id)?.name
                      : 'None'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} disabled={isSubmitting}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !canProceedStep2}>
              Continue
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {editingSubject ? 'Saving...' : 'Creating...'}
                </>
              ) : editingSubject ? (
                'Save Changes'
              ) : (
                'Create Subject'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


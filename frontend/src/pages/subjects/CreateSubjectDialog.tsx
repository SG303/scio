import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2 } from 'lucide-react'
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
import { toast } from '@/components/Toaster'
import { EmptyState } from '@/components/EmptyState'
import { StepIndicator } from '@/components/StepIndicator'
import { OptionCard, ModelOptionLabel, DocumentOptionLabel } from '@/components/OptionCard'
import type { SubjectListItem } from '@/types'
import { queryKeys } from '@/lib/constants'

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
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })

  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
  })

  const createMutation = useMutation({
    mutationFn: subjectsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
      handleClose()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create subject')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { title: string; description: string | null; ai_model_id: number | null; document_ids: number[] | null } }) =>
      subjectsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
      handleClose()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save subject')
    },
  })

  // P2.2: form and step are adjusted during render when the dialog inputs
  // (editingSubject / open) change (React docs: "Adjusting state when a prop
  // changes") instead of a setState-in-effect cascade. The previous-props
  // snapshot makes the adjustment one-shot per change and terminates before
  // commit; behaviour is identical to the former effect, including the
  // reset when the dialog closes or reopens.
  const [syncedProps, setSyncedProps] = useState<{
    editingSubject: SubjectListItem | null | undefined
    open: boolean
  }>({ editingSubject: undefined, open: false })
  if (syncedProps.editingSubject !== editingSubject || syncedProps.open !== open) {
    setSyncedProps({ editingSubject, open })
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
  }

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

        <StepIndicator steps={['Details', 'Documents', 'AI Model']} current={step} className="py-2" />

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
              <EmptyState
                icon={FileText}
                title="No documents available"
                description="You can add documents later or generate topic-based content."
                className="py-8"
              />
            ) : (
              <>
                {formData.document_ids.length === 0 && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                    No documents selected. Materials will be generated based on titles/topics.
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

        {/* Step 3: AI Model */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select a default AI model for generating content in this subject (can be overridden per generation).
            </p>
            {formData.ai_model_id === null && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                No default model selected. You'll need to select a model when generating content.
              </p>
            )}
            <div className="grid max-h-60 gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="Default AI Model">
              {models.map((model) => (
                <OptionCard
                  key={model.id}
                  indicator="radio"
                  selected={formData.ai_model_id === model.id}
                  onClick={() =>
                    setFormData({
                      ...formData,
                      ai_model_id: formData.ai_model_id === model.id ? null : model.id,
                    })
                  }
                >
                  <ModelOptionLabel model={model} />
                </OptionCard>
              ))}
            </div>

            {/* Summary */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Summary</h4>
              <dl className="divide-y rounded-lg border text-sm">
                {([
                  ['Name', formData.title],
                  ['Documents', formData.document_ids.length > 0 ? `${formData.document_ids.length} selected` : 'None'],
                  ['Default model', formData.ai_model_id
                    ? models.find((m) => m.id === formData.ai_model_id)?.name
                    : 'None'],
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


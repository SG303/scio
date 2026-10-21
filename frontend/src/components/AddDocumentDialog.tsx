import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, BookOpen, ListChecks, HelpCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/Toaster'
import { documentsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import type { Document } from '@/types'

export const docTypeConfig = {
  exam_objectives: { label: 'Exam Objectives', icon: ListChecks },
  study_guide: { label: 'Study Guide', icon: BookOpen },
  example_questions: { label: 'Example Questions', icon: HelpCircle },
}

const emptyForm = { title: '', doc_type: 'study_guide', content: '' }

type AddDocumentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the stored document, e.g. to select it in a wizard. */
  onCreated?: (document: Document) => void
}

/**
 * Add a document by pasting text or uploading a file. Used on the Documents
 * page and inline in the create wizards, so uploading never loses wizard state.
 */
export function AddDocumentDialog({ open, onOpenChange, onCreated }: AddDocumentDialogProps) {
  const queryClient = useQueryClient()
  const [addMode, setAddMode] = useState<'text' | 'file'>('text')
  const [formData, setFormData] = useState(emptyForm)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const resetForm = () => {
    setFormData(emptyForm)
    setSelectedFile(null)
    setAddMode('text')
  }

  const handleCreated = (document: Document) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.documents })
    onCreated?.(document)
    onOpenChange(false)
    resetForm()
  }

  const createMutation = useMutation({
    mutationFn: documentsApi.create,
    onSuccess: handleCreated,
    // P3.1 (M8): surface failures — previously the dialog closed silently
    // or nothing happened at all
    onError: () => {
      toast.error('Could not create the document. Please try again.')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: ({ title, docType, file }: { title: string; docType: string; file: File }) =>
      documentsApi.upload(title, docType, file),
    onSuccess: handleCreated,
    onError: () => {
      toast.error('Upload failed. Please try again.')
    },
  })

  const isSaving = createMutation.isPending || uploadMutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Inside a wizard the dialog is portalled, but React still bubbles the
    // submit event — keep it from reaching any surrounding form
    e.stopPropagation()
    if (addMode === 'file' && selectedFile) {
      uploadMutation.mutate({
        title: formData.title,
        docType: formData.doc_type,
        file: selectedFile,
      })
    } else {
      createMutation.mutate(formData)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Document</DialogTitle>
            <DialogDescription>
              Add study material to use as context for generating tests and flashcards
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Mode Toggle */}
            <div className="inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Input mode">
              {([
                ['text', FileText, 'Paste Text'],
                ['file', Upload, 'Upload File'],
              ] as const).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={addMode === mode}
                  onClick={() => setAddMode(mode)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    addMode === mode
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="document-title">Title</Label>
              <Input
                id="document-title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., AWS Solutions Architect Study Guide"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="document-type">Document Type</Label>
              <Select
                value={formData.doc_type}
                onValueChange={(value) => setFormData({ ...formData, doc_type: value })}
              >
                <SelectTrigger id="document-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(docTypeConfig).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2">
                        <config.icon className="h-4 w-4 text-muted-foreground" />
                        {config.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {addMode === 'text' ? (
              <div className="space-y-2">
                <Label htmlFor="document-content">Content</Label>
                <Textarea
                  id="document-content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Paste your study material here..."
                  className="min-h-[200px] font-mono text-sm"
                  required
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="document-file">File</Label>
                <Input
                  id="document-file"
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,.md"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Supported formats: PDF, DOCX, TXT, Markdown
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {addMode === 'file' ? 'Upload' : 'Add Document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

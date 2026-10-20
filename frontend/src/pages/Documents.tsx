import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/Toaster'
import { FileText, Upload, Plus, Trash2, BookOpen, ListChecks, HelpCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListIcon, ListRow, RowActions } from '@/components/List'
import { documentsApi } from '@/services/api'
import { cn, formatDate } from '@/lib/utils'
import type { Document } from '@/types'
import { queryKeys } from '@/lib/constants'

const docTypeConfig = {
  exam_objectives: { label: 'Exam Objectives', icon: ListChecks },
  study_guide: { label: 'Study Guide', icon: BookOpen },
  example_questions: { label: 'Example Questions', icon: HelpCircle },
}

export default function Documents() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [addMode, setAddMode] = useState<'text' | 'file'>('text')
  const [deletingDocId, setDeletingDocId] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    title: '',
    doc_type: 'study_guide',
    content: '',
  })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const { data: documents = [], isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
  })

  const createMutation = useMutation({
    mutationFn: documentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents })
      setIsAddOpen(false)
      resetForm()
    },
    // P3.1 (M8): surface failures — previously the dialog closed silently
    // or nothing happened at all
    onError: () => {
      toast.error('Could not create the document. Please try again.')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: ({ title, docType, file }: { title: string; docType: string; file: File }) =>
      documentsApi.upload(title, docType, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents })
      setIsAddOpen(false)
      resetForm()
      setIsUploading(false)
    },
    onError: () => {
      setIsUploading(false)
      toast.error('Upload failed. Please try again.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: documentsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents })
      setDeletingDocId(null)
      toast.success('Document deleted')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete document')
    },
  })

  const resetForm = () => {
    setFormData({ title: '', doc_type: 'study_guide', content: '' })
    setSelectedFile(null)
    setAddMode('text')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (addMode === 'file' && selectedFile) {
      setIsUploading(true)
      uploadMutation.mutate({
        title: formData.title,
        docType: formData.doc_type,
        file: selectedFile,
      })
    } else {
      createMutation.mutate(formData)
    }
  }

  const groupedDocs = documents.reduce((acc, doc) => {
    const type = doc.doc_type as keyof typeof docTypeConfig
    if (!acc[type]) acc[type] = []
    acc[type].push(doc)
    return acc
  }, {} as Record<string, Document[]>)

  // P3.3 pattern: a failed query is an error, not an empty document list
  if (isLoading || error) {
    return <QueryState loading={isLoading} error={error} onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Documents"
        description="Manage your study materials and context documents."
        actions={
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Document
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>Add Document</DialogTitle>
                  <DialogDescription>
                    Add study material to use as context for generating tests
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
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="e.g., AWS Solutions Architect Study Guide"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="type">Document Type</Label>
                    <Select
                      value={formData.doc_type}
                      onValueChange={(value) => setFormData({ ...formData, doc_type: value })}
                    >
                      <SelectTrigger>
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
                      <Label htmlFor="content">Content</Label>
                      <Textarea
                        id="content"
                        value={formData.content}
                        onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                        placeholder="Paste your study material here..."
                        className="min-h-[200px] font-mono text-sm"
                        required
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="file">File</Label>
                      <Input
                        id="file"
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
                  <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || isUploading}
                  >
                    {(createMutation.isPending || isUploading) && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    {addMode === 'file' ? 'Upload' : 'Add Document'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents yet"
          description="Add your study materials to start generating practice tests."
          action={
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Document
            </Button>
          }
        />
      ) : (
        Object.entries(docTypeConfig).map(([type, config]) => {
          const docs = groupedDocs[type] || []
          if (docs.length === 0) return null

          return (
            <section key={type} className="space-y-3">
              <SectionHeader title={config.label} meta={docs.length} />
              <List>
                {docs.map((doc) => (
                  <ListRow key={doc.id}>
                    <ListIcon>
                      <config.icon />
                    </ListIcon>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-medium">{doc.title}</h3>
                      <p className="truncate text-xs text-muted-foreground">
                        {doc.file_name && <>{doc.file_name} · </>}
                        Added {formatDate(doc.created_at)}
                      </p>
                      {doc.content && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                          {doc.content.substring(0, 150)}...
                        </p>
                      )}
                    </div>
                    <RowActions label={`Actions for ${doc.title}`}>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeletingDocId(doc.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </RowActions>
                  </ListRow>
                ))}
              </List>
            </section>
          )
        })
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingDocId !== null} onOpenChange={() => setDeletingDocId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this document? It will no longer be available as
              context for generating tests. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingDocId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingDocId !== null && deleteMutation.mutate(deletingDocId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}


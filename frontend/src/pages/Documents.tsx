import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, Plus, Trash2, BookOpen, ListChecks, HelpCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { documentsApi } from '@/services/api'
import { formatDate } from '@/lib/utils'
import type { Document } from '@/types'

const docTypeConfig = {
  exam_objectives: { label: 'Exam Objectives', icon: ListChecks, color: 'text-blue-400' },
  study_guide: { label: 'Study Guide', icon: BookOpen, color: 'text-green-400' },
  example_questions: { label: 'Example Questions', icon: HelpCircle, color: 'text-purple-400' },
}

export default function Documents() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [addMode, setAddMode] = useState<'text' | 'file'>('text')
  const [formData, setFormData] = useState({
    title: '',
    doc_type: 'study_guide',
    content: '',
  })
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: documentsApi.list,
  })

  const createMutation = useMutation({
    mutationFn: documentsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setIsAddOpen(false)
      resetForm()
    },
  })

  const uploadMutation = useMutation({
    mutationFn: ({ title, docType, file }: { title: string; docType: string; file: File }) =>
      documentsApi.upload(title, docType, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      setIsAddOpen(false)
      resetForm()
      setIsUploading(false)
    },
    onError: () => {
      setIsUploading(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: documentsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-muted-foreground">
            Manage your study materials and context documents
          </p>
        </div>
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
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={addMode === 'text' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAddMode('text')}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Paste Text
                  </Button>
                  <Button
                    type="button"
                    variant={addMode === 'file' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setAddMode('file')}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </Button>
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
                            <config.icon className={`h-4 w-4 ${config.color}`} />
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
      </div>

      {/* Documents List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No documents yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add your study materials to start generating practice tests
            </p>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Document
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(docTypeConfig).map(([type, config]) => {
            const docs = groupedDocs[type] || []
            if (docs.length === 0) return null

            return (
              <Card key={type}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <config.icon className={`h-5 w-5 ${config.color}`} />
                    <CardTitle className="text-lg">{config.label}</CardTitle>
                  </div>
                  <CardDescription>
                    {docs.length} document{docs.length !== 1 ? 's' : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {docs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-4 rounded-lg border bg-card/50"
                      >
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">{doc.title}</h4>
                          <p className="text-sm text-muted-foreground">
                            {doc.file_name && <span className="mr-2">{doc.file_name} •</span>}
                            Added {formatDate(doc.created_at)}
                          </p>
                          {doc.content && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {doc.content.substring(0, 150)}...
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(doc.id)}
                          disabled={deleteMutation.isPending}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}


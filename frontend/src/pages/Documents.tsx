import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/Toaster'
import { ChevronRight, FileText, Plus, Scissors, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListIcon, ListRow, RowActions } from '@/components/List'
import { SectionTabs, subjectTabs } from '@/components/SectionTabs'
import { AddDocumentDialog, docTypeConfig } from '@/components/AddDocumentDialog'
import { documentsApi } from '@/services/api'
import { cn, formatDate } from '@/lib/utils'
import { groupDocuments } from '@/lib/documents'
import { SplitChaptersDialog } from '@/components/documents/SplitChaptersDialog'
import type { Document } from '@/types'
import { queryKeys } from '@/lib/constants'

export default function Documents() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [deletingDocId, setDeletingDocId] = useState<number | null>(null)
  const [splitting, setSplitting] = useState<Document | null>(null)
  const [openBooks, setOpenBooks] = useState<Set<number>>(new Set())

  const toggleBook = (id: number) =>
    setOpenBooks((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const { data: documents = [], isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.documents,
    queryFn: documentsApi.list,
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

  const groupedDocs = documents.reduce((acc, doc) => {
    const type = doc.doc_type as keyof typeof docTypeConfig
    if (!acc[type]) acc[type] = []
    acc[type].push(doc)
    return acc
  }, {} as Record<string, Document[]>)

  const deletingChapterCount = documents.filter((d) => d.parent_document_id === deletingDocId).length

  // P3.3 pattern: a failed query is an error, not an empty document list
  if (isLoading || error) {
    return <QueryState loading={isLoading} error={error} onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <SectionTabs tabs={subjectTabs} label="Subjects section" />

      <PageHeader
        title="Documents"
        description="All documents are available to every test, deck and subject."
        actions={
          <Button onClick={() => setIsAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Document
          </Button>
        }
      />

      <AddDocumentDialog open={isAddOpen} onOpenChange={setIsAddOpen} />

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
          const groups = groupDocuments(groupedDocs[type] || [])
          if (groups.length === 0) return null

          return (
            <section key={type} className="space-y-3">
              <SectionHeader title={config.label} meta={groups.length} />
              <List>
                {groups.map(({ document: doc, chapters }) => (
                  <div key={doc.id}>
                    <ListRow>
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
                      {chapters.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={() => toggleBook(doc.id)}
                          aria-expanded={openBooks.has(doc.id)}
                        >
                          {chapters.length} chapters
                          <ChevronRight
                            className={cn('h-4 w-4 ml-1 transition-transform', openBooks.has(doc.id) && 'rotate-90')}
                          />
                        </Button>
                      )}
                      <RowActions label={`Actions for ${doc.title}`}>
                        {chapters.length === 0 && (
                          <DropdownMenuItem onClick={() => setSplitting(doc)}>
                            <Scissors className="h-4 w-4 mr-2" />
                            Split into chapters
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingDocId(doc.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </RowActions>
                    </ListRow>
                    {openBooks.has(doc.id) && (
                      <div className="divide-y border-t bg-muted/30">
                        {chapters.map((chapter) => (
                          <ListRow key={chapter.id} className="min-h-12 py-2 pl-16">
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-sm">{chapter.title}</h4>
                              {chapter.page_start !== null && (
                                <p className="text-xs tabular-nums text-muted-foreground">
                                  Pages {chapter.page_start}–{chapter.page_end}
                                </p>
                              )}
                            </div>
                            <RowActions label={`Actions for ${chapter.title}`}>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => setDeletingDocId(chapter.id)}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </RowActions>
                          </ListRow>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </List>
            </section>
          )
        })
      )}

      <SplitChaptersDialog document={splitting} onClose={() => setSplitting(null)} />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingDocId !== null} onOpenChange={() => setDeletingDocId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this document
              {deletingChapterCount > 0 && <> and its {deletingChapterCount} chapters</>}? It will no
              longer be available as context for generating tests. This action cannot be undone.
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


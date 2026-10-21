import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { SectionTabs, subjectTabs } from '@/components/SectionTabs'
import { List, ListRow, ListIcon, RowActions, rowLinkClass } from '@/components/List'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/Toaster'
import { subjectsApi } from '@/services/api'
import { cn, getScoreColor } from '@/lib/utils'
import type { SubjectListItem } from '@/types'
import CreateSubjectDialog from './CreateSubjectDialog'
import { queryKeys } from '@/lib/constants'

export default function SubjectsPage() {
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingSubject, setEditingSubject] = useState<SubjectListItem | null>(null)
  const [deletingSubject, setDeletingSubject] = useState<SubjectListItem | null>(null)

  const { data: subjects = [], isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.subjects,
    queryFn: subjectsApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => subjectsApi.delete(id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
      setDeletingSubject(null)
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete subject')
    },
  })

  const handleEdit = (subject: SubjectListItem) => {
    setEditingSubject(subject)
    setShowCreateDialog(true)
  }

  const handleCloseDialog = () => {
    setShowCreateDialog(false)
    setEditingSubject(null)
  }

  if (isLoading) {
    return <QueryState loading />
  }

  // P3.3: a failed query is an error, not "no subjects yet"
  if (error) {
    return <QueryState error={error} onRetry={() => refetch()} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <SectionTabs tabs={subjectTabs} label="Subjects section" />

      <PageHeader
        title="Subjects"
        description="Organize your learning materials by subject."
        actions={
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Subject
          </Button>
        }
      />

      {subjects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No subjects yet"
          description="Create a subject to organize your practice tests and flashcard decks together and track progress across related materials."
          action={
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Subject
            </Button>
          }
        />
      ) : (
        <section className="space-y-3">
          <SectionHeader title="All subjects" meta={subjects.length} />
          <List>
            {subjects.map((subject) => (
              <ListRow key={subject.id} interactive>
                <ListIcon>
                  <FolderOpen />
                </ListIcon>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/subjects/${subject.id}`}
                    className={cn('block truncate text-sm font-medium', rowLinkClass)}
                  >
                    {subject.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {subject.test_count} test{subject.test_count !== 1 ? 's' : ''} ·{' '}
                    {subject.deck_count} deck{subject.deck_count !== 1 ? 's' : ''}
                    {subject.ai_model_name && <> · {subject.ai_model_name}</>}
                    {subject.description && <> · {subject.description}</>}
                  </p>
                </div>

                <dl className="hidden shrink-0 gap-6 text-right sm:flex">
                  <div className="w-20">
                    <dt className="text-xs text-muted-foreground">Avg. score</dt>
                    <dd
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        subject.total_tests_taken > 0 && subject.average_score !== null
                          ? getScoreColor(subject.average_score)
                          : 'text-muted-foreground'
                      )}
                    >
                      {subject.total_tests_taken > 0 && subject.average_score !== null
                        ? `${Math.round(subject.average_score)}%`
                        : '—'}
                    </dd>
                  </div>
                  <div className="w-20">
                    <dt className="text-xs text-muted-foreground">Mastered</dt>
                    <dd className="text-sm font-semibold tabular-nums">
                      {subject.total_cards > 0 ? (
                        <>
                          {subject.mastered_cards}
                          <span className="font-normal text-muted-foreground">/{subject.total_cards}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <RowActions label={`Actions for ${subject.title}`}>
                  <DropdownMenuItem onClick={() => handleEdit(subject)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeletingSubject(subject)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </RowActions>
              </ListRow>
            ))}
          </List>
        </section>
      )}

      {/* Create/Edit Dialog */}
      <CreateSubjectDialog
        open={showCreateDialog}
        onClose={handleCloseDialog}
        editingSubject={editingSubject}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingSubject !== null} onOpenChange={() => setDeletingSubject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Subject</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingSubject?.title}"? The tests and flashcard
              decks within this subject will be kept but unlinked from this subject.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingSubject(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingSubject && deleteMutation.mutate(deletingSubject.id)}
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


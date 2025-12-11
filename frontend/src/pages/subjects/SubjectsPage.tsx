import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  ClipboardList,
  Layers,
  MoreVertical,
  Pencil,
  Trash2,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { subjectsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import type { SubjectListItem } from '@/types'
import CreateSubjectDialog from './CreateSubjectDialog'

export default function SubjectsPage() {
  const queryClient = useQueryClient()
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [editingSubject, setEditingSubject] = useState<SubjectListItem | null>(null)
  const [deletingSubject, setDeletingSubject] = useState<SubjectListItem | null>(null)

  const { data: subjects = [], isLoading } = useQuery({
    queryKey: ['subjects'],
    queryFn: subjectsApi.list,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => subjectsApi.delete(id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] })
      setDeletingSubject(null)
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
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Subjects</h1>
          <p className="text-muted-foreground">
            Organize your learning materials by subject
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Subject
        </Button>
      </div>

      {/* Subjects Grid */}
      {subjects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-primary/10 p-4 mb-4">
              <FolderOpen className="h-10 w-10 text-primary" />
            </div>
            <h3 className="text-lg font-medium mb-2">No subjects yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Create a subject to organize your practice tests and flashcard decks together.
              Subjects help you track progress across related learning materials.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Subject
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <Card key={subject.id} className="group relative overflow-hidden hover:shadow-lg transition-shadow">
              <Link to={`/subjects/${subject.id}`} className="block">
                <CardContent className="p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0 pr-8">
                      <h3 className="font-semibold text-lg truncate">{subject.title}</h3>
                      {subject.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {subject.description}
                        </p>
                      )}
                    </div>
                    <div
                      className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.preventDefault()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(subject)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeletingSubject(subject)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="flex items-center gap-2">
                      <ClipboardList className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {subject.test_count} test{subject.test_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">
                        {subject.deck_count} deck{subject.deck_count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="space-y-2">
                    {subject.total_tests_taken > 0 && subject.average_score !== null && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Avg. Score</span>
                        <span
                          className={cn(
                            'font-medium',
                            subject.average_score >= 70
                              ? 'text-emerald-500'
                              : subject.average_score >= 50
                              ? 'text-amber-500'
                              : 'text-red-500'
                          )}
                        >
                          {Math.round(subject.average_score)}%
                        </span>
                      </div>
                    )}
                    {subject.total_cards > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Cards Mastered</span>
                        <span className="font-medium">
                          {subject.mastered_cards}/{subject.total_cards}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Model badge */}
                  {subject.ai_model_name && (
                    <div className="mt-4 pt-4 border-t">
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                        {subject.ai_model_name}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
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


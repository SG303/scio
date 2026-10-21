import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/Toaster'
import { Trash2, ClipboardList, Sparkles, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, RowActions } from '@/components/List'
import { TestRow } from '@/components/TestRow'
import { AssignSubjectDialog, SubjectBadge, type AssignTarget } from '@/components/SubjectAssignment'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { subjectsApi, testsApi } from '@/services/api'
import { queryKeys } from '@/lib/constants'

/**
 * P5.1: test management — all tests in one place.
 * Every test can be opened or deleted; templates show a score sparkline
 * built from the completed tests of the same config.
 */
export default function TestHistory() {
  const queryClient = useQueryClient()
  const [deletingTestId, setDeletingTestId] = useState<number | null>(null)
  const [assigning, setAssigning] = useState<AssignTarget | null>(null)

  const {
    data: tests = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.tests,
    queryFn: testsApi.list,
  })

  // Only used for badge titles and the assign dialog — no blocking state
  const { data: subjects = [] } = useQuery({
    queryKey: queryKeys.subjects,
    queryFn: subjectsApi.list,
  })
  const subjectTitle = (id: number | null) => subjects.find((s) => s.id === id)?.title

  const deleteMutation = useMutation({
    mutationFn: testsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tests })
      queryClient.invalidateQueries({ queryKey: queryKeys.templates })
      setDeletingTestId(null)
      toast.success('Test deleted')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete test')
    },
  })

  const handleDelete = () => {
    if (deletingTestId) {
      deleteMutation.mutate(deletingTestId)
    }
  }

  if (isLoading) {
    return <QueryState loading />
  }

  // P3.3 pattern: a failed query is an error, not an empty test list
  if (error) {
    return <QueryState error={error} onRetry={refetch} />
  }

  // Group completed scores per config for the sparkline
  const scoresByConfig = new Map<number, number[]>()
  for (const test of tests) {
    if (test.status === 'completed' && test.score !== null) {
      const list = scoresByConfig.get(test.config_id) ?? []
      list.push(test.score)
      scoresByConfig.set(test.config_id, list)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Tests"
        description="All your practice tests — continue, review or clean up."
        actions={
          <Button asChild>
            <Link to="/create">
              <Sparkles className="h-4 w-4 mr-2" />
              Generate New
            </Link>
          </Button>
        }
      />

      {tests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No tests yet"
          description="Generate your first practice test to see it here."
          action={
            <Button asChild>
              <Link to="/create">
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Test
              </Link>
            </Button>
          }
        />
      ) : (
        <section className="space-y-3">
          <SectionHeader title="Test history" meta={tests.length} />
          <List>
            {tests.map((test) => (
              <TestRow
                key={test.id}
                test={test}
                scores={scoresByConfig.get(test.config_id)}
                badge={!test.from_template && <SubjectBadge title={subjectTitle(test.subject_id)} />}
                actions={
                  <RowActions label={`Actions for ${test.config_title || `Test #${test.id}`}`}>
                    {/* legacy tests hang on a template config, which never gets a subject */}
                    {!test.from_template && (
                      <>
                        <DropdownMenuItem
                          onClick={() =>
                            setAssigning({
                              kind: 'test-config',
                              id: test.config_id,
                              title: test.config_title || `Test #${test.id}`,
                              subjectId: test.subject_id,
                            })
                          }
                        >
                          <FolderOpen className="h-4 w-4 mr-2" />
                          Assign subject
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeletingTestId(test.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </RowActions>
                }
              />
            ))}
          </List>
        </section>
      )}

      <AssignSubjectDialog target={assigning} subjects={subjects} onClose={() => setAssigning(null)} />

      {/* Delete Confirmation Dialog */}
      <Dialog open={deletingTestId !== null} onOpenChange={() => setDeletingTestId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Test</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this test? This will permanently remove all
              questions and answers. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingTestId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

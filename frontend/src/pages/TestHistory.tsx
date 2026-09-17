import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/Toaster'
import { GraduationCap, Trash2, Clock, CheckCircle2, ClipboardList, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { ScoreSparkline } from '@/components/ScoreSparkline'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { testsApi } from '@/services/api'
import { formatDate, getScoreColor } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import type { Test } from '@/types'

/**
 * P5.1: test management — all tests in one place.
 * Every test can be opened or deleted; templates show a score sparkline
 * built from the completed tests of the same config.
 */
export default function TestHistory() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deletingTestId, setDeletingTestId] = useState<number | null>(null)

  const {
    data: tests = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.tests,
    queryFn: testsApi.list,
  })

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

  const openTest = (test: Test) => {
    if (test.status === 'completed') {
      navigate(`/results/${test.id}`)
    } else {
      navigate(`/test/${test.id}`)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Tests</h1>
        <p className="text-muted-foreground">
          All your practice tests — continue, review or clean up.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Test History</CardTitle>
              <CardDescription>
                {tests.length} test{tests.length !== 1 ? 's' : ''} total
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/create">
                <Sparkles className="h-4 w-4 mr-2" />
                Generate New
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tests.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No tests yet</h3>
              <p className="text-muted-foreground mb-4">
                Generate your first practice test to see it here.
              </p>
              <Button asChild>
                <Link to="/create">
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Test
                </Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {tests.map((test) => {
                const scores = scoresByConfig.get(test.config_id) ?? []
                return (
                  <div
                    key={test.id}
                    className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <button
                      className="flex flex-1 items-center gap-3 text-left min-w-0"
                      onClick={() => openTest(test)}
                    >
                      {test.status === 'completed' ? (
                        <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                      ) : test.status === 'in_progress' ? (
                        <Clock className="h-5 w-5 text-primary shrink-0" />
                      ) : (
                        <GraduationCap className="h-5 w-5 text-muted-foreground shrink-0" />
                      )}
                      <div className="min-w-0">
                        <h4 className="font-medium truncate">
                          {test.config_title || `Test #${test.id}`}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {test.total_questions} questions • {formatDate(test.created_at)}
                        </p>
                      </div>
                    </button>
                    {scores.length >= 2 && (
                      <div className="hidden sm:block text-primary shrink-0" title="Recent scores for this template">
                        <ScoreSparkline scores={scores} />
                      </div>
                    )}
                    <div className="w-14 text-right shrink-0">
                      {test.status === 'completed' && test.score !== null ? (
                        <span className={`text-lg font-bold ${getScoreColor(test.score)}`}>
                          {test.score}%
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground capitalize">
                          {test.status === 'in_progress' ? 'Continue' : 'Start'}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeletingTestId(test.id)}
                      aria-label={`Delete ${test.config_title || `Test #${test.id}`}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

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

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/Toaster'
import { flashcardsApi, testsApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import type { SubjectListItem } from '@/types'

const NO_SUBJECT = 'none'

/** Small inline label: the subject's title, or a quiet "No subject". */
export function SubjectBadge({ title }: { title: string | null | undefined }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[10rem] items-center truncate rounded-full border px-1.5 py-px align-middle text-[11px] leading-4',
        title ? 'text-foreground' : 'border-dashed text-muted-foreground'
      )}
    >
      {title ?? 'No subject'}
    </span>
  )
}

export type AssignTarget = {
  /** A test assigns its config (all retakes of it), a deck itself. */
  kind: 'test-config' | 'deck'
  id: number
  title: string
  subjectId: number | null
}

type AssignSubjectDialogProps = {
  target: AssignTarget | null
  subjects: SubjectListItem[]
  onClose: () => void
}

/** Assign, change or remove the subject of an existing test or deck. */
export function AssignSubjectDialog({ target, subjects, onClose }: AssignSubjectDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* keyed so the selection resets for every opened item */}
        {target && <AssignSubjectForm key={`${target.kind}-${target.id}`} target={target} subjects={subjects} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function AssignSubjectForm({
  target,
  subjects,
  onClose,
}: {
  target: AssignTarget
  subjects: SubjectListItem[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(target.subjectId !== null ? String(target.subjectId) : NO_SUBJECT)

  const mutation = useMutation({
    mutationFn: async (subjectId: number | null) => {
      if (target.kind === 'test-config') {
        await testsApi.setConfigSubject(target.id, subjectId)
      } else {
        await flashcardsApi.updateDeck(target.id, { subject_id: subjectId })
      }
    },
    onSuccess: () => {
      if (target.kind === 'test-config') {
        queryClient.invalidateQueries({ queryKey: queryKeys.tests })
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDecks })
        queryClient.invalidateQueries({ queryKey: queryKeys.flashcardDeck(target.id) })
      }
      // old and new subject both change; prefix-matches every subject detail
      queryClient.invalidateQueries({ queryKey: queryKeys.subjects })
      queryClient.invalidateQueries({ queryKey: ['subject'] })
      toast.success('Subject updated')
      onClose()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not update the subject')
    },
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Assign subject</DialogTitle>
        <DialogDescription>
          “{target.title}” will be listed under the chosen subject.
          {target.kind === 'test-config' && ' This applies to every attempt of this test.'}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 py-2">
        <Label htmlFor="assign-subject">Subject</Label>
        <Select value={value} onValueChange={setValue}>
          <SelectTrigger id="assign-subject">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SUBJECT}>No subject</SelectItem>
            {subjects.map((subject) => (
              <SelectItem key={subject.id} value={String(subject.id)}>
                {subject.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate(value === NO_SUBJECT ? null : parseInt(value))}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}

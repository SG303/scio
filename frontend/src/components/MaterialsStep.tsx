import { useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { OptionCard, DocumentOptionLabel } from '@/components/OptionCard'
import { AddDocumentDialog } from '@/components/AddDocumentDialog'
import type { Document, SubjectListItem } from '@/types'

const NO_SUBJECT = 'none'

type MaterialsStepProps = {
  subjects: SubjectListItem[]
  subjectId: number | null
  /** Called with the newly chosen subject (null = no subject). */
  onSubjectChange: (subject: SubjectListItem | null) => void
  documents: Document[]
  documentIds: number[]
  onDocumentIdsChange: (ids: number[]) => void
  /** "questions" or "flashcards" — used in the topic-only hint. */
  generates: string
  /** Optional extra field shown below the subject (e.g. template picker). */
  children?: ReactNode
  onContinue: () => void
}

/** Subject defaults are pre-selected, never exclusive: every document stays selectable. */
export function withSubjectDefaults(
  documentIds: number[],
  previous: SubjectListItem | null | undefined,
  next: SubjectListItem | null | undefined,
) {
  const previousDefaults = previous?.document_ids ?? []
  const kept = documentIds.filter((id) => !previousDefaults.includes(id))
  const added = (next?.document_ids ?? []).filter((id) => !kept.includes(id))
  return [...kept, ...added]
}

/**
 * Step 1 of the create wizards: optional subject, all documents and an inline
 * upload. Works the same with and without a subject.
 */
export function MaterialsStep({
  subjects,
  subjectId,
  onSubjectChange,
  documents,
  documentIds,
  onDocumentIdsChange,
  generates,
  children,
  onContinue,
}: MaterialsStepProps) {
  const [isAddOpen, setIsAddOpen] = useState(false)

  const handleSubjectChange = (value: string) => {
    const previous = subjects.find((s) => s.id === subjectId)
    const next = value === NO_SUBJECT ? null : subjects.find((s) => String(s.id) === value) ?? null
    onDocumentIdsChange(withSubjectDefaults(documentIds, previous, next))
    onSubjectChange(next)
  }

  const toggleDocument = (docId: number) => {
    onDocumentIdsChange(
      documentIds.includes(docId)
        ? documentIds.filter((id) => id !== docId)
        : [...documentIds, docId]
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Subject & Materials</CardTitle>
        <CardDescription>
          Optionally file it under a subject and choose documents as context
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="subject">Subject (optional)</Label>
          <Select
            value={subjectId !== null ? String(subjectId) : NO_SUBJECT}
            onValueChange={handleSubjectChange}
          >
            <SelectTrigger id="subject">
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
          <p className="text-xs text-muted-foreground">
            {subjectId !== null
              ? "The subject's default documents are pre-selected; you can still pick any other."
              : 'It will be listed under Tests or Flashcards; you can assign a subject later.'}
          </p>
        </div>

        {children}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Label>Documents (optional)</Label>
            <Button variant="outline" size="sm" onClick={() => setIsAddOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Add Document
            </Button>
          </div>
          {documentIds.length === 0 && (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              No documents selected. The AI will generate {generates} based on your title/topic.
            </p>
          )}
          {documents.length > 0 && (
            <div className="grid gap-2">
              {documents.map((doc) => (
                <OptionCard
                  key={doc.id}
                  indicator="checkbox"
                  selected={documentIds.includes(doc.id)}
                  onClick={() => toggleDocument(doc.id)}
                >
                  <DocumentOptionLabel title={doc.title} docType={doc.doc_type} />
                </OptionCard>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t pt-4">
          <Button onClick={onContinue}>Continue</Button>
        </div>
      </CardContent>

      <AddDocumentDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        onCreated={(doc) => onDocumentIdsChange([...documentIds, doc.id])}
      />
    </Card>
  )
}

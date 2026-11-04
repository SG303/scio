import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Scissors, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { OptionCard, ModelOptionLabel } from '@/components/OptionCard'
import { toast } from '@/components/Toaster'
import { documentsApi, modelsApi } from '@/services/api'
import { queryKeys } from '@/lib/constants'
import { calculateEstimatedCost, cn, formatContextLength, isSubscriptionModel } from '@/lib/utils'
import {
  chapterDraftError,
  toChapterRanges,
  withEnds,
  type ChapterDraft,
} from '@/lib/documents'
import type { AIModel, ChapterProposal, Document } from '@/types'

type SplitChaptersDialogProps = {
  /** The book to split; the dialog is open while this is set. */
  document: Document | null
  onClose: () => void
}

const sourceNote: Record<ChapterProposal['method'], string> = {
  outline: "Found from the PDF's bookmarks.",
  headings: "Found from the document's headings.",
  ai: 'Found by the AI. Check the start pages against the PDF before you split.',
  none: '',
}

/**
 * Split a large document into one document per main chapter. Free detection
 * runs first; the AI is only offered for PDFs without bookmarks. Nothing is
 * stored until the owner confirms the reviewed chapter list.
 */
export function SplitChaptersDialog({ document, onClose }: SplitChaptersDialogProps) {
  const open = document !== null
  const [aiProposal, setAiProposal] = useState<ChapterProposal | null>(null)

  const freeDetection = useQuery({
    queryKey: queryKeys.chapterProposal(document?.id),
    queryFn: () => documentsApi.detectChapters(document!.id),
    enabled: open,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

  const aiDetection = useMutation({
    mutationFn: (modelId: number) => documentsApi.detectChapters(document!.id, modelId),
    onSuccess: setAiProposal,
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'The AI could not find the chapters.')
    },
  })

  const handleOpenChange = (next: boolean) => {
    if (next || aiDetection.isPending) return
    setAiProposal(null)
    onClose()
  }

  const proposal = aiProposal ?? freeDetection.data
  const found = proposal && proposal.chapters.length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split into chapters</DialogTitle>
          <DialogDescription>
            {document?.title}
            {proposal?.unit === 'page' && <> · {proposal.unit_count} pages</>}
          </DialogDescription>
        </DialogHeader>

        {freeDetection.isLoading && (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Reading the document. Large books can take a minute.
          </div>
        )}

        {freeDetection.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
            {freeDetection.error instanceof Error ? freeDetection.error.message : 'Could not read the document.'}
          </div>
        )}

        {proposal && found && document && (
          <ChapterEditor
            key={proposal.method}
            document={document}
            proposal={proposal}
            onDone={() => handleOpenChange(false)}
          />
        )}

        {proposal && !found && (
          proposal.ai_available ? (
            <AiDetection
              open={open}
              inputTokens={proposal.ai_input_tokens ?? 0}
              isPending={aiDetection.isPending}
              onDetect={(modelId) => aiDetection.mutate(modelId)}
              onCancel={() => handleOpenChange(false)}
            />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                No chapter headings found. Splitting needs “Heading 1” styles in Word files or
                <code className="mx-1 rounded bg-muted px-1">#</code>
                headings in Markdown.
              </p>
              <DialogFooter>
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}

type AiDetectionProps = {
  open: boolean
  inputTokens: number
  isPending: boolean
  onDetect: (modelId: number) => void
  onCancel: () => void
}

/** PDF without bookmarks: let a chosen AI model find the chapters. */
function AiDetection({ open, inputTokens, isPending, onDetect, onCancel }: AiDetectionProps) {
  const [chosenId, setChosenId] = useState<number | null>(null)
  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
    enabled: open,
  })
  const modelId = chosenId ?? models[0]?.id ?? null
  const model = models.find((m) => m.id === modelId)

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This PDF has no bookmarks, so the chapters can't be read for free. The AI can find them
          from the table of contents and the top line of every page. It never reads the whole book.
        </p>
        <div className="space-y-2">
          <Label>AI model</Label>
          <div className="grid max-h-56 gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="AI model">
            {models.map((m) => (
              <OptionCard key={m.id} indicator="radio" selected={modelId === m.id} onClick={() => setChosenId(m.id)}>
                <ModelOptionLabel model={m} />
              </OptionCard>
            ))}
          </div>
        </div>
        {model && <p className="text-xs text-muted-foreground">{costLine(inputTokens, model)}</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button onClick={() => modelId !== null && onDetect(modelId)} disabled={modelId === null || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {isPending ? 'Finding chapters…' : 'Find chapters with AI'}
        </Button>
      </DialogFooter>
    </>
  )
}

function costLine(inputTokens: number, model: AIModel) {
  const size = `Reads about ${formatContextLength(inputTokens)} tokens`
  if (isSubscriptionModel(model.openrouter_id)) return `${size}, included in your Claude subscription.`
  if (!model.pricing) return `${size}.`
  const { estimatedCost } = calculateEstimatedCost(inputTokens, 2000, model)
  return `${size}, about $${estimatedCost < 0.01 ? '0.01 or less' : estimatedCost.toFixed(2)} with ${model.name}.`
}

type ChapterEditorProps = {
  document: Document
  proposal: ChapterProposal
  onDone: () => void
}

/** Review the proposal: rename, move start pages, deselect, add or remove chapters. */
function ChapterEditor({ document, proposal, onDone }: ChapterEditorProps) {
  const queryClient = useQueryClient()
  const pages = proposal.unit === 'page'
  const unitCount = proposal.unit_count
  const [drafts, setDrafts] = useState<ChapterDraft[]>(() =>
    proposal.chapters.map((c, i) => ({ key: i, title: c.title, start: c.start, included: true }))
  )

  const split = useMutation({
    mutationFn: () => documentsApi.splitIntoChapters(document.id, toChapterRanges(drafts, unitCount)),
    onSuccess: (chapters) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.documents })
      toast.success(`Split into ${chapters.length} ${chapters.length === 1 ? 'chapter' : 'chapters'}`)
      onDone()
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Could not split the document.')
    },
  })

  const update = (key: number, change: Partial<ChapterDraft>) =>
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...change } : d)))
  const remove = (key: number) => setDrafts((current) => current.filter((d) => d.key !== key))
  const add = () =>
    setDrafts((current) => [
      ...current,
      { key: Math.max(-1, ...current.map((d) => d.key)) + 1, title: '', start: NaN, included: true },
    ])

  const error = chapterDraftError(drafts, unitCount, pages ? 'page' : 'section')
  const ends = new Map(error ? [] : withEnds(drafts, unitCount).map((d) => [d.key, d.end]))
  const selectedCount = drafts.filter((d) => d.included).length

  return (
    <>
      <div className="min-w-0 space-y-4">
        <p className="text-sm text-muted-foreground">
          {sourceNote[proposal.method]} Each selected chapter becomes its own document; the book itself
          is kept. Deselect parts you don't study, like the preface or index.
        </p>

        {pages && <PageMap drafts={drafts} ends={ends} unitCount={unitCount} />}

        <ol className="max-h-[45vh] divide-y overflow-y-auto rounded-xl border" aria-label="Chapters">
          {drafts.map((draft) => {
            const end = ends.get(draft.key)
            return (
              <li
                key={draft.key}
                className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5', !draft.included && 'bg-muted/40')}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  checked={draft.included}
                  onChange={(e) => update(draft.key, { included: e.target.checked })}
                  aria-label={`Include ${draft.title || 'chapter'}`}
                />
                <Input
                  value={draft.title}
                  onChange={(e) => update(draft.key, { title: e.target.value })}
                  placeholder="Chapter title"
                  aria-label="Chapter title"
                  className={cn('h-8 min-w-0 flex-1 basis-48', !draft.included && 'text-muted-foreground')}
                />
                {pages && (
                  <div className="flex items-center gap-2 pl-7 text-xs text-muted-foreground sm:pl-0">
                    <label className="flex items-center gap-1.5">
                      from p.
                      <Input
                        type="number"
                        min={1}
                        max={unitCount}
                        value={Number.isNaN(draft.start) ? '' : draft.start}
                        onChange={(e) => update(draft.key, { start: e.target.value === '' ? NaN : Number(e.target.value) })}
                        className="h-8 w-20 tabular-nums"
                      />
                    </label>
                    <span className="w-28 tabular-nums">
                      {end !== undefined && <>to {end} · {end - draft.start + 1} {end === draft.start ? 'page' : 'pages'}</>}
                    </span>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => remove(draft.key)}
                  aria-label={`Remove ${draft.title || 'chapter'}`}
                  title={pages ? 'Remove: its pages join the chapter before' : 'Remove: its text joins the chapter before'}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            )
          })}
        </ol>

        {pages && (
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="h-4 w-4 mr-2" />
            Add chapter
          </Button>
        )}
      </div>

      <DialogFooter className="items-center gap-y-2">
        {error && <p className="mr-auto text-sm text-destructive" role="alert">{error}</p>}
        <Button variant="outline" onClick={onDone} disabled={split.isPending}>
          Cancel
        </Button>
        <Button onClick={() => split.mutate()} disabled={error !== null || split.isPending}>
          {split.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Scissors className="h-4 w-4 mr-2" />}
          Create {selectedCount} {selectedCount === 1 ? 'chapter' : 'chapters'}
        </Button>
      </DialogFooter>
    </>
  )
}

type PageMapProps = {
  drafts: ChapterDraft[]
  ends: Map<number, number>
  unitCount: number
}

/** The book as a bar: selected chapters are segments, left-out pages stay empty. */
function PageMap({ drafts, ends, unitCount }: PageMapProps) {
  const included = drafts
    .filter((d) => d.included && ends.has(d.key))
    .sort((a, b) => a.start - b.start)
  const covered = included.reduce((sum, d) => sum + ends.get(d.key)! - d.start + 1, 0)

  return (
    <div className="space-y-1.5">
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {included.map((d, i) => (
          <div
            key={d.key}
            className={cn('absolute inset-y-0 border-r border-background', i % 2 ? 'bg-primary/55' : 'bg-primary')}
            style={{
              left: `${((d.start - 1) / unitCount) * 100}%`,
              width: `${((ends.get(d.key)! - d.start + 1) / unitCount) * 100}%`,
            }}
            title={d.title}
          />
        ))}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {ends.size > 0 ? `${covered} of ${unitCount} pages in the selected chapters` : `${unitCount} pages`}
      </p>
    </div>
  )
}

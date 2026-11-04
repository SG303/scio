import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CloudOff, GitCompare, Loader2, Maximize2, Minimize2, NotebookPen, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { QueryState } from '@/components/QueryState'
import { GenerationStatus } from '@/components/GenerationStatus'
import { FinishLectureDialog } from './FinishLectureDialog'
import { LectureCompare } from './LectureCompare'
import { toast } from '@/components/Toaster'
import { lecturesApi, modelsApi, settingsApi, subjectsApi } from '@/services/api'
import { queryKeys } from '@/lib/constants'
import type { Lecture } from '@/types'
import {
  clearDraft,
  readDraft,
  useLectureEditor,
  writeDraft,
  type LectureDraft,
  type OpenLecture,
} from '@/lib/lectureEditor'
import { cn } from '@/lib/utils'

const MarkdownEditor = lazy(() => import('./MarkdownEditor'))

const AUTOSAVE_DELAY_MS = 1200
const RETRY_DELAY_MS = 10_000

type Mode = 'edit' | 'formatting' | 'compare'

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'offline'

/** The open lecture: full-screen editor, or a bar at the bottom when minimized. */
export function LectureDock() {
  const { open } = useLectureEditor()
  if (!open) return null
  // key: a different lecture gets a fresh editor and save state
  return <LectureSession key={open.id} lecture={open} minimized={open.minimized} />
}

function LectureSession({ lecture, minimized }: { lecture: OpenLecture; minimized: boolean }) {
  const { closeLecture } = useLectureEditor()
  const { data, error, refetch } = useQuery({
    queryKey: queryKeys.lecture(lecture.id),
    queryFn: () => lecturesApi.get(lecture.id),
  })

  if (data) return <EditorSession lecture={lecture} server={data} minimized={minimized} />

  return (
    <div role="dialog" aria-label="Lecture notes" className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{lecture.subjectTitle}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground"
          onClick={() => void closeLecture()}
          aria-label="Close editor"
          title="Close"
        >
          <X className="h-[18px] w-[18px]" />
        </Button>
      </header>
      <div className="mx-auto w-full max-w-3xl p-6">
        {error ? <QueryState error={error} onRetry={() => refetch()} /> : <QueryState loading />}
      </div>
    </div>
  )
}

function EditorSession({
  lecture,
  server,
  minimized,
}: {
  lecture: OpenLecture
  server: Lecture
  minimized: boolean
}) {
  const { setMinimized, closeLecture, registerFlush } = useLectureEditor()
  const queryClient = useQueryClient()

  // Unsaved local edits (e.g. from a lost connection) win over the server copy
  const [start] = useState(() => {
    const serverCopy = { title: server.title, content: server.content }
    const draft = readDraft(server.id)
    const restored = !!draft && (draft.title !== server.title || draft.content !== server.content)
    return { serverCopy, draft: restored ? draft! : serverCopy, restored }
  })
  const [title, setTitle] = useState(start.draft.title)
  const [status, setStatus] = useState<SaveStatus>(start.restored ? 'unsaved' : 'saved')
  const [mode, setMode] = useState<Mode>('edit')
  const [finishOpen, setFinishOpen] = useState(false)
  // The editor is remounted with this text after formatting or restoring
  const [editorContent, setEditorContent] = useState(start.draft.content)
  const [editorKey, setEditorKey] = useState(0)
  const [original, setOriginal] = useState(server.original_content)

  const { data: subject } = useQuery({
    queryKey: queryKeys.subject(lecture.subjectId),
    queryFn: () => subjectsApi.get(lecture.subjectId),
  })

  // Current editor state and the state last confirmed by the server
  const latest = useRef<LectureDraft>(start.draft)
  const saved = useRef<LectureDraft>(start.serverCopy)
  const timer = useRef<number>()
  const inflight = useRef<Promise<boolean> | null>(null)

  const saveMutation = useMutation({
    mutationFn: (draft: LectureDraft) =>
      lecturesApi.update(lecture.id, {
        content: draft.content,
        // an emptied title field keeps the stored title
        ...(draft.title.trim() ? { title: draft.title } : {}),
      }),
  })

  const isDirty = () =>
    latest.current.title !== saved.current.title || latest.current.content !== saved.current.content

  const schedule = (delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void saveRef.current(), delay)
  }

  const save = async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    while (inflight.current) await inflight.current
    if (!isDirty()) return true
    const snapshot = { ...latest.current }
    setStatus('saving')
    const run = saveMutation.mutateAsync(snapshot).then(
      (result) => {
        saved.current = snapshot
        queryClient.setQueryData(queryKeys.lecture(lecture.id), result)
        queryClient.invalidateQueries({ queryKey: queryKeys.lectures(lecture.subjectId) })
        if (isDirty()) {
          setStatus('unsaved')
          schedule(AUTOSAVE_DELAY_MS)
        } else {
          clearDraft(lecture.id)
          setStatus('saved')
        }
        return true
      },
      () => {
        // the draft stays in localStorage; retry quietly in the background
        setStatus('offline')
        schedule(RETRY_DELAY_MS)
        return false
      }
    )
    inflight.current = run
    try {
      return await run
    } finally {
      inflight.current = null
    }
  }
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })

  const update = (changes: Partial<LectureDraft>) => {
    latest.current = { ...latest.current, ...changes }
    writeDraft(lecture.id, latest.current)
    setStatus('unsaved')
    schedule(AUTOSAVE_DELAY_MS)
  }

  // Close/switch flushes through the provider; a restored draft syncs at once
  useEffect(() => {
    const pending = timer
    registerFlush(() => saveRef.current())
    if (start.restored) pending.current = window.setTimeout(() => void saveRef.current(), 0)
    return () => {
      registerFlush(null)
      window.clearTimeout(pending.current)
    }
  }, [registerFlush, start.restored])

  // Warn before leaving the page with changes not yet on the server
  useEffect(() => {
    if (status === 'saved') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [status])

  // Full-screen editor: the page behind must not scroll
  useEffect(() => {
    if (minimized) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [minimized])

  // The server changed the notes (formatting/restore): adopt its copy
  const applyServer = (result: Lecture) => {
    const copy = { title: result.title, content: result.content }
    saved.current = copy
    latest.current = copy
    clearDraft(lecture.id)
    setStatus('saved')
    setTitle(result.title)
    setEditorContent(result.content)
    setEditorKey((key) => key + 1)
    setOriginal(result.original_content)
    queryClient.setQueryData(queryKeys.lecture(lecture.id), result)
    queryClient.invalidateQueries({ queryKey: queryKeys.lectures(lecture.subjectId) })
  }

  const formatMutation = useMutation({
    mutationFn: (modelId?: number) => lecturesApi.format(lecture.id, modelId),
    onSuccess: (result) => {
      applyServer(result)
      setMode('compare')
    },
    onError: (err) => {
      setMode('edit')
      toast.error(err instanceof Error ? err.message : 'Formatting failed. Your notes are unchanged.')
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (text: string) => lecturesApi.update(lecture.id, { content: text }),
    onSuccess: (result) => {
      applyServer(result)
      setMode('edit')
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to restore the original')
    },
  })

  const startFormatting = async (modelId?: number) => {
    setFinishOpen(false)
    setEditorContent(latest.current.content)
    setMode('formatting')
    // The AI must see exactly what is on the server
    if (!(await save())) {
      setMode('edit')
      toast.error('Your latest changes are not saved to the server yet. Reconnect, then try again.')
      return
    }
    formatMutation.mutate(modelId)
  }

  // Subject model first, then the global default (Settings). Only without
  // either does the user have to pick a model.
  const { data: appSettings } = useQuery({ queryKey: queryKeys.settings, queryFn: settingsApi.get })
  const defaultModelId = subject?.ai_model_id ?? appSettings?.default_ai_model_id ?? null
  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
  })
  const defaultModelName = models.find((m) => m.id === defaultModelId)?.name
  const finishTitle = defaultModelName ? `Format with ${defaultModelName}` : 'Fix spelling and structure'
  const onFinishClick = () => {
    if (defaultModelId === null) setFinishOpen(true)
    else void startFormatting()
  }

  const openCompare = () => {
    setEditorContent(latest.current.content)
    setMode('compare')
  }

  const uploadImage = async (file: File) => {
    try {
      return await lecturesApi.uploadImage(lecture.id, file)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image upload failed')
      throw err
    }
  }

  // Ctrl/Cmd+S saves right away instead of opening the browser's save dialog
  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
    }
  }

  const displayTitle = title.trim() || server.title

  return (
    <>
      <div
        role="dialog"
        aria-label={`Lecture notes: ${displayTitle}`}
        onKeyDown={onKeyDown}
        className={cn('fixed inset-0 z-50 flex flex-col bg-background', minimized && 'hidden')}
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{lecture.subjectTitle}</p>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                update({ title: e.target.value })
              }}
              onBlur={() => {
                if (!title.trim()) {
                  setTitle(saved.current.title)
                  update({ title: saved.current.title })
                }
              }}
              disabled={mode === 'formatting'}
              aria-label="Lecture title"
              placeholder="Lecture title"
              className="block w-full truncate rounded-sm bg-transparent text-[15px] font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <SaveIndicator status={status} />
          {mode === 'edit' && original !== null && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={openCompare}
              aria-label="Compare with the text before formatting"
              title="Compare with the text before formatting"
            >
              <GitCompare className="h-[18px] w-[18px]" />
            </Button>
          )}
          {mode === 'edit' && (
            <Button variant="outline" size="sm" className="h-9" onClick={onFinishClick} title={finishTitle}>
              <Sparkles className="h-4 w-4 sm:mr-1.5" />
              <span className="sr-only sm:not-sr-only">Finish lecture</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => setMinimized(true)}
            aria-label="Minimize editor"
            title="Minimize. Keep browsing Scio while the notes stay open"
          >
            <Minimize2 className="h-[18px] w-[18px]" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-foreground"
            onClick={() => void closeLecture()}
            aria-label="Close editor"
            title="Close"
          >
            <X className="h-[18px] w-[18px]" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {mode === 'compare' && original !== null ? (
            <LectureCompare
              original={original}
              formatted={editorContent}
              onKeep={() => setMode('edit')}
              onRestore={() => restoreMutation.mutate(original)}
              restoring={restoreMutation.isPending}
            />
          ) : mode === 'formatting' ? (
            <div className="mx-auto max-w-3xl p-6">
              <GenerationStatus progress={null} />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <Suspense fallback={<QueryState loading />}>
                <MarkdownEditor
                  key={editorKey}
                  defaultValue={editorContent}
                  onChange={(content) => update({ content })}
                  onUploadImage={uploadImage}
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>

      <FinishLectureDialog
        open={finishOpen}
        onOpenChange={setFinishOpen}
        defaultModelId={defaultModelId}
        onConfirm={(modelId) => void startFormatting(modelId)}
      />

      {minimized && (
        <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-1 rounded-lg border bg-card p-1 shadow-lg">
          <button
            type="button"
            onClick={() => setMinimized(false)}
            className="flex min-w-0 items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open notes: ${displayTitle}`}
          >
            <NotebookPen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block max-w-[14rem] truncate text-sm font-medium">{displayTitle}</span>
              <SaveIndicator status={status} compact />
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setMinimized(false)}
            aria-label="Expand editor"
            title="Expand"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => void closeLecture()}
            aria-label="Close editor"
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </>
  )
}

const statusText: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Editing',
  offline: 'Offline. Kept on this device',
}

function SaveIndicator({ status, compact = false }: { status: SaveStatus; compact?: boolean }) {
  const icon =
    status === 'offline' ? <CloudOff className="h-3.5 w-3.5" />
    : status === 'saved' ? <Check className="h-3.5 w-3.5" />
    : status === 'saving' ? <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
    : <span className="mx-1 h-1.5 w-1.5 rounded-full bg-current" />
  return (
    <span
      role="status"
      className={cn(
        'flex shrink-0 items-center gap-1.5 text-xs',
        status === 'offline' ? 'text-warning' : 'text-muted-foreground',
        !compact && 'px-1'
      )}
    >
      {!compact && icon}
      <span className={cn(!compact && status !== 'offline' && 'hidden sm:inline')}>
        {statusText[status]}
      </span>
    </span>
  )
}

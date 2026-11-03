import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { toast } from '@/components/Toaster'

// One lecture can be open in the editor dock at a time. The dock lives in the
// app layout, so it survives navigation; minimized it shrinks to a bar.

export type OpenLecture = { id: number; subjectId: number; subjectTitle: string }
type DockState = (OpenLecture & { minimized: boolean }) | null

/** Saves pending changes; resolves false if they are only kept on this device. */
type Flush = () => Promise<boolean>

type LectureEditorContextValue = {
  open: DockState
  openLecture: (lecture: OpenLecture) => Promise<void>
  setMinimized: (minimized: boolean) => void
  closeLecture: () => Promise<void>
  /** Close without saving, e.g. after the lecture was deleted. */
  discardLecture: (id: number) => void
  registerFlush: (flush: Flush | null) => void
}

const LectureEditorContext = createContext<LectureEditorContextValue | null>(null)

export function LectureEditorProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<DockState>(null)
  const flushRef = useRef<Flush | null>(null)

  const flushCurrent = useCallback(async () => {
    const saved = await (flushRef.current?.() ?? Promise.resolve(true))
    if (!saved) {
      toast.error('Notes could not be saved to the server. They are kept on this device and sync when you reopen the lecture.')
    }
  }, [])

  const openLecture = useCallback(
    async (lecture: OpenLecture) => {
      if (open?.id === lecture.id) {
        setOpen({ ...open, minimized: false })
        return
      }
      if (open) await flushCurrent()
      setOpen({ ...lecture, minimized: false })
    },
    [open, flushCurrent]
  )

  const closeLecture = useCallback(async () => {
    await flushCurrent()
    setOpen(null)
  }, [flushCurrent])

  const setMinimized = useCallback(
    (minimized: boolean) => setOpen((prev) => (prev ? { ...prev, minimized } : prev)),
    []
  )
  const discardLecture = useCallback((id: number) => {
    clearDraft(id)
    setOpen((prev) => (prev?.id === id ? null : prev))
  }, [])
  // Stable: the open session registers itself once on mount
  const registerFlush = useCallback((flush: Flush | null) => {
    flushRef.current = flush
  }, [])

  const value: LectureEditorContextValue = {
    open,
    openLecture,
    setMinimized,
    closeLecture,
    discardLecture,
    registerFlush,
  }

  return <LectureEditorContext.Provider value={value}>{children}</LectureEditorContext.Provider>
}

export function useLectureEditor() {
  const value = useContext(LectureEditorContext)
  if (!value) throw new Error('useLectureEditor must be used inside LectureEditorProvider')
  return value
}

// Unsaved edits are mirrored to localStorage on every change, so nothing is
// lost when the lecture-hall Wi-Fi drops or the tab closes mid-save.

export type LectureDraft = { title: string; content: string }

const draftKey = (id: number) => `scio-lecture-draft:${id}`

export function readDraft(id: number): LectureDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(id))
    return raw ? (JSON.parse(raw) as LectureDraft) : null
  } catch {
    return null
  }
}

export function writeDraft(id: number, draft: LectureDraft) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify(draft))
  } catch {
    // storage full or disabled: the server save still runs
  }
}

export function clearDraft(id: number) {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    // ignore
  }
}

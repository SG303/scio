import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import './markdown-editor.css'

type MarkdownEditorProps = {
  /** Initial Markdown; later changes of this prop are ignored. */
  defaultValue: string
  onChange: (markdown: string) => void
  /** Uploads a pasted, dropped or picked image and resolves to its URL. */
  onUploadImage: (file: File) => Promise<string>
}

/**
 * Live Markdown editor (Milkdown Crepe): formatting renders while typing,
 * "/" opens the block menu, images can be pasted or dropped.
 * Loaded lazily — Crepe is large and only needed while writing notes.
 */
export default function MarkdownEditor({ defaultValue, onChange, onUploadImage }: MarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onUploadRef = useRef(onUploadImage)
  const initialValue = useRef(defaultValue)
  useEffect(() => {
    onChangeRef.current = onChange
    onUploadRef.current = onUploadImage
  })

  useEffect(() => {
    // Own mount node per instance: StrictMode mounts twice and the first
    // instance is torn down asynchronously
    const mount = document.createElement('div')
    rootRef.current?.appendChild(mount)

    const crepe = new Crepe({
      root: mount,
      defaultValue: initialValue.current,
      featureConfigs: {
        [Crepe.Feature.ImageBlock]: { onUpload: (file) => onUploadRef.current(file) },
        [Crepe.Feature.Placeholder]: {
          text: 'Start writing. Type / for headings, lists, tables and images.',
          mode: 'doc',
        },
      },
    })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
        if (markdown !== previous) onChangeRef.current(markdown)
      })
    })
    const ready = crepe.create()

    return () => {
      void ready.then(() => crepe.destroy()).finally(() => mount.remove())
    }
  }, [])

  return <div ref={rootRef} className="scio-editor" />
}

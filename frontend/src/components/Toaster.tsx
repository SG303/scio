import { useEffect, useState } from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { CheckCircle2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// P3.1: global toast helper + Toaster component, built on the already
// installed (but previously unused) @radix-ui/react-toast. The helper can
// be called from anywhere — no React context required.

type ToastItem = {
  id: number
  title: string
  variant: 'success' | 'error'
}

type Listener = (toast: ToastItem) => void

let listeners: Listener[] = []
let nextId = 1

function emit(title: string, variant: 'success' | 'error') {
  const toast: ToastItem = { id: nextId++, title, variant }
  listeners.forEach((listener) => listener(toast))
}

export const toast = {
  success: (title: string) => emit(title, 'success'),
  error: (title: string) => emit(title, 'error'),
}

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const listener: Listener = (toast) => {
      setToasts((prev) => [...prev, toast])
    }
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  }, [])

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          open
          onOpenChange={(open) => {
            if (!open) dismiss(toast.id)
          }}
          className={cn(
            'group pointer-events-auto relative flex w-full items-start justify-between gap-3 overflow-hidden rounded-lg border p-4 pr-8 shadow-lg',
            'bg-background text-foreground',
            toast.variant === 'error' ? 'border-red-500/40' : 'border-emerald-500/40'
          )}
        >
          <div className="flex items-start gap-3">
            {toast.variant === 'error' ? (
              <ToastPrimitive.Description className="text-red-500 shrink-0">
                <X className="h-5 w-5" />
              </ToastPrimitive.Description>
            ) : (
              <ToastPrimitive.Description className="text-emerald-500 shrink-0">
                <CheckCircle2 className="h-5 w-5" />
              </ToastPrimitive.Description>
            )}
            <ToastPrimitive.Title className="text-sm font-medium leading-relaxed">
              {toast.title}
            </ToastPrimitive.Title>
          </div>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex max-h-screen w-full max-w-sm flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  )
}

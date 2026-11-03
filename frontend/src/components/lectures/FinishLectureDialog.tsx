import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { modelsApi } from '@/services/api'
import { queryKeys } from '@/lib/constants'

type FinishLectureDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The subject's model, pre-selected. */
  defaultModelId: number | null
  onConfirm: (modelId: number) => void
}

/** Pick the model that formats the notes when a lecture is finished. */
export function FinishLectureDialog({ open, onOpenChange, defaultModelId, onConfirm }: FinishLectureDialogProps) {
  const [chosenId, setChosenId] = useState<number | null>(null)
  const { data: models = [] } = useQuery({
    queryKey: queryKeys.modelsAll,
    queryFn: () => modelsApi.list(true),
    enabled: open,
  })
  const modelId = chosenId ?? defaultModelId ?? models[0]?.id ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Finish lecture</DialogTitle>
          <DialogDescription>
            The AI fixes spelling and gives your notes a clean structure. It adds nothing and removes
            nothing, and you review every change before keeping it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label>AI model</Label>
          <div className="grid max-h-64 gap-2 overflow-y-auto p-0.5" role="radiogroup" aria-label="AI model">
            {models.map((model) => (
              <OptionCard
                key={model.id}
                indicator="radio"
                selected={modelId === model.id}
                onClick={() => setChosenId(model.id)}
              >
                <ModelOptionLabel model={model} />
              </OptionCard>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => modelId !== null && onConfirm(modelId)} disabled={modelId === null}>
            <Sparkles className="h-4 w-4 mr-2" />
            Format notes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

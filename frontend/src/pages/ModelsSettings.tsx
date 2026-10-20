import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Plus, Trash2, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { QueryState } from '@/components/QueryState'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { List, ListRow, RowActions } from '@/components/List'
import { modelsApi, settingsApi } from '@/services/api'
import { cn, formatContextLength, formatPricePerMillion } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import { toast } from '@/components/Toaster'

/** Token-based on/off switch (no extra dependency). */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0'
        )}
      />
    </button>
  )
}

export default function ModelsSettings() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    openrouter_id: '',
    description: '',
  })

  const { data: models = [], isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.models,
    queryFn: () => modelsApi.list(false),
  })

  const { data: settings } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: settingsApi.get,
  })

  const createMutation = useMutation({
    mutationFn: modelsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models })
      setIsAddOpen(false)
      setFormData({ name: '', openrouter_id: '', description: '' })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add model')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { is_enabled: boolean } }) =>
      modelsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update model')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: modelsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.models })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete model')
    },
  })

  const settingsMutation = useMutation({
    mutationFn: (verificationModel: string) =>
      settingsApi.update({ verification_model: verificationModel }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      toast.success('Settings saved.')
    },
    onError: () => {
      // Revert the select to the last saved value
      queryClient.invalidateQueries({ queryKey: queryKeys.settings })
      toast.error('Could not save the settings. Please try again.')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

  const toggleEnabled = (id: number, currentState: boolean) => {
    updateMutation.mutate({ id, data: { is_enabled: !currentState } })
  }

  // P3.3 pattern: a failed query is an error, not an empty model list
  if (isLoading || error) {
    return <QueryState loading={isLoading} error={error} onRetry={refetch} />
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="AI Models"
        description="Configure which AI models are available for test generation."
        actions={
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Model
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleSubmit}>
                <DialogHeader>
                  <DialogTitle>Add AI Model</DialogTitle>
                  <DialogDescription>
                    Add a new AI model from OpenRouter
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., GPT-4 Turbo"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openrouter_id">OpenRouter Model ID</Label>
                    <Input
                      id="openrouter_id"
                      value={formData.openrouter_id}
                      onChange={(e) => setFormData({ ...formData, openrouter_id: e.target.value })}
                      placeholder="e.g., openai/gpt-4-turbo"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Find model IDs at{' '}
                      <a
                        href="https://openrouter.ai/models"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        openrouter.ai/models
                      </a>
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description (optional)</Label>
                    <Input
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Brief description of the model"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending && (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    )}
                    Add Model
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {/* Info note */}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">OpenRouter integration.</span> This app
          uses OpenRouter to access various AI models. Make sure you have set up your OpenRouter
          API key in the environment variables. Models marked as disabled won't appear in the
          test creation form.
        </p>
      </div>

      {/* Models List */}
      <section className="space-y-3">
        <SectionHeader
          title="Available models"
          meta={`${models.filter((m) => m.is_enabled).length} of ${models.length} enabled`}
        />
        {models.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No models configured"
            description="Add your first model to get started."
          />
        ) : (
          <List>
            {models.map((model) => (
              <ListRow key={model.id} className="items-start">
                <div className="flex h-9 shrink-0 items-center">
                  <Switch
                    checked={model.is_enabled}
                    onChange={() => toggleEnabled(model.id, model.is_enabled)}
                    disabled={updateMutation.isPending}
                    label={`${model.is_enabled ? 'Disable' : 'Enable'} ${model.name}`}
                  />
                </div>
                <div className={cn('min-w-0 flex-1 transition-opacity', !model.is_enabled && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-sm font-medium">{model.name}</h3>
                    {model.context_length && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {formatContextLength(model.context_length)} context
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {model.openrouter_id}
                  </p>
                  {model.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{model.description}</p>
                  )}
                  {model.pricing && (
                    <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
                      <span>
                        Input <span className="font-medium text-foreground">{formatPricePerMillion(model.pricing.prompt)}</span>/1M
                      </span>
                      <span>
                        Output <span className="font-medium text-foreground">{formatPricePerMillion(model.pricing.completion)}</span>/1M
                      </span>
                    </p>
                  )}
                  {!model.pricing && !model.context_length && (
                    <p className="mt-1.5 text-xs italic text-muted-foreground">
                      Pricing info unavailable from OpenRouter
                    </p>
                  )}
                </div>
                <RowActions label={`Actions for ${model.name}`} disabled={deleteMutation.isPending}>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this model?')) {
                        deleteMutation.mutate(model.id)
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </RowActions>
              </ListRow>
            ))}
          </List>
        )}
      </section>

      {/* Generation Settings */}
      <section className="space-y-3">
        <SectionHeader title="Generation settings" />
        <div className="rounded-xl border bg-card p-5 sm:p-6">
          <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
            The verification model double-checks each generated question after you
            finish a test. A cheap, fast model is usually the best choice here.
          </p>
          <div className="flex max-w-md items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="verification-model">Verification model</Label>
              <Select
                value={settings?.verification_model ?? ''}
                onValueChange={(value) => settingsMutation.mutate(value)}
                disabled={settingsMutation.isPending}
              >
                <SelectTrigger id="verification-model">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {settings?.verification_model &&
                    !models.some((m) => m.openrouter_id === settings.verification_model) && (
                      <SelectItem value={settings.verification_model}>
                        {settings.verification_model}
                      </SelectItem>
                    )}
                  {models.map((model) => (
                    <SelectItem key={model.openrouter_id} value={model.openrouter_id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {settingsMutation.isPending && (
              <Loader2 className="mb-3 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

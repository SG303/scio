import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Plus, Trash2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { modelsApi } from '@/services/api'
import { cn, formatPricePerMillion } from '@/lib/utils'

export default function ModelsSettings() {
  const queryClient = useQueryClient()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    openrouter_id: '',
    description: '',
  })

  const { data: models = [], isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => modelsApi.list(false),
  })

  const createMutation = useMutation({
    mutationFn: modelsApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setIsAddOpen(false)
      setFormData({ name: '', openrouter_id: '', description: '' })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { is_enabled: boolean } }) =>
      modelsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: modelsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate(formData)
  }

  const toggleEnabled = (id: number, currentState: boolean) => {
    updateMutation.mutate({ id, data: { is_enabled: !currentState } })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Models</h1>
          <p className="text-muted-foreground">
            Configure which AI models are available for test generation
          </p>
        </div>
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
      </div>

      {/* Info Card */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-4 pt-6">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium mb-1">OpenRouter Integration</h3>
            <p className="text-sm text-muted-foreground">
              This app uses OpenRouter to access various AI models. Make sure you have set up your
              OpenRouter API key in the environment variables. Models marked as disabled won't
              appear in the test creation form.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Models List */}
      <Card>
        <CardHeader>
          <CardTitle>Available Models</CardTitle>
          <CardDescription>
            {models.filter((m) => m.is_enabled).length} of {models.length} models enabled
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : models.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No models configured. Add your first model to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={cn(
                    'flex items-center justify-between p-4 rounded-lg border transition-colors',
                    model.is_enabled ? 'bg-card' : 'bg-muted/30 opacity-60'
                  )}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <button
                      onClick={() => toggleEnabled(model.id, model.is_enabled)}
                      disabled={updateMutation.isPending}
                      className={cn(
                        'w-10 h-6 rounded-full transition-colors relative flex-shrink-0',
                        model.is_enabled ? 'bg-success' : 'bg-muted-foreground/30'
                      )}
                    >
                      <div
                        className={cn(
                          'w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform',
                          model.is_enabled ? 'translate-x-4' : 'translate-x-0.5'
                        )}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium">{model.name}</h4>
                        {model.context_length && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                            {Math.round(model.context_length / 1000)}k context
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground font-mono">
                        {model.openrouter_id}
                      </p>
                      {model.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {model.description}
                        </p>
                      )}
                      {model.pricing && (
                        <div className="flex items-center gap-3 mt-2 text-xs">
                          <span className="text-muted-foreground">
                            Input: <span className="text-foreground font-medium">{formatPricePerMillion(model.pricing.prompt)}</span>/1M
                          </span>
                          <span className="text-muted-foreground">
                            Output: <span className="text-foreground font-medium">{formatPricePerMillion(model.pricing.completion)}</span>/1M
                          </span>
                        </div>
                      )}
                      {!model.pricing && !model.context_length && (
                        <p className="text-xs text-muted-foreground/60 mt-2 italic">
                          Pricing info unavailable from OpenRouter
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this model?')) {
                        deleteMutation.mutate(model.id)
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


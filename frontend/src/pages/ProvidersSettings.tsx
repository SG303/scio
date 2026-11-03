import { useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QueryState } from '@/components/QueryState'
import { PageHeader } from '@/components/PageHeader'
import { SectionTabs, settingsTabs } from '@/components/SectionTabs'
import { providersApi } from '@/services/api'
import { cn } from '@/lib/utils'
import { queryKeys } from '@/lib/constants'
import { toast } from '@/components/Toaster'
import type { ClaudeStatus } from '@/types'

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        connected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/60')}
      />
      {connected ? 'Connected' : 'Not connected'}
    </span>
  )
}

function ProviderPanel({
  title,
  connected,
  description,
  children,
}: {
  title: string
  connected: boolean
  description: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <StatusBadge connected={connected} />
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function OpenRouterPanel() {
  const queryClient = useQueryClient()
  const [isEditing, setIsEditing] = useState(false)
  const [apiKey, setApiKey] = useState('')

  const { data: status, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.openRouterStatus,
    queryFn: providersApi.openRouterStatus,
  })

  const onSaved = (message: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.openRouterStatus })
    setApiKey('')
    setIsEditing(false)
    toast.success(message)
  }

  const saveMutation = useMutation({
    mutationFn: providersApi.saveOpenRouterKey,
    onSuccess: () => onSaved('OpenRouter key saved.'),
    onError: (err) => toast.error(errorMessage(err, 'Could not save the key.')),
  })

  const removeMutation = useMutation({
    mutationFn: providersApi.removeOpenRouterKey,
    onSuccess: () => onSaved('OpenRouter key removed.'),
    onError: (err) => toast.error(errorMessage(err, 'Could not remove the key.')),
  })

  if (isLoading || error || !status) {
    return <QueryState loading={isLoading} error={error} onRetry={refetch} />
  }

  const showForm = !status.configured || isEditing

  return (
    <ProviderPanel
      title="OpenRouter"
      connected={status.configured}
      description="Pay-per-use access to models from OpenAI, Anthropic, Google and others. Each generation is billed to your OpenRouter credit."
    >
      {status.configured && !isEditing && (
        <div className="space-y-4">
          <p className="text-sm">
            Using the key ending in{' '}
            <span className="font-medium tabular-nums">{status.key_hint?.replace('…', '')}</span>
            {status.source === 'app'
              ? ', saved in Scio.'
              : ', set by the OPENROUTER_API_KEY environment variable. A key saved here takes priority.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              {status.source === 'app' ? 'Replace key' : 'Save a different key'}
            </Button>
            {status.source === 'app' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={removeMutation.isPending}
                onClick={() => {
                  if (confirm('Remove the OpenRouter key from Scio?')) removeMutation.mutate()
                }}
              >
                {removeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Remove key
              </Button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <form
          className="max-w-md space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            saveMutation.mutate(apiKey)
          }}
        >
          <Label htmlFor="openrouter-key">API key</Label>
          <div className="flex gap-2">
            <Input
              id="openrouter-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-v1-…"
              required
            />
            <Button type="submit" disabled={saveMutation.isPending || apiKey.trim().length < 10}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save key
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Create a key at{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              openrouter.ai/keys
            </a>
            . Scio checks it with OpenRouter before saving.
          </p>
          {isEditing && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          )}
        </form>
      )}
    </ProviderPanel>
  )
}

type StepState = 'done' | 'current' | 'upcoming'

function Step({
  number,
  state,
  title,
  isLast = false,
  children,
}: {
  number: number
  state: StepState
  title: string
  isLast?: boolean
  children?: ReactNode
}) {
  return (
    <li className={cn('relative flex gap-4', !isLast && 'pb-6')}>
      {!isLast && (
        // Connector line to the next step
        <span aria-hidden className="absolute bottom-1 left-[13px] top-8 w-px bg-border" />
      )}
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
          state === 'done' && 'bg-success text-success-foreground',
          state === 'current' && 'bg-primary text-primary-foreground ring-4 ring-primary/15',
          state === 'upcoming' && 'border bg-background text-muted-foreground'
        )}
      >
        {state === 'done' ? <Check className="h-3.5 w-3.5" /> : number}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className={cn('text-sm font-medium', state === 'upcoming' && 'text-muted-foreground')}>
          {title}
        </h3>
        {state === 'current' && children && <div className="mt-2 space-y-3">{children}</div>}
      </div>
    </li>
  )
}

const PLAN_NAMES: Record<string, string> = { pro: 'Claude Pro', max: 'Claude Max', team: 'Claude Team', enterprise: 'Claude Enterprise' }

function ClaudePanel() {
  const queryClient = useQueryClient()
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [code, setCode] = useState('')

  const { data: status, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.claudeStatus,
    queryFn: providersApi.claudeStatus,
  })

  const setStatus = (next: ClaudeStatus) => queryClient.setQueryData(queryKeys.claudeStatus, next)

  const installMutation = useMutation({
    mutationFn: providersApi.installClaude,
    onSuccess: (next) => {
      setStatus(next)
      toast.success('Claude Code installed.')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not install Claude Code.')),
  })

  const startMutation = useMutation({
    mutationFn: providersApi.startClaudeLogin,
    onSuccess: ({ url }) => setLoginUrl(url),
    onError: (err) => toast.error(errorMessage(err, 'Could not start the sign-in.')),
  })

  const completeMutation = useMutation({
    mutationFn: providersApi.completeClaudeLogin,
    onSuccess: (next) => {
      setStatus(next)
      setLoginUrl(null)
      setCode('')
      // The first sign-in adds the subscription models
      queryClient.invalidateQueries({ queryKey: queryKeys.models })
      toast.success('Claude subscription connected.')
    },
    onError: (err) => {
      // The CLI ends the sign-in on a rejected code: start over
      setLoginUrl(null)
      setCode('')
      toast.error(errorMessage(err, 'Sign-in failed.'))
    },
  })

  const cancelMutation = useMutation({
    mutationFn: providersApi.cancelClaudeLogin,
    onSuccess: (next) => {
      setStatus(next)
      setLoginUrl(null)
      setCode('')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not cancel the sign-in.')),
  })

  const logoutMutation = useMutation({
    mutationFn: providersApi.logoutClaude,
    onSuccess: (next) => {
      setStatus(next)
      toast.success('Signed out of Claude.')
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not sign out.')),
  })

  if (isLoading || error || !status) {
    return <QueryState loading={isLoading} error={error} onRetry={refetch} />
  }

  const description =
    'Generate with the Claude models included in your Claude plan instead of paying per use. Generations count toward the same usage limits as the rest of your Claude use.'

  if (status.logged_in) {
    return (
      <ProviderPanel title="Claude subscription" connected description={description}>
        <dl className="grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Account</dt>
          <dd className="truncate">{status.email ?? 'Unknown'}</dd>
          <dt className="text-muted-foreground">Plan</dt>
          <dd>{PLAN_NAMES[status.subscription_type ?? ''] ?? status.subscription_type ?? 'Unknown'}</dd>
          <dt className="text-muted-foreground">Claude Code</dt>
          <dd className="tabular-nums">{status.version ?? 'Unknown'}</dd>
        </dl>
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">
          The models marked “subscription” are listed under AI models and can be picked when
          creating tests and flashcards.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          disabled={logoutMutation.isPending}
          onClick={() => {
            if (confirm('Sign out of Claude? Subscription models stop working until you sign in again.')) {
              logoutMutation.mutate()
            }
          }}
        >
          {logoutMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign out
        </Button>
      </ProviderPanel>
    )
  }

  const installState: StepState = status.installed ? 'done' : 'current'
  const signInState: StepState = !status.installed ? 'upcoming' : loginUrl ? 'done' : 'current'
  const codeState: StepState = loginUrl ? 'current' : 'upcoming'

  return (
    <ProviderPanel title="Claude subscription" connected={false} description={description}>
      <ol>
        <Step number={1} state={installState} title="Install Claude Code">
          {status.can_install ? (
            <>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Scio talks to your subscription through Anthropic’s official Claude Code app.
                It is downloaded once (about 200 MB) and keeps itself up to date.
              </p>
              <Button size="sm" disabled={installMutation.isPending} onClick={() => installMutation.mutate()}>
                {installMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {installMutation.isPending ? 'Installing, this can take a minute…' : 'Install Claude Code'}
              </Button>
            </>
          ) : (
            <p className="max-w-2xl text-sm text-muted-foreground">
              Install Claude Code on the computer that runs Scio, then reload this page.
            </p>
          )}
        </Step>

        <Step number={2} state={signInState} title="Sign in at Anthropic">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Opens Anthropic’s sign-in page. You sign in there, so Scio never sees your password.
          </p>
          <Button size="sm" disabled={startMutation.isPending} onClick={() => startMutation.mutate()}>
            {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Start sign-in
          </Button>
        </Step>

        <Step number={3} state={codeState} title="Paste the code from Anthropic" isLast>
          <Button asChild size="sm" variant="outline">
            <a href={loginUrl ?? undefined} target="_blank" rel="noopener noreferrer">
              Open Anthropic sign-in
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
          <p className="max-w-2xl text-sm text-muted-foreground">
            After you sign in, Anthropic shows a code. Copy it and paste it here.
          </p>
          <form
            className="flex max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              completeMutation.mutate(code)
            }}
          >
            <Label htmlFor="claude-code" className="sr-only">
              Code from Anthropic
            </Label>
            <Input
              id="claude-code"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Paste code"
              required
            />
            <Button type="submit" disabled={completeMutation.isPending || !code.trim()}>
              {completeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Connect
            </Button>
          </form>
          <Button
            variant="ghost"
            size="sm"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Start over
          </Button>
        </Step>
      </ol>
    </ProviderPanel>
  )
}

export default function ProvidersSettings() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <SectionTabs tabs={settingsTabs} label="Settings section" />
      <PageHeader
        title="AI providers"
        description="Connect the services that generate your tests and flashcards."
      />
      <OpenRouterPanel />
      <ClaudePanel />
    </div>
  )
}

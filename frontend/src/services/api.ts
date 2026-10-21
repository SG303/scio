import type {
  AIModel,
  Document,
  Test,
  TestDetail,
  TestConfig,
  TestResult,
  CreateTestConfig,
  CreateDocument,
  FlashcardDeck,
  FlashcardDeckWithStats,
  Flashcard,
  StudySession,
  ReviewResponse,
  GlobalFlashcardStats,
  StreakStats,
  DeckStats,
  StudyQueueResponse,
  CreateFlashcardDeck,
  CreateFlashcard,
  GenerateFlashcardsRequest,
  GenerateFlashcardsResponse,
  CreateFromTestRequest,
  CreateFromTestResponse,
  Subject,
  SubjectListItem,
  SubjectDetail,
  CreateSubject,
  UpdateSubject,
  AddQuestionsRequest,
  AddCardsRequest,
  CreateAndGenerateTestRequest,
  CreateAndGenerateDeckRequest,
  CreateAndGenerateDeckResponse,
  ImportCardsResult,
  FlashcardAnalytics,
  AppSettings
} from '@/types'

const API_BASE = '/api'

/**
 * Error with the HTTP status attached, so callers can distinguish permanent
 * failures (e.g. 404 for a deleted card) from message matching.
 */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Build a readable error message from a FastAPI `detail` payload, which can be
 * a string or — for request-validation errors (422) — an array of
 * `{loc, msg, type}` objects. The first `loc` element is always "body" (or
 * "path"/"query") and is dropped so the message names the offending field.
 */
export function formatErrorDetail(detail: unknown): string {
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc) ? item.loc.slice(1) : []
          const field = loc.length > 0 ? `${loc.join('.')}: ` : ''
          const msg = typeof item.msg === 'string' ? item.msg : JSON.stringify(item)
          return `${field}${msg}`
        }
        return String(item)
      })
      .join('; ')
  }
  if (detail && typeof detail === 'object') {
    return JSON.stringify(detail)
  }
  return typeof detail === 'string' ? detail : ''
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'An error occurred' }))
    throw new ApiError(formatErrorDetail(error.detail) || 'Request failed', response.status)
  }

  return response.json()
}

// P6.2: generation progress tracking
export interface GenerationProgress {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  stage?: string
  batch?: number
  batches_total?: number
  done?: number
  total?: number
  message?: string
}

export const generationApi = {
  getProgress: (token: string) =>
    fetchApi<GenerationProgress>(`/generation/progress/${token}`),

  cancel: (token: string) =>
    fetchApi<{ status: 'cancellation_requested' }>(`/generation/progress/${token}/cancel`, {
      method: 'POST',
    }),
}

// AI Models
export const settingsApi = {
  get: () => fetchApi<AppSettings>('/settings'),

  update: (data: Partial<AppSettings>) =>
    fetchApi<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
}

export const modelsApi = {
  list: (enabledOnly = false) =>
    fetchApi<AIModel[]>(`/models${enabledOnly ? '?enabled_only=true' : ''}`),
  
  get: (id: number) =>
    fetchApi<AIModel>(`/models/${id}`),
  
  create: (data: Partial<AIModel>) =>
    fetchApi<AIModel>('/models', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  update: (id: number, data: Partial<AIModel>) =>
    fetchApi<AIModel>(`/models/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  delete: (id: number) =>
    fetchApi<void>(`/models/${id}`, { method: 'DELETE' }),
}

// Documents
export const documentsApi = {
  list: () =>
    fetchApi<Document[]>('/documents'),
  
  get: (id: number) =>
    fetchApi<Document>(`/documents/${id}`),
  
  create: (data: CreateDocument) =>
    fetchApi<Document>('/documents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  upload: async (title: string, docType: string, file: File) => {
    const formData = new FormData()
    formData.append('title', title)
    formData.append('doc_type', docType)
    formData.append('file', file)

    const response = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }))
      throw new Error(error.detail || 'Upload failed')
    }

    return response.json() as Promise<Document>
  },
  
  update: (id: number, data: Partial<Document>) =>
    fetchApi<Document>(`/documents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  delete: (id: number) =>
    fetchApi<void>(`/documents/${id}`, { method: 'DELETE' }),
}

// Tests
export const testsApi = {
  list: () =>
    fetchApi<Test[]>('/tests'),
  
  get: (id: number) =>
    fetchApi<TestDetail>(`/tests/${id}`),
  
  createConfig: (data: CreateTestConfig) =>
    fetchApi<TestConfig>('/tests/configs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  listConfigs: () =>
    fetchApi<TestConfig[]>('/tests/configs'),

  // Assign (number) or unassign (null) the subject of a test config
  setConfigSubject: (configId: number, subjectId: number | null) =>
    fetchApi<TestConfig>(`/tests/configs/${configId}`, {
      method: 'PATCH',
      body: JSON.stringify({ subject_id: subjectId }),
    }),

  // Deletes a (non-template) config with all of its tests
  deleteConfig: (configId: number) =>
    fetchApi<void>(`/tests/configs/${configId}`, { method: 'DELETE' }),
  
  // P5.1: score history for the template sparkline
  getConfigScores: (configId: number, limit = 20) =>
    fetchApi<number[]>(`/tests/configs/${configId}/scores?limit=${limit}`),

  // P6.2: combined create + generate with progress token
  createAndGenerate: (
    data: CreateAndGenerateTestRequest,
    progressToken?: string,
    signal?: AbortSignal,
  ) =>
    fetchApi<Test>(`/tests/create-and-generate${progressToken ? `?progress_token=${progressToken}` : ''}`, {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    }),
  
  start: (testId: number) =>
    fetchApi<Test>(`/tests/${testId}/start`, { method: 'POST' }),
  
  submitAnswer: (testId: number, questionId: number, answer: number) =>
    fetchApi<{ message: string; is_correct: boolean }>(`/tests/${testId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_id: questionId, answer }),
    }),
  
  submit: (testId: number) =>
    fetchApi<TestResult>(`/tests/${testId}/submit`, { method: 'POST' }),
  
  verifyQuestion: (testId: number, questionId: number) =>
    fetchApi<{
      status: 'likely_ok' | 'potential_issue'
      confidence: 'high' | 'medium' | 'low'
      analysis: string
    }>(`/tests/${testId}/questions/${questionId}/verify`, { method: 'POST' }),

  delete: (testId: number) =>
    fetchApi<void>(`/tests/${testId}`, { method: 'DELETE' }),
  
  // Templates
  listTemplates: () =>
    fetchApi<TestConfig[]>('/tests/templates'),
  
  getTemplate: (id: number) =>
    fetchApi<TestConfig>(`/tests/templates/${id}`),
  
  createTemplate: (data: CreateTestConfig) =>
    fetchApi<TestConfig>('/tests/configs', {
      method: 'POST',
      body: JSON.stringify({ ...data, is_template: true }),
    }),
  
  updateTemplate: (id: number, data: CreateTestConfig) =>
    fetchApi<TestConfig>(`/tests/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...data, is_template: true }),
    }),
  
  deleteTemplate: (id: number) =>
    fetchApi<void>(`/tests/templates/${id}`, { method: 'DELETE' }),
}

// Flashcards
export const flashcardsApi = {
  // Decks
  listDecks: () =>
    fetchApi<FlashcardDeckWithStats[]>('/flashcards/decks'),
  
  getDeck: (deckId: number) =>
    fetchApi<FlashcardDeckWithStats>(`/flashcards/decks/${deckId}`),
  
  createDeck: (data: CreateFlashcardDeck) =>
    fetchApi<FlashcardDeck>('/flashcards/decks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  updateDeck: (deckId: number, data: Partial<CreateFlashcardDeck>) =>
    fetchApi<FlashcardDeck>(`/flashcards/decks/${deckId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  deleteDeck: (deckId: number) =>
    fetchApi<void>(`/flashcards/decks/${deckId}`, { method: 'DELETE' }),
  
  // Card generation
  // P5.2: deck + cards in one call — failed generation leaves no deck behind
  createAndGenerateDeck: (data: CreateAndGenerateDeckRequest) =>
    fetchApi<CreateAndGenerateDeckResponse>('/flashcards/create-and-generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // P6.1: export a deck as Anki .apkg or CSV — triggers a browser download
  exportDeck: async (deckId: number, format: 'apkg' | 'csv', deckTitle: string) => {
    const response = await fetch(`${API_BASE}/flashcards/decks/${deckId}/export?format=${format}`, {
      method: 'POST',
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Export failed' }))
      throw new Error(error.detail || 'Export failed')
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${deckTitle.replace(/[^\w\-. ]/g, '_') || 'deck'}.${format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },

  // P6.1: import cards from a CSV file (columns: front,back,state)
  importCards: async (deckId: number, file: File): Promise<ImportCardsResult> => {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${API_BASE}/flashcards/decks/${deckId}/import`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Import failed' }))
      throw new Error(error.detail || 'Import failed')
    }
    return response.json()
  },

  generateCards: (deckId: number, data: GenerateFlashcardsRequest) =>
    fetchApi<GenerateFlashcardsResponse>(`/flashcards/decks/${deckId}/generate`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  // Cards
  listCards: (deckId: number) =>
    fetchApi<Flashcard[]>(`/flashcards/decks/${deckId}/cards`),
  
  createCard: (deckId: number, data: CreateFlashcard) =>
    fetchApi<Flashcard>(`/flashcards/decks/${deckId}/cards`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  updateCard: (cardId: number, data: Partial<CreateFlashcard>) =>
    fetchApi<Flashcard>(`/flashcards/cards/${cardId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  deleteCard: (cardId: number) =>
    fetchApi<void>(`/flashcards/cards/${cardId}`, { method: 'DELETE' }),
  
  // Study
  getStudyQueue: (deckId: number, sessionId?: number) =>
    fetchApi<StudyQueueResponse>(
      sessionId
        ? `/flashcards/decks/${deckId}/study?session_id=${sessionId}`
        : `/flashcards/decks/${deckId}/study`
    ),
  
  submitReview: (cardId: number, rating: number, timeTakenMs?: number, sessionId?: number) =>
    fetchApi<ReviewResponse>(
      sessionId
        ? `/flashcards/cards/${cardId}/review?session_id=${sessionId}`
        : `/flashcards/cards/${cardId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ rating, time_taken_ms: timeTakenMs }),
      }
    ),
  
  getIncompleteSession: (deckId: number) =>
    fetchApi<{ has_incomplete_session: boolean; session_id?: number; cards_studied_count?: number; started_at?: string }>(
      `/flashcards/decks/${deckId}/incomplete-session`
    ),
  
  // Sessions
  startSession: (deckId?: number) =>
    fetchApi<StudySession>('/flashcards/sessions', {
      method: 'POST',
      body: JSON.stringify({ deck_id: deckId }),
    }),
  
  completeSession: (sessionId: number, totalTimeMs: number) =>
    fetchApi<StudySession>(`/flashcards/sessions/${sessionId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ total_time_ms: totalTimeMs }),
    }),
  
  getSession: (sessionId: number) =>
    fetchApi<StudySession>(`/flashcards/sessions/${sessionId}`),
  
  // Stats
  // P6.3: aggregated analytics for the stats page
  getAnalytics: () => fetchApi<FlashcardAnalytics>('/flashcards/analytics'),

  getGlobalStats: () =>
    fetchApi<GlobalFlashcardStats>('/flashcards/stats'),

  // P4.2: streak and daily goal
  getStreak: () =>
    fetchApi<StreakStats>('/flashcards/streak'),
  
  getDeckStats: (deckId: number) =>
    fetchApi<DeckStats>(`/flashcards/decks/${deckId}/stats`),
  
  // Test integration
  createFromTest: (testId: number, data: CreateFromTestRequest) =>
    fetchApi<CreateFromTestResponse>(`/flashcards/from-test/${testId}`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Subjects
export const subjectsApi = {
  // CRUD
  list: () =>
    fetchApi<SubjectListItem[]>('/subjects'),
  
  get: (id: number) =>
    fetchApi<SubjectDetail>(`/subjects/${id}`),
  
  create: (data: CreateSubject) =>
    fetchApi<Subject>('/subjects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  update: (id: number, data: UpdateSubject) =>
    fetchApi<Subject>(`/subjects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  
  delete: (id: number, cascade = false) =>
    fetchApi<void>(`/subjects/${id}?cascade=${cascade}`, { method: 'DELETE' }),
  
  // Add to existing
  addQuestions: (subjectId: number, configId: number, data: AddQuestionsRequest) =>
    fetchApi<Test>(`/subjects/${subjectId}/test-configs/${configId}/add-questions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  addCards: (subjectId: number, deckId: number, data: AddCardsRequest) =>
    fetchApi<GenerateFlashcardsResponse>(`/subjects/${subjectId}/decks/${deckId}/add-cards`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

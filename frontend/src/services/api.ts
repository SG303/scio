import type {
  AIModel,
  Document,
  Test,
  TestDetail,
  TestConfig,
  TestResult,
  CreateTestConfig,
  CreateDocument,
  GenerateFromTemplateRequest,
  FlashcardDeck,
  FlashcardDeckWithStats,
  Flashcard,
  StudySession,
  ReviewResponse,
  GlobalFlashcardStats,
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
  GenerateTestInSubjectRequest,
  GenerateFlashcardsInSubjectRequest,
  AddQuestionsRequest,
  AddCardsRequest
} from '@/types'

const API_BASE = '/api'

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'An error occurred' }))
    throw new Error(error.detail || 'Request failed')
  }

  return response.json()
}

// AI Models
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
  
  generate: (configId: number, options?: GenerateFromTemplateRequest) =>
    fetchApi<Test>(`/tests/generate/${configId}`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
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
  
  generateFromTemplate: (templateId: number, numQuestions?: number) =>
    fetchApi<Test>(`/tests/generate/${templateId}`, {
      method: 'POST',
      body: JSON.stringify({ num_questions: numQuestions }),
    }),
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
  getGlobalStats: () =>
    fetchApi<GlobalFlashcardStats>('/flashcards/stats'),
  
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
  
  // Generate materials
  generateTest: (subjectId: number, data: GenerateTestInSubjectRequest) =>
    fetchApi<Test>(`/subjects/${subjectId}/generate-test`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
  generateFlashcards: (subjectId: number, data: GenerateFlashcardsInSubjectRequest) =>
    fetchApi<GenerateFlashcardsResponse>(`/subjects/${subjectId}/generate-flashcards`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  
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


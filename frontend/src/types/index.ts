export interface AIModel {
  id: number
  name: string
  openrouter_id: string
  description: string | null
  is_enabled: boolean
  created_at: string
  pricing?: {
    prompt: string
    completion: string
  }
  context_length?: number
}

export interface Document {
  id: number
  title: string
  doc_type: 'exam_objectives' | 'study_guide' | 'example_questions'
  content: string | null
  file_path: string | null
  file_name: string | null
  created_at: string
  updated_at: string
}

export interface Choice {
  index: number
  text: string
}

export interface Question {
  id: number
  question_number: number
  question_text: string
  choices: Choice[]
  user_answer: number | null
  is_correct: boolean | null
  correct_answer: number | null
  explanation: string | null
}

export interface TestConfig {
  id: number
  title: string
  num_questions: number
  num_choices: number
  ai_model_id: number
  document_ids: number[]
  is_template: boolean
  custom_prompt: string | null
  created_at: string
}

export interface Test {
  id: number
  config_id: number
  config_title: string | null
  status: 'generated' | 'in_progress' | 'completed'
  started_at: string | null
  completed_at: string | null
  score: number | null
  total_questions: number
  correct_answers: number | null
  created_at: string
}

export interface TestDetail extends Test {
  questions: Question[]
}

export interface TestResult {
  test_id: number
  status: string
  score: number
  total_questions: number
  correct_answers: number
  questions: Question[]
}

export interface CreateTestConfig {
  title: string
  num_questions: number
  num_choices: number
  ai_model_id: number
  document_ids: number[]
  is_template?: boolean
  custom_prompt?: string | null
}

export interface GenerateFromTemplateRequest {
  num_questions?: number
}

export interface CreateDocument {
  title: string
  doc_type: string
  content?: string
}

// ============== Flashcard Types ==============

export interface FlashcardDeck {
  id: number
  title: string
  description: string | null
  ai_model_id: number | null
  document_ids: number[] | null
  custom_prompt: string | null
  new_cards_per_day: number
  created_at: string
  updated_at: string
}

export interface FlashcardDeckWithStats extends FlashcardDeck {
  total_cards: number
  new_cards: number
  due_cards: number
  learning_cards: number
  review_cards: number
}

export interface Flashcard {
  id: number
  deck_id: number
  front: string
  back: string
  state: 'new' | 'learning' | 'review' | 'relearning'
  easiness_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  source_type: string | null
  source_question_id: number | null
  created_at: string
  last_reviewed_at: string | null
}

export interface FlashcardStudy {
  id: number
  front: string
  back: string
  state: string
}

export interface StudySession {
  id: number
  deck_id: number | null
  started_at: string
  completed_at: string | null
  cards_reviewed: number
  cards_again: number
  cards_hard: number
  cards_good: number
  cards_easy: number
  total_time_ms: number
}

export interface ReviewResponse {
  card_id: number
  rating: number
  new_state: string
  next_review_at: string | null
  interval_days: number
}

export interface DeckStats {
  total_cards: number
  new_cards: number
  learning_cards: number
  review_cards: number
  due_today: number
  due_reviews: number
  new_available: number
}

export interface GlobalFlashcardStats {
  total_decks: number
  total_cards: number
  due_today: number
  due_reviews: number
  new_available: number
}

export interface StudyQueueResponse {
  deck_id: number
  total_cards: number
  cards: FlashcardStudy[]
}

export interface CreateFlashcardDeck {
  title: string
  description?: string | null
  ai_model_id?: number | null
  document_ids?: number[] | null
  custom_prompt?: string | null
  new_cards_per_day?: number
}

export interface CreateFlashcard {
  front: string
  back: string
}

export interface GenerateFlashcardsRequest {
  num_cards: number
  topic?: string
}

export interface GenerateFlashcardsResponse {
  deck_id: number
  cards_generated: number
  cards: Flashcard[]
}

export interface CreateFromTestRequest {
  deck_id?: number | null
  deck_title?: string | null
  wrong_only?: boolean
}

export interface CreateFromTestResponse {
  deck_id: number
  cards_created: number
  cards: Flashcard[]
}

// ============== Subject Types ==============

export interface Subject {
  id: number
  title: string
  description: string | null
  ai_model_id: number | null
  document_ids: number[] | null
  created_at: string
  updated_at: string
}

export interface SubjectListItem extends Subject {
  ai_model_name: string | null
  document_count: number
  test_count: number
  deck_count: number
  total_tests_taken: number
  average_score: number | null
  total_cards: number
  mastered_cards: number
}

export interface TestConfigInSubject {
  id: number
  title: string
  num_questions: number
  num_choices: number
  tests_taken: number
  best_score: number | null
  last_score: number | null
  created_at: string
}

export interface FlashcardDeckInSubject {
  id: number
  title: string
  description: string | null
  total_cards: number
  new_cards: number
  learning_cards: number
  review_cards: number
  due_cards: number
  created_at: string
}

export interface SubjectDetail extends Subject {
  ai_model_name: string | null
  document_count: number
  total_tests_taken: number
  average_score: number | null
  total_cards: number
  mastered_cards: number
  test_configs: TestConfigInSubject[]
  flashcard_decks: FlashcardDeckInSubject[]
}

export interface CreateSubject {
  title: string
  description?: string | null
  ai_model_id?: number | null
  document_ids?: number[] | null
}

export interface UpdateSubject {
  title?: string
  description?: string | null
  ai_model_id?: number | null
  document_ids?: number[] | null
}

export interface GenerateTestInSubjectRequest {
  title: string
  num_questions?: number
  num_choices?: number
  ai_model_id?: number | null
  document_ids?: number[] | null
  custom_prompt?: string | null
}

export interface GenerateFlashcardsInSubjectRequest {
  title: string
  description?: string | null
  num_cards?: number
  ai_model_id?: number | null
  document_ids?: number[] | null
  custom_prompt?: string | null
}

export interface AddQuestionsRequest {
  num_questions?: number
  ai_model_id?: number | null
  custom_prompt?: string | null
}

export interface AddCardsRequest {
  num_cards?: number
  ai_model_id?: number | null
  custom_prompt?: string | null
}

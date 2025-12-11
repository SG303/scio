import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { AIModel } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatScore(score: number): string {
  if (score >= 90) return 'Excellent!'
  if (score >= 80) return 'Great job!'
  if (score >= 70) return 'Good work!'
  if (score >= 60) return 'Keep practicing!'
  return 'Need more study'
}

export function getScoreColor(score: number): string {
  if (score >= 90) return 'text-green-400'
  if (score >= 80) return 'text-emerald-400'
  if (score >= 70) return 'text-yellow-400'
  if (score >= 60) return 'text-orange-400'
  return 'text-red-400'
}

export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ~= 4 characters for English text
  return Math.ceil(text.length / 4)
}

/**
 * Calculate the estimated tokens for a test generation request.
 * 
 * The backend uses a tiered generation strategy for token efficiency:
 * 1. Single call for all questions (≤60 questions) - most efficient
 * 2. Medium batches (25 questions) - fallback
 * 3. Small batches (10 questions) - final fallback
 * 
 * This estimation assumes the most likely path (single call or minimal batches).
 */
export function calculateTestGenerationTokens(
  documentContents: string[],
  numQuestions: number,
  hasCustomPrompt: boolean = false
): { inputTokens: number; outputTokens: number; numBatches: number } {
  // Tiered batch sizes matching backend strategy
  // Single call for ≤60 questions, medium batches (25) for more
  const SINGLE_CALL_THRESHOLD = 60
  const MEDIUM_BATCH_SIZE = 25
  
  // Calculate number of batches based on tiered strategy
  let numBatches: number
  if (numQuestions <= SINGLE_CALL_THRESHOLD) {
    numBatches = 1  // Single call - most efficient
  } else {
    numBatches = Math.ceil(numQuestions / MEDIUM_BATCH_SIZE)
  }
  
  // Base prompt tokens (system message + prompt template)
  // System message: ~25 tokens
  // Prompt template without docs: ~450 tokens
  // Prompt template with docs: ~350 tokens (less instructions, more context)
  // Custom prompt adds: ~50-100 tokens overhead
  const hasDocs = documentContents.length > 0 && documentContents.some(c => c && c.length > 0)
  const systemTokens = 25
  const basePromptTokens = hasDocs ? 350 : 450
  const customPromptOverhead = hasCustomPrompt ? 75 : 0
  
  // Calculate document tokens
  let documentTokens = 0
  documentContents.forEach(content => {
    if (content) {
      documentTokens += estimateTokens(content)
      // Add ~20 tokens per document for header formatting (### Title (type))
      documentTokens += 20
    }
  })
  
  // Per-batch input tokens = system + base prompt + documents
  const perBatchInputTokens = systemTokens + basePromptTokens + customPromptOverhead + documentTokens
  
  // Total input tokens = per-batch * number of batches
  // With tiered strategy, this is much more efficient than before
  const totalInputTokens = perBatchInputTokens * numBatches
  
  // Output tokens: ~120 tokens per question
  // (question text ~40, choices ~40, correct_answer ~1, explanation ~40)
  const outputTokensPerQuestion = 120
  const totalOutputTokens = numQuestions * outputTokensPerQuestion
  
  return {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    numBatches
  }
}

/**
 * Format price per token to price per 1M tokens for display
 * OpenRouter returns pricing per token (e.g., "0.000005")
 * This converts to a human-readable per-million format
 */
export function formatPricePerMillion(pricePerToken: string | number): string {
  const price = typeof pricePerToken === 'string' ? parseFloat(pricePerToken) : pricePerToken
  if (isNaN(price) || price === 0) return '$0.00'
  
  const pricePerMillion = price * 1_000_000
  
  // Format based on magnitude
  if (pricePerMillion >= 1) {
    return `$${pricePerMillion.toFixed(2)}`
  } else if (pricePerMillion >= 0.01) {
    return `$${pricePerMillion.toFixed(3)}`
  } else {
    return `$${pricePerMillion.toFixed(4)}`
  }
}

export function calculateEstimatedCost(
  inputTokens: number,
  outputTokens: number,
  model: AIModel | undefined
): { estimatedCost: number; contextUsage: number } {
  if (!model || !model.pricing) {
    return { estimatedCost: 0, contextUsage: 0 }
  }

  // OpenRouter API returns pricing per token (e.g. "0.000005")
  const promptPricePerToken = parseFloat(model.pricing.prompt) || 0
  const completionPricePerToken = parseFloat(model.pricing.completion) || 0

  // Calculate total cost
  const inputCost = inputTokens * promptPricePerToken
  const outputCost = outputTokens * completionPricePerToken
  
  const estimatedCost = inputCost + outputCost

  // Calculate context usage percentage
  const totalTokens = inputTokens + outputTokens
  const contextLimit = model.context_length || 128000 // Default fallback
  const contextUsage = Math.min(100, (totalTokens / contextLimit) * 100)

  return { estimatedCost, contextUsage }
}

// What differs between the generation flows that share the generation lifecycle (useGenerationJob;
// GenerationSetup for Stories 3.1a, 4.1; SummarizeSetup for Story 4.3): the job kind, the i18n section of
// the copy, the tool name, the request endpoint, the capacity field (none for a summary), and the page a
// finished job opens.
export const QUIZ = {
  kind: 'quiz',
  copy: 'quiz',
  tool: 'tools.quiz',
  endpoint: 'quizzes',
  capacity: 'max_questions',
  result: (projectId, ref) => `/projects/${projectId}/quizzes/${ref}`,
}

export const FLASHCARDS = {
  kind: 'flashcards',
  copy: 'flashcards',
  tool: 'tools.flashcards',
  endpoint: 'flashcard-sets',
  capacity: 'max_cards',
  result: (projectId, ref) => `/projects/${projectId}/flashcard-sets/${ref}`,
}

export const SUMMARY = {
  kind: 'summary',
  copy: 'summary',
  tool: 'tools.summarize',
  endpoint: 'summaries',
  result: (projectId, ref) => `/projects/${projectId}/summaries/${ref}`,
}

// What differs between the generation flows that share GenerationSetup (Stories 3.1a, 4.1): the job
// kind, the i18n section of the copy, the tool name, the request endpoint, the capacity field, and the
// page a finished job opens.
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

import GenerationSetup from './GenerationSetup.jsx'
import { QUIZ } from './generationKinds.js'

// Quiz setup and generation (Story 3.1a, FR-10, FR-26): the shared GenerationSetup flow for a Quiz.
export { DEFAULT_COUNT, POLL_MS } from './GenerationSetup.jsx'

export default function QuizSetup() {
  return <GenerationSetup kind={QUIZ} />
}

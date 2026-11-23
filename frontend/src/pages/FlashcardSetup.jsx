import GenerationSetup from './GenerationSetup.jsx'
import { FLASHCARDS } from './generationKinds.js'

// Flashcards setup and generation (Story 4.1, FR-13): the shared GenerationSetup flow for a flashcard
// set, the same as the Quiz's with cards: "Make flashcards", "How many cards?", "Make {n} cards", and the
// steps "Reading your material -> Writing cards -> Checking sources". Done goes to the set's page.
export default function FlashcardSetup() {
  return <GenerationSetup kind={FLASHCARDS} />
}

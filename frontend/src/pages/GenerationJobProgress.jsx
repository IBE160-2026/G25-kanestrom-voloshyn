import { useTranslation } from 'react-i18next'
import GenerationProgress from '../components/GenerationProgress.jsx'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import styles from './QuizSetup.module.css'
import { STEPS } from './useGenerationJob.js'

// The progress view of a running job (useGenerationJob): the shared Progress steps with the kind's step
// labels (`{copy}.steps.*`), Cancel, and the Inline error of a failed cancel request.
export default function GenerationJobProgress({ copy, generation }) {
  const { t } = useTranslation()
  const { job, cancel, cancelling, cancelError, progressRegion } = generation
  if (!job) return null
  return (
    <GenerationProgress
      ref={progressRegion}
      steps={STEPS.map((step) => t(`${copy}.steps.${step}`))}
      current={job.reached}
      onCancel={cancel}
      cancelling={cancelling}
    >
      {cancelError && (
        <div className={styles.error}>
          <InlineError onRetry={cancel}>{errorText(t, cancelError)}</InlineError>
        </div>
      )}
    </GenerationProgress>
  )
}

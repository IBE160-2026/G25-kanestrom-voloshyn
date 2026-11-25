import { useTranslation } from 'react-i18next'
import ChatBar from '../components/ChatBar.jsx'
import ChatThread from '../components/ChatThread.jsx'
import Composer from '../components/Composer.jsx'
import InlineError from '../components/InlineError.jsx'
import { errorText } from '../i18n/errors.js'
import { ALL_MATERIALS, useChat } from './useChat.js'

// The chat as the Project home (Story 4.4, FR-16; DESIGN.md › Layout › Project home): the Chat bar, the
// thread, the tool buttons row (`tools`, from ProjectHome), and the composer, top to bottom. Until a file
// is Ready (`enabled` false) the drop zone or skeleton (`placeholder`) stands in for the Chat bar and
// thread, and the composer is off. In a read-only Project the thread still shows, but the scope can't
// change and nothing can be sent. ProjectHome keys this by Project (see useChat).
// A failed answer shows the Inline error with "Try again" under the thread; the question is back in the
// composer. A scope change that fails shows the Inline error alone.
/** The chat's scope as the UI shows it: a file that is no longer Ready counts as all materials. */
function readyScope(scope, readyFiles) {
  if (scope?.material_id && readyFiles.some((file) => file.id === scope.material_id)) return scope
  return ALL_MATERIALS
}

export default function ProjectChat({ projectId, enabled, readOnly, materials, placeholder, tools }) {
  const { t } = useTranslation()
  const chat = useChat(projectId, { enabled })
  const readyFiles = (materials ?? []).filter((m) => m.status === 'ready')
  const busy = chat.pending !== null
  const composerOff = !enabled || readOnly || chat.chat === null

  return (
    <>
      {enabled ? (
        <>
          <ChatBar
            scope={readyScope(chat.chat?.current_scope, readyFiles)}
            files={readyFiles}
            disabled={readOnly || busy || chat.chat === null}
            onScope={chat.setScope}
          />
          {chat.scopeError && <InlineError>{errorText(t, chat.scopeError)}</InlineError>}
          <ChatThread
            messages={chat.chat?.messages ?? null}
            pending={chat.pending}
            announcement={chat.announcement}
          >
            {chat.loadError && <InlineError onRetry={chat.reload}>{errorText(t, chat.loadError)}</InlineError>}
            {chat.failure && (
              <InlineError onRetry={chat.failure.retryable ? chat.retry : undefined}>
                {errorText(t, chat.failure.error)}
              </InlineError>
            )}
          </ChatThread>
        </>
      ) : (
        placeholder
      )}
      {tools}
      <Composer
        value={chat.draft}
        onChange={chat.setDraft}
        onSend={chat.send}
        disabled={composerOff}
        busy={busy}
        left={enabled && !readOnly ? chat.left : null}
      />
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useAppStore, type ChatMessage } from '../../store'
import styles from './AiPanel.module.css'

const SUGGESTIONS = [
  'Should I bet UP or DOWN right now?',
  'What signals are strongest?',
  'Summarize my trading today',
  'What\'s my win rate by session?',
  'Compare this setup to my recent losses',
  'Is this a high-edge entry?',
]

async function persistMsg(role: 'user' | 'assistant', content: string, isProactive = false, timestamp = Date.now()) {
  try {
    await fetch('/api/chat/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, content, isProactive, timestamp }),
    })
  } catch {}
}

function useAI() {
  const {
    chatHistory, isAIStreaming, proactiveAlerts,
    setChatHistory, addChatMessage, updateLastAssistantMessage,
    finalizeLastAssistantMessage, setIsAIStreaming, addProactiveAlert,
    signals, windowState,
  } = useAppStore((s) => ({
    chatHistory: s.chatHistory,
    isAIStreaming: s.isAIStreaming,
    proactiveAlerts: s.proactiveAlerts,
    setChatHistory: s.setChatHistory,
    addChatMessage: s.addChatMessage,
    updateLastAssistantMessage: s.updateLastAssistantMessage,
    finalizeLastAssistantMessage: s.finalizeLastAssistantMessage,
    setIsAIStreaming: s.setIsAIStreaming,
    addProactiveAlert: s.addProactiveAlert,
    signals: s.signals,
    windowState: s.windowState,
  }))

  // Load today's chat history on mount
  useEffect(() => {
    fetch('/api/chat')
      .then((r) => r.json() as Promise<{ messages: Array<{ role: string; content: string; isProactive: boolean; timestamp: number }> }>)
      .then(({ messages }) => {
        if (messages.length > 0) {
          setChatHistory(messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            isProactive: m.isProactive,
            timestamp: m.timestamp,
          })))
        }
      })
      .catch(() => {})
  }, [])

  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = async (message: string) => {
    if (!message.trim() || isAIStreaming) return

    const userMsg: ChatMessage = { role: 'user', content: message, timestamp: Date.now() }
    addChatMessage(userMsg)
    persistMsg('user', message, false, userMsg.timestamp)

    const assistantMsg: ChatMessage = {
      role: 'assistant', content: '', isStreaming: true, timestamp: Date.now(),
    }
    addChatMessage(assistantMsg)
    setIsAIStreaming(true)

    const history = chatHistory
      .filter((m) => !m.isStreaming)
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }))

    abortRef.current = new AbortController()
    try {
      const r = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
        signal: abortRef.current.signal,
      })

      if (!r.ok) {
        const err = await r.json() as { error: string }
        finalizeLastAssistantMessage(`Error: ${err.error}`)
        setIsAIStreaming(false)
        return
      }

      const reader = r.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; fullResponse?: string; error?: string }
            if (data.delta) updateLastAssistantMessage(data.delta)
            if (data.done && data.fullResponse) {
              finalizeLastAssistantMessage(data.fullResponse)
              persistMsg('assistant', data.fullResponse, false, Date.now())
            }
            if (data.error) finalizeLastAssistantMessage(`Error: ${data.error}`)
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        finalizeLastAssistantMessage('Connection error. Is the backend running?')
      }
    } finally {
      setIsAIStreaming(false)
    }
  }

  const triggerProactive = async () => {
    try {
      const r = await fetch('/api/ai/proactive', { method: 'POST' })
      if (!r.ok) return

      let content = ''
      const reader = r.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as { delta?: string; fullResponse?: string }
            if (data.delta) content += data.delta
            if (data.fullResponse) content = data.fullResponse
          } catch {}
        }
      }

      if (content) {
        const ts = Date.now()
        addProactiveAlert({ role: 'assistant', content, isProactive: true, timestamp: ts })
        persistMsg('assistant', content, true, ts)
      }
    } catch {}
  }

  // Auto-trigger proactive analysis when C4 starts
  const prevCandleNum = useRef(0)
  useEffect(() => {
    const cn = windowState?.candleNum ?? 0
    if (cn === 4 && prevCandleNum.current !== 4) {
      triggerProactive()
    }
    prevCandleNum.current = cn
  }, [windowState?.candleNum])

  return { chatHistory, isAIStreaming, proactiveAlerts, sendMessage }
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  return (
    <div className={`${styles.bubble} ${msg.role === 'user' ? styles.userBubble : styles.aiBubble}`}>
      {msg.isProactive && <div className={styles.proactiveLabel}>⚡ AUTO ANALYSIS</div>}
      <div className={styles.bubbleText}>
        {msg.content || (msg.isStreaming ? <span className={styles.cursor}>▌</span> : '')}
        {msg.isStreaming && msg.content && <span className={styles.cursor}>▌</span>}
      </div>
      <div className={styles.bubbleTime}>
        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

export function AiPanel() {
  const { chatHistory, isAIStreaming, proactiveAlerts, sendMessage } = useAI()
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  interface ContextInfo { candleNum: number; session: string; oddsUp: number; tradesLoaded: number; journalEntriesLoaded: number; newsCount: number }
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  useEffect(() => {
    const load = () => fetch('/api/ai/context')
      .then((r) => r.json() as Promise<ContextInfo>)
      .then(setContextInfo)
      .catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  // Expose focus for keyboard shortcut
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.type === 'focus-ai-input') inputRef.current?.focus()
    }
    window.addEventListener('focus-ai-input', handler as EventListener)
    return () => window.removeEventListener('focus-ai-input', handler as EventListener)
  }, [])

  const handleSubmit = () => {
    if (!input.trim() || isAIStreaming) return
    sendMessage(input.trim())
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  const handleSuggestion = (s: string) => {
    sendMessage(s)
  }

  return (
    <div className={styles.panel}>
      {/* Context bar */}
      {contextInfo && (
        <div className={styles.contextBar}>
          <span className={styles.ctxChip}>C{contextInfo.candleNum}</span>
          {contextInfo.session && <span className={styles.ctxChip}>{contextInfo.session.toUpperCase()}</span>}
          {contextInfo.oddsUp != null && (
            <span className={styles.ctxChip}>{Math.round(contextInfo.oddsUp * 100)}%↑</span>
          )}
          <span className={styles.ctxChip}>{contextInfo.tradesLoaded}T</span>
          <span className={styles.ctxChip}>{contextInfo.journalEntriesLoaded}J</span>
          <span className={styles.ctxChip}>{contextInfo.newsCount}N</span>
        </div>
      )}

      {/* Proactive alerts */}
      {proactiveAlerts.length > 0 && chatHistory.length === 0 && (
        <div className={styles.proactiveSection}>
          <div className={styles.proactiveSectionLabel}>⚡ LATEST ANALYSIS</div>
          {proactiveAlerts.slice(0, 1).map((a, i) => (
            <div key={i} className={styles.proactiveAlert}>
              {a.content}
            </div>
          ))}
        </div>
      )}

      {/* Chat messages */}
      <div className={styles.messages}>
        {chatHistory.length === 0 && proactiveAlerts.length === 0 && (
          <div className={styles.empty}>
            Ask anything about the current setup, your trade history, or market conditions.
          </div>
        )}
        {chatHistory.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion pills */}
      {chatHistory.length === 0 && (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className={styles.suggestion} onClick={() => handleSuggestion(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className={styles.inputRow}>
        <textarea
          ref={inputRef}
          className={styles.input}
          placeholder="Ask the AI agent… (Ctrl+K)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isAIStreaming}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSubmit}
          disabled={!input.trim() || isAIStreaming}
        >
          {isAIStreaming ? '…' : '→'}
        </button>
      </div>
    </div>
  )
}

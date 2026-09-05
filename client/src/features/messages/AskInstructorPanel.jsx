import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getThread, sendMessage } from '../../services/messages.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Avatar, Card } from '../../components/ui/index.js';
import { ErrorBanner } from '../../components/Spinner.jsx';

// Student ↔ instructor chat (S7 D6). One thread per (student, course), plain
// text, polled — no sockets. This module also owns the pieces the instructor
// inbox reuses (the polling hook, the bubble list, the composer) so the two
// screens cannot drift apart.

export const POLL_INTERVAL_MS = 20_000;

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

// Compact, ambient timestamps: a chat is read as "how long ago", not as a date.
export const relativeTime = (value) => {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
};

// Polls `fn` every `POLL_INTERVAL_MS` while the tab is visible. A hidden tab
// costs nothing (the interval is torn down, not merely skipped) and coming back
// refreshes immediately, so the learner never reads a stale thread.
export const usePoll = (fn, enabled = true) => {
  useEffect(() => {
    if (!enabled) return undefined;

    let timer = null;
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      timer = window.setInterval(fn, POLL_INTERVAL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fn();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fn, enabled]);
};

// One conversation, loaded and kept fresh. `pending` holds messages this client
// has just sent: they are shown immediately and dropped as soon as the server
// echoes them back, so a poll that was already in flight cannot make a sent
// message flicker out of the list.
export const useMessageThread = ({ courseId, studentId, viewerId }) => {
  const { user, refreshProfile } = useAuth();
  const [thread, setThread] = useState(null);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(Boolean(courseId));
  const [error, setError] = useState(null);
  const countRef = useRef(-1);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!courseId) return;
      if (!silent) setLoading(true);
      try {
        const data = await getThread(courseId, studentId);
        setThread(data);
        setError(null);
        // Reading the thread clears the other side's unread flags server-side;
        // refresh the header bell so it agrees with what is on screen.
        if (data.messages.length !== countRef.current) {
          countRef.current = data.messages.length;
          refreshProfile?.().catch(() => {});
        }
      } catch (err) {
        // A failed poll keeps the last good thread on screen; only the first
        // load has nothing to fall back on.
        if (!silent) setError(errorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [courseId, studentId, refreshProfile],
  );

  useEffect(() => {
    countRef.current = -1;
    setThread(null);
    setPending([]);
    setError(null);
    if (courseId) load();
  }, [courseId, studentId, load]);

  const poll = useCallback(() => load({ silent: true }), [load]);
  usePoll(poll, Boolean(courseId));

  const messages = useMemo(() => {
    const server = thread?.messages || [];
    const ids = new Set(server.map((message) => message.id));
    const echoed = new Set(server.map((message) => `${message.senderId}|${message.body}`));
    const unconfirmed = pending.filter(
      (message) => !ids.has(message.id) && !echoed.has(`${message.senderId}|${message.body}`),
    );
    return [...server, ...unconfirmed];
  }, [thread, pending]);

  // Optimistic append; the caller decides what to do with a rejection (the
  // panels put the text back in the box).
  const post = useCallback(
    async (payload) => {
      const clientId = `pending-${Date.now()}`;
      const optimistic = {
        id: clientId,
        senderId: viewerId || 'me',
        senderRole: user?.role || 'student',
        body: payload.body,
        createdAt: new Date().toISOString(),
        mine: true,
        pending: true,
      };
      setPending((current) => [...current, optimistic]);

      try {
        const created = await sendMessage(courseId, { ...payload, studentId });
        setPending((current) =>
          current.map((message) => (message.id === clientId ? { ...created, mine: true } : message)),
        );
        await load({ silent: true });
        return created;
      } catch (err) {
        setPending((current) => current.filter((message) => message.id !== clientId));
        throw err;
      }
    },
    [courseId, studentId, viewerId, user?.role, load],
  );

  return { thread, messages, loading, error, reload: load, post };
};

const Bubble = ({ message, name }) => (
  <li className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
    <div className="max-w-[85%]">
      <p className="mb-0.5 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">{name}</span>
        {message.createdAt && <> · {relativeTime(message.createdAt)}</>}
        {message.pending && <> · sending…</>}
      </p>
      {/* Plain text, deliberately: message bodies are never Markdown or HTML. */}
      <p
        className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
          message.mine
            ? 'bg-brand-50 text-slate-900'
            : 'border border-slate-200 bg-slate-50 text-slate-700'
        } ${message.pending ? 'opacity-60' : ''}`}
      >
        {message.body}
      </p>
    </div>
  </li>
);

// The conversation itself. `role="log"` + `aria-live="polite"` means a reply
// arriving from a poll is announced without stealing focus from the composer.
export const MessageList = ({ messages, nameFor, empty, className = 'max-h-64' }) => {
  const listRef = useRef(null);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  return (
    <div
      ref={listRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation"
      className={`overflow-y-auto ${className}`.trim()}
    >
      {messages.length === 0 ? (
        empty
      ) : (
        <ul className="space-y-3 pr-1">
          {messages.map((message) => (
            <Bubble key={message.id} message={message} name={nameFor(message)} />
          ))}
        </ul>
      )}
    </div>
  );
};

// Enter sends, Shift+Enter makes a newline — the convention every chat the
// pilot cohort already uses. The label is real (screen-reader only) so the
// textarea is never an unlabelled box.
export const MessageComposer = ({
  id,
  value,
  onChange,
  onSend,
  sending = false,
  disabled = false,
  label = 'Message',
  placeholder = 'Ask a question…',
}) => {
  const submit = (event) => {
    event.preventDefault();
    if (!value.trim() || sending || disabled) return;
    onSend();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (value.trim() && !sending && !disabled) onSend();
    }
  };

  const canSend = Boolean(value.trim()) && !sending && !disabled;

  // The composer is one bordered surface that the textarea sits inside, rather
  // than a bare <textarea> next to a button. The previous markup asked for a
  // class the stylesheet does not define (`input` — the project's field class
  // is `field`), so it rendered as an unstyled browser textarea: no border
  // radius, no focus ring, a resize grip, and a send button floated beside it
  // on a guessed margin.
  return (
    <form onSubmit={submit}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="rounded-xl border border-slate-300 bg-white shadow-sm transition-colors focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
        <textarea
          id={id}
          rows={2}
          className="block w-full resize-none rounded-t-xl border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          maxLength={4000}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
          <p className="text-[11px] text-slate-400">
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">Enter</kbd>{' '}
            sends ·{' '}
            <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-sans">
              Shift + Enter
            </kbd>{' '}
            new line
          </p>
          <div className="flex items-center gap-2">
            {value.length > 3600 && (
              <span className="text-[11px] tabular-nums text-slate-400">
                {4000 - value.length}
              </span>
            )}
            <button
              type="submit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              disabled={!canSend}
              aria-label="Send message"
            >
              <span aria-hidden="true">{sending ? '…' : '➔'}</span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};

const nameOf = (person, fallback) => {
  if (!person) return fallback;
  return (
    person.name || [person.firstName, person.lastName].filter(Boolean).join(' ') || fallback
  );
};

// Props: { courseId, lessonId, instructor, className }
// `instructor` is optional ({ id, name | firstName, lastName, avatar }) — it
// renders the header before the thread has loaded; the thread's own instructor
// wins once it arrives. `lessonId` is what turns a question into a tracked
// scaffolding event (progressService.recordQuestionAsked).
// `bare` drops the card chrome and the instructor header: inside the floating
// ChatDock both are already supplied by the dock itself, and repeating them
// would nest a titled card inside a titled panel.
export const AskInstructorPanel = ({
  courseId,
  lessonId,
  instructor,
  className = '',
  bare = false,
}) => {
  const { user } = useAuth();
  // This is the STUDENT half of the conversation. The thread endpoint takes the
  // learner from the caller's own token, so an instructor or admin has to name a
  // student instead — which this panel has no way to know. Mounting it for them
  // fired a request that could only ever 400, once on open and again on every
  // 20s poll. They have the inbox at /instructor/messages; here they get
  // nothing. Passing `courseId: undefined` keeps the hooks unconditional while
  // disabling both the initial load and the polling.
  const isStudent = user?.role === 'student';
  const { thread, messages, loading, error, post } = useMessageThread({
    courseId: isStudent ? courseId : undefined,
    viewerId: user?.dbId,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  if (!courseId || !isStudent) return null;

  const staff = thread?.instructor || instructor || null;
  const staffName = nameOf(staff, 'Your instructor');
  const myName = nameOf(thread?.student, 'You');

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    setDraft('');
    try {
      await post({ body, ...(lessonId ? { lessonId } : {}) });
    } catch (err) {
      // Keep what they typed — losing a paragraph of question to a flaky
      // connection is the worst failure this panel can have.
      setDraft(body);
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const body = (
    <>
      {error && <ErrorBanner message={error} />}
      {sendError && <ErrorBanner message={sendError} />}

      <MessageList
        className={bare ? 'min-h-0 flex-1' : undefined}
        messages={messages}
        nameFor={(message) => (message.mine ? myName : staffName)}
        empty={
          <p className="text-sm text-slate-600">
            {loading
              ? 'Loading your conversation…'
              : `Hi, I'm here to help. Have some questions about the lesson? Ask me anything.`}
          </p>
        }
      />

      <MessageComposer
        id={`ask-instructor-${courseId}`}
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        sending={sending}
        label={`Message ${staffName}`}
        placeholder="Ask about this lesson…"
      />
    </>
  );

  // In the dock the surrounding panel already owns the frame and the header,
  // and the conversation has to grow to fill it rather than sit in a card.
  if (bare) {
    return <div className={`flex flex-col gap-3 p-4 ${className}`}>{body}</div>;
  }

  return (
    <Card className={className}>
      <div className="flex items-center gap-3">
        <Avatar src={staff?.avatar} name={staffName} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-brand-700">{staffName}</p>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Instructor
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">{body}</div>
    </Card>
  );
};

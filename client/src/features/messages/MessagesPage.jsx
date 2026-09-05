import { useCallback, useEffect, useMemo, useState } from 'react';

import { listThreads } from '../../services/messages.js';
import { useAuth } from '../../hooks/useAuth.js';
import { Avatar, Card, EmptyState } from '../../components/ui/index.js';
import { Spinner, ErrorBanner } from '../../components/Spinner.jsx';
import {
  MessageComposer,
  MessageList,
  relativeTime,
  useMessageThread,
  usePoll,
} from './AskInstructorPanel.jsx';

// The shared inbox: threads on the left, the selected conversation on the
// right, one thread per (course, student). The polling hook, bubble list and
// composer come from the learner's Ask-instructor panel so both sides of a
// conversation behave identically.
//
// ONE page serves every role. The server returns the same thread shape to a
// student and to course staff, so the only thing that varies is which party is
// "the other one" — and a student who could only reach their threads through a
// lesson page had no way to answer a reply to a lesson they had finished.

const errorMessage = (err) =>
  err?.response?.data?.error?.message || err?.message || 'Something went wrong';

const previewOf = (thread) => {
  const last = thread.lastMessage;
  if (!last) return 'No messages yet';
  return `${last.mine ? 'You: ' : ''}${last.body}`;
};

// A student is talking to the instructor; staff are talking to the learner.
const counterpartyOf = (thread, isStudent) =>
  (isStudent ? thread?.instructor : thread?.student) || null;

const ThreadRow = ({ thread, isStudent, selected, onSelect }) => {
  const other = counterpartyOf(thread, isStudent);
  const name = other?.name || (isStudent ? 'Your instructor' : 'Learner');

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(thread)}
        aria-current={selected ? 'true' : undefined}
        className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
          selected
            ? 'border-brand-200 bg-brand-50'
            : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
        }`}
      >
        <span className="flex items-start gap-3">
          <Avatar src={other?.avatar} name={name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-900">{name}</span>
              <span className="shrink-0 text-[11px] text-slate-400">
                {relativeTime(thread.updatedAt)}
              </span>
            </span>
            <span className="block truncate text-xs text-slate-500">
              {thread.course?.icon ? `${thread.course.icon} ` : ''}
              {thread.course?.title}
            </span>
            <span className="mt-0.5 flex items-center gap-1">
              <span className="truncate text-xs text-slate-600">{previewOf(thread)}</span>
              {thread.unread > 0 && (
                <span
                  className="ml-auto inline-flex min-w-[1.1rem] shrink-0 justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white"
                  aria-label={`${thread.unread} unread`}
                >
                  {thread.unread}
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
};

const Conversation = ({ thread, isStudent, onBack, onRead }) => {
  const { user } = useAuth();
  const { thread: loaded, messages, loading, error, post } = useMessageThread({
    courseId: thread.courseId,
    studentId: thread.studentId,
    viewerId: user?.dbId,
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  useEffect(() => {
    setDraft('');
    setSendError(null);
  }, [thread.id]);

  // Opening a thread clears its unread flags server-side. Refresh the list so
  // the badge disappears now rather than at the next 20s poll.
  useEffect(() => {
    if (!loading && messages.length > 0) onRead?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, thread.id]);

  const otherFromServer = isStudent ? loaded?.instructor : loaded?.student;
  const otherName =
    otherFromServer?.name ||
    counterpartyOf(thread, isStudent)?.name ||
    (isStudent ? 'Your instructor' : 'Learner');
  const myName = (isStudent ? loaded?.student?.name : loaded?.instructor?.name) || 'You';

  const handleSend = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    setDraft('');
    try {
      await post({ body });
      onRead?.();
    } catch (err) {
      setDraft(body);
      setSendError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-ghost px-2 lg:hidden" onClick={onBack}>
          <span aria-hidden="true">←</span> Threads
        </button>
        <Avatar src={otherFromServer?.avatar} name={otherName} size="md" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{otherName}</p>
          <p className="truncate text-xs text-slate-500">
            {thread.course?.icon ? `${thread.course.icon} ` : ''}
            {thread.course?.title}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {error && <ErrorBanner message={error} />}
        {sendError && <ErrorBanner message={sendError} />}

        <MessageList
          className="max-h-[26rem] min-h-[12rem]"
          messages={messages}
          nameFor={(message) => (message.mine ? myName : otherName)}
          empty={
            <p className="text-sm text-slate-600">
              {loading ? 'Loading the conversation…' : 'No messages in this thread yet.'}
            </p>
          }
        />

        <MessageComposer
          id={`reply-${thread.id}`}
          value={draft}
          onChange={setDraft}
          onSend={handleSend}
          sending={sending}
          label={`Reply to ${otherName}`}
          placeholder={isStudent ? 'Ask your instructor…' : 'Write a reply…'}
        />
      </div>
    </Card>
  );
};

export const MessagesPage = () => {
  const { user } = useAuth();
  const isStudent = user?.role === 'student';

  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      const rows = await listThreads();
      setThreads(rows);
      setError(null);
    } catch (err) {
      if (!silent) setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const poll = useCallback(() => load({ silent: true }), [load]);
  usePoll(poll);

  const refreshBadges = useCallback(() => load({ silent: true }), [load]);

  const selected = useMemo(
    () => (threads || []).find((thread) => thread.id === selectedId) || null,
    [threads, selectedId],
  );

  const totalUnread = (threads || []).reduce((sum, thread) => sum + (thread.unread || 0), 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">Messages</h1>
        <p className="mt-1 text-slate-600">
          {isStudent
            ? 'Your conversations with the instructors of the courses you are enrolled in.'
            : 'Questions from students on the courses you teach.'}
          {totalUnread > 0 && ` ${totalUnread} unread.`}
        </p>
      </header>

      {error && <ErrorBanner message={error} />}
      {threads === null && !error && <Spinner label="Loading your messages…" />}

      {threads !== null && threads.length === 0 && (
        <EmptyState
          icon="💬"
          title={isStudent ? 'No conversations yet' : 'No questions yet'}
          description={
            isStudent
              ? 'Open a lesson and use “Ask your instructor” to start a conversation. It will appear here.'
              : 'When a student asks a question from a lesson, the thread appears here.'
          }
        />
      )}

      {threads !== null && threads.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          {/* On narrow screens the conversation replaces the list; from lg up
              they sit side by side. */}
          <Card title="Threads" className={selected ? 'hidden lg:block' : ''}>
            <ul className="max-h-[32rem] space-y-1 overflow-y-auto">
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  isStudent={isStudent}
                  selected={thread.id === selectedId}
                  onSelect={(next) => setSelectedId(next.id)}
                />
              ))}
            </ul>
          </Card>

          {selected ? (
            <Conversation
              thread={selected}
              isStudent={isStudent}
              onBack={() => setSelectedId(null)}
              onRead={refreshBadges}
            />
          ) : (
            <EmptyState
              className="hidden lg:block"
              icon="✉️"
              title="Pick a thread"
              description="Select a conversation on the left to read it and reply."
            />
          )}
        </div>
      )}
    </div>
  );
};

// The instructor route predates the shared page; both now render the same
// component, so staff and learners cannot drift apart.
export const InstructorMessagesPage = MessagesPage;

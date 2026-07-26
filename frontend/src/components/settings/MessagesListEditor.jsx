import React, { memo, useState, useRef, useEffect, useCallback } from 'react';
import { TrashIcon } from '../Icons';

function normalizeMessages(messages) {
  return Array.isArray(messages) ? messages.filter((m) => typeof m === 'string') : [];
}

const MessageItem = memo(function MessageItem({
  value,
  index,
  onChange,
  onRemove,
  onBlur,
  inputRef,
}) {
  return (
    <div className="category-msg-item">
      <span className="category-msg-index" aria-hidden="true">
        {index + 1}
      </span>
      <textarea
        ref={inputRef}
        className="msg-textarea category-msg-item-textarea fs-13"
        rows={3}
        value={value}
        placeholder="Текст сообщения… Enter — новая строка"
        onChange={(e) => onChange(index, e.target.value)}
        onBlur={() => onBlur(index)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="socialBtn mini-btn mini-btn-danger category-msg-remove"
        title="Удалить сообщение"
        onClick={() => onRemove(index)}
      >
        <TrashIcon />
      </button>
    </div>
  );
});

const MessagesListEditor = memo(function MessagesListEditor({
  messages,
  onCommit,
  debounceMs = 400,
}) {
  const source = normalizeMessages(messages);
  const [items, setItems] = useState(source);
  const lastCommitted = useRef(JSON.stringify(source));
  const timerRef = useRef(null);
  const focusIndexRef = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    const serialized = JSON.stringify(source);
    if (serialized !== lastCommitted.current) {
      setItems(source);
      lastCommitted.current = serialized;
    }
  }, [source]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const buildCommitPayload = useCallback(
    (list) => list.filter((m) => m.trim() !== ''),
    []
  );

  const commitNow = useCallback(
    (list) => {
      const payload = buildCommitPayload(list);
      lastCommitted.current = JSON.stringify(payload);
      onCommit(payload);
      return payload;
    },
    [buildCommitPayload, onCommit]
  );

  const scheduleCommit = useCallback(
    (list) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => commitNow(list), debounceMs);
    },
    [commitNow, debounceMs]
  );

  const handleChange = (index, text) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = text;
      scheduleCommit(next);
      return next;
    });
  };

  const handleBlur = (index) => {
    clearTimeout(timerRef.current);
    setItems((prev) => {
      let next = [...prev];
      if (next[index]?.trim() === '' && next.length > 1) {
        next = next.filter((_, i) => i !== index);
      }
      commitNow(next);
      return next;
    });
  };

  const handleAdd = () => {
    setItems((prev) => {
      const next = [...prev, ''];
      focusIndexRef.current = next.length - 1;
      return next;
    });
  };

  useEffect(() => {
    if (focusIndexRef.current === null) return;
    const el = itemRefs.current[focusIndexRef.current];
    el?.focus();
    focusIndexRef.current = null;
  }, [items.length]);

  const handleRemove = (index) => {
    clearTimeout(timerRef.current);
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== index);
      commitNow(next);
      return next;
    });
  };

  return (
    <div className="category-messages-editor">
      {items.map((text, i) => (
        <MessageItem
          key={i}
          index={i}
          value={text}
          inputRef={(el) => {
            itemRefs.current[i] = el;
          }}
          onChange={handleChange}
          onRemove={handleRemove}
          onBlur={handleBlur}
        />
      ))}
      <button
        type="button"
        className="btn-primary btn-sm btn-outline category-msg-add"
        onClick={handleAdd}
      >
        + Сообщение
      </button>
    </div>
  );
});

export default MessagesListEditor;

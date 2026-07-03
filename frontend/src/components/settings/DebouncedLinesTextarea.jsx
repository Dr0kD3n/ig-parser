import React, { memo, useState, useRef, useEffect, useCallback } from 'react';

const DebouncedLinesTextarea = memo(function DebouncedLinesTextarea({
  lines,
  onCommit,
  debounceMs = 400,
  className,
  style,
  placeholder,
}) {
  const serialized = (lines || []).join('\n');
  const [draft, setDraft] = useState(serialized);
  const lastCommitted = useRef(serialized);
  const timerRef = useRef(null);

  useEffect(() => {
    if (serialized !== lastCommitted.current) {
      setDraft(serialized);
      lastCommitted.current = serialized;
    }
  }, [serialized]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const commit = useCallback(
    (text) => {
      lastCommitted.current = text;
      onCommit(text.split('\n'));
    },
    [onCommit]
  );

  const handleChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(val), debounceMs);
  };

  const handleBlur = () => {
    clearTimeout(timerRef.current);
    commit(draft);
  };

  return (
    <textarea
      className={className}
      style={style}
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  );
});

export default DebouncedLinesTextarea;

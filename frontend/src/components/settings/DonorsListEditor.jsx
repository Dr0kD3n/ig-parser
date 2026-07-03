import React, { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';

const DonorsListEditor = memo(function DonorsListEditor({ donors, onCommit }) {
  const serialized = useMemo(
    () => (donors || []).map((d) => (typeof d === 'string' ? d : d.url)).join('\n'),
    [donors]
  );
  const [draft, setDraft] = useState(serialized);
  const lastCommitted = useRef(serialized);
  const timerRef = useRef(null);
  const donorsRef = useRef(donors);

  useEffect(() => {
    donorsRef.current = donors;
  }, [donors]);

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
      const lines = text.split('\n');
      const updated = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const existing = (donorsRef.current || []).find(
          (ed) => (typeof ed === 'string' ? ed : ed.url) === trimmed
        );
        return existing || line;
      });
      onCommit(updated);
    },
    [onCommit]
  );

  const handleChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(val), 400);
  };

  return (
    <textarea
      className="msg-textarea donors-raw-textarea"
      value={draft}
      onChange={handleChange}
      onBlur={() => {
        clearTimeout(timerRef.current);
        commit(draft);
      }}
      placeholder={'https://www.instagram.com/username/\nhttps://www.instagram.com/username2/'}
    />
  );
});

export default DonorsListEditor;

import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { useMemo } from 'react';

const extensionsFor = {
  javascript: () => [javascript()],
  json: () => [json()],
  text: () => [],
};

export function CodeEditor({ value, onChange, language = 'javascript', readOnly = false, placeholder }) {
  const extensions = useMemo(
    () => (extensionsFor[language] ?? extensionsFor.text)(),
    [language],
  );

  return (
    <div className="editor-wrap">
      <CodeMirror
        value={value ?? ''}
        onChange={onChange}
        extensions={extensions}
        theme="dark"
        readOnly={readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !readOnly,
          autocompletion: !readOnly,
          bracketMatching: true,
        }}
      />
    </div>
  );
}

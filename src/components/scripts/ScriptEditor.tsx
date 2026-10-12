import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { FileUp, Loader2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScriptInput, ScriptType, StoredScript } from '@/services/scripts';
import { TYPE_LABEL } from '@/lib/scripts';

const inputClass = 'h-11 w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 text-[13.5px] outline-none transition-colors placeholder:text-faint focus:border-accent/45';

/** Guess the type from a file name or the shebang line */
function detectType(fileName: string, content: string): ScriptType | null {
  if (/\.py$/i.test(fileName) || /^#!.*python/.test(content)) return 'python';
  if (/\.ps1$/i.test(fileName) || /^#!.*pwsh/.test(content)) return 'powershell';
  if (/\.(sh|bash)$/i.test(fileName) || /^#!.*\b(ba)?sh\b/.test(content)) return 'bash';
  return null;
}

/** Plain textarea with a line-number gutter; Tab inserts two spaces */
function CodeArea({ value, onChange, onFile }: { value: string; onChange: (value: string) => void; onFile: (file: File) => void }) {
  const gutter = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const lines = Math.max(value.split('\n').length, 18);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    onChange(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`);
    requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={cn('relative flex h-[440px] overflow-hidden rounded-2xl border bg-canvas transition-colors', dragging ? 'border-accent/60' : 'border-line/[0.10] focus-within:border-accent/45')}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div ref={gutter} className="w-11 shrink-0 select-none overflow-hidden border-r border-line/[0.06] py-3 pr-2 text-right font-mono text-[11.5px] leading-[20px] text-faint" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => <div key={index}>{index + 1}</div>)}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        spellCheck={false}
        placeholder={'#!/bin/bash\n# Script hier einfügen oder eine Datei hierher ziehen'}
        className="scroll-thin h-full flex-1 resize-none whitespace-pre bg-transparent px-3 py-3 font-mono text-[12.5px] leading-[20px] text-ink outline-none placeholder:text-faint"
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent/[0.06] text-[13px] text-accent">
          <FileUp className="mr-2 size-4" /> Datei loslassen zum Einfügen
        </div>
      )}
    </div>
  );
}

export function ScriptEditor({ script, saving, onSave, onCancel }: { script?: StoredScript | null; saving: boolean; onSave: (input: ScriptInput) => void; onCancel: () => void }) {
  const [name, setName] = useState(script?.name ?? '');
  const [description, setDescription] = useState(script?.description ?? '');
  const [type, setType] = useState<ScriptType>(script?.type ?? 'bash');
  const [tags, setTags] = useState((script?.tags ?? []).join(', '));
  const [content, setContent] = useState(script?.content ?? '');
  const fileInput = useRef<HTMLInputElement>(null);

  const loadFile = async (file: File) => {
    if (file.size > 256 * 1024) return;
    const text = await file.text();
    setContent(text);
    const detected = detectType(file.name, text);
    if (detected) setType(detected);
    if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, ''));
  };

  const error = !name.trim() ? 'Name fehlt' : !content.trim() ? 'Script ist leer' : content.length > 256 * 1024 ? 'Script ist größer als 256 KB' : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 px-7 pb-6 pt-7">
        <div>
          <p className="text-[12px] text-muted">{script?.id ? 'Script bearbeiten' : 'Neues Script'}</p>
          <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{name.trim() || 'Ohne Namen'}</h2>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, z. B. Updates einspielen" maxLength={120} />
          <div className="flex rounded-full border border-line/[0.10] bg-raised/50 p-1">
            {(Object.keys(TYPE_LABEL) as ScriptType[]).map((option) => (
              <button key={option} type="button" onClick={() => setType(option)} className={cn('relative h-9 rounded-full px-3.5 text-[12.5px] transition-colors', type === option ? 'text-ink' : 'text-muted hover:text-ink')}>
                {type === option && <motion.span layoutId="script-type" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
                <span className="relative">{TYPE_LABEL[option]}</span>
              </button>
            ))}
          </div>
        </div>
        <input className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Beschreibung (optional): was macht das Script?" />
        <input className={inputClass} value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Tags mit Komma, z. B. wartung, updates" />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[12.5px] font-medium">Script</p>
            <button type="button" onClick={() => fileInput.current?.click()} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] text-muted hover:bg-raised hover:text-ink">
              <FileUp className="size-3.5" /> Datei laden
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".sh,.bash,.py,.ps1,.txt,text/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void loadFile(file);
                event.target.value = '';
              }}
            />
          </div>
          <CodeArea value={content} onChange={setContent} onFile={(file) => void loadFile(file)} />
          <p className="mt-2 text-[11.5px] text-faint">
            Läuft als Temp-Datei mit {type === 'python' ? 'python3' : type === 'powershell' ? 'pwsh' : 'bash'} auf dem Server und wird danach gelöscht. Exit-Code 0 gilt als Erfolg.
          </p>
        </div>
        {error && (name || content) && <p className="text-[12.5px] text-bad">{error}</p>}
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-line/[0.07] bg-panel/95 px-7 py-4 backdrop-blur">
        <button type="button" onClick={onCancel} className="h-11 rounded-full border border-line/[0.12] px-5 text-[13.5px] hover:bg-raised">Abbrechen</button>
        <button
          type="button"
          disabled={!!error || saving}
          onClick={() => onSave({ name: name.trim(), description: description.trim(), type, content, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) })}
          className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Speichern
        </button>
      </div>
    </div>
  );
}

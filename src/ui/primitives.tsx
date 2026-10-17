/**
 * Control primitives. Small, accessible by default: every control has a
 * visible label or an aria-label, a focus ring, and a >= 44px hit area on
 * coarse pointers (handled in CSS).
 */

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/* ---------------------------------------------------------------- buttons */

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  type = 'button',
  disabled,
  busy,
  icon,
  block,
  title
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'quiet' | 'danger';
  size?: 'md' | 'sm';
  type?: 'button' | 'submit';
  disabled?: boolean;
  busy?: boolean;
  icon?: IconName;
  block?: boolean;
  title?: string;
}) {
  const className = [
    'btn',
    variant === 'primary' ? 'btn--primary' : '',
    variant === 'quiet' ? 'btn--quiet' : '',
    variant === 'danger' ? 'btn--danger' : '',
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={className} onClick={onClick} type={type} disabled={disabled || busy} title={title}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  name,
  label,
  onClick,
  size = 20
}: {
  name: IconName;
  label: string;
  onClick?: () => void;
  size?: number;
}) {
  return (
    <button className="iconbtn" onClick={onClick} type="button" aria-label={label} title={label}>
      <Icon name={name} size={size} />
    </button>
  );
}

/* ----------------------------------------------------------------- fields */

export function Field({
  label,
  hint,
  children,
  htmlFor,
  required
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  id,
  type = 'text',
  maxLength,
  autoComplete = 'off'
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  id?: string;
  type?: string;
  maxLength?: number;
  autoComplete?: string;
}) {
  return (
    <input
      className="input"
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  id,
  rows = 4,
  autoFocus
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  return (
    <textarea
      className="textarea"
      id={id}
      value={value}
      rows={rows}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  label
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  id?: string;
  label?: string;
}) {
  return (
    <select
      className="select"
      id={id}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  hiddenLabel
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  /** Keep the label for assistive tech but hide it visually. */
  hiddenLabel?: boolean;
}) {
  const id = useId();
  return (
    <label className="switch" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch__track" aria-hidden="true" />
      <span className={hiddenLabel ? 'sr-only' : undefined}>
        <span className="text-sm">{label}</span>
        {description ? (
          <>
            <br />
            <span className="text-xs text-faint">{description}</span>
          </>
        ) : null}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="segmented__option"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = tone === 'neutral' ? '' : `badge--${tone}`;
  return <span className={`badge ${toneClass}`}>{children}</span>;
}

export function TagChip({ tag, onClick }: { tag: string; onClick?: () => void }) {
  if (!onClick) return <span className="tagchip">#{tag}</span>;
  return (
    <button type="button" className="tagchip" onClick={onClick}>
      #{tag}
    </button>
  );
}

/* ------------------------------------------------------------ misc layout */

export function Row({ children, gap = 2 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="chip-row" style={{ alignItems: 'center', gap: `var(--space-${gap})` }}>
      {children}
    </div>
  );
}

export function Stack({ children, gap = 4 }: { children: ReactNode; gap?: number }) {
  return (
    <div className="form-stack" style={{ gap: `var(--space-${gap})` }}>{children}</div>
  );
}

/** A disclosure that remembers nothing: plain <details> semantics. */
export function Details({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="card">
      <summary>
        <Icon name="chevron-down" size={16} className="icon-inline" />
        {summary}
      </summary>
      <div className="card__body form-stack form-stack--tight">{children}</div>
    </details>
  );
}

/* ------------------------------------------------------------- key handling */

/** Escape closes; used by dialogs and the capture sheet. */
export function useEscape(active: boolean, onClose: () => void): void {
  const handler = useRef(onClose);
  handler.current = onClose;
  useEffect(() => {
    if (!active) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handler.current();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [active]);
}

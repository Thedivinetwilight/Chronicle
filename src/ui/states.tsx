/**
 * Empty / loading / error presentations (§20).
 *
 * An empty state is not a failure: it explains what the place is for and offers
 * the one action that starts it. Loading is quiet. Errors say what went wrong
 * in plain language and always offer a retry.
 */

import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Mark, type MarkName } from './art/Mark';
import { Button } from './primitives';

/**
 * A section's empty state carries the same drawn mark as that section's nav
 * entry, so "Places & people" looks like itself whether you are reading the
 * sidebar or staring at an empty page. Utility states (search, import
 * failures) have no section mark and keep the icon set.
 */
export function EmptyState({
  icon,
  mark,
  title,
  children,
  action,
  compact = false
}: {
  icon?: IconName;
  mark?: MarkName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /**
   * A first-use state on an otherwise empty page. The full panel — a dashed
   * 560px box with a halo above a centred paragraph — is a lot of furniture to
   * describe an empty list, and on a brand-new archive every section is empty,
   * so the user met that box six times before writing anything. Compact states
   * read as one line with the offer beside them.
   */
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="state state--compact">
        {mark ? <Mark name={mark} size={20} className="state__inline-mark" /> : null}
        <div className="state__inline-copy">
          <span className="state__inline-title">{title}</span>
          {children ? <span className="state__inline-note">{' '}{children}</span> : null}
        </div>
        {action ? <div className="state__inline-action">{action}</div> : null}
      </div>
    );
  }
  return (
    <div className="state">
      <div className="state__halo">
        {mark ? <Mark name={mark} size={24} /> : <Icon name={icon ?? 'book'} size={24} />}
      </div>
      <div className="state__title">{title}</div>
      {children ? <div className="text-sm measure">{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state" role="alert">
      <div className="state__halo">
        <Icon name="alert" size={24} />
      </div>
      <div className="state__title">{title}</div>
      {message ? <div className="text-sm measure">{message}</div> : null}
      {onRetry ? (
        <Button onClick={onRetry} icon="undo">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Placeholder rows that keep the layout stable while a query resolves. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card card__body form-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="form-stack form-stack--tight">
          <div className="skeleton" style={{ height: 14, width: `${58 - index * 6}%` }} />
          <div className="skeleton" style={{ height: 12, width: `${82 - index * 4}%` }} />
        </div>
      ))}
    </div>
  );
}

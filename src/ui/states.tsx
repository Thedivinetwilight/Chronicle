/**
 * Empty / loading / error presentations (§20).
 *
 * An empty state is not a failure: it explains what the place is for and offers
 * the one action that starts it. Loading is quiet. Errors say what went wrong
 * in plain language and always offer a retry.
 */

import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Button } from './primitives';

export function EmptyState({
  icon = 'book',
  title,
  children,
  action
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state__halo">
        <Icon name={icon} size={24} />
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

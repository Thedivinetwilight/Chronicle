/**
 * Trips — dates, places and notes together.
 *
 * Travel documents are sensitive. Confirmation numbers, booking references and
 * ticket details live in one field (`sensitive_notes`) that is:
 *  - masked on screen until the owner explicitly reveals it,
 *  - never included in a share preview (see `domain/share/preview.ts`),
 *  - never written to the console, a URL, or any network call.
 *
 * Sharing a trip is *not* implemented in this build. The trip page links to the
 * share preview screen, which explains exactly what would be visible and states
 * plainly that nothing is published.
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChronicle } from '../../state/ChronicleContext';
import { useEntries, usePlaces, useTrip, useTrips } from '../../state/hooks';
import type { Trip } from '../../domain/types';
import { formatDateLabel } from '../../domain/time';
import { WhenItHappened } from '../../ui/format';
import { Badge, Button, Field, IconButton, TextArea, TextInput } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { EmptyState, ErrorState, SkeletonList } from '../../ui/states';
import { Icon } from '../../ui/Icon';
import { Cover } from '../../ui/art/Cover';

function tripDates(trip: Trip): string {
  if (trip.start_date && trip.end_date) return `${formatDateLabel(trip.start_date)} – ${formatDateLabel(trip.end_date)}`;
  if (trip.start_date) return `From ${formatDateLabel(trip.start_date)}`;
  if (trip.end_date) return `Until ${formatDateLabel(trip.end_date)}`;
  return trip.date_hint ?? 'Dates not known';
}

export function TripsPage() {
  const trips = useTrips();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (trips === undefined) return <SkeletonList rows={3} />;

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">Places, together</span>
          <h1>Trips</h1>
          <p className="text-sm text-muted measure">
            Collect a journey’s dates, places and notes. Confirmation numbers are kept apart and private by default.
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New trip
        </Button>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {trips.length === 0 ? (
        <EmptyState
          mark="ridge"
          compact
          title="No trips yet"
        >
          Keep a journey's places and dates together.
        </EmptyState>
      ) : (
        <div className="covershelf covershelf--wide">
          {trips.map((trip) => (
            <Link key={trip.id} to={`/trips/${trip.id}`} className="covershelf__item rowlink">
              <span className="coverframe">
                <Cover kind="trip" id={trip.id} name={trip.name} />
              </span>
              <span className="covershelf__name">{trip.name}</span>
              <span className="covershelf__meta">
                {tripDates(trip)}
                {trip.place_ids.length > 0 ? ` · ${trip.place_ids.length} place${trip.place_ids.length === 1 ? '' : 's'}` : ''}
              </span>
              {trip.sensitive_notes ? <span className="covershelf__flag">Has private details</span> : null}
            </Link>
          ))}
        </div>
      )}

      <TripDialog open={creating} trip={null} onClose={() => setCreating(false)} onSaved={() => setCreating(false)} onError={setError} />
    </div>
  );
}

export function TripPage() {
  const { tripId } = useParams();
  const { store, toast, timezone } = useChronicle();
  const trip = useTrip(tripId);
  const places = usePlaces();
  const entries = useEntries({});
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (trip === undefined) return <SkeletonList rows={3} />;
  if (trip === null) return <ErrorState title="Trip not found" message="It may have been deleted." />;

  const tripPlaces = (places ?? []).filter((place) => trip.place_ids.includes(place.id));
  // An experience is shown as part of the trip only when its text names one of
  // the trip's recorded places. Chronicle does not invent trip membership.
  const related = (entries ?? []).filter((entry) => {
    if (entry.deleted_at) return false;
    const text = `${entry.title}\n${entry.body}`.toLowerCase();
    return tripPlaces.some((place) => place.name.length > 2 && text.includes(place.name.toLowerCase()));
  });

  const remove = async () => {
    try {
      await store.deleteTrip(trip.id);
      toast('Trip deleted. You can restore it from Settings.', { tone: 'success' });
      setConfirmDelete(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The trip could not be deleted.');
      setConfirmDelete(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">{tripDates(trip)}</span>
          <h1>{trip.name}</h1>
          <p className="text-sm text-muted">
            <Badge>
              <Icon name="lock" size={10} className="icon-inline" /> private by default
            </Badge>
            {trip.date_precision === 'unknown' ? <Badge>dates not exact</Badge> : null}
          </p>
        </div>
        <div className="page__actions">
          <IconButton name="edit" label="Edit trip" onClick={() => setEditing(true)} />
          <IconButton name="trash" label="Delete trip" onClick={() => setConfirmDelete(true)} />
        </div>
      </header>

      {error ? (
        <p className="note note--danger" role="alert">
          <Icon name="alert" size={16} className="note__icon" /> {error}
        </p>
      ) : null}

      {trip.description ? (
        <article className="card">
          <div className="card__body text-block">{trip.description}</div>
        </article>
      ) : null}

      <section aria-label="Places on this trip">
        <div className="section-head">
          <h2 className="section-head__title">Places</h2>
        </div>
        {tripPlaces.length === 0 ? (
          <p className="text-sm text-muted">No places linked yet. Edit the trip to add the places you recorded.</p>
        ) : (
          <div className="chip-row">
            {tripPlaces.map((place) => (
              <span key={place.id} className="tagchip">
                <Icon name="pin" size={13} className="icon-inline" /> {place.name}
                {place.region ? <span className="text-faint">, {place.region}</span> : null}
              </span>
            ))}
          </div>
        )}
      </section>

      {trip.sensitive_notes ? (
        <section aria-label="Private travel details">
          <div className="section-head">
            <h2 className="section-head__title">Private details</h2>
            <button type="button" className="section-head__link" onClick={() => setRevealed((value) => !value)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          </div>
          <p className="text-xs text-faint" style={{ marginBottom: 'var(--space-2)' }}>
            Booking references and confirmation numbers. Hidden by default, never included in a share preview, and
            never leaves this device.
          </p>
          <div className="sensitive" aria-live="polite">
            {revealed ? (
              <span className="text-block">{trip.sensitive_notes}</span>
            ) : (
              <span>
                <Icon name="shield" size={15} className="icon-inline" /> Hidden — {trip.sensitive_notes.length}{' '}
                characters of private details.
              </span>
            )}
          </div>
        </section>
      ) : null}

      <section aria-label="Experiences that mention this trip's places">
        <div className="section-head">
          <h2 className="section-head__title">Experiences mentioning these places</h2>
        </div>
        {related.length === 0 ? (
          <p className="text-sm text-muted">
            None of your experiences mention {tripPlaces.length > 0 ? 'these places' : 'this trip’s places'} yet.
          </p>
        ) : (
          <>
            <p className="text-xs text-faint" style={{ marginBottom: 'var(--space-2)' }}>
              Found by matching the place names you recorded against your own text. This is a reading aid, not a link
              Chronicle created for you.
            </p>
            <div className="card list">
              {related.map((entry) => (
                <Link key={entry.id} to={`/journal/${entry.id}`} className="list__item entrycard">
                  <span className="entrycard__title">{entry.title || 'Untitled experience'}</span>
                  <span className="entrycard__meta">
                    <WhenItHappened at={entry.occurred_at} precision={entry.occurred_precision} timezone={timezone} unknownLabel="Date not recorded" />
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="note">
        <Icon name="info" size={16} className="note__icon" />
        <span>
          A shareable trip recap is planned but not implemented. Chronicle has no accounts or server in this build, so
          nothing can be published. <Link to="/share-preview">See what a preview would contain</Link>.
        </span>
      </div>

      <TripDialog open={editing} trip={trip} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onError={setError} />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this trip?"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Keep trip
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete trip
            </Button>
          </>
        }
      >
        <p className="text-sm">
          The trip moves to Deleted and can be restored. Its private details are deleted along with it when you empty
          the deleted bin. Places and experiences are not affected.
        </p>
      </Dialog>
    </div>
  );
}

function TripDialog({
  open,
  trip,
  onClose,
  onSaved,
  onError
}: {
  open: boolean;
  trip: Trip | null;
  onClose: () => void;
  onSaved: (trip: Trip) => void;
  onError: (message: string | null) => void;
}) {
  const { store } = useChronicle();
  const places = usePlaces();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [placeIds, setPlaceIds] = useState<string[]>([]);
  const [sensitive, setSensitive] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (trip?.id ?? 'new') : null;
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setName(trip?.name ?? '');
    setDescription(trip?.description ?? '');
    setStartDate(trip?.start_date ?? '');
    setEndDate(trip?.end_date ?? '');
    setPlaceIds(trip?.place_ids ?? []);
    setSensitive(trip?.sensitive_notes ?? '');
    setSaveError(null);
  }

  if (!open) return null;

  const togglePlace = (id: string) => {
    setPlaceIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        start_date: startDate || null,
        end_date: endDate || null,
        date_precision: (startDate || endDate ? 'day' : 'unknown') as Trip['date_precision'],
        place_ids: placeIds,
        sensitive_notes: sensitive.trim() || undefined
      };
      const saved = trip ? await store.updateTrip(trip.id, payload) : await store.createTrip(payload);
      onError(null);
      onSaved(saved);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'The trip could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={trip ? 'Edit trip' : 'New trip'}
      wide
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>
            {trip ? 'Save trip' : 'Create trip'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {saveError ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" /> {saveError} Nothing was saved — your text is kept.
          </p>
        ) : null}
        <Field label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="Japan 2025" maxLength={120} />
        </Field>
        <Field label="Description" hint="Optional.">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <div className="grid-fields">
          <Field label="Started" hint="Leave empty if unsure.">
            <TextInput type="date" value={startDate} onChange={setStartDate} />
          </Field>
          <Field label="Ended">
            <TextInput type="date" value={endDate} onChange={setEndDate} />
          </Field>
        </div>
        <Field label="Places" hint="Only places you have already recorded. Add more from a chapter or the trip page.">
          {(places ?? []).length === 0 ? (
            <p className="text-sm text-muted">No places recorded yet — a trip can be saved without any.</p>
          ) : (
            <div className="chip-row" role="group" aria-label="Places on this trip">
              {(places ?? []).map((place) => (
                <button
                  key={place.id}
                  type="button"
                  className="tagchip"
                  aria-pressed={placeIds.includes(place.id)}
                  onClick={() => togglePlace(place.id)}
                >
                  {place.name}
                </button>
              ))}
            </div>
          )}
        </Field>
        <Field
          label="Private details"
          hint="Confirmation numbers, booking references. Stored privately, hidden by default, excluded from share previews."
        >
          <TextArea value={sensitive} onChange={setSensitive} rows={3} />
        </Field>
      </div>
    </Dialog>
  );
}

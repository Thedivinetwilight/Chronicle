/**
 * Places and people.
 *
 * Two kinds of record that exist mostly as *references*: a place is somewhere
 * you went, a person is someone you were with. Chronicle stores the name the
 * user typed and nothing more — no coordinates, no geocoding, no profile of
 * anyone. Both are private by default.
 *
 * People are deliberately sparse. Recording that someone was there is not the
 * same as building a social profile of them, and this screen says so.
 */

import { useState } from 'react';
import { useChronicle } from '../../state/ChronicleContext';
import { usePeople, usePlaces } from '../../state/hooks';
import type { Person, Place } from '../../domain/types';
import { Badge, Button, Field, IconButton, Select, TextArea, TextInput } from '../../ui/primitives';
import { Dialog } from '../../ui/Dialog';
import { EmptyState, SkeletonList } from '../../ui/states';
import { Icon } from '../../ui/Icon';

const PLACE_KINDS: { value: Place['kind']; label: string }[] = [
  { value: 'city', label: 'City' },
  { value: 'region', label: 'Region' },
  { value: 'country', label: 'Country' },
  { value: 'venue', label: 'Venue' },
  { value: 'landmark', label: 'Landmark' },
  { value: 'other', label: 'Somewhere else' }
];

export function PlacesPage() {
  const places = usePlaces();
  const people = usePeople();
  const [editingPlace, setEditingPlace] = useState<Place | 'new' | null>(null);
  const [editingPerson, setEditingPerson] = useState<Person | 'new' | null>(null);

  return (
    <div className="page">
      <header className="page__header">
        <div className="page__title">
          <span className="eyebrow">Where and who</span>
          <h1>Places &amp; people</h1>
          <p className="text-sm text-muted measure">
            Names you typed, kept for yourself. Chronicle does not look up addresses, does not store coordinates, and
            does not build a profile of anyone.
          </p>
        </div>
      </header>

      <section aria-label="Places">
        <div className="section-head">
          <h2 className="section-head__title">Places · {places?.length ?? 0}</h2>
          <Button size="sm" icon="plus" onClick={() => setEditingPlace('new')}>
            Add place
          </Button>
        </div>
        {places === undefined ? (
          <SkeletonList rows={2} />
        ) : places.length === 0 ? (
          <EmptyState icon="pin" title="No places yet">
            A place is a name you will recognise — a city, a street, a venue. Adding one lets trips and experiences
            point at it.
          </EmptyState>
        ) : (
          <div className="card list">
            {places.map((place) => (
              <div key={place.id} className="list__item row-between">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="entrycard__title">
                    <Icon name="pin" size={14} className="icon-inline" /> {place.name}
                  </span>
                  <span className="entrycard__meta">
                    {PLACE_KINDS.find((kind) => kind.value === place.kind)?.label ?? 'Place'}
                    {place.region ? ` · ${place.region}` : ''}
                    {place.notes ? ` · ${place.notes.slice(0, 70)}` : ''}
                  </span>
                </span>
                <IconButton name="edit" label={`Edit ${place.name}`} onClick={() => setEditingPlace(place)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="People">
        <div className="section-head">
          <h2 className="section-head__title">People · {people?.length ?? 0}</h2>
          <Button size="sm" icon="plus" onClick={() => setEditingPerson('new')}>
            Add person
          </Button>
        </div>
        {people === undefined ? (
          <SkeletonList rows={2} />
        ) : people.length === 0 ? (
          <EmptyState icon="people" title="No people recorded">
            Someone can be recorded as “the person I was with”, with no surname, no contact details and no account.
            Leaving this empty is a perfectly good choice.
          </EmptyState>
        ) : (
          <div className="card list">
            {people.map((person) => (
              <div key={person.id} className="list__item row-between">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="entrycard__title">
                    <Icon name="people" size={14} className="icon-inline" /> {person.name}
                  </span>
                  <span className="entrycard__meta">
                    {person.relationship ?? 'No relationship noted'} · <Badge>private</Badge>
                  </span>
                </span>
                <IconButton name="edit" label={`Edit ${person.name}`} onClick={() => setEditingPerson(person)} />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-faint">
          People are never shown in a share preview in this build, and no person record can be made public.
        </p>
      </section>

      <PlaceDialog
        open={editingPlace !== null}
        place={editingPlace === 'new' ? null : editingPlace}
        onClose={() => setEditingPlace(null)}
      />
      <PersonDialog
        open={editingPerson !== null}
        person={editingPerson === 'new' ? null : editingPerson}
        onClose={() => setEditingPerson(null)}
      />
    </div>
  );
}

function PlaceDialog({ open, place, onClose }: { open: boolean; place: Place | null; onClose: () => void }) {
  const { store, toast } = useChronicle();
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [kind, setKind] = useState<Place['kind']>('city');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (place?.id ?? 'new') : null;
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setName(place?.name ?? '');
    setRegion(place?.region ?? '');
    setKind(place?.kind ?? 'city');
    setNotes(place?.notes ?? '');
    setError(null);
  }

  if (!open) return null;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        region: region.trim() || undefined,
        kind,
        notes: notes.trim() || undefined,
        // A place is private unless the user changes it somewhere that offers
        // that choice; no such control exists yet, so it stays private.
        visibility: place?.visibility ?? ('private' as const)
      };
      if (place) await store.updatePlace(place.id, payload);
      else await store.createPlace(payload);
      toast(place ? 'Place updated.' : 'Place added.', { tone: 'success' });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The place could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={place ? 'Edit place' : 'Add a place'}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>
            {place ? 'Save place' : 'Add place'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {error ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" /> {error} Nothing was saved.
          </p>
        ) : null}
        <Field label="Name" required hint="However you think of it — “Kotturpuram”, “Grandma's village”.">
          <TextInput value={name} onChange={setName} maxLength={120} />
        </Field>
        <div className="grid-fields">
          <Field label="Kind">
            <Select label="Kind" value={kind} onChange={setKind} options={PLACE_KINDS} />
          </Field>
          <Field label="Region" hint="Optional.">
            <TextInput value={region} onChange={setRegion} maxLength={80} />
          </Field>
        </div>
        <Field label="Notes" hint="Optional, private to you.">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
        <p className="text-xs text-faint">
          No coordinates are stored. Chronicle cannot place this on a real map, by design.
        </p>
      </div>
    </Dialog>
  );
}

function PersonDialog({ open, person, onClose }: { open: boolean; person: Person | null; onClose: () => void }) {
  const { store, toast } = useChronicle();
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = open ? (person?.id ?? 'new') : null;
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setName(person?.name ?? '');
    setRelationship(person?.relationship ?? '');
    setNotes(person?.notes ?? '');
    setError(null);
  }

  if (!open) return null;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        relationship: relationship.trim() || undefined,
        notes: notes.trim() || undefined
      };
      if (person) await store.updatePerson(person.id, payload);
      else await store.createPerson(payload);
      toast(person ? 'Person updated.' : 'Person added.', { tone: 'success' });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The person could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={person ? 'Edit person' : 'Add a person'}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={() => void save()}>
            {person ? 'Save' : 'Add person'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        {error ? (
          <p className="note note--danger" role="alert">
            <Icon name="alert" size={16} className="note__icon" /> {error} Nothing was saved.
          </p>
        ) : null}
        <Field label="Name" required hint="A first name or a nickname is enough.">
          <TextInput value={name} onChange={setName} maxLength={120} />
        </Field>
        <Field label="How you know them" hint="Optional. “Sister”, “college friend”, “neighbour”.">
          <TextInput value={relationship} onChange={setRelationship} maxLength={80} />
        </Field>
        <Field label="Notes" hint="Optional. Only what you would want to remember.">
          <TextArea value={notes} onChange={setNotes} rows={2} />
        </Field>
        <p className="text-xs text-faint">
          This is a note about your own memory, not a profile of another person. No contact details, no photos, no
          public page.
        </p>
      </div>
    </Dialog>
  );
}

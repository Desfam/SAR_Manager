import { useState } from 'react';
import { Siren } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import type { SocEvent } from '@/services/soc';
import { AssessmentCard } from './AssessmentCard';
import { EventContextPanel } from './EventContextPanel';
import { IncidentFormDrawer } from './IncidentForm';
import { draftFromEvent, type IncidentDraft } from '@/lib/soc';

/** Assessment and full context of one event in a side panel */
export function EventDrawer({ event, onClose }: { event: SocEvent | null; onClose: () => void }) {
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  return (
    <>
    <Drawer open={!!event} onClose={onClose} label="Event" width={860}>
      {event && (
        <div className="space-y-6 px-7 pb-8 pt-7">
          <div className="flex justify-end">
            <button type="button" onClick={() => setDraft(draftFromEvent(event))} className="flex h-9 items-center gap-2 rounded-full border border-accent/30 px-4 text-[12.5px] text-accent hover:bg-accent/10">
              <Siren className="size-4" /> Incident anlegen
            </button>
          </div>
          <AssessmentCard event={event} />
          <div className="border-t border-line/[0.07] pt-4">
            <EventContextPanel key={`${event.index}/${event.id}`} event={event} />
          </div>
        </div>
      )}
    </Drawer>
    <IncidentFormDrawer draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}
